#!/usr/bin/env node
//
// win-isa-guard.mjs: the Windows-only half of the K1 (3.0.1) ISA guard.
//
// review-k1-avx.md (Opus, final review) found that verify-sidecar-isa.sh's
// old rule ("no mnemonic starting with 'v' in the baseline") is not
// holdable under MSVC: the MSVC-STL and CRT ship their own AVX2 fast paths
// (vector_algorithms.obj, wmemcmp) inside every module they are linked
// into, switched at runtime through __isa_available/__isa_enabled, and a
// naive mnemonic grep cannot tell "linked in but runtime-guarded" apart
// from "compiled in and unconditional" (the actual K1 bug). It also
// produced flat false positives (verr/verw read out of data bytes
// dumpbin/objdump happens to disassemble).
//
// This module implements Opus's replacement rule (R1-R3, R6):
//
//   1. Detect VEX/EVEX instructions by their OPCODE BYTE (0xC4, 0xC5, 0x62),
//      not by mnemonic spelling. In 64-bit code these three bytes are
//      unambiguous (the 32-bit-only meanings LDS/LES/BOUND do not exist in
//      long mode), so this is exact, not heuristic, and it makes verr/verw/
//      vmread false positives structurally impossible: their real opcode is
//      0F 00 /4 and 0F 00 /5, first byte 0x0F, never 0xC4/0xC5/0x62.
//   2. Resolve every hit's owning function from the linker .map file
//      (Publics by Value + Static symbols, both sections use the same row
//      shape: "<seg:off> <name> <VA> [f] [i] <Lib:Object>", and Lib:Object
//      is always the last whitespace token because no object/library name
//      in a .map file contains a space).
//   3. Decide per hit:
//      - Lib:Object is msvcprt:vector_algorithms.obj, or starts with
//        "MSVCRT:", or the owning symbol is EXACTLY wmemcmp/memcmp AND the
//        owning object is one of the specific objects that match was hand
//        verified against (WMEMCMP_MEMCMP_HOST_OBJECTS, see isAllowlisted
//        below): ALLOWED (CRT/STL allowlist, R3.1). These carry their own
//        runtime dispatch, verified by hand in review-k1-avx.md; a naive
//        "well it also needs a guard in this function" rule would wrongly
//        flag __std_find_trivial_impl (checked in its OWN body) as fine but
//        flag _Dispatch_pos / _Make_bitmap (checked in their CALLER) as
//        unprotected, which they are not. (review-waechter-windows.md BL3:
//        a bare substring/regex match on the symbol name alone, without the
//        object condition, let an unrelated own-code symbol that merely
//        contains "memcmp" in a mangled name through as ALLOWED_CRT; fixed
//        by requiring both conditions together.)
//      - Anything else ("own code": ggml-*.obj, llama-*.obj, common.obj,
//        server-*.obj, ggml-vulkan.obj) is ALLOWED only if, within the
//        owning function's address range, there is a read of
//        __isa_available / __isa_enabled / _Avx2WmemEnabled at an address
//        BEFORE the hit, and a conditional jump (any j-mnemonic except jmp)
//        sitting IMMEDIATELY after a cmp/test instruction that is itself
//        bound to that same read (same memory location, or the register the
//        read just loaded), whose target lands AFTER the hit and still
//        inside the function (the block-skip shape the MSVC auto-vectorizer
//        and the STL dispatcher both emit; see checkDominance below).
//        Anything else is UNPROTECTED, RED. (review-waechter-windows.md N1:
//        an earlier version only asked for "some isa-flag read before the
//        hit" and "some conditional jump landing past it", with no
//        requirement that the jump actually evaluate that read; that let an
//        unrelated read plus an unrelated jump wave a real unconditional AVX
//        block through. Closed by binding the jump to the read via an
//        immediately-adjacent cmp/test, at the cost of also rejecting some
//        real, correctly-guarded MSVC code whose scheduler put other
//        instructions between the cmp and the jump; see checkDominance's own
//        comment and its UNPROTECTED message for the known false-red forms
//        A-D this costs.)
//
// This is an approximation of a real control-flow graph, not one (R3,
// "Bewertung der Regel, ehrlich"): it cannot see a function that reads the
// ISA flag for an unrelated reason and then falls into unconditional AVX
// anyway. The three controls in verify-sidecar-isa.sh's Windows branch
// (positive: haswell has ANY hit at all; negative: haswell's OWN-CODE
// kernels come out UNPROTECTED under this same decision logic, so the rule
// has not been loosened into "allow everything"; red-probe: the fixtures in
// scripts/__fixtures__/win-isa/ prove the decision function itself, not
// just real files) exist to bound that risk, not to remove it.
//
// Deliberately dependency-free (no npm install step for a build guard) and
// works on both dumpbin's Intel-syntax output (the box, and Windows CI once
// a Developer Command Prompt is on PATH); see readTextFileAuto for the
// encoding note.
//
// SCOPE, STATED HONESTLY (review-waechter-windows.md N6): this guard proves
// "no unprotected VEX/EVEX instruction", i.e. AVX-and-above. It does NOT
// prove "runs on every x86-64 CPU". A legacy-encoded instruction above the
// x86-64 baseline (POPCNT, LZCNT, TZCNT, the SSE4.2 string/CRC32 ops) is not
// VEX/EVEX-coded and would pass through unnoticed even if compiled in
// unconditionally, and would fault with the identical 0xC000001D on the same
// customer machine. For K1 as reported this residual gap is accepted, not
// closed:
//   - BMI1/BMI2 (ANDN, BEXTR, BZHI, PDEP, PEXT, ...) do NOT need separate
//     handling: they are VEX-encoded instructions (VEX.LZ.0F38, per the
//     Intel SDM), so the existing 0xC4/0xC5/0x62 first-byte check already
//     covers them.
//   - POPCNT/LZCNT/TZCNT were checked for cheap opcode-byte coverage and
//     rejected: their real encoding is a mandatory 0xF3 prefix followed by a
//     0F-map opcode (F3 0F B8 for POPCNT, F3 0F BD for LZCNT, F3 0F BC for
//     TZCNT). Unlike 0xC4/0xC5/0x62, a leading 0xF3 byte is NOT unambiguous
//     in 64-bit code: it is the ordinary REP/REPE prefix and the mandatory
//     prefix for a large family of unrelated scalar SSE instructions
//     (MOVSS, CVTSI2SS, ADDSS, ...), so a first-byte-only rule would flag
//     huge numbers of ordinary SSE instructions as false positives, and a
//     rule that also inspects the trailing 0F B8/BD/BC bytes stops being a
//     one-byte structural check and starts being exactly the kind of
//     multi-byte, easy-to-get-subtly-wrong decoder this rewrite was meant to
//     avoid. Not implemented; flagged here rather than silently dropped.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// dumpbin redirected to a file from a plain `cmd`/`powershell` session can
// come out UTF-16LE with a BOM depending on how the caller captured it
// (Out-File's default vs. plain `>` redirection differ). Decode by BOM when
// present instead of assuming UTF-8 and silently mangling every address.
export function readTextFileAuto(path) {
  const buf = readFileSync(path);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  return buf.toString('utf8');
}

