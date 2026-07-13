// IPC between pt and the pocket-t daemon over a Unix-domain socket.
//
// Wire protocol — binary frames:
//
//   [1B  type] [4B length BE] [N bytes payload]
//
// pt → daemon frame types:
//   0x01 HELLO       payload: 1 byte protocol_version (= 1)
//   0x02 REGISTER    payload: JSON {sessionId, cwd, pid, rows, cols, shell}
//   0x03 STDOUT      payload: raw PTY output bytes
//   0x04 RESIZE      payload: u16 BE rows | u16 BE cols
//   0x05 EXIT        payload: i32 BE exit_code
//
// daemon → pt frame types:
//   0x10 ACK         payload: empty
//   0x11 INPUT       payload: raw bytes to write into the PTY master
//   0x12 KILL        payload: 1 byte signal number (e.g. SIGTERM=15)
//
// Connection is "fail-soft": if pt can't reach the daemon (socket missing,
// connect refused, daemon down), pt logs once and continues as a plain
// local shell proxy. The daemon enables the remote-control / bubble
// layer; the user's terminal must always work even when the daemon
// is off.

use std::ffi::OsStr;
use std::io::{Error, ErrorKind};
use std::os::fd::RawFd;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

use libc::{
    self, c_int, c_void, close, connect, read, sockaddr_un, socket, AF_UNIX, MSG_NOSIGNAL,
    SOCK_STREAM,
};

pub const PROTOCOL_VERSION: u8 = 1;

// Hard wall-clock budget (ms) for writing one whole frame (header+payload).
// Shared across both write_all calls in send_frame so a single frame can
// never freeze the terminal for more than this, even against a slow-drip
// daemon. See write_all for the two bounds that enforce it.
const FRAME_WRITE_BUDGET_MS: u64 = 2000;

// pt → daemon
pub const FRAME_HELLO: u8 = 0x01;
pub const FRAME_REGISTER: u8 = 0x02;
pub const FRAME_STDOUT: u8 = 0x03;
pub const FRAME_RESIZE: u8 = 0x04;
pub const FRAME_EXIT: u8 = 0x05;

// daemon → pt
pub const FRAME_ACK: u8 = 0x10;
pub const FRAME_INPUT: u8 = 0x11;
pub const FRAME_KILL: u8 = 0x12;
pub const FRAME_RESIZE_REMOTE: u8 = 0x13;

pub struct DaemonConn {
    fd: RawFd,
    // Inbound frame parser state — buffers partial frames between poll wakeups.
    rx_buf: Vec<u8>,
}

pub enum Incoming {
    Ack,
    Input(Vec<u8>),
    Kill(u8),
    /// Remote (browser-initiated) terminal resize. Rows then cols, u16 BE.
    /// pt calls ioctl(TIOCSWINSZ) on the PTY master; the kernel sends
    /// SIGWINCH to the foreground process group and the shell redraws.
    ResizeRemote { rows: u16, cols: u16 },
    Unknown(u8),
}

