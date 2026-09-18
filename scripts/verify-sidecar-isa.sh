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
    LIB_PREFIX=""
    ;;
  *)
    EXPECTED_VARIANTS=(x64 sse42 sandybridge ivybridge piledriver haswell skylakex cannonlake cascadelake icelake cooperlake zen4 alderlake sapphirerapids)
    LIB_EXT="so"
    LIB_PREFIX="lib"
    ;;
esac

COMPANIONS_DIR="$(resource_llama_dir_for "$TRIPLE")"
[ -d "$COMPANIONS_DIR" ] || vdie "no companion directory at $COMPANIONS_DIR, build first (scripts/build-llama.sh $TRIPLE)"

# BLOCKER B5 (review-sidecar.md, Runde 2): this must match EXACTLY the
# filename ggml itself opens, not merely a file that contains the right
# substring. Read at the pin (ggml-backend-reg.cpp:472-520,
# ggml_backend_load_best):
#   - CPU variants are found by a SCAN: every regular file in the search
#     directory is a candidate if `filename.find(file_prefix) == 0` (the
#     name starts with "[lib]ggml-cpu-") AND `entry.path().extension() ==
#     file_extension` (the extension is EXACTLY ".so"/".dll", not ".so.0").
#     A versioned SONAME copy like "libggml-cpu-x64.so.0" has extension
#     ".0", so ggml never even considers it: the loader would see NO CPU
#     backend at all and the app would die on the first model load, while a
#     guard that matches "*ggml-cpu-x64.so*" (Runde 2's version) stays
#     green.
#   - "vulkan" (and any other backend without per-CPU variants) is NOT
#     found by that scan at all: "libggml-vulkan.so" does not start with
#     "libggml-vulkan-" (the scan prefix always has a trailing hyphen
#     because it is built for "<name>-<variant>" files). It is only found
#     through the FALLBACK branch a few lines down, which requires the
#     single EXACT filename "[lib]ggml-vulkan.<ext>" to exist verbatim in
#     one of the two search paths.
# So the guard's own filename check must be exact-match, not substring: the
# only wildcard-worthy part is the "lib" prefix, and that is not even a
# wildcard, it is a fixed, platform-determined string
# (ggml/CMakeLists.txt:79-83 strips it only "if (WIN32)", so it is "lib" on
# every other platform, never optional or ambiguous).
#
# Both helpers below end in an explicit `return 0`, not just the bare `[ -f
# ... ] && printf ...` their body used to be: under `set -e` (this whole
# script runs with it) a simple command whose last action is a failed `[ -f
# ]` test aborts the ENTIRE SCRIPT right there, silently, the moment
# `f="$(find_variant_file "$variant")"` captures its output, because a
# failing command substitution assigned to a variable is not exempt from
# `set -e`. "no file found" here is an expected, ordinary outcome (the
# caller collects it into `missing[]` and reports it properly), not an
# error the shell should treat as fatal. Found the hard way: the very
# first real end-to-end run of this rewrite (a missing variant) exited
# with status 1 and NO message at all, instead of the intended "expected
# CPU variant(s) missing: ..." from vdie.
find_variant_file() {
  local variant="$1"
  local exact="$COMPANIONS_DIR/${LIB_PREFIX}ggml-cpu-${variant}.${LIB_EXT}"
  if [ -f "$exact" ]; then
    printf '%s\n' "$exact"
  fi
  return 0
}