// One disassembled instruction line: address, raw opcode bytes (as printed,
// upper/lowercase not normalised here), and the mnemonic+operand text.
// Continuation lines dumpbin emits for instructions that overflow the byte
// column onto a second line (review-k1-avx.md R1) carry no address and are
// simply not matched by either regex below, which is correct: the opcode's
// FIRST byte, all that VEX/EVEX detection needs, is always on the anchored
// line.
const DUMPBIN_LINE = /^\s*([0-9A-Fa-f]{16}):\s+((?:[0-9A-Fa-f]{2}\s+)*[0-9A-Fa-f]{2})\s+(\S.*?)\s*$/;
// GNU objdump on a PE/COFF x86_64 image also prints an absolute VA (not an
// ELF-style section offset) followed by a tab, the raw byte column, a tab,
// then the AT&T-syntax instruction, same shape, different separators.
const OBJDUMP_LINE = /^\s*([0-9A-Fa-f]+):\t((?:[0-9A-Fa-f]{2}\s+)*[0-9A-Fa-f]{2})\s*\t(\S.*?)\s*$/;

export function parseDisasmLines(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = DUMPBIN_LINE.exec(raw) || OBJDUMP_LINE.exec(raw);
    if (!m) continue;
    const addr = parseInt(m[1], 16);
    const bytes = m[2].trim().split(/\s+/);
    const rest = m[3];
    const spaceIdx = rest.search(/\s/);
    const mnemonic = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase();
    lines.push({ addr, bytes, text: rest, mnemonic, raw });
  }
  lines.sort((a, b) => a.addr - b.addr);
  return lines;
}

