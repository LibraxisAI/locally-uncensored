//! Die zwei Eingriffe an einer ComfyUI, die schon da ist.
//!
//! Der geteilte Zustand ist eine BESTEHENDE Installation — beide Befehle
//! fangen dort an, wo `comfy_install` aufhört, und beide müssen sie erst
//! finden, bevor sie etwas anfassen dürfen. Was sie unterscheidet, ist die
//! Hälfte, die sie ersetzen: die Reparatur wirft das venv weg und baut es
//! neu, das Update holt den Kern nach und lässt das venv stehen.
//!
//! Sie stehen zusammen, weil ihre Fehlerfälle dieselben sind und in beiden
//! Richtungen aufeinander zeigen. Beide brechen ab, wenn kein brauchbarer
//! Python da ist; beide behandeln fehlgeschlagene optionale Abhängigkeiten
//! als Warnung und nicht als Abbruch, weil ComfyUI danach trotzdem startet;
//! und beide erzählen in denselben Statusschlitz, den `install_comfyui_status`
//! ausliest. Wer die eine Regel ändert, muss die andere danebenlegen.
//!
//! Die Reparatur trägt zusätzlich die Pflicht, die ihr Auslöser ihr
//! aufgibt: sie läuft automatisch nach einem ComfyUI-Absturz, und sie
//! löscht dabei ein venv, in dem faster-whisper und Piper mitwohnen. Was sie
//! wegnimmt, muss sie am Ende wieder hinstellen — und es sagen, sonst liest
//! der Nutzer nur "die Sprachausgabe ist plötzlich weg".

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::Ordering;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::State;
use tracing::{error, info};

use crate::state::AppState;
use crate::os_error;
use std::path::Path;
use super::comfy_job::{finished_notice, requirements_fallback_log};
use super::env_check::verify_and_heal_environment;
use super::pip::{pip_install_streaming_with_retry_raw, requirements_failure_reason_for};

use super::comfy_job::{ComfyJob, COMFY_JOB};
use super::comfy_job::comfy_job_busy_message;
use super::pip::pip_install_streaming_with_retry_cancellable;
use super::torch::plan_pytorch_install;
use super::venv::{
    create_comfyui_venv, detect_venv_passengers, finish_rebuild, restore_after_failed_rebuild,
    restore_orphaned_venv_if_needed, retire_for_rebuild,
};
#[cfg(target_os = "windows")]
use super::git::{windows_git_install_hint, windows_git_probe, WindowsGitState};
#[cfg(target_os = "windows")]
use super::CREATE_NO_WINDOW;

