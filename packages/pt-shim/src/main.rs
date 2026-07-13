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
use std::process::exit;
use std::sync::atomic::{AtomicBool, Ordering};

use libc::{
    self, c_int, c_void, forkpty, ioctl, kill, pid_t, pollfd, read, signal, tcgetattr,
    tcsetattr, termios, waitpid, write, POLLERR, POLLHUP, POLLIN, SIGHUP, SIGWINCH,
    STDIN_FILENO, STDOUT_FILENO, TCSANOW, TIOCGWINSZ, TIOCSWINSZ,
};

use ipc::{DaemonConn, Incoming};

// SIGWINCH handlers can only set atomics; the main loop drains.
static WINCH_PENDING: AtomicBool = AtomicBool::new(false);

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

fn copy_loop(master_fd: RawFd, child_pid: pid_t, daemon: &mut Option<DaemonConn>) {
    let mut buf = [0u8; 8192];
    // Headless mode: pt was spawned by the daemon (e.g. from a phone
    // tap on "+ New session"). There's no local human at a Terminal.app
    // window — stdin is /dev/null. Don't poll stdin (it'd EOF instantly
    // and we'd SIGHUP the child shell before it even prompts). Don't
    // SIGHUP on stdin EOF later either. The daemon socket is the only
    // I/O channel.
    let headless = std::env::var("POCKET_T_HEADLESS").is_ok()
        || unsafe { libc::isatty(STDIN_FILENO) } == 0;
    loop {
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

        let rc = unsafe { libc::poll(fds.as_mut_ptr(), nfds, -1) };
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
                    // Daemon vanished mid-session — drop the connection.
                    // In local mode the terminal still works for the human;
                    // in headless mode there's nothing to fall back to,
                    // so just exit.
                    if headless { break; }
                    eprintln!("pt: daemon connection lost; continuing local-only");
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
                                    // Send to the whole process group, not just
                                    // the shell PID. forkpty calls setsid() in
                                    // the child, so child_pid IS the session /
                                    // process-group leader — anything the shell
                                    // spawned (claude, vim, npm…) lives in the
                                    // same pgid. Negative-pid = signal the
                                    // entire group, so the kill is forceful and
                                    // complete instead of leaving children
                                    // outliving their parent.
                                    unsafe { kill(-child_pid, sig as c_int) };
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
        signal(SIGWINCH, on_sigwinch as usize);
    }

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

    let mut daemon = DaemonConn::try_connect(&ipc::default_socket_path());

    if let Some(conn) = daemon.as_ref() {
        // Session id: process pid as a stable, simple, locally-unique key.
        // The daemon namespaces by connection anyway, so PID is enough.
        let session_id = format!("pt-{}", std::process::id());
        let cwd = env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));

        if let Err(e) = conn.send_hello() {
            eprintln!("pt: daemon HELLO failed: {} — continuing local-only", e);
            daemon = None;
        } else if let Err(e) = conn.send_register(
            &session_id,
            &cwd,
            pid,
            initial_ws.ws_row,
            initial_ws.ws_col,
            &shell,
        ) {
            eprintln!("pt: daemon REGISTER failed: {} — continuing local-only", e);
            daemon = None;
        }
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

    copy_loop(master_fd, pid, &mut daemon);

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
