#!/usr/bin/env bash
#
# verify-sidecar-isa.selftest.sh: proves the DECISION LOGIC of the Linux
# half of verify-sidecar-isa.sh (scripts/lib/isa-guard-linux-rules.sh)
# against small checked-in disassembly-text fixtures
# (scripts/__fixtures__/linux-isa/), with no objdump, no real ELF file and
# no COMPANIONS_DIR needed. Runs the same on the Linux CI runner and on a
# Mac dev box (arm64), the same reasoning win-isa-guard.test.mjs already
# uses for the Windows half of this guard: the real Linux run always needs
# a real x86_64 build to disassemble (see the "real run" command at the
# bottom of this file's usage comment), but the CLASSIFICATION and CEILING
# rules that decide pass/fail from that disassembly text are pure functions
# and can be proven everywhere, every commit.
#
# FUND this answers (SKEPTIKER-LINUX-WEB-K1.md): the pre-existing Linux
# guard checked 4 of the staged modules and never exercised a tier-ceiling
# rule at all, so nothing in this repo's test suite could have caught a
# regression there before a real Linux build ran. This selftest is that
# missing coverage, runnable on every commit regardless of platform.
#
# Usage: scripts/verify-sidecar-isa.selftest.sh
# Real Linux run (after a real build, by the tester assigned to it):
#   scripts/build-llama.sh x86_64-unknown-linux-gnu
#   scripts/verify-sidecar-isa.sh x86_64-unknown-linux-gnu
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/__fixtures__/linux-isa"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/isa-guard-linux-rules.sh"

pass_count=0
fail_count=0

# Every assertion goes through this so a wrong verdict AND a wrong exit
# code are both caught, the same "exact expected outcome, not just any
# failure" discipline verify-sidecar-isa.sh's own Windows controls already
# hold themselves to (review-waechter-windows.md BLOCKER B2).
assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf '  ok   %s\n' "$desc"
    pass_count=$((pass_count + 1))
  else
    printf '  FAIL %s: expected [%s], got [%s]\n' "$desc" "$expected" "$actual" >&2
    fail_count=$((fail_count + 1))
  fi
}

fixture() {
  local name="$1"
  [ -f "$FIXTURES_DIR/$name" ] || { printf '  FAIL missing fixture %s\n' "$name" >&2; fail_count=$((fail_count + 1)); return; }
  cat "$FIXTURES_DIR/$name"
}

echo "== tier table consistency (derived list vs. the hand-typed set) =="
# Same 14 names verify-sidecar-isa.sh's own EXPECTED_VARIANTS lists for a
# non-Windows triple, order-independent. Catches the two lists drifting
# apart the way review-waechter-windows.md N5 warned about for the Windows
# side of this same guard.
expected_variant_set='alderlake cannonlake cascadelake cooperlake haswell icelake ivybridge piledriver sandybridge sapphirerapids skylakex sse42 x64 zen4'
actual_variant_set="$(printf '%s\n' "${LINUX_CPU_VARIANTS[@]}" | sort | tr '\n' ' ' | sed 's/ $//')"
assert_eq "LINUX_CPU_VARIANTS matches the 14-name pin (14 entries, one place)" \
  "$(printf '%s' "$expected_variant_set" | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//')" \
  "$actual_variant_set"

echo "== tier_of_variant =="
assert_eq "x64 is baseline" "baseline" "$(tier_of_variant x64)"
assert_eq "sse42 is baseline" "baseline" "$(tier_of_variant sse42)"
assert_eq "sandybridge is avx-only" "avx-only" "$(tier_of_variant sandybridge)"
assert_eq "piledriver is avx-only" "avx-only" "$(tier_of_variant piledriver)"
assert_eq "haswell is avx2" "avx2" "$(tier_of_variant haswell)"
assert_eq "alderlake is avx2" "avx2" "$(tier_of_variant alderlake)"
assert_eq "skylakex is avx512" "avx512" "$(tier_of_variant skylakex)"
assert_eq "sapphirerapids is avx512" "avx512" "$(tier_of_variant sapphirerapids)"
assert_eq "made-up name is unknown" "unknown" "$(tier_of_variant not-a-real-tier || true)"