impl DaemonConn {
    /// Attempt to connect to the daemon at the given Unix socket path.
    /// Returns None (with one logged warning to stderr) on any failure —
    /// caller continues as a plain shell proxy.
    pub fn try_connect(socket_path: &Path) -> Option<Self> {
        // sun_path is fixed-size on every Unix; on macOS it's 104 bytes
        // including the trailing NUL. Reject paths that wouldn't fit.
        let path_bytes = socket_path.as_os_str().as_bytes();
        let mut addr: sockaddr_un = unsafe { std::mem::zeroed() };
        if path_bytes.len() >= addr.sun_path.len() {
            eprintln!("pt: daemon socket path too long: {:?}", socket_path);
            return None;
        }

        let fd = unsafe { socket(AF_UNIX, SOCK_STREAM, 0) };
        if fd < 0 {
            eprintln!("pt: socket() failed: {}", Error::last_os_error());
            return None;
        }

        addr.sun_family = AF_UNIX as libc::sa_family_t;
        for (i, &b) in path_bytes.iter().enumerate() {
            addr.sun_path[i] = b as libc::c_char;
        }

        let addrlen = std::mem::size_of::<sockaddr_un>() as libc::socklen_t;
        let rc = unsafe { connect(fd, &addr as *const _ as *const _, addrlen) };
        if rc < 0 {
            let err = Error::last_os_error();
            // ENOENT (no socket file) and ECONNREFUSED (daemon down) are
            // expected when the daemon isn't running — degrade quietly.
            match err.kind() {
                ErrorKind::NotFound | ErrorKind::ConnectionRefused => {
                    // Quiet — the user may not have started the daemon yet.
                }
                _ => {
                    eprintln!("pt: connect({:?}) failed: {}", socket_path, err);
                }
            }
            unsafe { close(fd) };
            return None;
        }

        // Make the socket non-blocking so reads in poll() don't stall.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL, 0) };
        if flags >= 0 {
            unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) };
        }

        Some(DaemonConn {
            fd,
            rx_buf: Vec::with_capacity(8192),
        })
    }

    pub fn fd(&self) -> RawFd {
        self.fd
    }

    /// Write a complete frame. Best-effort: short writes / EAGAIN are
    /// retried briefly; permanent errors are reported and the caller may
    /// decide to drop the connection.
    pub fn send_frame(&self, frame_type: u8, payload: &[u8]) -> Result<(), Error> {
        let len = payload.len();
        if len > u32::MAX as usize {
            return Err(Error::new(ErrorKind::InvalidInput, "payload too large"));
        }
        let mut header = [0u8; 5];
        header[0] = frame_type;
        header[1..5].copy_from_slice(&(len as u32).to_be_bytes());
        // One wall-clock deadline shared by the header and payload writes of
        // this frame. Without it each write_all got its own budget, so a
        // single frame could freeze the terminal for ~2x the per-write cap
        // (header stall + payload stall) against a wedged/slow-drip daemon.
        let deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(FRAME_WRITE_BUDGET_MS);
        write_all(self.fd, &header, deadline)?;
        if !payload.is_empty() {
            write_all(self.fd, payload, deadline)?;
        }
        Ok(())
    }

    /// Convenience: send HELLO with the current protocol version.
    pub fn send_hello(&self) -> Result<(), Error> {
        self.send_frame(FRAME_HELLO, &[PROTOCOL_VERSION])
    }

    /// Convenience: send REGISTER with the session metadata as JSON.
    pub fn send_register(
        &self,
        session_id: &str,
        cwd: &Path,
        pid: i32,
        rows: u16,
        cols: u16,
        shell: &str,
    ) -> Result<(), Error> {
        let cwd_str = cwd.to_string_lossy();
        let json = format!(
            "{{\"sessionId\":\"{}\",\"cwd\":\"{}\",\"pid\":{},\"rows\":{},\"cols\":{},\"shell\":\"{}\"}}",
            json_escape(session_id),
            json_escape(&cwd_str),
            pid,
            rows,
            cols,
            json_escape(shell),
        );
        self.send_frame(FRAME_REGISTER, json.as_bytes())
    }

    pub fn send_stdout(&self, bytes: &[u8]) -> Result<(), Error> {
        self.send_frame(FRAME_STDOUT, bytes)
    }

    pub fn send_resize(&self, rows: u16, cols: u16) -> Result<(), Error> {
        let mut payload = [0u8; 4];
        payload[0..2].copy_from_slice(&rows.to_be_bytes());
        payload[2..4].copy_from_slice(&cols.to_be_bytes());
        self.send_frame(FRAME_RESIZE, &payload)
    }

    pub fn send_exit(&self, code: i32) -> Result<(), Error> {
        self.send_frame(FRAME_EXIT, &code.to_be_bytes())
    }

    /// Drain whatever the daemon has queued on our side of the socket,
    /// returning all fully-parsed frames. Call after poll() reports POLLIN
    /// on self.fd().
    pub fn read_incoming(&mut self) -> Result<Vec<Incoming>, Error> {
        let mut tmp = [0u8; 4096];
        loop {
            let n = unsafe { read(self.fd, tmp.as_mut_ptr() as *mut c_void, tmp.len()) };
            if n > 0 {
                self.rx_buf.extend_from_slice(&tmp[..n as usize]);
                if (n as usize) < tmp.len() {
                    break;
                }
                // Otherwise loop and read more — might be more queued.
                continue;
            }
            if n == 0 {
                return Err(Error::new(ErrorKind::UnexpectedEof, "daemon closed connection"));
            }
            // n < 0
            let err = Error::last_os_error();
            match err.raw_os_error() {
                // On macOS/Linux EAGAIN == EWOULDBLOCK, so matching just
                // EAGAIN covers both.
                Some(libc::EAGAIN) => break,
                Some(libc::EINTR) => continue,
                _ => return Err(err),
            }
        }

        let mut out = Vec::new();
        loop {
            if self.rx_buf.len() < 5 {
                break;
            }
            let frame_type = self.rx_buf[0];
            let len = u32::from_be_bytes([
                self.rx_buf[1],
                self.rx_buf[2],
                self.rx_buf[3],
                self.rx_buf[4],
            ]) as usize;
            if self.rx_buf.len() < 5 + len {
                break;
            }
            let payload = self.rx_buf[5..5 + len].to_vec();
            self.rx_buf.drain(..5 + len);

            let incoming = match frame_type {
                FRAME_ACK => Incoming::Ack,
                FRAME_INPUT => Incoming::Input(payload),
                FRAME_KILL => Incoming::Kill(payload.first().copied().unwrap_or(15)),
                FRAME_RESIZE_REMOTE => {
                    if payload.len() >= 4 {
                        let rows = u16::from_be_bytes([payload[0], payload[1]]);
                        let cols = u16::from_be_bytes([payload[2], payload[3]]);
                        Incoming::ResizeRemote { rows, cols }
                    } else {
                        Incoming::Unknown(frame_type)
                    }
                }
                other => Incoming::Unknown(other),
            };
            out.push(incoming);
        }
        Ok(out)
    }
}