/// GH #98 (joelnewswanger, 2026-08-14): ComfyUI installed once, then died at
/// import time on every start. His torch lived in the SHARED system Python's
/// site-packages, where anything the user ever pip-installed can break us,
/// and clicking install again changed nothing because pip saw every package
/// as "already satisfied". kryptoxide's night (same issue) was the same trap
/// from the other side: a stray `comfy 0.0.1` on the system Python shadowed
/// ComfyUI's own package.
///
/// The repair builds what those installs never had: a fresh venv inside the
/// ComfyUI folder, with PyTorch and the requirements installed into it. The
/// launcher already prefers ComfyUI/venv over the system Python, so the next
/// start picks it up with no further wiring. The system Python, models,
/// outputs and custom nodes are left alone. Progress goes through the same
/// install_status slot, so install_comfyui_status polling just works.
#[tauri::command]
pub fn repair_comfyui_env(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    if !crate::commands::process::comfy_supported_here() {
        return Err(crate::commands::process::MACOS_COMFY_REFUSAL.to_string());
    }
    // OI-5: acquired before any of the checks below, because every one of them
    // reads state a concurrent install is actively changing. Dropped again on
    // each early return.
    let job_guard = match COMFY_JOB.try_acquire(ComfyJob::Repair) {
        Ok(g) => g,
        Err(ComfyJob::Repair) => return Ok(serde_json::json!({"status": "already_installing"})),
        Err(running) => return Err(comfy_job_busy_message(ComfyJob::Repair, running)),
    };
    let comfy_dir = {
        let p = state.comfy_path.lock().unwrap().clone();
        p.or_else(crate::commands::process::find_comfyui_path)
    };
    let Some(comfy_dir) = comfy_dir else {
        return Err(
            "ComfyUI is not installed, so there is no environment to repair. Use Install ComfyUI instead."
                .to_string(),
        );
    };
    let comfy_dir = PathBuf::from(comfy_dir);
    // Portable installs bring their own python_embeded and the launcher
    // prefers it over any venv, so a rebuilt venv would never be used.
    let embeded_here = comfy_dir.join("python_embeded").join("python.exe").exists();
    let embeded_beside = comfy_dir
        .parent()
        .map(|p| p.join("python_embeded").join("python.exe").exists())
        .unwrap_or(false);
    if embeded_here || embeded_beside {
        return Err(
            "This is a portable ComfyUI with its own bundled Python. Re-extract the portable \
             package to repair it; the app cannot rebuild that environment."
                .to_string(),
        );
    }
    let python_bin = state.python_bin.lock().unwrap().clone();
    if python_bin.is_empty() || !crate::python::is_real_python(&python_bin) {
        return Err(
            "no_python: Python must be installed before the environment can be rebuilt. Call install_python first."
                .to_string(),
        );
    }
    {
        let mut install = state.install_status.lock().unwrap();
        install.status = "installing".to_string();
        install.logs.clear();
        install.notice.clear();
        install.notice_kind.clear();
        install.logs.push("Repairing the ComfyUI environment...".to_string());
    }
    info!("comfyui env repair start");
    // A tracked child would hold venv files open on Windows; it is dead or
    // dying anyway (the repair only runs after a startup crash).
    {
        let mut proc = state.comfy_process.lock().unwrap();
        if let Some(mut child) = proc.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    state.comfyui_install_cancel.store(false, Ordering::SeqCst);
    let cancel_flag = state.comfyui_install_cancel.clone();
    let install_status = state.install_status.clone();
    // OI-3: the whisper server runs FROM this venv's Python. On Windows a
    // running interpreter holds its own files open, so leaving it up makes
    // `remove_dir_all` fail and the repair dies at step one with "close
    // anything using it and retry" — naming nothing the user can close.
    // Stopping it is also free: `ensure_whisper_running` brings it back on
    // the next voice input, then against the rebuilt venv.
    let whisper = state.whisper.clone();

    std::thread::spawn(move || {
        let _job_guard = job_guard;
        let update = |status: &str, msg: &str| {
            if let Ok(mut s) = install_status.lock() {
                s.status = status.to_string();
                s.logs.push(msg.to_string());
            }
        };

        // Set when `pip install -r requirements.txt` failed and the run carried
        // on with the packages LU knows about. Folder plus reason, so the live
        // log line and the line the finished run leaves behind agree (A15).
        let mut requirements_fallback: Option<(String, &'static str)> = None;

        // Runde 6, B9 "Wiederanlauf": before ANYTHING else touches this
        // folder, recover from a rebuild that died between retiring the old
        // venv and the new one passing verification (crash, power loss, the
        // app being killed). A healthy environment sees no difference at
        // all: this is a no-op the moment a usable `venv` already exists.
        restore_orphaned_venv_if_needed(&comfy_dir);

        // A16 (A15-2): before anything is deleted and before anything is
        // downloaded. A folder with no requirements.txt is not a ComfyUI
        // checkout, and nothing later in this run can change that, so there is
        // no reason to spend three minutes and two gigabytes finding out, nor
        // to throw away a venv for a rebuild that cannot finish.
        if let Err(msg) = repair_precheck(&comfy_dir) {
            update("error", &msg);
            return;
        }

        // P3 (04.09.): the repair had exactly one cancel check, and it sat
        // BEHIND the venv build. Everything before it was a click the app
        // swallowed. This is the same helper the installer has had all along
        // (comfy_install.rs), and the checks below are placed the same way:
        // before each stretch that cannot be interrupted from inside.
        let cancelled = || cancel_flag.load(Ordering::SeqCst);
        if cancelled() {
            update("cancelled", "Repair cancelled before anything was changed.");
            return;
        }

        let venv_dir = comfy_dir.join("venv");

        // Runde 6, B9: the old venv and the new one now BOTH sit on disk at
        // the same time, from the moment the old one is retired until it is
        // swept away in the background after the new one passes
        // verification. The flat 5 GB estimate below never accounted for
        // that second copy; this one does, and it REFUSES rather than warns,
        // before anything is touched, so a drive that genuinely cannot hold
        // both says so up front instead of failing minutes into the PyTorch
        // download with the old venv already gone.
        if let Some(msg) = check_repair_disk_pressure(&comfy_dir, &venv_dir) {
            update("error", &msg);
            return;
        }
        // The generic warning (soft, not a refusal) the installer also
        // shows, kept for the same reason it always was: room for
        // everything ELSE a repair downloads besides the venv itself.
        if let Some(warning) = super::comfy_install::check_install_disk_pressure(&comfy_dir) {
            update("installing", &warning);
        }

        // Runde 3, Nachbesserung 6: the torch/Python preflight used to run
        // AFTER the old venv was already gone (`torch_python_preflight` sat
        // right before Step 2's download, well past the delete below). A
        // repair that then turned out to have no usable interpreter left the
        // customer with a freshly emptied venv folder and a failed run, the
        // exact "a healthy venv must never be destroyed for a run that then
        // fails anyway" case. Moving the check here, before `venv_dir` is
        // touched at all, means a repair that cannot proceed leaves the old
        // venv exactly as it was. Also folds in B1(b): LU picks the newest
        // interpreter that actually has a torch wheel itself, no Settings
        // picker, and the picked interpreter is what builds the new venv
        // further down instead of always `python_bin`.
        let (torch_args, gpu_info, torch_index, torch_packages) = plan_pytorch_install();
        let torch_package_refs: Vec<&str> = torch_packages.iter().map(|s| s.as_str()).collect();
        // Repair always rebuilds the venv from this interpreter, so the
        // strict ensurepip probe applies (Runde 6, F11).
        let chosen_python = match super::torch::choose_torch_python(&python_bin, torch_index.as_deref(), &torch_package_refs, "press \"Repair environment\" again", true) {
            super::torch::TorchPythonDecision::Proceed => python_bin.clone(),
            super::torch::TorchPythonDecision::UseInstead { path, .. } => {
                update(
                    "installing",
                    &format!(
                        "The default Python ({python_bin}) does not have a PyTorch wheel for \
                         this machine yet; using {path} instead, found on this machine already."
                    ),
                );
                path
            }
            super::torch::TorchPythonDecision::Blocked(msg) => {
                update("error", &msg);
                return;
            }
        };

        // Runde 6, BLOCKER B9 (review Runde 5): Runde 5's build-then-swap
        // built the new venv under a staging name and renamed the folder
        // into place afterwards. A venv is not relocatable: every console
        // script's shebang, `pip`'s own launcher, and every activate script
        // bake in the ABSOLUTE path it was BUILT at, so that rename left
        // `venv/bin/pip` and every other script pointing at a staging folder
        // that no longer existed. See `venv::retire_for_rebuild`'s doc for
        // the measured proof. The fix: the OLD venv is retired (renamed
        // aside, reversibly (reversible because restoring it uses the EXACT
        // same name it already had) FIRST, and the NEW venv is then built
        // DIRECTLY under the final `venv` name via `create_comfyui_venv`, so
        // its build path and its resting path are the same string from the
        // very first `python -m venv` call. Never renamed again afterwards.
        //
        // OI-3: faster-whisper and Piper live in the OLD venv too. Read
        // BEFORE it is touched (it still is not, at this point).
        let passengers = detect_venv_passengers(&venv_dir);
        if !passengers.is_empty() {
            let names: Vec<&str> = passengers.iter().map(|p| p.label).collect();
            // The connection has to be in the log the user is looking at. Its
            // absence is what turned this into "Voice just stopped": two
            // unrelated-looking features died during a ComfyUI repair the
            // Create tab started on its own.
            info!(passengers = ?names, "comfyui repair will rebuild venv passengers");
            update(
                "installing",
                &format!(
                    "This venv also holds {}. Rebuilding it removes them, so LU will \
                     reinstall them once the new environment is verified; do not close the app \
                     until that step is done.",
                    names.join(" and ")
                ),
            );
        }

        // Nothing of ours may still be running out of the OLD venv before it
        // is even RETIRED, or its files stay open on Windows and the rename
        // fails (see `venv::windows_lock_aware_retire_error`'s doc: this is
        // the same OI-3 reasoning Runde 5 applied right before its swap; it
        // has to run before the retire now, since the retire is the first
        // destructive step).
        if venv_dir.exists() {
            if let Ok(mut w) = whisper.lock() {
                if w.is_running() {
                    update(
                        "installing",
                        "Stopping the voice-input server, which runs from the existing \
                         environment. It restarts by itself the next time you use voice input.",
                    );
                    w.stop();
                }
            }
        }

        update("installing", "Step 1/4: Setting the existing environment aside...");
        let retired = match retire_for_rebuild(&venv_dir) {
            Ok(r) => r,
            Err(msg) => {
                update("error", &msg);
                return;
            }
        };

        // Every early return from here on has to leave the customer with a
        // WORKING venv again: either the freshly verified new one, or, on
        // ANY failure (a failed build, a failed download, a failed
        // requirements install, a failed verification, or the user
        // cancelling at any of those points), the retired old one restored.
        // One place, so that guarantee is enforced once instead of repeated
        // at each call site, the same reasoning Runde 5's `abandon_staging`
        // documented for the staging approach.
        let abort_and_restore = |status: &str, msg: &str, install_status: &std::sync::Arc<std::sync::Mutex<crate::state::InstallState>>| {
            let restore_note = match restore_after_failed_rebuild(&comfy_dir, &venv_dir, retired.clone()) {
                Ok(()) => String::new(),
                Err(e) => format!("\n\n{}", e),
            };
            if let Ok(mut s) = install_status.lock() {
                s.status = status.to_string();
                s.logs.push(format!("{msg}{restore_note}"));
            }
        };

        let venv_py = match create_comfyui_venv(&comfy_dir, &chosen_python, Some(&cancel_flag)) {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(e) if e == "cancelled" => {
                abort_and_restore(
                    "cancelled",
                    "Repair cancelled while the new environment was being built. Your previous \
                     environment was restored.",
                    &install_status,
                );
                return;
            }
            Err(e) => {
                abort_and_restore(
                    "error",
                    &format!(
                        "Building the new environment failed. Your previous environment was \
                         restored.\n\n{}",
                        e
                    ),
                    &install_status,
                );
                return;
            }
        };

        update("installing", &format!("Step 2/4: {}", gpu_info));

        update(
            "installing",
            "Downloading PyTorch into the new environment (~2 GB). Live pip output below.",
        );
        let refs: Vec<&str> = torch_args.iter().map(|s| s.as_str()).collect();
        match pip_install_streaming_with_retry_cancellable(&refs, &venv_py, 3, &install_status, Some(&cancel_flag)) {
            Ok(()) => update("installing", "PyTorch installed."),
            Err(d) if d == "cancelled" => {
                abort_and_restore(
                    "cancelled",
                    "Repair cancelled during the PyTorch download. Your previous environment was \
                     restored.",
                    &install_status,
                );
                return;
            }
            Err(d) => {
                abort_and_restore(
                    "error",
                    &format!(
                        "PyTorch installation failed. Your previous environment was \
                         restored.\n\n{}",
                        d
                    ),
                    &install_status,
                );
                return;
            }
        }

        let reqs = comfy_dir.join("requirements.txt");
        // Checked once at the top already. Kept as a guard for the file being
        // renamed or deleted while the rebuild was running, which is a real
        // few minutes on a slow line.
        if !reqs.exists() {
            abort_and_restore("error", &missing_requirements_for_repair(&comfy_dir), &install_status);
            return;
        }
        {
            update(
                "installing",
                "Step 3/4: Installing ComfyUI dependencies into the new environment...",
            );
            let reqs_str = reqs.to_string_lossy().to_string();
            let req_args = vec![
                "-m", "pip", "install",
                "--progress-bar", "off",
                "--no-input",
                "-r", reqs_str.as_str(),
            ];
            match pip_install_streaming_with_retry_raw(&req_args, &venv_py, 3, &install_status, Some(&cancel_flag)) {
                Ok(()) => update("installing", "Dependencies installed."),
                Err(f) if f.diagnosis == "cancelled" => {
                    abort_and_restore(
                        "cancelled",
                        "Repair cancelled during the requirements install. Your previous \
                         environment was restored.",
                        &install_status,
                    );
                    return;
                }
                Err(f) => {
                    let reason = requirements_failure_reason_for(&f);
                    let folder = comfy_dir.display().to_string();
                    requirements_fallback = Some((folder.clone(), reason));
                    update("installing", &requirements_fallback_log(&folder, reason));
                    update(
                        "installing",
                        &format!(
                            "Not every dependency installed. Checking what is really missing.\n\n{}",
                            f.diagnosis
                        ),
                    );
                }
            }
        }

        // OI-3: put the passengers back, into the new environment. Failures
        // here are reported but do not fail the repair, since a working
        // ComfyUI is nearly ready at this point, and burying it under a
        // Piper wheel error would trade one silent loss for another. What
        // must never happen again is the repair finishing without saying
        // what happened to Voice.
        let mut lost: Vec<&str> = Vec::new();
        for p in &passengers {
            update(
                "installing",
                &format!("Reinstalling {} into the new environment...", p.label),
            );
            let args = vec![
                "-m", "pip", "install",
                "--progress-bar", "off",
                "--no-input",
                p.pip_name,
            ];
            match pip_install_streaming_with_retry_cancellable(&args, &venv_py, 3, &install_status, Some(&cancel_flag)) {
                Ok(()) => update("installing", &format!("{} is back.", p.label)),
                Err(d) if d == "cancelled" => {
                    abort_and_restore(
                        "cancelled",
                        &format!(
                            "Repair cancelled while reinstalling {}. Your previous environment \
                             was restored.",
                            p.label
                        ),
                        &install_status,
                    );
                    return;
                }
                Err(d) => {
                    error!(package = p.pip_name, error = %d, "venv passenger reinstall failed after comfyui repair");
                    lost.push(p.label);
                    update(
                        "installing",
                        &format!("Could not reinstall {}: {}", p.label, d),
                    );
                }
            }
        }

        // A3: this is the step the button was missing. Two of the five
        // reporters pressed Repair environment and nothing changed, because a
        // rebuild that trusts pip's exit code rebuilds the same hole. Now
        // also the B9 gate: this is the LAST check before the retired old
        // venv is discarded for good, so a new environment that does not
        // import never leaves the customer with neither one.
        update("installing", "Step 4/4: Checking that the new environment really starts...");
        match verify_and_heal_environment(&venv_py, &comfy_dir, &reqs, &install_status, Some(&cancel_flag)) {
            Ok(()) => {}
            Err(e) if e == "cancelled" => {
                abort_and_restore(
                    "cancelled",
                    "Repair cancelled during the environment check. Your previous environment \
                     was restored.",
                    &install_status,
                );
                return;
            }
            Err(e) => {
                error!("comfyui env repair built an environment that does not import");
                abort_and_restore(
                    "error",
                    &format!(
                        "The new environment was built, but it still does not start, so your \
                         previous environment was restored instead of being replaced with one \
                         that does not work either.\n\n{}",
                        e
                    ),
                    &install_status,
                );
                return;
            }
        }

        // The new environment is built, populated and VERIFIED, and it is
        // already at its final path: nothing above this line ever renamed
        // it, so there is no swap left to do. Only now is the retired old
        // one discarded for good.
        update("installing", "Removing the previous, now-replaced environment...");
        finish_rebuild(&comfy_dir, retired);

        // Runde 5 Folgeposten (review Runde 4, Abschnitt 2): the repair's own
        // log line promises "custom nodes stay untouched", true for the
        // FOLDERS but not for what they import: their own requirements.txt
        // never followed the venv into the rebuild. Reusing
        // `install_node_requirements` (the same function `install_custom_node`
        // itself calls, #72's rule) against the now-final venv, one folder's
        // failure never stopping the rest.
        //
        // Runde 6, Folgeposten (a) (review Runde 5, F2): a node's own
        // requirements.txt (an unpinned old torch, a `numpy<2`, ...) must not
        // be allowed to quietly downgrade the core packages this repair just
        // spent four steps verifying. A constraints file built from THIS
        // venv's own `pip freeze` of torch/torchvision/torchaudio/numpy makes
        // pip refuse such a change outright: the node's own install fails
        // loudly and by name, through the existing per-node failure list,
        // instead of the environment silently regressing. `verify_and_heal_
        // environment` then runs a SECOND time after the whole node loop: a
        // node with an `install.py` or another way around the constraint
        // (F10, still open) could still break something the constraints file
        // does not cover, and this is the backstop for that.
        //
        // Runde 6, Folgeposten (b): a name and a log line per node while this
        // runs (there was one blanket sentence before), and the cancel flag
        // is now read between nodes, so twenty custom nodes no longer look
        // like a hang with a Cancel button that does nothing.
        let mut broken_nodes: Vec<(String, String)> = Vec::new();
        if comfy_dir.join("custom_nodes").is_dir() {
            let constraints = super::custom_nodes::write_core_package_constraints(&venv_py);
            let outcome = super::custom_nodes::reinstall_all_node_requirements(
                &comfy_dir,
                &venv_py,
                constraints.as_deref(),
                Some(&cancel_flag),
                |name| update("installing", &format!("Restoring dependencies for {}...", name)),
            );
            if let Some(c) = &constraints {
                let _ = std::fs::remove_file(c);
            }
            for (name, _) in &outcome.failures {
                update("installing", &format!("Could not restore requirements for {}.", name));
            }
            if outcome.cancelled {
                update(
                    "cancelled",
                    "Repair cancelled while restoring custom node dependencies. ComfyUI's \
                     environment itself was already rebuilt and verified; some custom nodes may \
                     still be missing their own dependencies.",
                );
                return;
            }
            // Runde 6, F13 (review Runde 6, Abschnitt 5): see
            // `NodeReinstallOutcome::needs_reverification`'s own doc. This
            // gate used to run only when EVERY node succeeded, which skipped
            // it whenever an unrelated node failed even though a different
            // node had already installed something that could have damaged
            // the environment.
            if outcome.needs_reverification() {
                update(
                    "installing",
                    "Re-checking the environment after restoring custom node dependencies...",
                );
                if let Err(e) = verify_and_heal_environment(&venv_py, &comfy_dir, &reqs, &install_status, Some(&cancel_flag)) {
                    if e == "cancelled" {
                        update(
                            "cancelled",
                            "Repair cancelled during the post-restore environment check. ComfyUI's \
                             environment itself was already rebuilt and verified.",
                        );
                        return;
                    }
                    // A3: the same rule that governs the FIRST verification
                    // governs this one too. The constraints file above is
                    // the primary defense, but it cannot cover every way a
                    // node's own install could break something (an
                    // `install.py`, F10, still open); this is the backstop,
                    // and it must stop the run rather than report "complete"
                    // over an environment that no longer starts. The venv
                    // itself is left exactly as it is (its own build already
                    // passed verification once): only the node loop's
                    // outcome is undone, by naming it, not by rolling back
                    // the whole rebuild.
                    error!(nodes = ?outcome.reinstalled, "comfyui repair: custom node dependencies left the environment unable to start");
                    let suspects = outcome.reinstalled.join(", ");
                    update("error",
                        &format!(
                            "The environment was rebuilt and verified, but restoring custom node \
                             dependencies left it unable to start again. One of these likely \
                             caused it: {}. Disabling that node (move its folder out of \
                             custom_nodes and add .disabled to the name) and repairing again \
                             usually clears it.\n\n{}",
                            suspects, e
                        ),
                    );
                    return;
                }
            }
            broken_nodes = outcome.failures;
        }

        // What used to say "custom nodes stay untouched" unconditionally. That
        // was only ever true of the folders, not of what they import, and the
        // repair now actually restores their dependencies instead of merely
        // promising it (Runde 5 Folgeposten). What is reported here is
        // whichever of that restoration and the voice passengers above did NOT
        // make it back in, so the closing line stays true either way.
        let node_names: Vec<&str> = broken_nodes.iter().map(|(name, _)| name.as_str()).collect();
        let mut unrestored: Vec<&str> = lost.clone();
        unrestored.extend(node_names.iter().copied());
        let (notice_text, closing) = if unrestored.is_empty() {
            (
                "Repair finished. ComfyUI is ready.".to_string(),
                "Environment repaired. ComfyUI now runs from its own venv; start it again."
                    .to_string(),
            )
        } else {
            let names = unrestored.join(", ");
            (
                format!("Repair finished, but {} could not be fully restored.", names),
                format!(
                    "ComfyUI's environment is repaired and can be started again, but {} could not \
                     be fully restored into the new venv. Voice packages: reinstall from Settings. \
                     Custom nodes: reinstalling the node's own dependencies from its README, or \
                     reinstalling the node, usually fixes it.",
                    names,
                ),
            )
        };
        if let Ok(mut s) = install_status.lock() {
            let (line, kind) = finished_notice(&notice_text, requirements_fallback.as_ref());
            s.notice = line;
            s.notice_kind = kind.to_string();
        }
        update("complete", &closing);
    });

    Ok(serde_json::json!({"status": "installing"}))
}

/// Update an existing ComfyUI install in place: `git pull --ff-only` plus a
/// venv-aware `pip install -r requirements.txt`. The 2.5.8 local Create lanes
/// (music / talking character / extend / motion) need node classes that ship
/// with current ComfyUI cores, and the UI gates on node PRESENCE — when the
/// nodes are missing this command is the one-click "Update ComfyUI" path.
/// Progress streams through the same `install_status` channel the installer
/// uses, so the existing `install_comfyui_status` polling UI works unchanged.
#[tauri::command]
pub fn update_comfyui(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    // OI-5: same lock as install and repair. This command's old guard was the
    // strictest of the three ("installing" OR "downloading"), which is exactly
    // why the inconsistency was invisible from here — it was the other two
    // that let a job in mid-clone.
    let job_guard = match COMFY_JOB.try_acquire(ComfyJob::Update) {
        Ok(g) => g,
        Err(ComfyJob::Update) => return Ok(serde_json::json!({"status": "already_installing"})),
        Err(running) => return Err(comfy_job_busy_message(ComfyJob::Update, running)),
    };
    {
        let mut install = state.install_status.lock().unwrap();
        install.status = "installing".to_string();
        install.logs.clear();
        install.notice.clear();
        install.notice_kind.clear();
        install.logs.push("Updating ComfyUI...".to_string());
    }

    info!("comfyui update start");

    let comfy_dir = {
        let p = state.comfy_path.lock().unwrap().clone();
        p.or_else(crate::commands::process::find_comfyui_path)
            .map(PathBuf::from)
    };
    let fail = |state: &State<'_, AppState>, msg: &str| -> Result<serde_json::Value, String> {
        let mut install = state.install_status.lock().unwrap();
        install.status = "error".to_string();
        install.logs.push(msg.to_string());
        error!("comfyui update aborted: {}", msg);
        Err(msg.to_string())
    };
    let Some(comfy_dir) = comfy_dir else {
        return fail(&state, "ComfyUI not found. Install ComfyUI first.");
    };
    if !comfy_dir.join(".git").exists() {
        // Portable / zip installs carry no git metadata — nothing to pull.
        return fail(
            &state,
            "This ComfyUI was not installed from git, so it can't be updated in place. \
             Update it with its own updater, or reinstall from Settings.",
        );
    }

    // Runde 6, F12: same reasoning as install_comfyui's call. Without this,
    // an Update pressed after a Repair that crashed mid rebuild reads
    // `comfy_venv_state` below as `Absent` (the retired `venv.lu-old-*`
    // sibling is not named `venv`), falls back to the system Python, and
    // never notices the several-gigabyte orphan sitting right next to it.
    // A no-op once a usable `venv` already exists.
    restore_orphaned_venv_if_needed(&comfy_dir);

    // Prefer the install's venv Python (same preference the launcher uses);
    // refuse without a usable interpreter — a pulled core with stale
    // requirements is worse than no update (frontend package pins move often).
    // P3: the same third answer the launcher has. Updating into the system
    // Python while ComfyUI can only ever start out of this venv leaves the
    // hole exactly where it was, one git pull further along.
    let python_bin = match crate::python::comfy_venv_state(&comfy_dir) {
        crate::python::ComfyVenv::Usable(p) => p,
        crate::python::ComfyVenv::Broken { venv_dir, interpreter } => {
            return fail(
                &state,
                &crate::commands::process::comfy_broken_venv_message(&venv_dir, &interpreter),
            );
        }
        crate::python::ComfyVenv::Absent => state.python_bin.lock().unwrap().clone(),
    };
    if python_bin.is_empty() || !crate::python::is_real_python(&python_bin) {
        return fail(
            &state,
            "No usable Python found for this ComfyUI. Install Python first, then retry the update.",
        );
    }

    let install_status = state.install_status.clone();
    // The update runs through the same status slot, the same panel and the
    // same Cancel button as the install, so it gets the same flag. Reset
    // first, for the reason install_comfyui resets it (Bug #1): a previously
    // cancelled run would otherwise abort this one on the first poll.
    state.comfyui_install_cancel.store(false, Ordering::SeqCst);
    let cancel_flag = state.comfyui_install_cancel.clone();
    std::thread::spawn(move || {
        let _job_guard = job_guard;
        let update = |status: &str, msg: &str| {
            if let Ok(mut s) = install_status.lock() {
                s.status = status.to_string();
                s.logs.push(msg.to_string());
            }
        };

        // Set when `pip install -r requirements.txt` failed and the run carried
        // on with the packages LU knows about. Folder plus reason, so the live
        // log line and the line the finished run leaves behind agree (A15).
        let mut requirements_fallback: Option<(String, &'static str)> = None;

        #[cfg(target_os = "windows")]
        {
            let probe = windows_git_probe();
            if probe == WindowsGitState::Missing {
                update("error", &windows_git_install_hint(&probe).unwrap_or_default());
                return;
            }
        }

        update("installing", "Step 1/3: Pulling the latest ComfyUI...");
        let mut pull = crate::process_util::foreign_system_command("git");
        // --ff-only: a user-modified checkout must not silently merge; surface
        // the divergence honestly instead.
        pull.args(["pull", "--ff-only"])
            .current_dir(&comfy_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        pull.creation_flags(CREATE_NO_WINDOW);
        match pull.output() {
            Ok(o) if o.status.success() => {
                let out = String::from_utf8_lossy(&o.stdout);
                let line = out.lines().last().unwrap_or("").trim().to_string();
                update(
                    "installing",
                    if line.is_empty() { "Repository updated." } else { &line },
                );
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                update(
                    "error",
                    &format!(
                        "git pull failed. If you changed files inside the ComfyUI folder, \
                         stash or revert them and retry.\n\n{}",
                        stderr.trim(),
                    ),
                );
                return;
            }
            Err(e) => {
                update("error", &format!("Could not run git: {}", os_error::english(&e)));
                return;
            }
        }

        update(
            "installing",
            "Step 2/3: Updating Python dependencies (live pip output below)...",
        );
        let reqs = comfy_dir.join("requirements.txt");
        if !reqs.exists() {
            update(
                "error",
                &format!(
                    "The folder {} has no requirements.txt after the pull, so its dependencies \
                     cannot be updated. Reinstall ComfyUI from Settings.",
                    comfy_dir.display()
                ),
            );
            return;
        }

        // B6 (review Runde 4, Runde 5 Blocker): ComfyUI's own requirements.txt
        // pulls torch/torchvision/torchaudio, so this pip call needed exactly
        // the same preflight the install and repair paths already have, or a
        // venv on an unsupported interpreter got pip's generic wheel-not-found
        // error again, at this entry point instead of those two. Update does
        // not rebuild a venv, so `UseInstead` is handled like the existing-venv
        // branch of Install/Repair: point at Repair rather than silently
        // switching interpreters under an environment nothing rebuilt.
        let (_torch_args, _gpu_info, torch_index, torch_packages) = plan_pytorch_install();
        let torch_package_refs: Vec<&str> = torch_packages.iter().map(|s| s.as_str()).collect();
        // Runde 6, F11: Update never rebuilds the venv, so the light probe
        // (ssl, pip) applies, not the ensurepip probe a venv build would need.
        match super::torch::choose_torch_python(&python_bin, torch_index.as_deref(), &torch_package_refs, "press \"Update ComfyUI\" again", false) {
            super::torch::TorchPythonDecision::Proceed => {}
            super::torch::TorchPythonDecision::UseInstead { path, current_version, chosen_version } => {
                update("error", &super::torch::existing_venv_needs_repair_message(current_version, &path, chosen_version));
                return;
            }
            super::torch::TorchPythonDecision::Blocked(msg) => {
                update("error", &msg);
                return;
            }
        }

        {
            let reqs_str = reqs.to_string_lossy().to_string();
            let req_args = vec![
                "-m", "pip", "install",
                "--progress-bar", "off",
                "--no-input",
                "-r", reqs_str.as_str(),
            ];
            match pip_install_streaming_with_retry_raw(
                &req_args,
                &python_bin,
                3,
                &install_status,
                Some(&cancel_flag),
            ) {
                Ok(()) => update("installing", "Dependencies updated."),
                Err(f) if f.diagnosis == "cancelled" => {
                    update("cancelled", "Update cancelled during the requirements install.");
                    return;
                }
                Err(f) => {
                    println!("[Update] Requirements warning: {}", f.diagnosis);
                    let reason = requirements_failure_reason_for(&f);
                    let folder = comfy_dir.display().to_string();
                    requirements_fallback = Some((folder.clone(), reason));
                    update("installing", &requirements_fallback_log(&folder, reason));
                    update(
                        "installing",
                        &format!(
                            "Not every dependency updated. Checking what is really missing.\n\n{}",
                            f.diagnosis
                        ),
                    );
                }
            }
        }

        // A pull that brings new requirements is the third way into A3: the
        // core moves on, one wheel does not land, and the update reports
        // finished over an environment that no longer imports.
        update("installing", "Step 3/3: Checking that the environment really starts...");
        if let Err(e) = verify_and_heal_environment(&python_bin, &comfy_dir, &reqs, &install_status, Some(&cancel_flag)) {
            if e == "cancelled" {
                update("cancelled", "Update cancelled during the environment check.");
                return;
            }
            error!("comfyui update left an environment that does not import");
            update("error", &format!("ComfyUI was updated, but its Python environment is not usable.\n\n{}", e));
            return;
        }

        println!("[Update] ComfyUI update complete");
        if let Ok(mut s) = install_status.lock() {
            let (line, kind) = finished_notice(
                "Update finished. Restart ComfyUI to load the new nodes.",
                requirements_fallback.as_ref(),
            );
            s.notice = line;
            s.notice_kind = kind.to_string();
        }
        update(
            "complete",
            "ComfyUI updated. Restart ComfyUI to load the new nodes.",
        );
    });

    Ok(serde_json::json!({"status": "installing"}))
}


/// What Repair says about a folder with no requirements.txt.
///
/// A16 (A15-2), Windows counter-check 02.09.: the sentence itself was right and
/// arrived after 181,6 seconds, because the file was only looked at when pip
/// was about to be pointed at it, which is after the venv has been deleted and
/// PyTorch has been downloaded into the new one. Three minutes and two
/// gigabytes to learn that the folder was never a ComfyUI checkout, and a
/// half-built environment left behind for it. The check runs before any of
/// that now, and the wording is here so the early check and the late one, kept
/// as a guard against the file going away mid run, cannot drift apart.
fn missing_requirements_for_repair(dir: &Path) -> String {
    format!(
        "The folder {} has no requirements.txt, so it is not a complete ComfyUI \
         checkout and the environment cannot be rebuilt from it. Rename or delete \
         that folder and install ComfyUI again.",
        dir.display()
    )
}

/// Everything Repair can rule out before it destroys or downloads anything.
///
/// One function so the order is not a matter of where a call happens to sit:
/// this is called first in the run, and what it refuses costs the user
/// nothing.
fn repair_precheck(comfy_dir: &Path) -> Result<(), String> {
    if !comfy_dir.join("requirements.txt").exists() {
        return Err(missing_requirements_for_repair(comfy_dir));
    }
    Ok(())
}

/// The total size on disk of everything under `dir`, in bytes. Best-effort:
/// a file that vanishes mid-walk (a background delete, a concurrent process)
/// is simply skipped rather than failing the whole measurement, since this
/// feeds a space ESTIMATE, not an exact accounting.
fn dir_size(dir: &Path) -> u64 {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

/// Runde 6, B9: the old venv and the new one sit on the same drive at the
/// same time now, from the moment the old one is retired until the new one
/// passes verification. `check_install_disk_pressure`'s flat 5 GB estimate
/// (still shown as a soft warning right after this) never accounted for
/// that second copy, and it never refused outright either. This does both:
/// it adds the existing venv's real, measured size to the ~5 GB a fresh
/// build needs, and it is a REFUSAL, run before `retire_for_rebuild` touches
/// anything, so a drive that genuinely cannot hold both says so honestly
/// up front instead of failing part-way through with the old venv already
/// gone.
///
/// `None` both when the drive cannot be identified (same fallback
/// `check_install_disk_pressure` uses) and when there is no existing venv at
/// all yet: a first build's own soft warning already covers that case.
fn check_repair_disk_pressure(comfy_dir: &Path, venv_dir: &Path) -> Option<String> {
    if !venv_dir.exists() {
        return None;
    }
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    let normalized = comfy_dir.to_path_buf();
    let mut best: Option<&sysinfo::Disk> = None;
    let mut best_len: usize = 0;
    for d in &disks {
        let mp = d.mount_point();
        if normalized.starts_with(mp) {
            let len = mp.as_os_str().len();
            if len > best_len {
                best_len = len;
                best = Some(d);
            }
        }
    }
    let disk = best?;
    let free_bytes = disk.available_space();
    let existing_bytes = dir_size(venv_dir);
    let needed_for_new_build: u64 = 5 * 1024 * 1024 * 1024;
    let required = needed_for_new_build.saturating_add(existing_bytes);
    if free_bytes < required {
        return Some(format!(
            "Not enough free space to rebuild this environment. The existing environment is \
             about {:.1} GB, and building a new one alongside it before the old one is removed \
             needs about 5 GB more ({:.1} GB total); only {:.1} GB is free on {}. Free up space \
             and try again; nothing was changed.",
            existing_bytes as f64 / 1_073_741_824.0,
            required as f64 / 1_073_741_824.0,
            free_bytes as f64 / 1_073_741_824.0,
            disk.mount_point().to_string_lossy(),
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repair_refuses_a_folder_without_requirements_before_it_spends_anything() {
        // The counter-check renamed requirements.txt and pressed Repair. The
        // run deleted the venv, downloaded two gigabytes of PyTorch and then,
        // after 181,6 seconds, said the folder was never a ComfyUI checkout.
        let tmp = tempfile::tempdir().unwrap();
        let comfy = tmp.path().join("ComfyUI");
        std::fs::create_dir(&comfy).unwrap();
        std::fs::create_dir(comfy.join("venv")).unwrap();

        let refused = repair_precheck(&comfy).expect_err("a folder with no requirements.txt was accepted");

        assert!(refused.contains("requirements.txt"), "the file is not named: {refused}");
        assert!(refused.contains(&comfy.display().to_string()), "the folder is not named: {refused}");
        assert!(refused.contains("install ComfyUI again"), "no way out is offered: {refused}");
        // Nothing was touched on the way to that answer.
        assert!(comfy.join("venv").exists(), "the venv was removed by a run that could not finish");
    }

    #[test]
    fn repair_lets_a_real_checkout_through() {
        // Negative control. Without it the check above would pass on a
        // precheck that refused every folder, which would kill Repair outright.
        let tmp = tempfile::tempdir().unwrap();
        let comfy = tmp.path().join("ComfyUI");
        std::fs::create_dir(&comfy).unwrap();
        std::fs::write(comfy.join("requirements.txt"), "torch\n").unwrap();

        assert!(repair_precheck(&comfy).is_ok(), "a real ComfyUI checkout was refused");
    }

    #[test]
    fn the_repair_precheck_really_runs_before_the_venv_and_the_download() {
        // The weaker proof, and labelled as such: the repair body is a thread
        // inside a Tauri command and cannot be driven from here, so the ORDER
        // is pinned by reading this file. It catches the check drifting back
        // down the function, which is exactly what the counter-check found.
        //
        // Every needle is assembled from two halves, and that is not cosmetic.
        // Written whole, each one would stand in THIS file as well, `find`
        // would return the position of the copy in this test body whenever the
        // real line was gone, and the `.expect` beside it could never fire. A
        // guard that cannot fail is not a guard. Split, the halves never form
        // a contiguous match in the source, so a missing line is a `None` and
        // the message next to it is the one the reader gets.
        let src = include_str!("comfy_repair.rs");
        let needle = |head: &str, tail: &str| format!("{head}{tail}");
        let call = src.find(&needle("if let Err(msg) = repair_prech", "eck(&comfy_dir) {"))
            .expect("Repair no longer prechecks at all");
        let build = src.find(&needle("\"Step 1/4: Setting the existing environ", "ment aside...\");"))
            .expect("the retire-the-old-venv step is gone");
        let torch = src.find(&needle("\"Downloading PyTorch into the new env", "ironment (~2 GB). Live pip output below.\","))
            .expect("the PyTorch step is gone");
        assert!(call < build, "the precheck runs after the old venv is retired");
        assert!(call < torch, "the precheck runs after the PyTorch download");

        // And the guard on the guard: each needle occurs EXACTLY once in the
        // file. Two occurrences would mean this test body carries a copy of
        // the line it is looking for, which is how the three `.expect`s above
        // became unreachable in the first place.
        for (what, n) in [
            ("the precheck call", needle("if let Err(msg) = repair_prech", "eck(&comfy_dir) {")),
            ("the retire-the-old-venv step", needle("\"Step 1/4: Setting the existing environ", "ment aside...\");")),
            ("the PyTorch step", needle("\"Downloading PyTorch into the new env", "ironment (~2 GB). Live pip output below.\",")),
        ] {
            assert_eq!(
                src.matches(&n).count(),
                1,
                "{what}: the search string finds itself in this test, so its .expect can never fire",
            );
        }
    }

    #[test]
    fn the_repair_never_discards_the_old_venv_before_the_new_one_is_verified() {
        // Runde 6, B9: the old venv used to be RENAMED INTO the new venv's
        // build folder (Runde 5's staging approach), which left every
        // console script's shebang pointing at a name that no longer
        // existed. Now the old venv is only ever RETIRED (a reversible
        // rename, back to the exact name it already had if anything fails)
        // and the new one is built DIRECTLY at the final `venv` name, never
        // renamed at all. What still has to hold: the retired old venv is
        // discarded for good (`finish_rebuild`) only strictly after the new
        // one, built at the final name, has passed verification.
        //
        // Same shape as the precheck order test above, and for the same
        // reason: the body is a thread inside a Tauri command, so the order
        // is read out of this file. Needles split in half so they never
        // match themselves here.
        let src = include_str!("comfy_repair.rs");
        let needle = |head: &str, tail: &str| format!("{head}{tail}");

        let retire = needle("let retired = match retire_for_reb", "uild(&venv_dir) {");
        let build = needle("let venv_py = match create_comfyui_v", "env(&comfy_dir, &chosen_python, Some(&cancel_flag)) {");
        let verify = needle("verify_and_heal_environment(&venv_p", "y, &comfy_dir, &reqs, &install_status, Some(&cancel_flag))");
        let finish = needle("finish_rebuild(&comfy_d", "ir, retired);");

        let at_retire = src.find(&retire).expect("the retire-for-rebuild call is gone");
        let at_build = src.find(&build).expect("the new venv is no longer built directly at the final name");
        let at_verify = src.find(&verify).expect("the verify-and-heal call on the new venv is gone");
        let at_finish = src.find(&finish).expect("the old venv is no longer discarded via finish_rebuild");

        assert!(at_retire < at_build, "the old venv is retired after the new one is already being built");
        assert!(at_build < at_verify, "the new venv is verified before it is even built");
        assert!(at_verify < at_finish, "the old venv is discarded before the new one is verified");

        // The old way out has to be gone, not merely bypassed. Any direct
        // `retire_venv`/`remove_dir_all` on the OLD venv outside of
        // `retire_for_rebuild`, `restore_after_failed_rebuild` and
        // `finish_rebuild` would bring back exactly the failure mode this
        // guards against.
        assert!(
            !src.contains(&needle("retire_venv(&venv", "_dir)")),
            "something in this file still retires the old venv directly, outside retire_for_rebuild"
        );
        assert!(
            !src.contains(&needle("std::fs::remove_dir_all(&venv", "_dir)")),
            "something in this file still deletes the old venv directly, outside the venv module's own helpers"
        );

        // verify_and_heal_environment runs a SECOND time after the custom
        // node dependency restore (Runde 6, Folgeposten a); every other
        // needle is expected exactly once.
        for (what, n, expected) in [
            ("the retire call", retire, 1),
            ("the venv build call", build, 1),
            ("the verify call", verify, 2),
            ("the finish_rebuild call", finish, 1),
        ] {
            assert_eq!(
                src.matches(&n).count(),
                expected,
                "{what}: expected {expected} occurrence(s) in this file",
            );
        }
    }

    /// Runde 6, F12: Update reads `comfy_venv_state` synchronously, before
    /// even spawning its worker thread, to decide which Python to install
    /// requirements into. Without recovering an orphaned `venv.lu-old-*`
    /// first, that read comes back `Absent` and Update silently falls back
    /// to the system Python instead of adopting the recoverable venv, the
    /// exact failure mode F12 is about, just from the Update button instead
    /// of Install.
    #[test]
    fn update_also_recovers_an_orphaned_venv_before_reading_the_venv_state() {
        let src = include_str!("comfy_repair.rs");
        let needle = |head: &str, tail: &str| format!("{head}{tail}");

        let update_fn_start = src.find("pub fn update_comfyui(").expect("update_comfyui is gone");
        let recovery_call = needle("restore_orphaned_venv_if_needed(&comfy_d", "ir);");
        let venv_state_read = needle("comfy_venv_state(&comfy_d", "ir)");

        // Both needles occur twice in the file (Repair has its own copies);
        // only the occurrence inside update_comfyui, i.e. after its `fn`
        // keyword, is what this test is about.
        let at_recovery = src[update_fn_start..].find(&recovery_call).map(|i| i + update_fn_start).expect("update_comfyui no longer recovers an orphaned venv");
        let at_state_read = src[update_fn_start..].find(&venv_state_read).map(|i| i + update_fn_start).expect("update_comfyui no longer reads the venv state");

        assert!(at_recovery < at_state_read, "orphan recovery must run before update_comfyui reads the venv state");
    }
}