// R1: VEX/EVEX are unambiguous by first opcode byte in 64-bit code.
const VEX_EVEX_FIRST_BYTES = new Set(['c4', 'c5', '62']);

export function isVexEvexHit(line) {
  const first = (line.bytes[0] || '').toLowerCase();
  return VEX_EVEX_FIRST_BYTES.has(first);
}

export function findVexEvexHits(lines) {
  return lines.filter(isVexEvexHit);
}

// .map row: "<seg:off>  <name>  <VA 16 hex>  [f] [i]  <Lib:Object>". The
// Lib:Object field is always the trailing whitespace-delimited token: no
// object/library name in a linker map contains a space, decorated (mangled)
// C++ names included.
const MAP_ROW = /^\s*[0-9A-Fa-f]{4}:[0-9A-Fa-f]{8}\s+(\S+)\s+([0-9A-Fa-f]{16})\s+(.+?)\s*$/;

export function parseMapSymbols(text) {
  const symbols = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = MAP_ROW.exec(raw);
    if (!m) continue;
    const name = m[1];
    const va = parseInt(m[2], 16);
    const tail = m[3].trim().split(/\s+/).filter((t) => t !== 'f' && t !== 'i');
    const obj = tail[tail.length - 1] || '';
    symbols.push({ name, va, obj });
  }
  symbols.sort((a, b) => a.va - b.va);
  return symbols;
}

// Largest symbol address <= addr; "function end" is the next symbol's
// address (Infinity if addr is the last symbol). This is R3's stated
// approximation, not a real function-boundary table.
export function findOwner(symbolsSortedByVa, addr) {
  let lo = 0;
  let hi = symbolsSortedByVa.length - 1;
  let ownerIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (symbolsSortedByVa[mid].va <= addr) {
      ownerIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ownerIdx === -1) return null;
  const owner = symbolsSortedByVa[ownerIdx];
  const end = ownerIdx + 1 < symbolsSortedByVa.length ? symbolsSortedByVa[ownerIdx + 1].va : Infinity;
  return { owner, functionStart: owner.va, functionEnd: end };
}

const ISA_SYMBOL_NAMES = new Set([
  '__isa_available',
  '__isa_enabled',
  '_Avx2WmemEnabled',
  '_Avx2WmemEnabledWeakValue',
]);

export function findIsaSymbolVAs(symbols) {
  const vas = [];
  for (const s of symbols) {
    if (ISA_SYMBOL_NAMES.has(s.name)) vas.push(s.va);
  }
  return vas;
}

// R3.1: the CRT/STL allowlist. Named exactly, with the source it was
// checked against, so a future reader can re-verify rather than trust this
// comment: microsoft/STL, stl/src/vector_algorithms.cpp, _Use_avx2() is
// `__isa_enabled & (1 << __ISA_AVAILABLE_AVX2)`; wmemcmp's fast path is
// gated on the separate _Avx2WmemEnabled flag instead (same file family).
// Reviewed against MSVC 19.44.35222.0 / VS 2022 17.14, see
// checkToolsetVersion below and lu-301/bau/review-k1-avx.md section 3.
//
// review-waechter-windows.md BL3: the wmemcmp/memcmp part of this allowlist
// used to be a bare case-insensitive \b...\b REGEX against the owning
// symbol's NAME ALONE, with no condition on the owning OBJECT at all. That is
// both too loose (a substring match: a C++ namespace or class literally
// called "memcmp" anywhere in a mangled name, e.g.
// "?fast@memcmp@ggml@@YAXXZ" in an ENTIRELY UNRELATED, unguarded own-code
// object such as ggml-cpu.obj, matched and was waved through as ALLOWED_CRT)
// and not what R3.1 as reviewed actually verified: in the real Windows build
// wmemcmp's CRT COMDAT gets attributed by the linker to whichever OWN object
// first references it (that is *why* it shows up in "own" objects at all,
// not because this project wrote it), and the objects that happened to do so
// were hand-checked one by one, not "any object with this name in it
// somewhere". So the rule now requires BOTH an EXACT (not substring, not
// regex) match on the symbol name AND that the owning object is one of the
// specific objects that match was verified against
// (WMEMCMP_MEMCMP_HOST_OBJECTS below). A symbol named exactly "memcmp"
// sitting in some other object is not covered by that verification and must
// fall through to the ordinary own-code dominance check like everything
// else.
const WMEMCMP_MEMCMP_HOST_OBJECTS = new Set([
  'common.obj',
  'unicode.obj',
  'ggml-backend-reg.obj',
  'server-context.obj',
]);

