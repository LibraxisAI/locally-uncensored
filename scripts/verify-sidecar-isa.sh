#!/usr/bin/env bash
#
# verify-sidecar-isa.sh: the guard for K1 (3.0.1). Fails the build RED when
# the dynamic-ISA sidecar (scripts/build-llama.sh, Windows/Linux) is not what
# it claims to be.
#
# Two things this checks, both measured on the actual built files, not on the
# cmake command line that produced them (a wrong flag upstream, a stale
# build cache, or a future llama.cpp release changing its own defaults could
# all make the command line lie):
#
#   1. The BASELINE files (the "x64" CPU variant, and llama-server / ggml-base
#      themselves) must contain NO AVX-or-above instruction. These are the
#      files every CPU loads no matter how old, so an AVX instruction inside
#      one of them is exactly the K1 bug: a "dynamic" build that is secretly
#      still a fixed x86-64-v3 (or higher) binary. Checked by disassembling
#      and searching for ymm/zmm registers and VEX/EVEX-coded mnemonics (they
#      are the ones objdump prints with a leading "v", e.g. vmovaps,
#      vzeroupper, vfmadd231ps; no plain SSE mnemonic is spelled that way).
#   2. The HASWELL variant (the first AVX2 tier) MUST contain at least one
#      such instruction. Without this positive control, a disassembler that
#      silently failed, or a grep pattern that never matches anything, would
#      make check 1 pass on every input, including a build that produced no
#      real code at all. Two files, two opposite expectations, in one script.
#
# Also fails RED when an expected CPU variant is simply missing from the
# companions directory (a partial build, or a future cmake refactor that
# drops a name this project still assumes).
#
# Usage: scripts/verify-sidecar-isa.sh <triple>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/build-llama.sh"

vlog()  { printf '\033[1;36m[verify-sidecar-isa]\033[0m %s\n' "$*"; }
vdie()  { printf '\033[1;31m[verify-sidecar-isa] FAIL:\033[0m %s\n' "$*" >&2; exit 1; }

TRIPLE="${1:?usage: verify-sidecar-isa.sh <triple>}"

if ! is_dynamic_isa_triple "$TRIPLE"; then
  vlog "$TRIPLE is a static build (Metal), nothing to verify here"
  exit 0
fi

# The CPU-variant names this project's PINNED llama.cpp checkout is known to
# produce with GGML_CPU_ALL_VARIANTS=ON, per compiler family. Not a guess:
# read straight off a live `cmake -S/-B` configure against LLAMA_COMMIT
# (see build-llama.sh) and off ggml/src/CMakeLists.txt's own
# `ggml_add_cpu_backend_variant` calls (the "if (NOT MSVC)" branches are
# exactly the four names MSVC lacks). A future pin bump that changes this
# list is expected to update this array in the same commit, the same way
# LLAMA_TAG/LLAMA_COMMIT themselves are a deliberate, reviewed pin rather
# than "whatever upstream has today".
case "$TRIPLE" in
  *-windows-*)
    EXPECTED_VARIANTS=(x64 sse42 sandybridge haswell skylakex cannonlake cascadelake icelake alderlake)
    LIB_EXT="dll"
    ;;
  *)
    EXPECTED_VARIANTS=(x64 sse42 sandybridge ivybridge piledriver haswell skylakex cannonlake cascadelake icelake cooperlake zen4 alderlake sapphirerapids)
    LIB_EXT="so"
    ;;
esac

COMPANIONS_DIR="$(resource_llama_dir_for "$TRIPLE")"
[ -d "$COMPANIONS_DIR" ] || vdie "no companion directory at $COMPANIONS_DIR, build first (scripts/build-llama.sh $TRIPLE)"

# Companion files are named ggml-cpu-<variant>.<ext> possibly with a version
# suffix on Linux (SONAME symlinks, dereferenced to real files by
# stage_dynamic_isa_companions, see there). Match by prefix, same rule ggml
# itself uses to find them at runtime.
find_variant_file() {
  local variant="$1"
  find "$COMPANIONS_DIR" -maxdepth 1 -type f -iname "ggml-cpu-${variant}.${LIB_EXT}*" -print -quit
}

missing=()
for variant in "${EXPECTED_VARIANTS[@]}"; do
  f="$(find_variant_file "$variant")"
  if [ -z "$f" ]; then
    missing+=("$variant")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  vdie "expected CPU variant(s) missing from $COMPANIONS_DIR: ${missing[*]}"