echo "== classify_linux_module (fail-closed module accounting) =="
assert_eq "libggml-base.so is a known base module" "base:ggml-base" \
  "$(classify_linux_module libggml-base.so lib so)"
assert_eq "libggml-cpu-haswell.so is a known variant (avx2 tier)" "variant:haswell:avx2" \
  "$(classify_linux_module libggml-cpu-haswell.so lib so)"
assert_eq "libggml-cpu-sandybridge.so is a known variant (avx-only tier)" "variant:sandybridge:avx-only" \
  "$(classify_linux_module libggml-cpu-sandybridge.so lib so)"
assert_eq "libggml-base.so.1 is a SONAME sibling of libggml-base.so" "sibling:libggml-base.so" \
  "$(classify_linux_module libggml-base.so.1 lib so)"
assert_eq "libggml-cpu-x64.so.1.2.3 is a SONAME sibling of libggml-cpu-x64.so" "sibling:libggml-cpu-x64.so" \
  "$(classify_linux_module libggml-cpu-x64.so.1.2.3 lib so)"
assert_eq "an unrelated new .so is unknown (fail closed, the skeptic's actual finding)" "unknown" \
  "$(classify_linux_module libggml-cpu-zen5.so lib so || true)"
assert_eq "a plain typo/near-miss name is unknown, not fuzzy-matched" "unknown" \
  "$(classify_linux_module libggml-cpu-haswel.so lib so || true)"

echo "== has_avx_or_above / has_avx512_or_above / has_avx2_marker =="
clean_baseline="$(fixture clean-baseline.disasm.txt)"
avx_hit_baseline="$(fixture avx-hit-baseline.disasm.txt)"
clean_avx_only="$(fixture clean-avx-only.disasm.txt)"
avx2_leak="$(fixture avx2-leak-in-avx-only.disasm.txt)"
clean_avx2="$(fixture clean-avx2.disasm.txt)"
avx512_leak="$(fixture avx512-leak-in-avx2.disasm.txt)"
haswell_positive="$(fixture haswell-positive-control.disasm.txt)"
clean_avx512="$(fixture clean-avx512.disasm.txt)"

if has_avx_or_above "$clean_baseline"; then
  printf '  FAIL clean-baseline fixture should have NO AVX-or-above hit\n' >&2; fail_count=$((fail_count + 1))
else
  printf '  ok   clean-baseline fixture has no AVX-or-above hit\n'; pass_count=$((pass_count + 1))
fi
if has_avx_or_above "$avx_hit_baseline"; then
  printf '  ok   avx-hit-baseline fixture IS caught by has_avx_or_above\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL avx-hit-baseline fixture should have an AVX-or-above hit\n' >&2; fail_count=$((fail_count + 1))
fi
if has_avx2_marker "$avx2_leak"; then
  printf '  ok   avx2-leak-in-avx-only fixture IS caught by has_avx2_marker\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL avx2-leak-in-avx-only fixture should trip has_avx2_marker\n' >&2; fail_count=$((fail_count + 1))
fi
if has_avx2_marker "$clean_avx_only"; then
  printf '  FAIL clean-avx-only fixture must NOT trip has_avx2_marker\n' >&2; fail_count=$((fail_count + 1))
else
  printf '  ok   clean-avx-only fixture does not trip has_avx2_marker\n'; pass_count=$((pass_count + 1))
fi
if has_avx512_or_above "$avx512_leak"; then
  printf '  ok   avx512-leak-in-avx2 fixture IS caught by has_avx512_or_above\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL avx512-leak-in-avx2 fixture should trip has_avx512_or_above\n' >&2; fail_count=$((fail_count + 1))
