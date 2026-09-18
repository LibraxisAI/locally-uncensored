//! Process spawning + lifecycle helpers used by ComfyUI / LM Studio / Claude
//! Code lifecycle commands.
//!
//! On Windows we use Job Objects (KILL_ON_JOB_CLOSE) so any child process tree
//! gets cleaned up when the bridge exits, and prefer `taskkill /T /F` for
//! recursive kills. On Unix `kill_tree` walks the real parent/child links: a
//! process-group kill only reaches children that were put in a group at spawn,
//! which is true for `spawn_piped` but not for every caller.

use std::process::{Child, Command, Stdio};

#[cfg(windows)]
pub fn no_window() -> u32 {
    0x08000000 // CREATE_NO_WINDOW
}

/// Suppress the console window for a std `Command` on Windows (CREATE_NO_WINDOW);
/// no-op elsewhere. Use for every CLI we shell out to (lms, git, python probes)
/// so users don't get console flashes.
pub fn suppress_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(no_window());
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

// ── K11/K14: foreign programs vs. our own bundled sidecars on Linux AppImage ─
//
// K2/K11 (Discord, mallic, 2026-09-16, CachyOS/Arch AppImage): after an
// in-app update, `git clone` inside the app failed with "no version
// information available" and custom-node installs broke the same way.
// Reinstalling did not help.
//
// linuxdeploy's AppRun exports `LD_LIBRARY_PATH` by PREPENDING
// `$APPDIR/usr/lib[/x86_64-linux-gnu]` onto whatever the shell already had,
// so it is inherited by every child process, including a system `git` found
// on PATH. On Arch/CachyOS, whose `libpcre2-8`/`libssl` are newer than the
// ones linuxdeploy bundled for the build host, the system `git` binary links
// against ITS OWN system libpcre2/libssl by SONAME, the dynamic loader finds
// LU's older bundled copies FIRST because of the inherited path, and either
// a symbol-versioning mismatch ("no version information available") or an
// outright crash follows. Our own bundled sidecars (the llama.cpp server,
// `whisper_server.py`'s interpreter, ...) need exactly the libraries that
// variable points at, so this fix is scoped per spawned command instead of
// touching the process-wide environment: only the one child actually being
// started gets the cleaned value.
//
// K14 (Reddit, Linux, 2026-09-17) is the same bug one variable over: a
// ComfyUI venv's own `_ssl` extension failed to load under the same
// inherited `LD_LIBRARY_PATH`, and LU's diagnosis misread the resulting
// ImportError as "this Python was built without ssl". The original fix
// above covered only `LD_LIBRARY_PATH` because that was the one variable
// K11's report named; K14 generalises it to the whole table linuxdeploy's
// AppRun is known to set (below), since nothing about the git bug was
// specific to that one variable.

/// K14 (Reddit, Linux, 2026-09-17): the same poisoning K11 fixed for
/// `LD_LIBRARY_PATH` also broke a ComfyUI venv's own `_ssl` extension after
/// an in-app AppImage update, `import ssl` failed inside a bundled
/// `LD_LIBRARY_PATH`, and LU's own diagnosis then misread that as "this
/// Python was built without ssl" and sent the customer to reinstall Python,
/// which fixes nothing. `LD_LIBRARY_PATH` was never the only variable
/// linuxdeploy's AppRun exports for the bundle: PATH, PYTHONHOME, PYTHONPATH,
/// the GLib/GTK/GStreamer module-search variables, XDG_DATA_DIRS and the two
/// SSL_CERT_* variables (the last a common source of a Python that "loses"
/// its certificate bundle after being pointed at an AppImage-internal one)
/// are all in the same boat: a foreign program that inherits them looks
/// inside the AppImage mount for things that live at a different version, or
/// not at all, there.
///
/// Two shapes, because the two kinds of variable break differently:
///   * `PathList`: colon-separated, like `LD_LIBRARY_PATH`. Only the
///     AppImage-mount ENTRIES are removed, the rest of the list survives.
///   * `SingleValue`: one path. If it points inside the AppImage mount at
///     all, the whole variable is unset: there is no "the rest of it" to
///     keep, and a foreign program reading it half-stripped would be reading
///     a path segment, not a value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VarShape {
    PathList,
    SingleValue,
}

