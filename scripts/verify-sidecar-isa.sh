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
#   1. The BASELINE files (the "x64" and "sse42" CPU variants, ggml-base,
#      and the llama-server exe itself) must contain NO AVX-or-above
#      instruction. These are the files every CPU loads no matter how old,
#      so an AVX instruction inside one of them is exactly the K1 bug: a
#      "dynamic" build that is secretly still a fixed x86-64-v3 (or higher)
#      binary. Checked by disassembling and searching for ymm/zmm registers
#      and VEX/EVEX-coded mnemonics (they are the ones objdump prints with a
#      leading "v", e.g. vmovaps, vzeroupper, vfmadd231ps; no plain SSE
#      mnemonic is spelled that way).
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

# Companion files are named ggml-cpu-<variant>.<ext> on Windows, but
# libggml-cpu-<variant>.<ext> on Linux: ggml/CMakeLists.txt only strips the
# "lib" prefix "if (WIN32)", so a pattern with no leading wildcard never
# matches on Linux at all (this was BLOCKER B1: the guard never ran
# correctly there, neither green nor red for the right reason). The leading
# "*" makes an optional "lib" prefix match on both platforms; the variant
# name and extension stay anchored so the widened glob cannot accidentally
# pick up an unrelated file (a name that merely contains the variant name
# as a substring, or a file with a different extension, still fails to
# match). Possibly with a version suffix on Linux (SONAME symlinks,
# dereferenced to real files by stage_dynamic_isa_companions, see there).
find_variant_file() {
  local variant="$1"
  find "$COMPANIONS_DIR" -maxdepth 1 -type f -iname "*ggml-cpu-${variant}.${LIB_EXT}*" -print -quit
}

