// pt — the pocket-t transparent shell proxy.
//
// The user sets `pt` as their terminal's shell ("Run command:
// /usr/local/bin/pt" in Terminal.app preferences, or `chsh -s
// /usr/local/bin/pt`). From then on, every new terminal window is a
// pocket-t session.
//
// pt forkpty()s the user's real shell ($SHELL, fallback /bin/zsh) as a
// child with its own PTY, owns the master fd, and copies bytes faithfully
// in both directions between the controlling terminal and the master.
// It is a transparent byte proxy — no scrollback layer, no key prefix,
// no mouse interception, no $TERM munging. To zsh, pt looks like a normal
// PTY. To Terminal.app, pt looks like a normal child process.
//
// pt also opens an outbound Unix socket to the pocket-t daemon and tees
// PTY output to it + accepts remote input (browser keystrokes, daemon-
// driven resize, kill). The connection is fail-soft: if the daemon
// isn't running, pt still works as a plain local shell — the user only
// loses the remote-control + bubble layer, never their terminal.

mod ipc;

use std::env;
use std::ffi::CString;
use std::mem::MaybeUninit;
use std::os::fd::RawFd;
use std::path::PathBuf;
use std::process::{exit, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use libc::{
    self, c_int, c_void, forkpty, ioctl, kill, pid_t, pollfd, read, signal, tcgetattr,
    tcsetattr, termios, waitpid, write, POLLERR, POLLHUP, POLLIN, SIGHUP, SIGWINCH,
    STDIN_FILENO, STDOUT_FILENO, TCSANOW, TIOCGWINSZ, TIOCSWINSZ,
};

use ipc::{DaemonConn, Incoming};

// SIGWINCH handlers can only set atomics; the main loop drains.
static WINCH_PENDING: AtomicBool = AtomicBool::new(false);

// Dedicated tmux server label for pocket-t sessions. Sessions are created
// on this private server (`tmux -L pocket-t`) so they never collide with
// or pollute the user's own tmux server, and so the daemon can enumerate
// pocket-t sessions without filtering unrelated ones. Kept in sync with
// the daemon's TMUX_SOCKET constant in packages/daemon/src/pt-registry/state.ts.
const TMUX_SOCKET_LABEL: &str = "pocket-t";

/// Deterministic tmux session name for a pocket-t session id.
fn tmux_session_name(session_id: &str) -> String {
    format!("pocket-t-{}", session_id)
}

/// Locate a `tmux` executable on `PATH`, returning its full path. Presence
/// of tmux switches the shim into persistent mode (the shell runs inside a
/// detached tmux session that outlives the shim). Absence transparently
/// falls back to the direct forkpty model.
fn find_tmux() -> Option<String> {
    use std::os::unix::fs::PermissionsExt;
    let path = env::var_os("PATH")?;
    for dir in env::split_paths(&path) {
        let candidate = dir.join("tmux");
        if let Ok(md) = std::fs::metadata(&candidate) {
            if md.is_file() && md.permissions().mode() & 0o111 != 0 {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

extern "C" fn on_sigwinch(_: c_int) {
    WINCH_PENDING.store(true, Ordering::Relaxed);
}

fn get_winsize(fd: RawFd) -> libc::winsize {
    let mut ws: libc::winsize = unsafe { std::mem::zeroed() };
    unsafe { ioctl(fd, TIOCGWINSZ, &mut ws as *mut _) };
    if ws.ws_row == 0 {
        ws.ws_row = 24;
    }
    if ws.ws_col == 0 {
        ws.ws_col = 80;
    }
    ws
}

fn set_winsize(fd: RawFd, ws: &libc::winsize) {
    unsafe { ioctl(fd, TIOCSWINSZ, ws as *const _) };
}

fn enter_raw_mode(fd: RawFd) -> Result<termios, std::io::Error> {
    let mut orig: termios = unsafe { MaybeUninit::zeroed().assume_init() };
    if unsafe { tcgetattr(fd, &mut orig) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    let mut raw = orig;
    unsafe { libc::cfmakeraw(&mut raw) };
    if unsafe { tcsetattr(fd, TCSANOW, &raw) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(orig)
}

fn restore_termios(fd: RawFd, orig: &termios) {
    unsafe { tcsetattr(fd, TCSANOW, orig) };
}

fn write_all(fd: RawFd, mut buf: &[u8]) {
    while !buf.is_empty() {
        let n = unsafe { write(fd, buf.as_ptr() as *const c_void, buf.len()) };
        if n <= 0 {
            // EAGAIN / EINTR could be retried; for terminals at this volume,
            // a partial-write loop with retry is overkill. Just bail.
            return;
        }
        buf = &buf[n as usize..];
    }
}

// Reconnect backoff bounds for the daemon link. The shell keeps running
// throughout — this only governs how often we re-dial a daemon that went
// away (restarted, crashed, was upgraded). Bounded so a permanently-absent
// daemon costs at most one cheap connect() attempt every RECONNECT_MAX_MS.
const RECONNECT_BASE_MS: u64 = 500;
const RECONNECT_MAX_MS: u64 = 30_000;

/// Everything needed to (re-)register this session with the daemon. Held
/// for the life of the shim so the reconnect loop can re-announce the SAME
/// stable session id after a daemon restart, rather than minting a new one.
struct SessionMeta {
    socket_path: PathBuf,
    session_id: String,
    cwd: PathBuf,
    pid: pid_t,
    shell: String,
    // Path to the tmux binary backing this session, and the tmux session
    // name the shell runs in. Both Some when the session is tmux-backed;
    // both None in the direct-forkpty fallback. The pair lets the remote
    // kill path tear the tmux session down (not just detach this client).
    tmux_bin: Option<String>,
    tmux_session: Option<String>,
}

/// One connect + HELLO + REGISTER attempt. Returns a live connection on
/// success, or None on any failure (socket missing, daemon down, handshake
/// rejected) — the caller stays local-only and retries later. Registration
/// always carries the CURRENT window size so the daemon paints newly-
/// attaching browsers at the right dimensions after a reconnect.
fn try_register(meta: &SessionMeta, rows: u16, cols: u16) -> Option<DaemonConn> {
    let conn = DaemonConn::try_connect(&meta.socket_path)?;
    if conn.send_hello().is_err() {
        return None;
    }
    if conn
        .send_register(
            &meta.session_id,
            &meta.cwd,
            meta.pid,
            rows,
            cols,
            &meta.shell,
            meta.tmux_session.is_some(),
        )
        .is_err()
    {
        return None;
    }
    Some(conn)
}

/// Generate an RFC-4122 v4 UUID string without pulling in the `uuid` crate.
/// Entropy comes from /dev/urandom; if that can't be read we fall back to a
/// pid+time mix so a login shell never fails to start over missing entropy.
fn gen_uuid_v4() -> String {
    let mut b = [0u8; 16];
    let filled = std::fs::File::open("/dev/urandom")
        .and_then(|mut f| {
            use std::io::Read;
            f.read_exact(&mut b)
        })
        .is_ok();
    if !filled {
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let pid = std::process::id() as u128;
        let mix = t ^ (pid << 64) ^ pid.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        b.copy_from_slice(&mix.to_le_bytes());
    }
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // RFC-4122 variant
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

/// Resolve this session's stable id.
///
/// An env-carried `POCKET_T_SESSION_ID` is authoritative: it lets a
/// supervisor (or the daemon's phone-spawn path) pin a relaunched shim to a
/// KNOWN session so it re-attaches to the same logical session instead of
/// creating a new one. Absent that, we mint a fresh UUID — NOT the pid,
/// which changed on every launch and is exactly what made the advertised
/// resume unreachable. The id lives for the life of this process and is
/// reused verbatim across every daemon reconnect.
fn resolve_session_id() -> String {
    if let Ok(id) = env::var("POCKET_T_SESSION_ID") {
        if !id.is_empty() {
            return id;
        }
    }
    gen_uuid_v4()
}

fn copy_loop(
    master_fd: RawFd,
    child_pid: pid_t,
    daemon: &mut Option<DaemonConn>,
    meta: &SessionMeta,
) {
    let mut buf = [0u8; 8192];
    // Headless mode: pt was spawned by the daemon (e.g. from a phone
    // tap on "+ New session"). There's no local human at a Terminal.app
    // window — stdin is /dev/null. Don't poll stdin (it'd EOF instantly
    // and we'd SIGHUP the child shell before it even prompts). Don't
    // SIGHUP on stdin EOF later either. The daemon socket is the only
    // I/O channel.
    let headless = std::env::var("POCKET_T_HEADLESS").is_ok()
        || unsafe { libc::isatty(STDIN_FILENO) } == 0;

    // Reconnect bookkeeping. `next_retry` is None while we hold a live
    // daemon link; the moment the link drops it is set (via due=true on the
    // next iteration) and we re-dial on a bounded backoff — WITHOUT touching
    // the local PTY, so the user's shell never notices.
    let mut backoff = Duration::from_millis(RECONNECT_BASE_MS);
    let mut next_retry: Option<Instant> = None;

    loop {
        // Daemon link down? Re-dial on a bounded backoff and re-register the
        // SAME session id so the daemon (which persisted our session and is
        // holding it in detach-grace) swaps us back in and streaming
        // resumes. The child shell + PTY are untouched throughout.
        if daemon.is_none() {
            let now = Instant::now();
            // A fresh disconnect (next_retry still None) restarts the
            // backoff schedule from the base so recovery is fast, and only
            // decays toward RECONNECT_MAX_MS if the daemon stays away.
            if next_retry.is_none() {
                backoff = Duration::from_millis(RECONNECT_BASE_MS);
            }
            let due = next_retry.is_none_or(|t| now >= t);
            if due {
                let ws = get_winsize(if headless { master_fd } else { STDIN_FILENO });
                if let Some(conn) = try_register(meta, ws.ws_row, ws.ws_col) {
                    eprintln!("pt: reconnected to daemon; remote streaming resumed");
                    *daemon = Some(conn);
                    next_retry = None;
                } else {
                    backoff = (backoff * 2).min(Duration::from_millis(RECONNECT_MAX_MS));
                    next_retry = Some(now + backoff);
                }
            }
        }

        // Drain any pending SIGWINCH before polling — propagate the new
        // size to the child's PTY so apps like vim/htop redraw correctly,
        // and tell the daemon about it (browser clients also need to know).
        if WINCH_PENDING.swap(false, Ordering::Relaxed) {
            let ws = get_winsize(if headless { master_fd } else { STDIN_FILENO });
            set_winsize(master_fd, &ws);
            if let Some(conn) = daemon.as_ref() {
                if conn.send_resize(ws.ws_row, ws.ws_col).is_err() {
                    *daemon = None;
                }
            }
        }

        // Build poll set: (stdin if local), master, and (if alive) the
        // daemon socket. In headless mode stdin is omitted entirely.
        let daemon_fd = daemon.as_ref().map(|c| c.fd()).unwrap_or(-1);
        let mut fds = [
            pollfd {
                fd: if headless { -1 } else { STDIN_FILENO },
                events: if headless { 0 } else { POLLIN },
                revents: 0,
            },
            pollfd {
                fd: master_fd,
                events: POLLIN,
                revents: 0,
            },
            pollfd {
                fd: daemon_fd,
                events: if daemon_fd >= 0 { POLLIN } else { 0 },
                revents: 0,
            },
        ];
        let nfds = if daemon_fd >= 0 { 3 } else { 2 };

        // Block indefinitely while connected; when the link is down, wake at
        // the next scheduled reconnect so the re-dial loop actually fires
        // even if the PTY is idle (no output to wake poll on its own).
        let timeout_ms: c_int = if daemon.is_some() {
            -1
        } else {
            match next_retry {
                Some(t) => {
                    let ms = t.saturating_duration_since(Instant::now()).as_millis();
                    ms.min(c_int::MAX as u128) as c_int
                }
                None => 0,
            }
        };

        let rc = unsafe { libc::poll(fds.as_mut_ptr(), nfds, timeout_ms) };
        if rc < 0 {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() == Some(libc::EINTR) {
                continue;
            }

            eprintln!("pt: poll error: {}", err);
            break;
        }

        // local stdin → PTY master (skipped in headless mode)
        if !headless && fds[0].revents & POLLIN != 0 {
            let n = unsafe { read(STDIN_FILENO, buf.as_mut_ptr() as *mut c_void, buf.len()) };
            if n == 0 {
                // Local terminal closed stdin. In real terminal use this only
                // happens at session end; in piped/test contexts it fires
                // immediately when the pipe drains. Propagate hangup to the
                // child so the interactive shell exits cleanly instead of
                // leaving us blocked in waitpid forever.
                unsafe { kill(child_pid, SIGHUP) };
                break;
            }
            if n < 0 {
                break;
            }
            write_all(master_fd, &buf[..n as usize]);
        }

        // PTY master → local stdout (skipped in headless — no human),
        // and tee to daemon as STDOUT frames (always).
        if fds[1].revents & POLLIN != 0 {
            let n = unsafe { read(master_fd, buf.as_mut_ptr() as *mut c_void, buf.len()) };
            if n <= 0 {
                // Child closed its end of the PTY — shell exited.

                break;
            }
            let slice = &buf[..n as usize];
            if !headless {
                write_all(STDOUT_FILENO, slice);
            }
            if let Some(conn) = daemon.as_ref() {
                if conn.send_stdout(slice).is_err() {
                    // Daemon vanished mid-session — drop the link and fall
                    // into the reconnect loop. The local shell keeps running
                    // for the human, and (crucially for persistence) a
                    // headless/phone-spawned session no longer dies when the
                    // daemon restarts: the child keeps running and we re-
                    // register the same session id once the socket returns.
                    eprintln!("pt: daemon connection lost; retrying in background (shell unaffected)");
                    *daemon = None;
                }
            }
        }

        // daemon → pt control + remote input
        if daemon_fd >= 0 && fds[2].revents & POLLIN != 0 {
            let mut drop_daemon = false;
            if let Some(conn) = daemon.as_mut() {
                match conn.read_incoming() {
                    Ok(frames) => {
                        for frame in frames {
                            match frame {
                                Incoming::Ack => { /* fine */ }
                                Incoming::Input(bytes) => {
                                    // Remote keystrokes go into the PTY master
                                    // exactly like local stdin would.
                                    write_all(master_fd, &bytes);
                                }
                                Incoming::Kill(sig) => {
                                    match (meta.tmux_bin.as_deref(), meta.tmux_session.as_deref()) {
                                        (Some(bin), Some(session)) => {
                                            // tmux-backed: the shell lives in the
                                            // tmux server, not under child_pid
                                            // (which is only the attached client).
                                            // Kill the tmux session so the shell
                                            // and everything in it exits; the
                                            // client then hits PTY EOF and we
                                            // report a clean exit.
                                            let _ = Command::new(bin)
                                                .args([
                                                    "-L",
                                                    TMUX_SOCKET_LABEL,
                                                    "kill-session",
                                                    "-t",
                                                    session,
                                                ])
                                                .spawn();
                                        }
                                        _ => {
                                            // Direct forkpty: signal the whole
                                            // process group. forkpty calls
                                            // setsid() in the child, so child_pid
                                            // is the session / process-group
                                            // leader — anything the shell spawned
                                            // (claude, vim, npm…) shares the pgid.
                                            unsafe { kill(-child_pid, sig as c_int) };
                                        }
                                    }
                                }
                                Incoming::ResizeRemote { rows, cols } => {
                                    // Browser-driven resize. Update the PTY's
                                    // winsize so the kernel sends SIGWINCH to
                                    // the shell and apps redraw at the new
                                    // dimensions. We deliberately do NOT touch
                                    // the local terminal's stdin winsize —
                                    // that one tracks the user's Mac Terminal
                                    // window and SIGWINCH from THAT is still
                                    // forwarded through the WINCH_PENDING
                                    // path. If they conflict, the most recent
                                    // wins; that's the right semantics for an
                                    // interactive multi-viewer model.
                                    let ws = libc::winsize {
                                        ws_row:    rows,
                                        ws_col:    cols,
                                        ws_xpixel: 0,
                                        ws_ypixel: 0,
                                    };
                                    set_winsize(master_fd, &ws);
                                }
                                Incoming::Unknown(t) => {
                                    eprintln!("pt: unknown daemon frame type 0x{:02x}", t);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("pt: daemon read error: {}", e);
                        drop_daemon = true;
                    }
                }
            }
            if drop_daemon {
                *daemon = None;
            }
        }

        // Hangups / errors on either side of the *terminal* end the session.
        if fds[0].revents & (POLLHUP | POLLERR) != 0 {

            break;
        }
        if fds[1].revents & (POLLHUP | POLLERR) != 0 {

            break;
        }
        // A daemon-socket hangup just drops IPC; the local terminal lives on.
        if daemon_fd >= 0 && fds[2].revents & (POLLHUP | POLLERR) != 0 {
            *daemon = None;
        }
    }
}

fn main() {

    // Resolve the user's real shell. An explicitly-set, non-empty $SHELL is
    // authoritative: we exec *only* that and never silently fall back to a
    // different shell on exec failure, because doing so could let a user
    // escape a restricted/locked-down login shell an admin pinned via $SHELL.
    // The hardcoded fallbacks below apply only when $SHELL is unset or empty —
    // there there's no intent to honour, and the alternative is bricking the
    // terminal. Default to zsh (macOS default since Catalina) for that case.
    let shell_env = env::var("SHELL").ok().filter(|s| !s.is_empty());
    let shell = shell_env
        .clone()
        .unwrap_or_else(|| "/bin/zsh".to_string());

    // Ignore SIGPIPE. On macOS, `MSG_NOSIGNAL` on send() is effectively
    // a no-op, so a broken pipe (daemon vanished mid-write, stdout pipe
    // closed) would otherwise kill pt instead of letting us see EPIPE
    // and recover. Linux honours MSG_NOSIGNAL but ignoring SIGPIPE
    // process-wide is harmless and portable.
    unsafe {
        signal(libc::SIGPIPE, libc::SIG_IGN);
    }

    // Install SIGWINCH handler before forkpty so the parent picks up
    // resize events the moment the terminal sends them.
    unsafe {
        signal(SIGWINCH, on_sigwinch as *const () as usize);
    }

    // Resolve the stable session id before forking so the child can name a
    // deterministic tmux session from it and the parent can register it.
    let session_id = resolve_session_id();

    // Persistence backend. When tmux is on PATH the shell runs inside a
    // detached tmux session named `pocket-t-<session_id>`: the tmux server
    // owns the PTY + shell independently of any client, so quitting the
    // terminal (or the shim exiting) only detaches — the shell keeps
    // running and any client can re-attach later. When tmux is absent we
    // transparently fall back to a direct forkpty child (the shell then
    // shares the shim's lifetime, exactly as a plain login shell would).
    let tmux_bin = find_tmux();
    let tmux_session = tmux_bin.as_ref().map(|_| tmux_session_name(&session_id));

    // Read initial window size from the controlling terminal so the
    // child's PTY starts at the right dimensions.
    let initial_ws = get_winsize(STDIN_FILENO);

    let mut master_fd: c_int = 0;

    let pid = unsafe {
        forkpty(
            &mut master_fd,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &initial_ws as *const _ as *mut _,
        )
    };

    if pid < 0 {
        eprintln!("pt: forkpty failed: {}", std::io::Error::last_os_error());
        exit(1);
    }

    if pid == 0 {

        // Child: reset signal dispositions before exec. Custom handlers
        // are reset by exec() automatically, but SIG_IGN persists across
        // exec — so the SIGPIPE-IGN we set in the parent would carry into
        // zsh and cause subtle breakage (zsh assumes default SIGPIPE).
        // Restore everything we touched to SIG_DFL.
        unsafe {
            signal(libc::SIGPIPE, libc::SIG_DFL);
            signal(SIGWINCH, libc::SIG_DFL);
        }

        // Persistent path: become a tmux client that attaches to (or, on
        // first launch, creates) the session's deterministic tmux session.
        // `new-session -A` attaches when the named session already exists
        // and creates it otherwise, so the same command both starts a new
        // pocket-t session and re-attaches a surviving one. With an empty
        // default-command, tmux runs the login shell resolved from $SHELL
        // inside the server, which owns the PTY independently of this
        // client. execvp only returns on failure, in which case we fall
        // through to the direct-shell path so the terminal still works.
        if let Some(bin) = tmux_bin.as_deref() {
            let session_name = tmux_session_name(&session_id);
            let args: [&str; 7] = [
                bin,
                "-L",
                TMUX_SOCKET_LABEL,
                "new-session",
                "-A",
                "-s",
                &session_name,
            ];
            let cargs: Vec<CString> = args
                .iter()
                .filter_map(|a| CString::new(a.as_bytes()).ok())
                .collect();
            if cargs.len() == args.len() {
                let mut argv: Vec<*const libc::c_char> =
                    cargs.iter().map(|c| c.as_ptr()).collect();
                argv.push(std::ptr::null());
                unsafe {
                    libc::execvp(cargs[0].as_ptr(), argv.as_ptr());
                    eprintln!(
                        "pt: execvp(tmux) failed: {} — falling back to direct shell",
                        std::io::Error::last_os_error()
                    );
                }
            }
        }

        // Child: exec the user's shell as a *login* shell.
        // The leading-dash arg0 convention is how Unix marks a login shell;
        // zsh/bash/fish all respect it and source the login init files.
        //
        // Candidate shells to exec, in order. When $SHELL was explicitly set
        // we honour it *exclusively* — a single-element list — so an exec
        // failure never silently escapes a restricted login shell (see the
        // resolution note above). Only an unset/empty $SHELL falls through to
        // the well-known shells so a missing $SHELL never bricks the terminal:
        // /bin/zsh (macOS default) then /bin/sh (guaranteed present). Each
        // execvp only returns on failure, so we advance to the next
        // candidate; if every candidate fails there's nothing left to
        // become, so exit cleanly with 127.
        let candidates: Vec<&str> = match shell_env.as_deref() {
            Some(s) => vec![s],
            None => vec!["/bin/zsh", "/bin/sh"],
        };
        for candidate in &candidates {
            let shell_path = match CString::new(candidate.as_bytes()) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let shell_basename = std::path::Path::new(candidate)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "sh".to_string());
            let login_arg0 = match CString::new(format!("-{}", shell_basename)) {
                Ok(a) => a,
                Err(_) => continue,
            };

            let argv: [*const libc::c_char; 2] = [login_arg0.as_ptr(), std::ptr::null()];

            unsafe {
                libc::execvp(shell_path.as_ptr(), argv.as_ptr());
                // execvp only returns on failure — try the next candidate.
                let err = std::io::Error::last_os_error();
                eprintln!("pt: execvp({}) failed: {}", candidate, err);
            }
        }

        // Every shell candidate failed to exec.
        unsafe {
            libc::_exit(127);
        }
    }

    // Parent: try to connect to the daemon and register this session.
    // This is fail-soft — if the daemon isn't running, we just continue
    // as a plain local shell proxy.

    // Session identity that SURVIVES daemon restarts: a stable UUID (env-
    // carried when a supervisor pins one), never the pid — a pid changed on
    // every launch and made the advertised resume unreachable. The same id
    // is re-announced by the copy_loop reconnect path after a daemon
    // restart, so the daemon reattaches to this live shell instead of
    // spawning a new session.
    let meta = SessionMeta {
        socket_path: ipc::default_socket_path(),
        session_id,
        cwd: env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/")),
        pid,
        shell: shell.clone(),
        tmux_bin,
        tmux_session,
    };

    // Attach + register now. Fail-soft: if the daemon is down we start
    // local-only and copy_loop's reconnect path keeps re-dialling in the
    // background — the terminal is fully usable the whole time.
    let mut daemon = try_register(&meta, initial_ws.ws_row, initial_ws.ws_col);
    if daemon.is_none() {
        eprintln!("pt: daemon unavailable — starting local-only (retrying in background)");
    }

    // Put stdin into raw mode so keystrokes pass through unmodified.
    // If we can't (e.g. stdin isn't a tty), just wait for the child anyway —
    // the user still gets a working (cooked-mode) shell.

    let orig_termios = match enter_raw_mode(STDIN_FILENO) {
        Ok(t) => Some(t),
        Err(e) => {
            eprintln!("pt: cannot set raw mode (is stdin a tty?): {}", e);
            None
        }
    };

    copy_loop(master_fd, pid, &mut daemon, &meta);

    if let Some(orig) = orig_termios.as_ref() {
        restore_termios(STDIN_FILENO, orig);
    }

    // Reap the child first so we know its exit code, then tell the daemon
    // about it before this process dies (and the socket drops with us).
    let mut status: c_int = 0;
    unsafe { waitpid(pid, &mut status, 0) };
    let code = if libc::WIFEXITED(status) {
        libc::WEXITSTATUS(status)
    } else if libc::WIFSIGNALED(status) {
        128 + libc::WTERMSIG(status)
    } else {
        0
    };
    if let Some(conn) = daemon.as_ref() {
        let _ = conn.send_exit(code);
    }
    exit(code);
}