// A .map Lib:Object field can carry a "Lib:Object" form (e.g.
// "msvcprt:vector_algorithms.obj") or a bare "Object" form (the common case
// for this project's own objects, e.g. "common.obj"). Only the part after
// the last colon is ever a plain filename; strip a library prefix if present
// so the allowlist compares against the same shape in either case.
function objectBaseName(obj) {
  const idx = obj.lastIndexOf(':');
  return idx === -1 ? obj : obj.slice(idx + 1);
}

export function isAllowlisted(owner) {
  if (!owner) return false;
  if (owner.obj === 'msvcprt:vector_algorithms.obj') return true;
  if (owner.obj.startsWith('MSVCRT:')) return true;
  if (
    (owner.name === 'wmemcmp' || owner.name === 'memcmp') &&
    WMEMCMP_MEMCMP_HOST_OBJECTS.has(objectBaseName(owner.obj))
  ) {
    return true;
  }
  return false;
}

function hexVA(n) {
  return n.toString(16).padStart(16, '0');
}

// A genuine isa-flag READ dereferences the address in memory (dumpbin prints
// that as "... [<hex>h]", the bracket is the actual load); a line that merely
// mentions the same hex digits as an immediate constant (e.g. "mov
// rax,0000000180099898h", no brackets, Opus's fake-green pattern F in
// review-waechter-windows.md N1) never touches the flag's value at all and
// must not count.
function isaBracketMatch(text, isaHexes) {
  for (const hex of isaHexes) {
    const re = new RegExp(`\\[\\s*0*${hex}h?\\s*\\]`, 'i');
    if (re.test(text)) return true;
  }
  return false;
}

// If this line LOADS the isa flag into a register ("mov ecx,dword ptr
// [<isa>h]" / "movzx eax,byte ptr [<isa>h]"), return that register's name so
// the next step can require the guarding compare to use the SAME register,
// not an unrelated one. Returns null for a line that reads the flag directly
// into a comparison (e.g. "cmp dword ptr [<isa>h],5"): there is no
// intermediate register to track there.
function movLoadDestRegister(text) {
  const m = /^\s*mov(?:zx)?\s+(\w+)\s*,\s*(?:byte|word|dword|qword)\s+ptr/i.exec(text);
  return m ? m[1].toLowerCase() : null;
}

function isCompareMnemonic(mnemonic) {
  return mnemonic === 'cmp' || mnemonic === 'test';
}

// True when `text`'s FIRST operand is exactly `reg` (word-bounded, so "cl"
// does not accidentally match inside "rcl" and "eax" does not match "reax").
function firstOperandIsRegister(text, reg) {
  const re = new RegExp(`^\\s*\\S+\\s+${reg}\\b`, 'i');
  return re.test(text);
}