/// Every environment variable a linuxdeploy-built AppRun is known to set or
/// prepend onto, in the order a foreign spawn should have them cleaned.
pub const APPIMAGE_ENV_VARS: &[(&str, VarShape)] = &[
    ("LD_LIBRARY_PATH", VarShape::PathList),
    ("PATH", VarShape::PathList),
    ("PYTHONHOME", VarShape::SingleValue),
    ("PYTHONPATH", VarShape::PathList),
    ("GIO_MODULE_DIR", VarShape::SingleValue),
    ("GTK_PATH", VarShape::PathList),
    ("GTK_EXE_PREFIX", VarShape::SingleValue),
    ("GDK_PIXBUF_MODULE_FILE", VarShape::SingleValue),
    ("GST_PLUGIN_SYSTEM_PATH", VarShape::PathList),
    ("GST_PLUGIN_SYSTEM_PATH_1_0", VarShape::PathList),
    ("XDG_DATA_DIRS", VarShape::PathList),
    ("SSL_CERT_FILE", VarShape::SingleValue),
    ("SSL_CERT_DIR", VarShape::SingleValue),
];

/// What a single foreign-spawn variable should become, given the value this
/// process inherited and the AppImage's own mount point.
///
/// Pure and testable off any platform: no `std::env` read happens here, only
/// in [`strip_appimage_env`] which calls this once per variable in
/// [`APPIMAGE_ENV_VARS`]. Returns:
///   * `None`: leave the variable exactly as inherited.
///   * `Some(None)`: remove the variable (a `SingleValue` that pointed
///     inside the AppImage, or a `PathList` whose every entry did).
///   * `Some(Some(v))`: set the variable to `v` (a `PathList` with only its
///     AppImage entries removed).
pub fn sanitized_env_value(shape: VarShape, current: &str, appdir: &str) -> Option<Option<String>> {
    if current.is_empty() {
        return None;
    }
    let appdir = appdir.trim_end_matches('/');
    if appdir.is_empty() {
        return None;
    }
    match shape {
        VarShape::SingleValue => {
            if current.starts_with(appdir) {
                Some(None)
            } else {
                None
            }
        }
        VarShape::PathList => {
            let entries: Vec<&str> = current.split(':').collect();
            let kept: Vec<&str> = entries
                .iter()
                .copied()
                .filter(|entry| !entry.starts_with(appdir) || entry.is_empty())
                .collect();
            if kept.len() == entries.len() {
                None
            } else if kept.is_empty() {
                Some(None)
            } else {
                Some(Some(kept.join(":")))
            }
        }
    }
}

/// Clean every variable in [`APPIMAGE_ENV_VARS`] on a child `Command` for a
/// FOREIGN system program. No-op whenever `APPDIR` is unset, every platform
/// and packaging but a running Linux AppImage, so this is safe to call
/// unconditionally. Supersedes [`strip_appimage_ld_library_path`], which
/// stays only as the narrower helper its own tests pin.
pub fn strip_appimage_env(cmd: &mut Command) {
    let Ok(appdir) = std::env::var("APPDIR") else { return };
    for &(var, shape) in APPIMAGE_ENV_VARS {
        let Ok(current) = std::env::var(var) else { continue };
        match sanitized_env_value(shape, &current, &appdir) {
            Some(Some(clean)) => {
                cmd.env(var, clean);
            }
            Some(None) => {
                cmd.env_remove(var);
            }
            None => {}
        }
    }
}

/// Build a `Command` for a FOREIGN system program, `git`, a system Python
/// interpreter, `pip`, a system `ffmpeg`, `nvidia-smi`, `rocm-smi`,
/// `xdg-open`, `uv`: anything on `$PATH` that LU did not build and does not
/// bundle. Use this instead of a bare `Command::new` at every such call
/// site: it clears the AppImage's own environment out of the child (K11,
/// K14) so a foreign binary loads the SYSTEM libraries and modules it
/// actually links against, never our bundled copies. A no-op everywhere but
/// a running Linux AppImage.
///
/// Do NOT use this for our own bundled sidecars, call `Command::new`
/// directly for those, exactly as before: they are built against and need
/// exactly the AppImage-bundled libraries this strips out.
pub fn foreign_system_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    strip_appimage_env(&mut cmd);
    cmd
}

#[cfg(test)]
mod appimage_env_tests {
    use super::*;

