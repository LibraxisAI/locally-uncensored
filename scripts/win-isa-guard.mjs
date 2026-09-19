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
//        "MSVCRT:", or the owning symbol is wmemcmp/memcmp: ALLOWED (CRT/STL
//        allowlist, R3.1). These carry their own runtime dispatch, verified
//        by hand in review-k1-avx.md; a naive "well it also needs a guard in
//        this function" rule would wrongly flag __std_find_trivial_impl
//        (checked in its OWN body) as fine but flag _Dispatch_pos /
//        _Make_bitmap (checked in their CALLER) as unprotected, which they
//        are not.
//      - Anything else ("own code": ggml-*.obj, llama-*.obj, common.obj,
//        server-*.obj, ggml-vulkan.obj) is ALLOWED only if, within the
//        owning function's address range, there is a read of
//        __isa_available / __isa_enabled / _Avx2WmemEnabled at an address
//        BEFORE the hit, and a conditional jump (any j-mnemonic except jmp)
//        between that read and the hit whose target lands AFTER the hit and
//        still inside the function (the block-skip shape the MSVC
//        auto-vectorizer and the STL dispatcher both emit). Anything else
//        is UNPROTECTED, RED.
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
export function isAllowlisted(owner) {
  if (!owner) return false;
  if (owner.obj === 'msvcprt:vector_algorithms.obj') return true;
  if (owner.obj.startsWith('MSVCRT:')) return true;
  if (/\bwmemcmp\b/i.test(owner.name) || /\bmemcmp\b/i.test(owner.name)) return true;
  return false;
}

function hexVA(n) {
  return n.toString(16).padStart(16, '0');
}

// R3.2: the dominance approximation for "own code". Looks for an isa-flag
// read before the hit in the owning function, then a conditional jump
// (mnemonic starts with j, is not jmp) between that read and the hit whose
// target lands strictly after the hit and still inside the function, the
// exact shape both Fundstelle 1a/1b (STL) and 2a-2d (ggml auto-vectorizer)
// showed in review-k1-avx.md.
export function checkDominance(linesSortedByAddr, isaVAs, functionStart, functionEnd, hitAddr) {
  if (isaVAs.length === 0) {
    return { protected: false, reason: 'no __isa_available/__isa_enabled/_Avx2WmemEnabled symbol found in this map at all' };
  }
  const isaHexes = isaVAs.map(hexVA);
  let checkLine = null;
  for (const line of linesSortedByAddr) {
    if (line.addr < functionStart) continue;
    if (line.addr >= hitAddr) break;
    const upper = line.text.toUpperCase();
    if (isaHexes.some((h) => upper.includes(h.toUpperCase()))) {
      checkLine = line; // keep scanning: the closest-before check is fine, any is fine
    }
  }
  if (!checkLine) {
    return { protected: false, reason: 'no isa-flag read found before the hit in the owning function' };
  }
  for (const line of linesSortedByAddr) {
    if (line.addr <= checkLine.addr) continue;
    if (line.addr >= hitAddr) break;
    if (!/^j/.test(line.mnemonic) || line.mnemonic === 'jmp') continue;
    const m = /([0-9A-Fa-f]{6,16})h?\s*$/.exec(line.text.trim());
    if (!m) continue;
    const target = parseInt(m[1], 16);
    if (target > hitAddr && target <= functionEnd) {
      return { protected: true, checkLine, jumpLine: line };
    }
  }
  return {
    protected: false,
    reason: `isa-flag read found at ${hexVA(checkLine.addr)} but no conditional jump between it and the hit lands past the hit inside the function`,
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
    process.stderr.write('usage: win-isa-guard.mjs check --module <name> --disasm <file> --map <file> [--expect-unprotected] [--min-symbols N]\n');
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
  process.stdout.write(`[win-isa-guard] ${result.moduleName}: ${result.symbolCount} map symbols, ${result.hitCount} VEX/EVEX hit(s), ${result.ownedHitCount} resolved to an owner\n`);
  for (const v of result.verdicts) {
    process.stdout.write(`[win-isa-guard]   ${formatVerdict(v)}\n`);
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