// R3.2: the dominance approximation for "own code". review-waechter-windows.md
// N1: the original version only checked "an isa-flag read happened somewhere
// before the hit" and "SOME conditional jump between that read and the hit
// lands past it", with no requirement that the jump actually evaluate the
// flag it read. Two fake-green shapes exploited exactly that gap:
//   A) an isa-flag read (left over from an earlier, unrelated loop),
//      followed by an unrelated null-pointer test whose jump also happens to
//      land past the hit, followed by an unconditional AVX block;
//   F) the isa flag's ADDRESS used only as a bare immediate constant (never
//      dereferenced), with an unrelated jump and then the hit.
// Closed by requiring the conditional jump to sit IMMEDIATELY after a
// cmp/test instruction (no other instruction between them) that is itself
// bound to the isa-flag read: either the read line directly compares the
// flag's memory location (no intermediate register), or the read loads the
// flag into a register and that SAME register is the compare's first
// operand. Verified against the real Fundstelle 2a shape (mov ecx,dword ptr
// [isa] / cmp ecx,5 / jl) in the fixtures and the unit tests below; the two
// fake-green shapes are checked-in fixtures that must come out UNPROTECTED
// (scripts/__fixtures__/win-isa/fake-*-own-code.*).
//
// review-waechter-windows.md Final Review Runde 2, section 3 (Auflage A2):
// this closes real holes, but it is stricter than some genuinely protected
// MSVC code, and rot is the direction that costs a human an hour, not the
// direction that costs a customer a crash, so that trade was made
// deliberately. Four forms are KNOWN to come out UNPROTECTED (false red)
// even though they are correctly guarded; if the address flagged UNPROTECTED
// matches one of these when disassembled by hand, it is a known codegen
// pattern, not a K1 regression:
//   (i)   the exact real shape shipped in wmemcmp (ggml.dll): "cmp [isa],eax
//         / mov rbx,rcx / mov r9,rcx / mov r10,rdx / je <past-the-hit>" -
//         the MSVC scheduler put three unrelated movs between the cmp and
//         the jump instead of emitting them back to back;
//   (ii)  a cached comparison register: "mov eax,[isa] / mov ecx,eax /
//         cmp ecx,6 / jl <past-the-hit>" - the load and the compare use
//         different registers, linked through a copy checkDominance does
//         not trace;
//   (iii) a partial-register test: "movzx eax,byte ptr [isa] / test al,al /
//         je <past-the-hit>" - the compare's first operand is a sub-register
//         (al) of the register the load wrote (eax), which the current
//         word-bounded register match treats as a different register;
//   (iv)  a bit-test form: "bt dword ptr [isa],5 / jae <past-the-hit>" - the
//         STL's "__isa_enabled & (1 << N)" expressed as bt/jae instead of a
//         masked cmp/test, which is not a cmp/test mnemonic at all.
// None of these are exploitable the way the two fake-green shapes above
// were (they can only make real, guarded code fail RED, never let
// unguarded code through GREEN), so they are named here as an accepted,
// documented gap rather than fixed. If checkDominance is ever loosened to
// cover one of these, it needs its own checked-in fixture the way the two
// fake-green shapes above do, so the loosening cannot silently re-open N1's
// original hole.
export function checkDominance(linesSortedByAddr, isaVAs, functionStart, functionEnd, hitAddr) {
  if (isaVAs.length === 0) {
    return { protected: false, reason: 'no __isa_available/__isa_enabled/_Avx2WmemEnabled symbol found in this map at all' };
  }
  const isaHexes = isaVAs.map(hexVA);

  // Collect every REAL (bracket-dereferenced) isa-flag read before the hit,
  // in order; try each as a candidate, closest-to-the-hit first, since that
  // is the one most likely to actually guard this specific hit.
  const reads = [];
  for (const line of linesSortedByAddr) {
    if (line.addr < functionStart) continue;
    if (line.addr >= hitAddr) break;
    if (isaBracketMatch(line.text, isaHexes)) reads.push(line);
  }
  if (reads.length === 0) {
    return { protected: false, reason: 'no isa-flag read found before the hit in the owning function' };
  }

  for (let i = reads.length - 1; i >= 0; i -= 1) {
    const readLine = reads[i];
    const readIdx = linesSortedByAddr.indexOf(readLine);
    const destReg = movLoadDestRegister(readLine.text);

    let compareLine = null;
    if (destReg === null && isCompareMnemonic(readLine.mnemonic)) {
      // The read line itself is the compare (e.g. "cmp dword ptr [isa],5").
      compareLine = readLine;
    } else if (destReg !== null) {
      // Find the first cmp/test AFTER the load, before the hit, whose first
      // operand is the register the load just wrote.
      for (let j = readIdx + 1; j < linesSortedByAddr.length; j += 1) {
        const cand = linesSortedByAddr[j];
        if (cand.addr >= hitAddr) break;
        if (isCompareMnemonic(cand.mnemonic) && firstOperandIsRegister(cand.text, destReg)) {
          compareLine = cand;
          break;
        }
      }
    }
    if (!compareLine) continue;

    const compareIdx = linesSortedByAddr.indexOf(compareLine);
    const jumpLine = linesSortedByAddr[compareIdx + 1];
    if (!jumpLine || jumpLine.addr >= hitAddr) continue;
    if (!/^j/.test(jumpLine.mnemonic) || jumpLine.mnemonic === 'jmp') continue;
    const m = /([0-9A-Fa-f]{6,16})h?\s*$/.exec(jumpLine.text.trim());
    if (!m) continue;
    const target = parseInt(m[1], 16);
    if (target > hitAddr && target <= functionEnd) {
      return { protected: true, checkLine: readLine, compareLine, jumpLine };
    }
  }

  return {
    protected: false,
    reason: `an isa-flag read exists before the hit, but no conditional jump immediately following a cmp/test bound to that same read lands past the hit inside the function (review-waechter-windows.md N1). Disassemble this address by hand before treating it as a build regression: check whether an __isa_available/__isa_enabled/_Avx2WmemEnabled check with a jump over this instruction actually exists in the real disassembly. If it does and only misses this rule's shape (e.g. the scheduler put other instructions between the compare and the jump, the compare uses a cached or partial register, or the guard is a bt/jae bit test - see the four known false-red forms documented above checkDominance), that is a known codegen pattern, not a regression: add a fixture reproducing the exact shape and extend checkDominance with a justification tying it to that fixture, the same way the two fake-green shapes above are fixtured. If no such check exists at all, this is a genuine K1 AVX regression and must be treated as one, not allowlisted away.`,
  };
}