    /// `APPDIR` and friends are PROCESS-WIDE `std::env` state, and cargo runs
    /// this file's tests concurrently on one binary. Every test below that
    /// sets or reads `APPDIR` takes this first, or it can observe another
    /// thread's `APPDIR` mid-mutation (an intermittent failure that has
    /// nothing to do with the code under test).
    fn env_guard() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        LOCK.lock().unwrap_or_else(|p| p.into_inner())
    }

    #[test]
    fn appimage_entries_are_dropped_and_the_rest_survives() {
        let appdir = "/tmp/.mount_LocallieGkad";
        let current = "/tmp/.mount_LocallieGkad/usr/lib:/tmp/.mount_LocallieGkad/usr/lib/x86_64-linux-gnu:/usr/local/lib";
        let clean = sanitized_env_value(VarShape::PathList, current, appdir)
            .expect("appimage entries were present and should have been stripped")
            .expect("one entry survives, so this is a Some(value), not a removal");
        assert_eq!(clean, "/usr/local/lib");
        assert!(!clean.contains(".mount_LocallieGkad"));
    }

    #[test]
    fn a_value_with_nothing_from_the_appimage_is_left_alone() {
        // Negative control: a user who set LD_LIBRARY_PATH themselves, or an
        // AppImage runtime with nothing prepended, must not be rewritten ,
        // rewriting an unrelated value could break the very thing the user set.
        assert_eq!(
            sanitized_env_value(VarShape::PathList, "/usr/local/lib:/opt/cuda/lib64", "/tmp/.mount_x"),
            None,
        );
        assert_eq!(sanitized_env_value(VarShape::PathList, "", "/tmp/.mount_x"), None);
        assert_eq!(sanitized_env_value(VarShape::PathList, "/usr/local/lib", ""), None);
    }

    #[test]
    fn a_trailing_slash_on_appdir_does_not_break_the_match() {
        let appdir = "/tmp/.mount_LocallieGkad/";
        let current = "/tmp/.mount_LocallieGkad/usr/lib:/usr/local/lib";
        assert_eq!(
            sanitized_env_value(VarShape::PathList, current, appdir),
            Some(Some("/usr/local/lib".to_string())),
        );
    }

    #[test]
    fn foreign_system_command_is_a_noop_without_appdir() {
        // Negative control for the whole path: with no APPDIR (every
        // platform and packaging but a running Linux AppImage), the command
        // must come back with no environment override at all.
        let _guard = env_guard();
        std::env::remove_var("APPDIR");
        let cmd = foreign_system_command("git");
        assert_eq!(cmd.get_envs().count(), 0, "no APPDIR means nothing should be overridden");
    }

    #[test]
    fn foreign_system_command_cleans_the_env_a_spawned_git_would_inherit() {
        // K11/K2 (mallic, CachyOS/Arch AppImage, 2026-09-16): `git` on PATH
        // inherited the AppImage's LD_LIBRARY_PATH and loaded LU's bundled
        // libpcre2/libssl instead of the system's, printing "no version
        // information available". This is the exact call every
        // `Command::new("git")` in the codebase was switched to.
        let _guard = env_guard();
        std::env::set_var("APPDIR", "/tmp/.mount_LocallieGkad");
        std::env::set_var(
            "LD_LIBRARY_PATH",
            "/tmp/.mount_LocallieGkad/usr/lib:/tmp/.mount_LocallieGkad/usr/lib/x86_64-linux-gnu",
        );
        let cmd = foreign_system_command("git");
        // K14: the generalised strip_appimage_env removes a PathList
        // variable outright once every entry was inside the mount, rather
        // than setting it to an explicit "" the way the narrower
        // strip_appimage_ld_library_path used to, see
        // a_path_list_variable_with_every_entry_inside_the_mount_is_removed_not_emptied
        // for why that is the better of the two for a reader that treats an
        // empty search list differently from an unset one.
        let ld = cmd.get_envs().find(|(k, _)| *k == std::ffi::OsStr::new("LD_LIBRARY_PATH"));
        assert_eq!(
            ld,
            Some((std::ffi::OsStr::new("LD_LIBRARY_PATH"), None)),
            "both entries were inside the AppImage: the variable should be removed, not merely emptied"
        );
        assert_eq!(cmd.get_program(), "git");
        std::env::remove_var("APPDIR");
        std::env::remove_var("LD_LIBRARY_PATH");
    }

    // ── K14: the generalised sanitizer, as a pure function over a map ──────
    //
    // These never touch std::env, sanitized_env_value is given the current
    // value and the mount point directly, exactly as strip_appimage_env
    // reads them, so the whole APPIMAGE_ENV_VARS table is testable on every
    // platform this app builds for, CI included.

    #[test]
    fn a_single_value_variable_pointing_inside_the_mount_is_removed_entirely() {
        // PYTHONHOME/SSL_CERT_FILE/etc: there is no "rest of the value" to
        // keep once the ONE path it names is inside the AppImage. K14's
        // customer case: a bundled cert bundle or module dir shadows the
        // system one and a foreign Python reads garbage or nothing.
        let appdir = "/tmp/.mount_LU";
        let current = "/tmp/.mount_LU/usr/lib/python3.11";
        assert_eq!(sanitized_env_value(VarShape::SingleValue, current, appdir), Some(None));
    }

    #[test]
    fn a_single_value_variable_outside_the_mount_is_left_alone() {
        // Negative control: a user's own SSL_CERT_FILE (a corporate proxy's
        // CA bundle, say) must survive untouched.
        let appdir = "/tmp/.mount_LU";
        let current = "/etc/ssl/certs/ca-certificates.crt";
        assert_eq!(sanitized_env_value(VarShape::SingleValue, current, appdir), None);
    }

    #[test]
    fn a_path_list_variable_with_every_entry_inside_the_mount_is_removed_not_emptied() {
        // XDG_DATA_DIRS etc: emptying a PathList variable to "" is not the
        // same as removing it for every reader, some tools treat an EMPTY
        // XDG_DATA_DIRS as "search nothing" rather than "use the default",
        // which is worse than never having set it. So a PathList that
        // becomes empty after stripping is removed outright, same as a
        // SingleValue.
        let appdir = "/tmp/.mount_LU";
        let current = "/tmp/.mount_LU/usr/share:/tmp/.mount_LU/usr/share/gio-modules";
        assert_eq!(sanitized_env_value(VarShape::PathList, current, appdir), Some(None));
    }

    #[test]
    fn a_path_list_variable_keeps_its_non_appimage_entries() {
        let appdir = "/tmp/.mount_LU";
        let current = "/tmp/.mount_LU/usr/share:/usr/local/share:/usr/share";
        assert_eq!(
            sanitized_env_value(VarShape::PathList, current, appdir),
            Some(Some("/usr/local/share:/usr/share".to_string()))
        );
    }

    #[test]
    fn every_appimage_env_var_is_covered_exactly_once() {
        // Guards the table itself: no duplicate entries (a second sanitize
        // pass overwriting the first's cleaned value with the raw one from
        // std::env would be silent), and every name in it is one linuxdeploy
        // is actually known to touch.
        let names: Vec<&str> = APPIMAGE_ENV_VARS.iter().map(|(n, _)| *n).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), names.len(), "a variable appears twice in APPIMAGE_ENV_VARS");
        assert!(names.contains(&"LD_LIBRARY_PATH"));
        assert!(names.contains(&"PYTHONHOME"));
        assert!(names.contains(&"SSL_CERT_FILE"));
        assert!(names.contains(&"SSL_CERT_DIR"));
        assert!(names.contains(&"XDG_DATA_DIRS"));
    }

    #[test]
    fn strip_appimage_env_cleans_every_poisoned_variable_at_once() {
        // K14 end to end: several of the table's variables poisoned together
        // (the realistic AppRun shape), one strip_appimage_env call, every
        // one of them comes back clean or gone.
        let _guard = env_guard();
        let appdir = "/tmp/.mount_LU2";
        std::env::set_var("APPDIR", appdir);
        std::env::set_var("LD_LIBRARY_PATH", format!("{appdir}/usr/lib:/usr/local/lib"));
        std::env::set_var("PYTHONHOME", format!("{appdir}/usr"));
        std::env::set_var("SSL_CERT_FILE", format!("{appdir}/usr/ssl/cacert.pem"));
        std::env::set_var("XDG_DATA_DIRS", format!("{appdir}/usr/share"));
        // A variable this AppImage never touched, present only because the
        // shell it launched from set it, must survive untouched.
        std::env::set_var("SSL_CERT_DIR", "/etc/ssl/certs");

        let mut cmd = Command::new("python3");
        strip_appimage_env(&mut cmd);
        let envs: std::collections::HashMap<String, Option<String>> = cmd
            .get_envs()
            .map(|(k, v)| (k.to_string_lossy().into_owned(), v.map(|v| v.to_string_lossy().into_owned())))
            .collect();

        assert_eq!(envs.get("LD_LIBRARY_PATH").and_then(|v| v.clone()), Some("/usr/local/lib".to_string()));
        // An explicit removal shows up in get_envs() as the key mapped to
        // `None` (Command::env_remove), which is Some(None) once wrapped in
        // this test's outer HashMap, distinct from the key being absent,
        // which would mean "left untouched", the wrong outcome here.
        assert_eq!(envs.get("PYTHONHOME"), Some(&None), "PYTHONHOME must be explicitly removed");
        assert_eq!(envs.get("SSL_CERT_FILE"), Some(&None), "SSL_CERT_FILE must be explicitly removed");
        assert_eq!(envs.get("XDG_DATA_DIRS"), Some(&None), "the whole list was inside the mount, so it is removed");
        assert!(
            !envs.contains_key("SSL_CERT_DIR"),
            "SSL_CERT_DIR pointed outside the mount and must not appear as an override at all"
        );

        std::env::remove_var("APPDIR");
        std::env::remove_var("LD_LIBRARY_PATH");
        std::env::remove_var("PYTHONHOME");
        std::env::remove_var("SSL_CERT_FILE");
        std::env::remove_var("XDG_DATA_DIRS");
        std::env::remove_var("SSL_CERT_DIR");
    }
}