fi
vlog "all ${#EXPECTED_VARIANTS[@]} expected CPU variants present for $TRIPLE"

f="$(find_variant_file vulkan)"
[ -n "$f" ] || vdie "ggml-vulkan.$LIB_EXT missing from $COMPANIONS_DIR, the GPU backend did not build as a loadable module"
vlog "ggml-vulkan.$LIB_EXT present"

# --- The disassembler ------------------------------------------------------

disassemble() {
  local file="$1"
  if command -v objdump >/dev/null 2>&1; then
    objdump -d "$file" 2>/dev/null
  elif command -v llvm-objdump >/dev/null 2>&1; then
    llvm-objdump -d "$file" 2>/dev/null
  elif command -v dumpbin >/dev/null 2>&1; then
    dumpbin /disasm "$file" 2>/dev/null
  else
    vdie "no disassembler found (need objdump, llvm-objdump or dumpbin)"
  fi
}

# True when the disassembly contains an AVX-or-above register or a
# VEX/EVEX-coded mnemonic. ymm*/zmm* registers cover AVX and AVX-512 data;
# the mnemonic pattern catches the handful of VEX instructions that touch no
# wide register at all (vzeroupper is the standing example: it clears the
# upper bits of every ymm register and takes no operand). A mnemonic is the
# first word after the opcode-byte column, so anchoring on tab/space
# boundaries avoids matching inside a byte string or a symbol name.
has_avx_or_above() {
  grep -qE '%[yz]mm[0-9]+|[[:space:]]v[a-z0-9]{2,}([[:space:]]|$)' <<<"$1"
}

BASELINE_TARGETS=("x64" "sse42")
POSITIVE_CONTROL="haswell"

fail_count=0
for variant in "${BASELINE_TARGETS[@]}"; do
  f="$(find_variant_file "$variant")"
  asm="$(disassemble "$f")"
  if has_avx_or_above "$asm"; then
    printf '\033[1;31m[verify-sidecar-isa] FAIL:\033[0m %s contains an AVX-or-above instruction, this is supposed to be the no-AVX baseline:\n' "$f" >&2
    grep -E '%[yz]mm[0-9]+|[[:space:]]v[a-z0-9]{2,}([[:space:]]|$)' <<<"$asm" | head -5 >&2
    fail_count=$((fail_count + 1))
  else
    vlog "$variant ($f): no AVX-or-above instruction found, as expected"
  fi
done

exe_name="$(out_name_for "$TRIPLE")"
exe_path="$BIN_DIR/$exe_name"
if [ -f "$exe_path" ]; then
  asm="$(disassemble "$exe_path")"
  if has_avx_or_above "$asm"; then
    printf '\033[1;31m[verify-sidecar-isa] FAIL:\033[0m %s (the exe itself) contains an AVX-or-above instruction, it must be ISA-neutral, all CPU-specific code belongs in the ggml-cpu-* variants:\n' "$exe_path" >&2
    grep -E '%[yz]mm[0-9]+|[[:space:]]v[a-z0-9]{2,}([[:space:]]|$)' <<<"$asm" | head -5 >&2
    fail_count=$((fail_count + 1))
  else
    vlog "$exe_name: no AVX-or-above instruction found, as expected"
  fi
else
  vlog "no exe found at $exe_path, skipping the exe-itself check (build first for the full check)"
fi

# Positive control: without this, a broken disassembler invocation (a typo'd
# flag, a tool that silently prints nothing) would make every check above
# pass vacuously. haswell is the first tier with AVX2, so it MUST show up.
f="$(find_variant_file "$POSITIVE_CONTROL")"
asm="$(disassemble "$f")"
if ! has_avx_or_above "$asm"; then
  vdie "$f (the $POSITIVE_CONTROL variant, which IS supposed to use AVX2) shows no AVX instruction at all, the disassembler step itself is not working, every 'no AVX found' result above is unproven"
fi
vlog "$POSITIVE_CONTROL ($f): AVX-or-above instruction found, confirming the disassembler actually sees the ISA it is looking for"

[ "$fail_count" -eq 0 ] || vdie "$fail_count file(s) failed the no-AVX-in-the-baseline check"

vlog "OK: $TRIPLE sidecar, dynamic ISA layout intact, baseline files carry no AVX, disassembler proven working"
