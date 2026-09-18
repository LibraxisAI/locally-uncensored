//! Welches PyTorch-Rad diese Maschine bekommt.
//!
//! Der geteilte Zustand ist die Grafikkarte, wie sie sich abfragen lässt.
//! `parse_compute_cap_output` und `detect_nvidia_compute_cap` lesen sie,
//! `plan_pytorch_install` verbindet diese Lesung mit der Herstellerliste aus
//! `torch_wheels` zu einer Kanalwahl, und `pytorch_pip_args` gießt das
//! Ergebnis in die Argumentliste, die `pip` dann ausführt.
//!
//! Die Naht trennt die ENTSCHEIDUNG vom LAUF: alles hier ist reine
//! Rechnung über eine Sonde, ohne Netz und ohne Zustand, und ist deshalb
//! auf einem Rechner ohne die Hardware prüfbar. Der Einbau an zwei Stellen
//! — Erstinstallation und Reparatur — ist der Grund, warum diese Wahl
//! überhaupt eine eigene Funktion ist: die beiden dürfen nie
//! auseinanderlaufen.

use std::process::Stdio;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::commands::torch_wheels;

#[cfg(target_os = "windows")]
use super::CREATE_NO_WINDOW;

// ── GPU helpers (Bug #10 — Blackwell PyTorch cu128 routing) ─────────────────

/// Probe NVIDIA's compute capability and return it as (major, minor):
/// (8, 6) for a 3060, (7, 5) for a 2080, (12, 0) for Blackwell.
///
/// `nvidia-smi --query-gpu=compute_cap` prints lines like `12.0` (one per
/// GPU). We take the highest across visible GPUs because pip can only install
/// ONE PyTorch build, so the higher capability set is the one that satisfies
/// every card on the box. Returns None when nvidia-smi is absent or the parse
/// fails, and the caller then picks the channel that covers the widest range.
///
/// The minor number was thrown away until 2.6.7 and is now load bearing:
/// CUDA 13 dropped everything below Turing, and Turing is 7.5 while Volta is
/// 7.0. A major-only reading cannot tell those two apart.
pub(crate) fn parse_compute_cap_output(s: &str) -> Option<(u32, u32)> {
    let mut best: Option<(u32, u32)> = None;
    for line in s.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.split('.');
        let major = match parts.next().unwrap_or("").parse::<u32>() {
            Ok(m) => m,
            Err(_) => continue,
        };
        // A card that prints a bare major keeps the old reading of .0 rather
        // than being dropped: an unparseable minor must never cost us the card.
        let minor = parts.next().unwrap_or("0").trim().parse::<u32>().unwrap_or(0);
        best = Some(best.map_or((major, minor), |prev| prev.max((major, minor))));
    }
    best
}