// ── Reading the process table by COMMAND LINE ───────────────────────────────
//
// `System::refresh_processes` does NOT fetch command lines. Its refresh kind is
// memory + cpu + disk_usage + exe (sysinfo-0.33 `common/system.rs:296`), so
// `Process::cmd()` comes back as an EMPTY slice for every process, and any
// matcher that joins it silently compares against "".
//
// That is not a hypothetical. It cost this repo two independent bugs, and the
// second one is the reason this helper exists rather than a third copy of the
// same three lines:
//
//   * `process::find_orphaned_comfyui` (T-68) — the scan for a ComfyUI orphaned
//     by a hard kill found nothing at all, so Stop stayed the no-op the audit
//     described even after the adoption path was written.
//   * `remote::kill_orphaned_tunnels` (T-39) — the startup sweep that kills a
//     cloudflared tunnel surviving from the last run could never match, so a
//     tunnel kept publishing the LAN server to the internet while the app's own
//     indicator read OFF. AUDIT-COVERAGE.md recorded that finding as fixed,
//     because the fix LOOKED like it applied.
//
// One of the two got repaired and the other did not, purely because nobody knew
// they were the same line twice. So: one helper, one place to get this wrong.

/// A refreshed process table whose entries actually carry their command lines.
///
/// Use this — never a bare `System::new()` + `refresh_processes()` — whenever
/// the answer depends on `Process::cmd()`.
pub fn process_table_with_cmdlines() -> sysinfo::System {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        // `name()` stays populated by the base discovery, so a matcher that
        // reads both the name and the argv is served by this one refresh.
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    sys
}