// Evaluate one module: disasm text + its own .map text. Returns one verdict
// row per VEX/EVEX hit plus summary counts (used for the map-control, R4).
export function evaluateModule({ moduleName, disasmText, mapText }) {
  const lines = parseDisasmLines(disasmText);
  const symbols = parseMapSymbols(mapText);
  const isaVAs = findIsaSymbolVAs(symbols);
  const hits = findVexEvexHits(lines);

  const verdicts = [];
  let ownedHits = 0;
  for (const hit of hits) {
    const found = findOwner(symbols, hit.addr);
    if (!found) {
      verdicts.push({ hit, verdict: 'UNKNOWN_OWNER', reason: 'no symbol at or before this address in the map' });
      continue;
    }
    ownedHits += 1;
    const { owner, functionStart, functionEnd } = found;
    if (isAllowlisted(owner)) {
      verdicts.push({ hit, owner, verdict: 'ALLOWED_CRT' });
      continue;
    }
    const dom = checkDominance(lines, isaVAs, functionStart, functionEnd, hit.addr);
    verdicts.push({
      hit,
      owner,
      verdict: dom.protected ? 'ALLOWED_PROTECTED' : 'UNPROTECTED',
      reason: dom.reason,
    });
  }

  return {
    moduleName,
    lineCount: lines.length,
    symbolCount: symbols.length,
    hitCount: hits.length,
    ownedHitCount: ownedHits,
    verdicts,
    unprotected: verdicts.filter((v) => v.verdict === 'UNPROTECTED' || v.verdict === 'UNKNOWN_OWNER'),
  };
}

function formatVerdict(v) {
  const addr = hexVA(v.hit.addr);
  const obj = v.owner ? v.owner.obj : '?';
  const fn = v.owner ? v.owner.name : '?';
  const base = `${addr}: ${v.hit.text}  [${v.verdict}]  fn=${fn}  obj=${obj}`;
  return v.reason ? `${base}  (${v.reason})` : base;
}

