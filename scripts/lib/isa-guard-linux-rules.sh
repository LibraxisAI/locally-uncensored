#!/usr/bin/env bash
#
# isa-guard-linux-rules.sh: the pure decision logic for the Linux half of
# scripts/verify-sidecar-isa.sh (K1, 3.0.1), factored out of that script so
# it can be exercised by scripts/verify-sidecar-isa.selftest.sh against
# small checked-in disassembly-text fixtures, on any platform. This file
# touches no ELF file, no objdump, no companions directory: the real run
# (verify-sidecar-isa.sh) sources it and feeds it real objdump output, the
# selftest sources it and feeds it fixture text. Same functions, same
# verdicts, either way.
#
# FUND this responds to (SKEPTIKER-LINUX-WEB-K1.md, Abschnitt zum
# Linux-Waechter): the Linux guard checked 4 of the modules
# build-llama.sh stages (x64, sse42, ggml-base, the exe) and silently
# skipped every other base module (ggml, llama, llama-common,
# llama-server-impl, mtmd, ggml-vulkan) and every CPU-tier variant's own
# ISA ceiling entirely, exactly the modules that carried 24-98 VEX hits on
# the Windows side of the same regression.
#
# SCOPE, stated honestly (same spirit as scripts/win-isa-guard.mjs's own
# SCOPE comment): this file is a MNEMONIC/register-text classifier over
# objdump AT&T-syntax output, not an opcode-byte disassembler like the
# Windows guard. It answers two yes/no questions exactly, because both have
# an unambiguous textual signature:
#   - "does this file contain ANY VEX/EVEX-coded instruction at all"
#     (has_avx_or_above, unchanged from the pre-existing baseline rule: a
#     %ymm/%zmm register or a mnemonic beginning with 'v').
#   - "does this file contain an AVX-512 instruction specifically"
#     (has_avx512_or_above: a %zmm register, or an opmask operand like
#     "{%k1}" -- AVX-512 is the only x86 extension that defines 512-bit
#     registers or opmask registers at all, so this is exact, not a guess).
# The one boundary this file cannot draw exactly from mnemonic text alone
# is "AVX-only vs. AVX2": many AVX2 integer mnemonics (vpaddd, vpand, ...)
# are spelled identically whether they operate on a 128-bit %xmm (legal
# under plain AVX, which promoted the SSE integer set to VEX encoding at
# 128 bits only) or a 256-bit %ymm (which requires AVX2 -- plain AVX never
# defined a 256-bit integer op). Telling those apart from mnemonic+register
# text alone needs per-instruction operand-width parsing this file does not
# do. Instead has_avx2_marker checks a curated list of mnemonics AVX2
# introduced that have NO pre-AVX2 meaning at any width (broadcast-from-GPR,
# gather, variable-shift, the 128<->256 lane insert/extract/permute forms):
# every HIT is unambiguously AVX2-or-later, but a miss is not proof of
# absence (a 256-bit vpaddd smuggled into an AVX-only-tier build would slip
# past has_avx2_marker). Not silently assumed complete: the ceiling checks
# below always pair this with has_avx512_or_above, which alone already
# catches the reportable K1 shape (a "dynamic" build secretly compiled at a
# fixed high ISA level) as either an AVX-512 hit in a sub-AVX-512 tier, or
# an AVX-or-above hit in a baseline module -- both of which this file DOES
# catch exactly, not heuristically.
set -euo pipefail

has_avx_or_above() {
  grep -qE '%[yz]mm[0-9]+|[[:space:]]v[a-z0-9]{2,}([[:space:]]|$)' <<<"$1"
}

has_avx512_or_above() {
  grep -qE '%zmm[0-9]+|\{%k[1-7]\}' <<<"$1"
}

# Mnemonics AVX2 introduced that have no pre-AVX2 (plain-AVX or SSE) meaning
# at ANY operand width: broadcast-from-GPR/128-bit-lane forms, the 128<->256
# lane insert/extract/permute forms, variable-count shifts, masked
# load/store, and gather. A hit here is unambiguous; see the SCOPE comment
# above for why a miss is not proof of absence.
AVX2_ONLY_MNEMONICS='vpbroadcastb|vpbroadcastw|vpbroadcastd|vpbroadcastq|vbroadcasti128|vbroadcasti32x4|vinserti128|vextracti128|vperm2i128|vpermd|vpermps|vpermq|vpermpd|vpsllvd|vpsllvq|vpsrlvd|vpsrlvq|vpsravd|vpblendd|vpmaskmovd|vpmaskmovq|vpgatherdd|vpgatherqd|vpgatherdq|vpgatherqq|vgatherdps|vgatherqps|vgatherdpd|vgatherqpd'

has_avx2_marker() {
  grep -qE "[[:space:]]($AVX2_ONLY_MNEMONICS)([[:space:]]|\$)" <<<"$1"
}