/// One process's command line as owned strings, in argv order.
pub fn cmdline_of(process: &sysinfo::Process) -> Vec<String> {
    process
        .cmd()
        .iter()
        .map(|c| c.to_string_lossy().to_string())
        .collect()
}

/// Spawn a command with stdout+stderr piped, console suppressed on Windows.
pub fn spawn_piped(mut cmd: Command) -> std::io::Result<Child> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(no_window());
    }
    #[cfg(unix)]
    {
        // Create our own process group so we can kill the whole tree later.
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                if libc_setpgid_self() != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    cmd.spawn()
}

/// Every process in `root`'s tree, root last, paired with its start time.
///
/// The start time is the anti-PID-reuse token for the delayed SIGKILL below:
/// a descendant is reparented to init the moment its parent dies, init reaps
/// it, and the kernel is then free to hand that number to a stranger inside
/// our own grace window. Same pid AND same start time is the same process.
#[cfg(unix)]
fn tree_snapshot(root: u32) -> Vec<(u32, u64)> {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut order = crate::commands::shell::descendants(root, &sys);
    order.reverse(); // leaves first — a live parent can't respawn what we killed
    order.push(root);
    order
        .into_iter()
        .map(|pid| {
            let start = sys
                .process(Pid::from_u32(pid))
                .map(|p| p.start_time())
                .unwrap_or(0);
            (pid, start)
        })
        .collect()
}

/// How long a SIGTERM'd tree is given before the SIGKILL goes out.
///
/// A named constant because it is the subject of
/// `the_call_does_not_block_for_the_grace_period`: the whole point of the
/// detached thread below is that the CALLER never spends this. It was written
/// twice, once per escalation path, and a change to one of the two would have
/// been silent.
#[cfg(unix)]
const KILL_GRACE: std::time::Duration = std::time::Duration::from_millis(800);