# Same "lib" prefix rule applies to every other companion module name
# (ggml-base, ggml-vulkan, ...), so every lookup in this script goes
# through one of these two helpers rather than re-typing the glob.
find_named_module() {
  local name="$1"
  find "$COMPANIONS_DIR" -maxdepth 1 -type f -iname "*${name}.${LIB_EXT}*" -print -quit
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

f="$(find_named_module ggml-vulkan)"
[ -n "$f" ] || vdie "ggml-vulkan.$LIB_EXT missing from $COMPANIONS_DIR, the GPU backend did not build as a loadable module"
vlog "ggml-vulkan.$LIB_EXT present"

GGML_BASE_FILE="$(find_named_module ggml-base)"
[ -n "$GGML_BASE_FILE" ] || vdie "ggml-base.$LIB_EXT missing from $COMPANIONS_DIR, the shared runtime every backend links against did not build"
vlog "ggml-base.$LIB_EXT present at $GGML_BASE_FILE"

# --- RPATH/RUNPATH: no leftover build-tree path (BLOCKER B3) ---------------
#
# CMake writes a build-tree RPATH into linked ELF files by default, even
# with no explicit RPATH line anywhere in CMakeLists.txt
# (CMAKE_BUILD_WITH_INSTALL_RPATH defaults to OFF). That build-tree RPATH is
# very often an ABSOLUTE path into the CI runner's own build directory, a
# path that will not exist once the sidecar ships. Grepping CMakeLists.txt
# source for the literal word "RPATH" (what this project did before) cannot
# see this: it is CMake's own default, not a line anyone wrote. The only
# way to know is to read what actually landed in the binary.
check_no_absolute_build_rpath() {
  local file="$1"
  command -v readelf >/dev/null 2>&1 || { vlog "readelf not available, skipping RPATH check for $file"; return 0; }
  local tag_lines
  tag_lines="$(readelf -d "$file" 2>/dev/null | grep -E '\(RPATH\)|\(RUNPATH\)' || true)"
  if [ -z "$tag_lines" ]; then
    vlog "$file: no RPATH/RUNPATH entry"
    return 0
  fi
  # readelf prints the entry as e.g.
  # "0x000000000000001d (RUNPATH) Library runpath: [/home/runner/work/.../build/bin]"
  # An entry that starts with "/" inside the brackets is an absolute path;
  # "$ORIGIN" is the only form this project's build is supposed to emit.
  if grep -qE 'Library r(un)?path: \[/' <<<"$tag_lines"; then
    vdie "$file carries an absolute build-tree path in RPATH/RUNPATH: $tag_lines"
  fi
  vlog "$file: RPATH/RUNPATH present and not an absolute build-tree path: $tag_lines"
}

if [[ "$TRIPLE" == *-linux-* ]]; then
  check_no_absolute_build_rpath "$GGML_BASE_FILE"
  exe_check_path="$BIN_DIR/$(out_name_for "$TRIPLE")"
  [ -f "$exe_check_path" ] && check_no_absolute_build_rpath "$exe_check_path"
fi

# --- The disassembler ------------------------------------------------------

# Every call site captures this function's stdout via `$(disassemble ...)`
# to get the disassembly text, so a diagnostic printed with plain vlog (which
# writes to stdout) would be silently swallowed INTO that captured text
# instead of ever reaching the terminal, defeating the point of logging it
# at all (found the hard way: the tool-name line never appeared, even though
# the code "ran"). log_disassembler_choice writes to stderr (>&2)
# specifically so it survives being called from inside a command
# substitution.
log_disassembler_choice() { printf '\033[1;36m[verify-sidecar-isa]\033[0m %s\n' "$*" >&2; }

DISASSEMBLER_LOGGED=""
disassemble() {
  local file="$1"
  if command -v objdump >/dev/null 2>&1; then
    [ -n "$DISASSEMBLER_LOGGED" ] || { log_disassembler_choice "disassembler: objdump ($(command -v objdump))"; DISASSEMBLER_LOGGED=1; }
    objdump -d "$file" 2>/dev/null
  elif command -v llvm-objdump >/dev/null 2>&1; then
    [ -n "$DISASSEMBLER_LOGGED" ] || { log_disassembler_choice "disassembler: llvm-objdump ($(command -v llvm-objdump))"; DISASSEMBLER_LOGGED=1; }
    llvm-objdump -d "$file" 2>/dev/null
  elif command -v dumpbin >/dev/null 2>&1; then
    [ -n "$DISASSEMBLER_LOGGED" ] || { log_disassembler_choice "disassembler: dumpbin ($(command -v dumpbin))"; DISASSEMBLER_LOGGED=1; }
    dumpbin /disasm "$file" 2>/dev/null
  else
    vdie "no disassembler found (need objdump, llvm-objdump or dumpbin), cannot prove the ISA claims on this runner"
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
    grep -E '%[yz]mm[0-9]+|[[:space:]]v[a-z0-9]{2,}([[:space:]]|$)' <<<"$asm" | head -5 >&2 || true
    fail_count=$((fail_count + 1))
  else
    vlog "$variant ($f): no AVX-or-above instruction found, as expected"
  fi
done

asm="$(disassemble "$GGML_BASE_FILE")"
if has_avx_or_above "$asm"; then
  printf '\033[1;31m[verify-sidecar-isa] FAIL:\033[0m %s (ggml-base, loaded by every CPU variant) contains an AVX-or-above instruction, this is supposed to be ISA-neutral:\n' "$GGML_BASE_FILE" >&2
  grep -E '%[yz]mm[0-9]+|[[:space:]]v[a-z0-9]{2,}([[:space:]]|$)' <<<"$asm" | head -5 >&2 || true
  fail_count=$((fail_count + 1))
else
  vlog "ggml-base ($GGML_BASE_FILE): no AVX-or-above instruction found, as expected"
fi

exe_name="$(out_name_for "$TRIPLE")"
exe_path="$BIN_DIR/$exe_name"
if [ -f "$exe_path" ]; then
  asm="$(disassemble "$exe_path")"
  if has_avx_or_above "$asm"; then
    printf '\033[1;31m[verify-sidecar-isa] FAIL:\033[0m %s (the exe itself) contains an AVX-or-above instruction, it must be ISA-neutral, all CPU-specific code belongs in the ggml-cpu-* variants:\n' "$exe_path" >&2
    grep -E '%[yz]mm[0-9]+|[[:space:]]v[a-z0-9]{2,}([[:space:]]|$)' <<<"$asm" | head -5 >&2 || true
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