# --- tier table: llama.cpp GGML_CPU_ALL_VARIANTS, x86, non-MSVC branch -----
# Read at LLAMA_COMMIT (ggml/src/CMakeLists.txt, ggml_add_cpu_backend_variant
# calls; the "if (NOT MSVC)" branches only exist on Linux/GCC, not on
# Windows/MSVC, matching the four extra names verify-sidecar-isa.sh's own
# EXPECTED_VARIANTS comment already calls out):
#   x64                                          (ISA-neutral baseline)
#   sse42              SSE42                     (ISA-neutral baseline)
#   sandybridge        SSE42 AVX
#   ivybridge          SSE42 AVX F16C
#   piledriver         SSE42 AVX F16C FMA
#   haswell            SSE42 AVX F16C FMA AVX2 BMI2
#   alderlake          SSE42 AVX F16C FMA AVX2 BMI2 AVX_VNNI      (no AVX512)
#   skylakex           + AVX512
#   cannonlake         + AVX512_VBMI
#   cascadelake        + AVX512_VNNI
#   icelake            + AVX512_VBMI AVX512_VNNI
#   cooperlake         + AVX512_BF16
#   zen4               + AVX512_VBMI AVX512_VNNI AVX512_BF16
#   sapphirerapids     + AVX512_VBMI AVX512_VNNI AVX512_BF16 AMX_TILE AMX_INT8
# A future pin bump that changes this list is expected to update these
# arrays in the same commit, the same discipline EXPECTED_VARIANTS in
# verify-sidecar-isa.sh already holds itself to. sapphirerapids' AMX
# instructions are not VEX/EVEX-coded (a different encoding entirely) and
# are not detected by this file at all; that is fine here because
# sapphirerapids is already the top tier with no ceiling to enforce above
# AVX-512, the same residual gap win-isa-guard.mjs documents for BMI/POPCNT.
TIER_BASELINE_VARIANTS=(x64 sse42)
TIER_AVX_ONLY_VARIANTS=(sandybridge ivybridge piledriver)
TIER_AVX2_VARIANTS=(haswell alderlake)
TIER_AVX512_VARIANTS=(skylakex cannonlake cascadelake icelake cooperlake zen4 sapphirerapids)

# Derived, not a second hand-written copy (review-waechter-windows.md N5's
# lesson applied here too): the full Linux CPU-variant name list is exactly
# the union of the four tier arrays above, in one place, so it cannot drift
# from verify-sidecar-isa.sh's own EXPECTED_VARIANTS without the two being
# compared (verify-sidecar-isa.sh asserts the sets match at startup).
LINUX_CPU_VARIANTS=(
  "${TIER_BASELINE_VARIANTS[@]}"
  "${TIER_AVX_ONLY_VARIANTS[@]}"
  "${TIER_AVX2_VARIANTS[@]}"
  "${TIER_AVX512_VARIANTS[@]}"
)

# Every non-CPU-tier-variant module this pinned llama.cpp checkout produces
# for x86_64-unknown-linux-gnu: ggml/src/CMakeLists.txt add_library(ggml-base
# ...) and add_library(ggml ...), src/CMakeLists.txt add_library(llama ...),
# common/CMakeLists.txt (llama-common), tools/mtmd/CMakeLists.txt (mtmd),
# tools/server/CMakeLists.txt (llama-server-impl), plus the Vulkan backend
# module (ggml_add_backend_library(ggml-vulkan ...)). The same nine names
# (eight here plus the exe) EXPECTED_BASE_WINDOWS_MODULES in
# verify-sidecar-isa.sh already lists for MSVC -- one llama.cpp source tree,
# two platforms, the same target names (ggml.dll <-> libggml.so, etc.).
EXPECTED_BASE_LINUX_MODULES=(
  ggml ggml-base ggml-vulkan llama llama-common llama-server-impl mtmd
)

# Returns (on stdout) the ISA-ceiling role of a CPU-tier variant name:
# baseline|avx-only|avx2|avx512, or "unknown" (with a non-zero exit) for a
# name none of the four tier arrays list -- fail closed rather than guess.
tier_of_variant() {
  local variant="$1" v
  for v in "${TIER_BASELINE_VARIANTS[@]}"; do [ "$v" = "$variant" ] && { printf 'baseline\n'; return 0; }; done
  for v in "${TIER_AVX_ONLY_VARIANTS[@]}"; do [ "$v" = "$variant" ] && { printf 'avx-only\n'; return 0; }; done
  for v in "${TIER_AVX2_VARIANTS[@]}"; do [ "$v" = "$variant" ] && { printf 'avx2\n'; return 0; }; done
  for v in "${TIER_AVX512_VARIANTS[@]}"; do [ "$v" = "$variant" ] && { printf 'avx512\n'; return 0; }; done
  printf 'unknown\n'
  return 1
}