/// Recursive process-tree kill: SIGTERM the whole tree now, SIGKILL whatever
/// is left after a grace. Windows delegates the walk to `taskkill /T /F`.
///
/// The Unix branch used to signal the process GROUP (`kill -- -PGID`). That
/// only reaches a child that was made a group leader at spawn, and it is not
/// what either caller here does:
///
/// * `video::video_cancel` (the mlx_video Python job) spawns through a plain
///   `Command::spawn`, so the child is in OUR group and `-PID` addressed a
///   group that never existed — the kill went nowhere and the generation kept
///   running on the GPU. This is the case the explicit walk was written for.
/// * `remote::kill_tunnel_child` (the cloudflared quick tunnel) spawns through
///   `spawn_piped`, so that child IS its own group leader and the old group
///   kill would have worked for it. The walk works for it too: it follows the
///   parent links, which exist either way, and it never signals a pid that is
///   not in the snapshot — so the wider process group is not a hazard.
///
/// What BOTH callers have to satisfy is the reaping contract: the tree MUST be
/// walked before the root dies (afterwards its children are reparented to init
/// and the parent links that identify them are gone), and the caller must not
/// have reaped the child itself — the `waitpid` at the end of the detached
/// thread is what keeps the pid reserved until the escalation has fired, and it
/// is also what keeps the process from becoming a permanent zombie. Both
/// callers hand over an unreaped `Child` and drop it afterwards without
/// waiting, which is exactly right.
///
/// Nothing here blocks the caller: `video_cancel` holds the `video_process`
/// mutex across this call and the UI polls that same mutex, so the old
/// 800 ms sleep froze the window for the whole grace. The tunnel path has the
/// same shape on quit. The grace, the escalation and the final reap run on a
/// detached thread instead.
pub fn kill_tree(child: &mut Child) -> std::io::Result<()> {
    let pid = child.id();
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = child.kill();
        let _ = child.wait();
    }
    #[cfg(unix)]
    {
        let tree = tree_snapshot(pid);
        for (p, _) in &tree {
            unsafe {
                libc::kill(*p as i32, libc::SIGTERM);
            }
        }
        std::thread::spawn(move || {
            std::thread::sleep(KILL_GRACE);
            let survivors = {
                use sysinfo::{Pid, ProcessesToUpdate, System};
                let mut sys = System::new();
                sys.refresh_processes(ProcessesToUpdate::All, true);
                tree.iter()
                    .filter(|(p, start)| {
                        sys.process(Pid::from_u32(*p))
                            .map(|proc_| *start == 0 || proc_.start_time() == *start)
                            .unwrap_or(false)
                    })
                    .map(|(p, _)| *p)
                    .collect::<Vec<u32>>()
            };
            for p in survivors {
                unsafe {
                    libc::kill(p as i32, libc::SIGKILL);
                }
            }
            // The caller drops its `Child` without waiting, and a dropped
            // Child is never reaped — the job would sit in the table as a
            // zombie for as long as LU runs. Its pid also cannot be recycled
            // until this call, which is what makes the SIGKILL above safe.
            unsafe {
                let mut status: libc::c_int = 0;
                libc::waitpid(pid as libc::pid_t, &mut status, 0);
            }
        });
    }
    Ok(())
}

/// Same escalation as [`kill_tree`], but for a pid this process does NOT own.
///
/// The case it exists for (T-68): LU is hard-killed, its ComfyUI child is
/// reparented to init and survives. The next launch can identify that process
/// but has no `Child` for it — so there is nothing to `wait()` on, and calling
/// `waitpid` on a stranger would fail with ECHILD anyway. Everything else is
/// the same walk: snapshot the tree while the parent links still exist,
/// SIGTERM it, then SIGKILL whatever is still there (and still the same
/// process, by start time) after the grace, off the caller's thread.
pub fn kill_pid_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    {
        let tree = tree_snapshot(pid);
        for (p, _) in &tree {
            unsafe {
                libc::kill(*p as i32, libc::SIGTERM);
            }
        }
        std::thread::spawn(move || {
            std::thread::sleep(KILL_GRACE);
            use sysinfo::{Pid, ProcessesToUpdate, System};
            let mut sys = System::new();
            sys.refresh_processes(ProcessesToUpdate::All, true);
            for (p, start) in tree {
                let same = sys
                    .process(Pid::from_u32(p))
                    .map(|proc_| start == 0 || proc_.start_time() == start)
                    .unwrap_or(false);
                if same {
                    unsafe {
                        libc::kill(p as i32, libc::SIGKILL);
                    }
                }
            }
            // No waitpid: an adopted orphan is init's child, not ours. init
            // reaps it.
        });
    }
}

/// Best-effort stop of whatever process is LISTENING on a local TCP port.
/// Used by the "Stop" buttons for port-bound backends the bridge didn't spawn
/// itself (so there's no `Child` handle to kill) — the MLX sidecar and the
/// Ollama server. Only the listener is targeted (`-sTCP:LISTEN`), so the
/// bridge's own client connections to that port aren't hit.
// Gated like its only caller (state.rs, app quit): on Windows and Linux the
// function had no caller and a unix-only body, and `-D warnings` on the
// Windows CI row rejected it as dead. The gate says where it is alive.
#[cfg(target_os = "macos")]
pub fn kill_listeners_on_port(port: u16) {
    #[cfg(unix)]
    {
        if let Ok(out) = Command::new("lsof")
            .args(["-ti", &format!("tcp:{port}"), "-sTCP:LISTEN"])
            .stderr(Stdio::null())
            .output()
        {
            for pid in String::from_utf8_lossy(&out.stdout)
                .split_whitespace()
                .filter_map(|s| s.parse::<i32>().ok())
            {
                unsafe {
                    libc::kill(pid, libc::SIGTERM);
                }
            }
        }
    }
    #[cfg(windows)]
    {
        if let Ok(out) = Command::new("cmd")
            .args(["/C", &format!("netstat -ano -p tcp | findstr LISTENING | findstr :{port}")])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
        {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                if let Some(pid) = line.split_whitespace().last() {
                    let _ = Command::new("taskkill")
                        .args(["/F", "/PID", pid])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status();
                }
            }
        }
    }
}