fi
if has_avx512_or_above "$clean_avx2"; then
  printf '  FAIL clean-avx2 fixture must NOT trip has_avx512_or_above\n' >&2; fail_count=$((fail_count + 1))
else
  printf '  ok   clean-avx2 fixture does not trip has_avx512_or_above\n'; pass_count=$((pass_count + 1))
fi
# Positive control on the detector itself: without this, a broken grep
# pattern that never matches anything would make every "no AVX found"
# result above unproven (the exact reasoning verify-sidecar-isa.sh's own
# POSITIVE_CONTROL section already uses on a real haswell build).
if has_avx_or_above "$haswell_positive"; then
  printf '  ok   positive control: haswell-style fixture shows an AVX hit, the detector itself works\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL positive control: haswell-style fixture shows NO AVX hit, has_avx_or_above is broken\n' >&2; fail_count=$((fail_count + 1))
fi

echo "== evaluate_module_asm (the actual per-tier ceiling decision) =="
out="$(evaluate_module_asm baseline "$clean_baseline" "clean-baseline")"; status=$?
assert_eq "baseline/clean exits 0" "0" "$status"
assert_eq "baseline/clean verdict text" "OK: clean-baseline carries no AVX-or-above instruction, as expected for a baseline module" "$out"

set +e
out="$(evaluate_module_asm baseline "$avx_hit_baseline" "avx-hit-baseline")"; status=$?
set -e
assert_eq "baseline/regressed exits 1 (RED PROBE)" "1" "$status"
assert_eq "baseline/regressed verdict text (RED PROBE)" "FAIL: avx-hit-baseline contains an AVX-or-above instruction, this is supposed to be ISA-neutral baseline code (loaded by every CPU regardless of age)" "$out"

out="$(evaluate_module_asm avx-only "$clean_avx_only" "clean-avx-only")"; status=$?
assert_eq "avx-only/clean exits 0" "0" "$status"

set +e
out="$(evaluate_module_asm avx-only "$avx2_leak" "avx2-leak")"; status=$?
set -e
assert_eq "avx-only/avx2-leak exits 1 (RED PROBE)" "1" "$status"
assert_eq "avx-only/avx2-leak verdict text (RED PROBE)" "FAIL: avx2-leak contains an AVX2-only instruction; this tier (SSE42 AVX F16C FMA at most) must never reach AVX2" "$out"

out="$(evaluate_module_asm avx2 "$clean_avx2" "clean-avx2")"; status=$?
assert_eq "avx2/clean exits 0 (negative control: a real haswell-shaped body is not flagged)" "0" "$status"

set +e
out="$(evaluate_module_asm avx2 "$avx512_leak" "avx512-leak")"; status=$?
set -e
assert_eq "avx2/avx512-leak exits 1 (RED PROBE)" "1" "$status"
assert_eq "avx2/avx512-leak verdict text (RED PROBE)" "FAIL: avx512-leak contains an AVX-512 instruction; this tier (AVX2 at most) must never reach AVX-512" "$out"

out="$(evaluate_module_asm avx512 "$clean_avx512" "clean-avx512")"; status=$?
assert_eq "avx512/top-tier always exits 0 (nothing to cap above AVX-512)" "0" "$status"

set +e
out="$(evaluate_module_asm made-up-role "$clean_baseline" "some-module")"; status=$?
set -e
assert_eq "unrecognised role fails closed (RED PROBE)" "1" "$status"
assert_eq "unrecognised role verdict text (RED PROBE)" 'FAIL: some-module has an unrecognised ISA role "made-up-role", refusing to guess a ceiling (fail closed)' "$out"

echo
echo "$pass_count passed, $fail_count failed"
[ "$fail_count" -eq 0 ] || exit 1
echo "OK: isa-guard-linux-rules.sh decision logic proven against fixtures (module classification, all four tier ceilings, positive/negative controls, red probes), no ELF file or objdump needed"