# Classify one staged filename against the known Linux module set (fail
# closed on anything not recognised, K1 SKEPTIKER-LINUX-WEB-K1.md).
#   $1: basename as found in the companions directory
#       (e.g. "libggml-base.so", "libggml-base.so.1", "libggml-cpu-haswell.so")
#   $2: lib prefix ("lib" on Linux, see LIB_PREFIX in verify-sidecar-isa.sh)
#   $3: lib ext ("so")
# stdout, exactly one of:
#   base:<name>            -- exact match, one of EXPECTED_BASE_LINUX_MODULES
#   variant:<name>:<tier>  -- exact match, one of LINUX_CPU_VARIANTS
#   sibling:<canonical>    -- a SONAME-versioned copy of one of the above
#                             ("<canonical-filename>.<digits>[.<digits>...]").
#                             cp without -P/-d (stage_dynamic_isa_companions
#                             in build-llama.sh) turns every hop of a
#                             libFoo.so -> libFoo.so.N -> libFoo.so.N.n.n
#                             symlink chain into its own real file with
#                             identical bytes here (see the "extension .0"
#                             comment in verify-sidecar-isa.sh's
#                             find_variant_file) -- not independently
#                             disassembled, already checked under its
#                             canonical name.
#   unknown                 -- neither of the above; the caller must fail
#                              closed on this, never skip it silently.
classify_linux_module() {
  local base="$1" prefix="$2" ext="$3" name tier v exact
  for name in "${EXPECTED_BASE_LINUX_MODULES[@]}"; do
    if [ "$base" = "${prefix}${name}.${ext}" ]; then
      printf 'base:%s\n' "$name"
      return 0
    fi
  done
  for v in "${LINUX_CPU_VARIANTS[@]}"; do
    if [ "$base" = "${prefix}ggml-cpu-${v}.${ext}" ]; then
      tier="$(tier_of_variant "$v")"
      printf 'variant:%s:%s\n' "$v" "$tier"
      return 0
    fi
  done
  for name in "${EXPECTED_BASE_LINUX_MODULES[@]}"; do
    exact="${prefix}${name}.${ext}"
    case "$base" in
      "$exact".[0-9]*)
        printf 'sibling:%s\n' "$exact"
        return 0
        ;;
    esac
  done
  for v in "${LINUX_CPU_VARIANTS[@]}"; do
    exact="${prefix}ggml-cpu-${v}.${ext}"
    case "$base" in
      "$exact".[0-9]*)
        printf 'sibling:%s\n' "$exact"
        return 0
        ;;
    esac
  done
  printf 'unknown\n'
  return 1
}

# Evaluate one module's disassembly text against its ISA role and print a
# one-line verdict to stdout ("OK: ..." or "FAIL: ..."); returns 0 for a
# pass, 1 for a fail. An unrecognised role also fails (fail closed): never
# silently treat an unclassified role as "nothing to check".
#   $1: role -- baseline | avx-only | avx2 | avx512
#   $2: disassembly text
#   $3: label for the message (module name plus path, caller's choice)
evaluate_module_asm() {
  local role="$1" asm="$2" label="${3:-module}"
  case "$role" in
    baseline)
      if has_avx_or_above "$asm"; then
        printf 'FAIL: %s contains an AVX-or-above instruction, this is supposed to be ISA-neutral baseline code (loaded by every CPU regardless of age)\n' "$label"
        return 1
      fi
      printf 'OK: %s carries no AVX-or-above instruction, as expected for a baseline module\n' "$label"
      return 0
      ;;
    avx-only)
      if has_avx512_or_above "$asm"; then
        printf 'FAIL: %s contains an AVX-512 instruction; this tier (SSE42 AVX F16C FMA at most) must never reach AVX-512\n' "$label"
        return 1
      fi
      if has_avx2_marker "$asm"; then
        printf 'FAIL: %s contains an AVX2-only instruction; this tier (SSE42 AVX F16C FMA at most) must never reach AVX2\n' "$label"
        return 1
      fi
      printf 'OK: %s stays at or below its AVX-only ceiling (no AVX-512, no AVX2-only mnemonic found)\n' "$label"
      return 0
      ;;
    avx2)
      if has_avx512_or_above "$asm"; then
        printf 'FAIL: %s contains an AVX-512 instruction; this tier (AVX2 at most) must never reach AVX-512\n' "$label"
        return 1
      fi
      printf 'OK: %s stays at or below its AVX2 ceiling (no AVX-512 found)\n' "$label"
      return 0
      ;;
    avx512)
      printf 'OK: %s is the top CPU tier (AVX-512 and above allowed by design), nothing to cap\n' "$label"
      return 0
      ;;
    *)
      printf 'FAIL: %s has an unrecognised ISA role "%s", refusing to guess a ceiling (fail closed)\n' "$label" "$role"
      return 1
      ;;
  esac
}