#[cfg(unix)]
extern "C" {
    fn setpgid(pid: libc::pid_t, pgid: libc::pid_t) -> libc::c_int;
}

#[cfg(unix)]
fn libc_setpgid_self() -> libc::c_int {
    unsafe { setpgid(0, 0) }
}

// Minimal libc binding so we can avoid an extra crate.
#[cfg(unix)]
#[allow(non_camel_case_types)]
mod libc {
    pub type pid_t = i32;
    pub type c_int = i32;
    pub const SIGTERM: c_int = 15;
    pub const SIGKILL: c_int = 9;
    extern "C" {
        pub fn kill(pid: pid_t, sig: c_int) -> c_int;
        pub fn waitpid(pid: pid_t, status: *mut c_int, options: c_int) -> pid_t;
    }
}

#[cfg(all(test, unix))]
mod kill_tree_tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn alive(pid: u32) -> bool {
        let out = Command::new("ps")
            .args(["-o", "state=", "-p", &pid.to_string()])
            .output();
        match out {
            Ok(o) => {
                let st = String::from_utf8_lossy(&o.stdout).trim().to_string();
                !st.is_empty() && !st.starts_with('Z')
            }
            Err(_) => false,
        }
    }

    fn wait_until_gone(pids: &[u32], max: Duration) {
        let deadline = Instant::now() + max;
        loop {
            let left: Vec<u32> = pids.iter().copied().filter(|p| alive(*p)).collect();
            if left.is_empty() {
                return;
            }
            assert!(Instant::now() < deadline, "still running: {left:?}");
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    /// One of the two callers (`video_cancel`) spawns with a plain
    /// `Command::spawn`, so the child is NOT a process-group leader — which is
    /// exactly why the old `kill(-pid)` signalled nothing and left the tree
    /// running. (The other, `remote::kill_tunnel_child`, goes through
    /// `spawn_piped` and IS a group leader; the parent-link walk covers both,
    /// and the group-leader case is exercised in remote.rs's own tunnel tests.)
    #[test]
    fn a_child_without_a_process_group_still_loses_its_whole_tree() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 40 & sleep 40")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sh");
        let pid = child.id();

        // Waits for the CONDITION — sh has actually forked — with a ceiling,
        // instead of guessing 400 ms at it. The old fixed sleep made the
        // "test setup is wrong" assertion below a load measurement: on a busy
        // machine sh simply had not got there yet.
        let deadline = Instant::now() + Duration::from_secs(10);
        let kids = loop {
            let mut sys = sysinfo::System::new();
            sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            let kids = crate::commands::shell::descendants(pid, &sys);
            if !kids.is_empty() {
                break kids;
            }
            assert!(
                Instant::now() < deadline,
                "sh spawned nothing in 10s — test setup is wrong",
            );
            std::thread::sleep(Duration::from_millis(50));
        };

        kill_tree(&mut child).expect("kill_tree");

        let mut all = kids.clone();
        all.push(pid);
        wait_until_gone(&all, Duration::from_secs(5));
    }

    /// `video_cancel` holds the `video_process` mutex for the duration of this
    /// call and the progress poll waits on the same mutex, so a blocking grace
    /// froze the window. The kill must be ordered, not awaited.
    ///
    /// ── Why there is no stopwatch in here any more ──
    ///
    /// It used to time the call and assert `took < 400 ms`. That number is not
    /// the grace and it is not a property of the code: the unavoidable work
    /// inside `kill_tree` is `tree_snapshot`, which enumerates the ENTIRE
    /// process table, and how long that takes belongs to the machine and to
    /// whatever else is running on it. Measured on 01.09.2026 under six
    /// concurrent copies of the suite — every one of them walking the process
    /// table too — it failed 17 of 18 runs. The kill was ordered, not awaited,
    /// in all 18; the enumeration was simply slower than the budget.
    ///
    /// So the question is asked without a clock. `kill_tree` hands the grace,
    /// the SIGKILL and the final `waitpid` to a detached thread. The `waitpid`
    /// is the LAST of those, and until it runs the child is our unreaped
    /// zombie, which is a pid `kill(pid, 0)` can still address. An
    /// implementation that awaited the grace would return AFTER that thread had
    /// finished, and the pid would be gone. One signal-0, no wall clock, no
    /// budget to blow — and it fails for exactly the regression this test
    /// exists to catch (put `thread::sleep(KILL_GRACE)` back in the caller's
    /// path and the child is reaped before the assertion runs).
    #[test]
    fn the_call_does_not_block_for_the_grace_period() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 40")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sh");
        let pid = child.id();

        // Self-check instead of a settle sleep: wait for the CONDITION that the
        // stand-in is a live process carrying the argv this test chose, with a
        // ceiling. A `sh` that died on the spot would otherwise be killed as a
        // corpse and every assertion below would still pass. `checked_table`
        // owns the ceiling and the retry, including the one for a child that is
        // in the table but has not finished `exec` yet.
        let table = crate::test_support::checked_table(pid).unwrap_or_else(|why| panic!("{why}"));
        let argv = crate::process_util::cmdline_of(
            table
                .process(sysinfo::Pid::from_u32(pid))
                .expect("checked_table only returns a table containing this pid"),
        );
        assert!(
            argv.join(" ").contains("sleep"),
            "the stand-in is not the sleeper this test spawned: {argv:?}",
        );

        kill_tree(&mut child).expect("kill_tree");

        // Still ours, still unreaped → the detached thread has not reached its
        // `waitpid` yet → this call cannot have waited for the grace.
        let still_ours = unsafe { libc::kill(pid as i32, 0) } == 0;
        assert!(
            still_ours,
            "kill_tree returned only after the escalation thread had already \
             reaped pid {pid} — it waited out the {KILL_GRACE:?} grace",
        );

        wait_until_gone(&[pid], Duration::from_secs(5));
    }

    /// A killed child that nobody waits on stays in the process table as a
    /// zombie for the app's lifetime — and its pid can never be recycled.
    #[test]
    fn the_direct_child_is_reaped_not_left_as_a_zombie() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 40")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sh");
        let pid = child.id();
        std::thread::sleep(Duration::from_millis(200));
        kill_tree(&mut child).expect("kill_tree");
        drop(child); // exactly what video_cancel does with its taken handle

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let out = Command::new("ps")
                .args(["-o", "state=", "-p", &pid.to_string()])
                .output()
                .expect("ps");
            let st = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if st.is_empty() {
                return; // gone from the table entirely == reaped
            }
            assert!(Instant::now() < deadline, "pid {pid} is still listed as {st:?}");
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