impl Drop for DaemonConn {
    fn drop(&mut self) {
        unsafe { close(self.fd) };
    }
}

fn write_all(fd: RawFd, mut buf: &[u8], deadline: std::time::Instant) -> Result<(), Error> {
    // Bound the EAGAIN backoff. pt runs as the user's login shell, so an
    // unbounded 1ms spin against a wedged daemon (socket buffer full, never
    // drained) would freeze the terminal. Two independent bounds apply:
    //
    //   * `deadline` — a hard wall-clock cap on the total time this call may
    //     block, passed in and shared by send_frame across a frame's
    //     header+payload. This is what bounds a *slow-drip* daemon: one that
    //     dribbles a byte every ~1.9s makes progress often enough to keep
    //     resetting the consecutive-stall window forever, so only a total
    //     deadline stops it from freezing the terminal arbitrarily long.
    //   * consecutive-stall window (`stall_deadline`) — any successful send
    //     pushes it forward, so a fast, steadily-draining daemon is never
    //     penalised for a long-but-progressing transfer.
    //
    // On exceeding either bound we return an error; every caller treats a
    // send failure by dropping the daemon connection and continuing
    // local-only — the same degrade path used when the daemon is absent.
    const MAX_STALL_MS: u64 = 2000;
    let mut stall_deadline =
        std::time::Instant::now() + std::time::Duration::from_millis(MAX_STALL_MS);
    while !buf.is_empty() {
        // MSG_NOSIGNAL prevents a stray SIGPIPE if the daemon vanishes
        // mid-write — we want to handle EPIPE as an Error instead.
        let n = unsafe {
            libc::send(
                fd,
                buf.as_ptr() as *const c_void,
                buf.len(),
                MSG_NOSIGNAL,
            )
        };
        if n > 0 {
            buf = &buf[n as usize..];
            // Progress — reset the consecutive-stall window. The shared
            // `deadline` still bounds total time, so slow-drip can't abuse
            // this reset.
            stall_deadline =
                std::time::Instant::now() + std::time::Duration::from_millis(MAX_STALL_MS);
            continue;
        }
        if n == 0 {
            return Err(Error::new(ErrorKind::WriteZero, "send returned 0"));
        }
        let err = Error::last_os_error();
        match err.raw_os_error() {
            Some(libc::EINTR) => continue,
            // EAGAIN == EWOULDBLOCK on macOS/Linux. Socket buffer full —
            // briefly spin. A responsive daemon drains fast, pushing the
            // stall window forward. If either the total-time `deadline` or
            // the consecutive-stall window is exceeded, stop and degrade to
            // local-only instead of hanging the terminal forever.
            Some(libc::EAGAIN) => {
                let now = std::time::Instant::now();
                if now >= deadline || now >= stall_deadline {
                    return Err(Error::new(
                        ErrorKind::TimedOut,
                        "daemon socket blocked; degrading to local-only",
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(1));
                continue;
            }
            _ => return Err(err),
        }
    }
    Ok(())
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

/// Default location of the daemon's Unix socket. Picks up the same
/// `~/.pocket-t` directory the daemon already uses for `config.json`.
pub fn default_socket_path() -> std::path::PathBuf {
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
    home.join(".pocket-t").join("pt.sock")
}

/// Unused-import sentinel for `OsStr` (silences `unused_imports` while
/// keeping the trait object available for future extensions).
#[allow(dead_code)]
fn _unused_os_str(_: &OsStr) {}

/// Unused-import sentinel for `c_int` to keep our libc surface clear
/// when we later add control opcodes.
#[allow(dead_code)]
fn _unused_c_int(_: c_int) {}