// --- CLI ---------------------------------------------------------------
function main(argv) {
  const mode = argv[0];
  if (mode !== 'check') {
    process.stderr.write('usage: win-isa-guard.mjs check --module <name> --disasm <file> --map <file> [--expect-unprotected] [--min-symbols N] [--min-lines N]\n');
    process.exit(2);
  }
  const args = {};
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    }
  }
  if (!args.module || !args.disasm || !args.map) {
    process.stderr.write('missing --module/--disasm/--map\n');
    process.exit(2);
  }
  const disasmText = readTextFileAuto(args.disasm);
  const mapText = readTextFileAuto(args.map);
  const result = evaluateModule({ moduleName: args.module, disasmText, mapText });

  const minSymbols = args['min-symbols'] ? parseInt(args['min-symbols'], 10) : 1;
  // N2 (review-waechter-windows.md): a disasm dump the parser cannot make
  // sense of at all (wrong dumpbin flags, an encoding surprise, a future
  // dumpbin/objdump output-format change, a parser regression) yields ZERO
  // parsed instruction lines and therefore zero VEX/EVEX hits, which the
  // pre-existing checks read as "OK, no unprotected VEX/EVEX in own code",
  // a clean pass for exactly the wrong reason. A real module's dumpbin
  // /disasm dump is hundreds of lines at minimum (the smallest real module
  // measured against the committed guard, the exe itself, parsed 868 disasm
  // line(s) on the box; review-waechter-windows.md U2 caught an earlier,
  // uncorroborated version of this comment that claimed "thousands", which
  // the guard's own measured output on that same run never supported); 40
  // is deliberately far below any real module and only meant to catch "the
  // parser understood nothing", not to be a tight bound. Fixtures for
  // the decision logic itself (crt-allowed, protected-own-code, the red
  // probe) are deliberately tiny and pass --min-lines 0 explicitly, see
  // verify-sidecar-isa.sh.
  const minLines = args['min-lines'] !== undefined ? parseInt(args['min-lines'], 10) : 40;
  process.stdout.write(`[win-isa-guard] ${result.moduleName}: ${result.lineCount} disasm line(s) parsed, ${result.symbolCount} map symbols, ${result.hitCount} VEX/EVEX hit(s), ${result.ownedHitCount} resolved to an owner\n`);
  for (const v of result.verdicts) {
    process.stdout.write(`[win-isa-guard]   ${formatVerdict(v)}\n`);
  }

  if (result.lineCount < minLines) {
    process.stderr.write(`[win-isa-guard] FAIL: ${result.moduleName}: only ${result.lineCount} disassembled instruction line(s) were parsed out of the dumpbin/objdump output (need >= ${minLines}); this almost always means the parser did not recognise the disassembler's output format at all (wrong flags, an encoding surprise, a tool/output-format change) rather than a genuinely tiny binary, and a hitCount of 0 from a parser this broken is not proof of anything (review-waechter-windows.md N2)\n`);
    process.exit(1);
  }
  if (result.symbolCount < minSymbols) {
    process.stderr.write(`[win-isa-guard] FAIL: ${result.moduleName}'s map yielded only ${result.symbolCount} symbol(s) (need >= ${minSymbols}); a map this empty means ownership resolution is silently useless (review-k1-avx.md R4 map-control)\n`);
    process.exit(1);
  }
  if (result.hitCount > 0 && result.ownedHitCount === 0) {
    process.stderr.write(`[win-isa-guard] FAIL: ${result.moduleName} has ${result.hitCount} VEX/EVEX hit(s) but NONE resolved to a named owner; the allowlist and dominance check cannot run at all (review-k1-avx.md R4 map-control)\n`);
    process.exit(1);
  }

  if (args['expect-unprotected']) {
    // Negative control (R4): this module is EXPECTED to contain at least one
    // UNPROTECTED own-code hit (e.g. the haswell CPU variant, whose kernels
    // are unconditionally AVX2 by construction). Its absence means the
    // decision logic has been loosened into "allow everything".
    const unprotectedOwn = result.verdicts.filter((v) => v.verdict === 'UNPROTECTED');
    if (unprotectedOwn.length === 0) {
      process.stderr.write(`[win-isa-guard] FAIL (negative control): ${result.moduleName} was expected to contain at least one UNPROTECTED own-code VEX/EVEX instruction (it is a CPU-tier variant with unconditional AVX kernels) but the guard found none; the allowlist or dominance rule has gone soft\n`);
      process.exit(1);
    }
    process.stdout.write(`[win-isa-guard] OK (negative control): ${result.moduleName} correctly shows ${unprotectedOwn.length} UNPROTECTED own-code hit(s)\n`);
    process.exit(0);
  }

  if (result.unprotected.length > 0) {
    process.stderr.write(`[win-isa-guard] FAIL: ${result.moduleName} has ${result.unprotected.length} unprotected VEX/EVEX instruction(s) in own code\n`);
    process.exit(1);
  }
  process.stdout.write(`[win-isa-guard] OK: ${result.moduleName}, no unprotected VEX/EVEX in own code\n`);
  process.exit(0);
}

// Cross-platform "am I the entry script" check. The naive
// `import.meta.url === 'file://' + process.argv[1]` comparison this used to
// be is a string-format mismatch by construction on Windows: import.meta.url
// is a URL ("file:///C:/foo/bar.mjs", forward slashes, percent-escaped) while
// process.argv[1] is a native path ("C:\foo\bar.mjs", backslashes), the two
// never compare equal there, so main() silently never ran and every `node
// win-isa-guard.mjs check ...` invocation exited 0 having done nothing at
// all (found running this exact guard against the real box build:
// lu-301/bau/waechter-windows.md). Comparing two REAL filesystem paths
// (both resolved through fs, neither a URL) works the same way on every
// platform.
function isEntryScript() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryScript()) {
  main(process.argv.slice(2));
}