/// The one regression this helper exists to stop: a process table without
/// command lines.
///
/// Both callers (`process::find_orphaned_comfyui`, `remote::kill_orphaned_tunnels`)
/// match on argv, and both were silently matching against "" before this was
/// centralised. This test is the shared guard — it fails for either of them.
#[cfg(test)]
mod process_table_tests {
    // Only the unix test below reads anything from the parent; on Windows the
    // import was the one thing in this module clippy could see — and rejected.
    #[cfg(unix)]
    use super::*;

    #[cfg(unix)]
    #[test]
    fn the_table_carries_command_lines() {
        use std::process::{Command, Stdio};
        // The trailing `; :` stops sh from exec'ing the single command and
        // handing over its own argv — which would erase what is being read.
        let marker = "lu-process-table-probe-8f3a";
        let mut child = Command::new("/bin/sh")
            .args(["-c", "sleep 30; :", marker, "--flag", "value"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn the stand-in");

        let mut seen: Option<Vec<String>> = None;
        for _ in 0..40 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let sys = process_table_with_cmdlines();
            if let Some(p) = sys.process(sysinfo::Pid::from_u32(child.id())) {
                let cmd = cmdline_of(p);
                if !cmd.is_empty() {
                    seen = Some(cmd);
                    break;
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();

        let cmd = seen.expect(
            "the process table came back with an EMPTY command line — \
             refresh_processes does not fetch cmd, and every argv matcher in \
             this repo would silently be comparing against \"\"",
        );
        assert!(cmd.iter().any(|a| a == marker), "{cmd:?}");
        assert!(cmd.iter().any(|a| a == "--flag"), "{cmd:?}");
    }

    /// Nobody may quietly reintroduce a second, cmd-less refresh for an argv
    /// match. The two known matchers must go through the helper.
    #[test]
    fn the_argv_matchers_share_one_refresh() {
        const PROCESS_RS: &str = include_str!("commands/process.rs");
        const REMOTE_RS: &str = include_str!("commands/remote.rs");
        for (name, src, func) in [
            ("process.rs", PROCESS_RS, "pub(crate) fn find_orphaned_comfyui"),
            ("remote.rs", REMOTE_RS, "fn kill_orphaned_tunnels"),
        ] {
            let start = src.find(func).unwrap_or_else(|| panic!("{func} is gone from {name}"));
            let body = &src[start..start + 1200];
            assert!(
                body.contains("process_table_with_cmdlines()"),
                "{name}: {func} builds its own process table again"
            );
        }
    }
}