pub(crate) fn detect_nvidia_compute_cap() -> Option<(u32, u32)> {
    // K14: a foreign vendor CLI, never something LU bundles.
    let mut cmd = crate::process_util::foreign_system_command("nvidia-smi");
    cmd.args(["--query-gpu=compute_cap", "--format=csv,noheader,nounits"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    parse_compute_cap_output(&s)
}

/// The major alone, for the trainer, whose two channels (cu121 and cu128) are
/// split at Blackwell and have never needed the minor.
pub(crate) fn detect_nvidia_compute_cap_major() -> Option<u32> {
    detect_nvidia_compute_cap().map(|(major, _)| major)
}

/// Pure: the pip argument set for the PyTorch install, for a given wheel
/// index. Split from the probe so the arg shapes are testable without
/// nvidia-smi on the machine.
pub(crate) fn pytorch_pip_args(index_url: Option<&str>, packages: &[&str]) -> Vec<String> {
    let mut args: Vec<String> = ["-m", "pip", "install", "--progress-bar", "off", "--no-input"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    // The package names come from the plan: AMD's Windows index serves a slim
    // torch plus a device package behind an extra, so "torch" alone would build
    // an environment with no kernels for any card.
    args.extend(packages.iter().map(|s| s.to_string()));
    if let Some(u) = index_url {
        args.push("--index-url".to_string());
        args.push(u.to_string());
    }
    args
}

/// GPU probe + wheel choice + pip args, shared between the first install and
/// `repair_comfyui_env` so the two can never drift apart.
///
/// Bug #10 (vokurta, RTX 6000 Blackwell, 2026-05-11): SM 12.0 GPUs need their
/// own CUDA channel, older ones simply do not ship the kernel and the first
/// compute call dies with "no kernel image is available".
///
/// Box measurement 2026-08-16 (W2, #98): everything below Blackwell used to
/// get cu121, but that channel is frozen at torch 2.5.1 while ComfyUI's own
/// unpinned requirements move on. Current cores import comfy_kitchen, whose
/// custom ops use builtin generic annotations (`kernel_size: list[int]`) that
/// torch only accepts from 2.6 on, so a freshly repaired venv died at import
/// with the infer_schema ValueError.
///
/// AMD bundle 2026-08-28 (numbrain, lapbo, petermanmancusso, sancora): the
/// probe was `nvidia-smi` and nothing else, so an AMD card came out of it
/// looking exactly like a machine with no card, and the venv got the
/// processor wheels. Those wheels install cleanly and then answer
/// "Torch not compiled with CUDA enabled" the moment the user forces the GPU.
/// The vendor list now decides, and the choice itself lives in
/// `torch_wheels` where it is testable without any of the hardware.
/// Returns the ready-to-run pip args, the human-readable channel note, and
/// (index_url, packages) again on their own: Runde 2's preflight
/// ([`torch_python_preflight`]) needs those two separately, and re-deriving
/// them from the combined arg list would be a second copy of the exact
/// assembly `pytorch_pip_args` already does.
pub(crate) fn plan_pytorch_install() -> (Vec<String>, String, Option<String>, Vec<String>) {
    let (has_nvidia, has_amd, amd_names) = torch_wheels::gpu_vendor_facts();
    let compute_cap = if has_nvidia { detect_nvidia_compute_cap() } else { None };
    let amd_refs: Vec<&str> = amd_names.iter().map(|s| s.as_str()).collect();
    let plan = torch_wheels::comfy_wheel_plan(
        has_nvidia,
        compute_cap,
        has_amd,
        &amd_refs,
        std::env::consts::OS,
    );
    // The note is resolved WITH the index: a plan that reached for AMD's
    // Windows channel and found it dead falls back to the processor wheels,
    // and then the sentence in "Step 2/3" has to be the fallback's, not the
    // one the plan set out with.
    let (index, packages, note) = torch_wheels::resolve_plan(&plan);
    let gpu_info = match index {
        Some(url) => format!("{note} ({url})"),
        None => note,
    };
    let args = pytorch_pip_args(index, packages);
    (
        args,
        gpu_info,
        index.map(|s| s.to_string()),
        packages.iter().map(|s| s.to_string()).collect(),
    )
}

// ── Runde 2, Nachbesserung 12: torch/Python-version preflight ───────────────

/// The interpreter's own `(major, minor)`, the way wheel filenames spell it
/// (`cp312` -> `(3, 12)`).
pub(crate) fn python_version_tuple(python_bin: &str) -> Option<(u32, u32)> {
    let mut cmd = crate::python::python_command(python_bin);
    cmd.args(["-c", "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"]);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    parse_version_tuple(String::from_utf8_lossy(&out.stdout).trim())
}

pub(crate) fn parse_version_tuple(s: &str) -> Option<(u32, u32)> {
    let mut parts = s.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}

/// Every distinct CPython `(major, minor)` a wheel index page's `.whl`
/// filenames declare support for (`torch-2.7.0-cp312-cp312-linux_x86_64.whl`
/// -> `(3, 12)`). Pure and network-free, so it is testable against a canned
/// page instead of the real index; see the module doc on why that beats a
/// hardcoded version table: this reads whatever the channel serves AT CALL
/// TIME, so it is never stale the day a channel adds or drops a version.
pub(crate) fn python_versions_from_index_html(html: &str) -> std::collections::BTreeSet<(u32, u32)> {
    // `cp3\d{1,2}-cp3\d{1,2}` rather than `cp(\d)(\d+)`: a wheel tag repeats
    // the ABI tag right after the Python tag (`cp312-cp312-...`), and asking
    // for that repeat is enough discipline to reject a stray "cp312" inside
    // some other token (a URL query string, a directory name) without also
    // pulling in a whole HTML parser.
    static TAG: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = TAG.get_or_init(|| regex::Regex::new(r"cp3(\d{1,2})-cp3\d{1,2}").unwrap());
    re.captures_iter(html)
        .filter_map(|c| c.get(1)?.as_str().parse::<u32>().ok())
        .map(|minor| (3u32, minor))
        .collect()
}

/// Fetch a PEP 503 wheel index page (`<index_url>/<package>/`, or PyPI's own
/// simple index when `index_url` is `None`) and read the Python versions it
/// serves wheels for, per [`python_versions_from_index_html`].
///
/// Talks to the network, so it is the one function here `torch.rs`'s own
/// module doc excludes from "ohne Netz und ohne Zustand": everything ELSE
/// in this file stays a pure decision over a probe, on purpose, and this is
/// the deliberate, narrow exception, isolated so the pure half stays
/// testable without it.
fn fetch_index_python_versions(index_url: Option<&str>, package: &str) -> Result<std::collections::BTreeSet<(u32, u32)>, String> {
    let base = index_url.unwrap_or("https://pypi.org/simple").trim_end_matches('/');
    let url = format!("{base}/{package}/");
    let client = reqwest::blocking::Client::builder()
        .user_agent("LocallyUncensored/3.0")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("HTTP client error: {}", crate::os_error::english(&e)))?;
    let resp = client.get(&url).send().map_err(|e| format!("index request failed: {}", crate::os_error::english(&e)))?;
    if !resp.status().is_success() {
        return Err(format!("index returned HTTP {}", resp.status()));
    }
    let html = resp.text().map_err(|e| format!("index body: {}", crate::os_error::english(&e)))?;
    Ok(python_versions_from_index_html(&html))
}

/// One line per interpreter found on the box, for the "here is what LU can
/// see instead" half of the preflight message.
fn interpreter_inventory_lines() -> Vec<String> {
    crate::python::python_interpreters()
        .into_iter()
        .map(|path| match python_version_tuple(&path) {
            Some((maj, min)) => format!("  - {path} (Python {maj}.{min})"),
            None => format!("  - {path} (version unknown)"),
        })
        .collect()
}

/// Runs right before the real `pip install` for PyTorch. `None` means
/// proceed; `Some(message)` means the venv's Python is not on the channel
/// `plan_pytorch_install` chose and pip's own generic "no matching
/// distribution" would send the user chasing a PATH or proxy problem that
/// does not exist.
///
/// Fails OPEN on anything it cannot establish (offline, index unreachable,
/// version probe failed): a preflight that blocks installs whenever the
/// network hiccups is worse than the gap it closes. This is the "was du
/// ohne Netz nicht messen kannst, als solches markieren" rule applied to a
/// live check instead of a written report: the honest answer to "can I
/// tell" is sometimes "no", and the function returns exactly that as
/// `None`, not a false pass dressed up as a positive one.
pub(crate) fn torch_python_preflight(python_bin: &str, index_url: Option<&str>, packages: &[&str]) -> Option<String> {
    let (maj, min) = python_version_tuple(python_bin)?;
    // The AMD Windows channel serves "torch[device-all]"; strip any extra so
    // the index lookup is against the real package directory.
    let package = packages.first()?.split('[').next().unwrap_or("torch");
    let supported = match fetch_index_python_versions(index_url, package) {
        Ok(s) if !s.is_empty() => s,
        // Empty or unreachable: cannot tell, so do not block (see doc above).
        _ => return None,
    };
    if supported.contains(&(maj, min)) {
        return None;
    }
    let mut versions: Vec<String> = supported.iter().map(|(a, b)| format!("{a}.{b}")).collect();
    versions.sort();
    let interpreters = interpreter_inventory_lines();
    let interpreters_block = if interpreters.is_empty() {
        "  (none found)".to_string()
    } else {
        interpreters.join("\n")
    };
    Some(format!(
        "This environment's Python is {maj}.{min}, and the PyTorch build LU needs for this \
         machine currently ships wheels only for Python {versions}. Installing torch would \
         fail with a generic pip error, so LU is stopping before that and offering to rebuild \
         the virtual environment with a supported interpreter instead - your models and custom \
         nodes are untouched either way, only the venv folder is recreated.\n\n\
         Python interpreters LU found on this machine:\n{interpreters_block}\n\n\
         Pick one of the versions above in Settings and press Repair, or install a supported \
         Python and press Repair again.",
        versions = versions.join(", "),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── PyTorch-Kanalwahl (W2-Befund 16.08., comfy_kitchen braucht 2.6+) ─

    #[test]
    fn pytorch_index_rides_living_channels() {
        use crate::commands::torch_wheels::{comfy_wheel_plan, WheelPlan};
        let first = |nv, cap, amd, os| match comfy_wheel_plan(nv, cap, amd, &[], os) {
            WheelPlan::Index { candidates, .. } => Some(candidates[0]),
            WheelPlan::IndexOrCpu { candidates, .. } => Some(candidates[0]),
            WheelPlan::Cpu { .. } => None,
        };
        assert_eq!(
            first(true, Some((12, 0)), false, "windows"),
            Some("https://download.pytorch.org/whl/cu130")
        );
        assert_eq!(
            first(true, Some((8, 6)), false, "windows"),
            Some("https://download.pytorch.org/whl/cu130")
        );
        assert_eq!(
            first(true, None, false, "windows"),
            Some("https://download.pytorch.org/whl/cu126")
        );
        assert_eq!(first(false, None, false, "linux"), None);
    }

    #[test]
    fn pytorch_index_never_picks_the_frozen_cu121_channel() {
        // Negative control: cu121 is stuck at torch 2.5.1, which current
        // ComfyUI cores reject at import (comfy_kitchen infer_schema).
        use crate::commands::torch_wheels::{comfy_wheel_plan, WheelPlan};
        for (nv, cap) in [
            (true, Some((6, 1))),
            (true, Some((7, 0))),
            (true, Some((7, 5))),
            (true, Some((8, 6))),
            (true, Some((9, 0))),
            (true, Some((12, 0))),
            (true, None),
        ] {
            if let WheelPlan::Index { candidates, .. } = comfy_wheel_plan(nv, cap, false, &[], "linux") {
                assert!(
                    !candidates.iter().any(|c| c.contains("cu121")),
                    "frozen channel chosen for cap {:?}",
                    cap
                );
            }
        }
    }

    // ── PyTorch-Args, geteilt zwischen Install und Repair (GH #98) ──────

    #[test]
    fn pytorch_args_carry_the_wheel_index_when_given() {
        use crate::commands::torch_wheels::TORCH_TRIO;
        let args = pytorch_pip_args(Some("https://download.pytorch.org/whl/cu128"), TORCH_TRIO);
        assert_eq!(args.first().map(String::as_str), Some("-m"));
        assert!(args.contains(&"torch".to_string()));
        assert!(args.contains(&"torchvision".to_string()));
        assert!(args.contains(&"torchaudio".to_string()));
        assert!(args.contains(&"--no-input".to_string()));
        let idx = args.iter().position(|a| a == "--index-url").expect("index flag");
        assert_eq!(args.get(idx + 1).map(String::as_str), Some("https://download.pytorch.org/whl/cu128"));
    }

    #[test]
    fn pytorch_args_without_index_stay_on_pypi() {
        use crate::commands::torch_wheels::TORCH_TRIO;
        let args = pytorch_pip_args(None, TORCH_TRIO);
        assert!(!args.iter().any(|a| a == "--index-url"));
        assert!(args.contains(&"torch".to_string()));
    }

    #[test]
    fn pytorch_args_pass_a_channels_own_package_names_through_untouched() {
        // AMD's Windows index serves torch behind a device extra. pip has to
        // see "torch[device-all]" verbatim; a bare "torch" from that index is
        // an environment with no kernels for any card.
        use crate::commands::torch_wheels::{TORCH_TRIO, TORCH_TRIO_AMD_WINDOWS};
        let args = pytorch_pip_args(Some("https://repo.amd.com/rocm/whl-multi-arch/"), TORCH_TRIO_AMD_WINDOWS);
        assert!(args.contains(&"torch[device-all]".to_string()), "{args:?}");
        assert!(args.contains(&"torchvision".to_string()));
        // NEGATIVE CONTROL: the extra is never bolted onto the normal channels.
        let plain = pytorch_pip_args(Some("https://download.pytorch.org/whl/cu130"), TORCH_TRIO);
        assert!(!plain.iter().any(|a| a.contains('[')), "{plain:?}");
    }

    // ── parse_compute_cap_output (Bug #10 — Blackwell PyTorch routing) ────

    #[test]
    fn compute_cap_parses_ampere_single_gpu() {
        assert_eq!(parse_compute_cap_output("8.6\n"), Some((8, 6)));
    }

    #[test]
    fn compute_cap_parses_ada_single_gpu() {
        assert_eq!(parse_compute_cap_output("8.9\n"), Some((8, 9)));
    }

    #[test]
    fn compute_cap_parses_hopper() {
        assert_eq!(parse_compute_cap_output("9.0\n"), Some((9, 0)));
    }

    #[test]
    fn compute_cap_parses_blackwell() {
        assert_eq!(parse_compute_cap_output("12.0\n"), Some((12, 0)));
    }

    #[test]
    fn compute_cap_multi_gpu_picks_highest() {
        assert_eq!(parse_compute_cap_output("8.6\n12.0\n"), Some((12, 0)));
        // Same major, so only the minor can decide which of the two cards
        // the one PyTorch build has to satisfy.
        assert_eq!(parse_compute_cap_output("7.0\n7.5\n"), Some((7, 5)));
        assert_eq!(parse_compute_cap_output("7.5\n7.0\n"), Some((7, 5)));
    }

    #[test]
    fn compute_cap_survives_a_line_without_a_minor() {
        // Negative control for the new minor parse: a bare major must keep
        // the card rather than drop it, and read as .0.
        assert_eq!(parse_compute_cap_output("8\n"), Some((8, 0)));
        assert_eq!(parse_compute_cap_output("8.x\n"), Some((8, 0)));
    }

    #[test]
    fn compute_cap_handles_blank_lines() {
        assert_eq!(parse_compute_cap_output("\n8.6\n\n"), Some((8, 6)));
    }

    #[test]
    fn compute_cap_returns_none_for_empty_output() {
        assert_eq!(parse_compute_cap_output(""), None);
    }

    #[test]
    fn compute_cap_skips_unparseable_lines() {
        assert_eq!(parse_compute_cap_output("[Not Supported]\n8.6\n"), Some((8, 6)));
    }

    // ── Runde 2, Nachbesserung 12: torch/Python preflight ────────────────

    #[test]
    fn version_tuple_parses_the_usual_shape() {
        assert_eq!(parse_version_tuple("3.14"), Some((3, 14)));
        assert_eq!(parse_version_tuple("3.9"), Some((3, 9)));
        assert_eq!(parse_version_tuple(""), None);
        assert_eq!(parse_version_tuple("garbage"), None);
    }

    /// A trimmed but structurally real PEP 503 index page, the shape both
    /// pypi.org/simple and download.pytorch.org/whl/<channel> serve: one
    /// `<a>` per wheel file, cp-tagged twice (Python tag, then ABI tag).
    const SAMPLE_INDEX_HTML: &str = r#"<!DOCTYPE html>
<html><body>
<a href="torch-2.7.0-cp310-cp310-manylinux_2_28_x86_64.whl">torch-2.7.0-cp310-cp310-manylinux_2_28_x86_64.whl</a>
<a href="torch-2.7.0-cp311-cp311-manylinux_2_28_x86_64.whl">torch-2.7.0-cp311-cp311-manylinux_2_28_x86_64.whl</a>
<a href="torch-2.7.0-cp312-cp312-manylinux_2_28_x86_64.whl">torch-2.7.0-cp312-cp312-manylinux_2_28_x86_64.whl</a>
<a href="torch-2.7.0-cp313-cp313-manylinux_2_28_x86_64.whl">torch-2.7.0-cp313-cp313-manylinux_2_28_x86_64.whl</a>
<a href="torch-2.6.0-cp39-cp39-manylinux_2_28_x86_64.whl">torch-2.6.0-cp39-cp39-manylinux_2_28_x86_64.whl</a>
</body></html>"#;

    #[test]
    fn index_html_yields_every_python_version_the_channel_actually_serves() {
        let versions = python_versions_from_index_html(SAMPLE_INDEX_HTML);
        assert_eq!(
            versions,
            [(3, 9), (3, 10), (3, 11), (3, 12), (3, 13)].into_iter().collect()
        );
        // Python 3.14 is deliberately NOT in the sample: this is the exact
        // shape of the gap the preflight exists to catch (Punkt 12).
        assert!(!versions.contains(&(3, 14)));
    }

    #[test]
    fn index_html_with_no_wheels_yields_an_empty_set_not_a_panic() {
        assert!(python_versions_from_index_html("<html><body>nothing here</body></html>").is_empty());
        assert!(python_versions_from_index_html("").is_empty());
    }

    /// Negative control for the parser: a bare `cp312` with no repeated ABI
    /// tag (not a real wheel filename shape) must NOT be picked up. A parser
    /// that matched anything containing "cp3\d\d" would also fire on a stray
    /// digit sequence inside a URL query string or directory name.
    #[test]
    fn a_lone_cp_tag_without_the_repeated_abi_tag_is_not_counted() {
        let html = r#"<a href="/cp312/some-other-thing">not a wheel</a>"#;
        assert!(python_versions_from_index_html(html).is_empty());
    }
}