# Same exact-match rule for every other named companion module
# (ggml-base, ggml-vulkan, ...), so every lookup in this script goes
# through one of these two helpers rather than re-typing the pattern.
find_named_module() {
  local name="$1"
  local exact="$COMPANIONS_DIR/${LIB_PREFIX}${name}.${LIB_EXT}"
  if [ -f "$exact" ]; then
    printf '%s\n' "$exact"
  fi
  return 0
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

# --- RPATH/RUNPATH: no leftover build-tree path (BLOCKER B3, widened B4) --
#
# CMake writes a build-tree RPATH into linked ELF files by default, even
# with no explicit RPATH line anywhere in CMakeLists.txt
# (CMAKE_BUILD_WITH_INSTALL_RPATH defaults to OFF). That build-tree RPATH is
# very often an ABSOLUTE path into the CI runner's own build directory, a
# path that will not exist once the sidecar ships. Grepping CMakeLists.txt
# source for the literal word "RPATH" (what Runde 1 did) cannot see this:
# it is CMake's own default, not a line anyone wrote. The only way to know
# is to read what actually landed in the binary.
#
# BLOCKER B4 (review-sidecar.md, Runde 2): Runde 2 only ran this check on
# ggml-base and the exe, the two files that structurally NEVER need a
# sibling RPATH (ggml-base only needs system libraries; the exe's own
# cross-directory need is covered by LD_LIBRARY_PATH, not RPATH). The
# fourteen ggml-cpu-* variants and ggml-vulkan are exactly the files that DO
# need $ORIGIN to find libggml-base.so.N beside them, and Runde 2 never
# looked at any of them: a broken CMAKE_BUILD_RPATH_USE_ORIGIN combined
# with a missing patchelf would silently leave them all with an absolute
# build-tree RUNPATH, and this guard would stay green regardless (it would
# still report "no RPATH/RUNPATH entry" on the two files it DOES check).
# Now every staged companion is checked (see the call site below), and a
# file that is missing an RPATH/RUNPATH entry is only accepted if it also
# has no sibling dependency to resolve locally: a file that NEEDS a
# sibling .so but carries no RPATH/RUNPATH at all is exactly the silent
# failure mode this guard exists to catch.
check_no_absolute_build_rpath() {
  local file="$1"
  local dir; dir="$(dirname "$file")"
  command -v readelf >/dev/null 2>&1 \
    || vdie "readelf not found, cannot verify RPATH/RUNPATH for $file (a guard that silently skips its own check when its tool is missing is worse than no guard, N4)"
  local dyn
  dyn="$(readelf -d "$file" 2>/dev/null)" || vdie "readelf -d failed to read the dynamic section of $file"
  local tag_lines
  tag_lines="$(grep -E '\(RPATH\)|\(RUNPATH\)' <<<"$dyn" || true)"

  # A NEEDED entry whose SONAME also exists as a FILE right next to this one
  # is a same-package sibling dependency (a ggml-cpu-* module needing
  # libggml-base.so.N, say). The dynamic linker can only resolve that via
  # RPATH/RUNPATH or LD_LIBRARY_PATH, never via a plain system search path,
  # so a file with a sibling NEEDED entry MUST carry an RPATH/RUNPATH.
  # Checking "does a file with this exact SONAME exist beside me" instead
  # of hardcoding a list of library-name prefixes means this keeps working
  # if the pin ever renames, adds, or removes a shared library.
  local sibling_needed=""
  while IFS= read -r soname; do
    [ -n "$soname" ] || continue
    [ -e "$dir/$soname" ] && sibling_needed="$sibling_needed $soname"
  done < <(sed -nE 's/.*\(NEEDED\)[^]]*Shared library: \[([^]]*)\].*/\1/p' <<<"$dyn")

  if [ -z "$tag_lines" ]; then
    if [ -n "$sibling_needed" ]; then
      vdie "$file needs sibling librar$([ "$(wc -w <<<"$sibling_needed")" -eq 1 ] && echo y || echo ies) ($sibling_needed) but carries NO RPATH/RUNPATH entry at all: it cannot resolve them on its own, only via the caller's LD_LIBRARY_PATH, which the dlopen'd ggml-cpu-*/ggml-vulkan modules cannot rely on"
    fi
    vlog "$file: no RPATH/RUNPATH entry (no sibling dependency to resolve, nothing missing)"
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
  for variant in "${EXPECTED_VARIANTS[@]}"; do
    variant_file="$(find_variant_file "$variant")"
    [ -n "$variant_file" ] && check_no_absolute_build_rpath "$variant_file"
  done
  vulkan_file="$(find_named_module ggml-vulkan)"
  [ -n "$vulkan_file" ] && check_no_absolute_build_rpath "$vulkan_file"
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
