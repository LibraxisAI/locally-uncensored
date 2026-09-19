// Unit tests for scripts/win-isa-guard.mjs against small, checked-in fixture
// excerpts (scripts/__fixtures__/win-isa/), not the multi-MB real dumpbin
// dumps from lu-301/e2e/k1-avx/, which stay out of the repo. Run with:
//   node --test scripts/win-isa-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  parseDisasmLines,
  parseMapSymbols,
  findVexEvexHits,
  isVexEvexHit,
  findOwner,
  isAllowlisted,
  checkDominance,
  evaluateModule,
} from './win-isa-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '__fixtures__', 'win-isa');

function loadFixture(name) {
  return {
    disasmText: readFileSync(join(FIXTURES, `${name}.disasm.txt`), 'utf8'),
    mapText: readFileSync(join(FIXTURES, `${name}.map.txt`), 'utf8'),
  };
}

test('R1: VEX/EVEX detection is by opcode byte, not mnemonic spelling', () => {
  const lines = parseDisasmLines([
    '  0000000180000000: C5 F9 6E D8        vmovd       xmm3,eax',
    '  0000000180000004: C4 E3 65 18 DB 01  vinsertf128 ymm3,ymm3,xmm3,1',
    '  0000000180000010: 62 F2 F5 08 40 C6  vpmullq     xmm0,xmm1,xmm6',
    // verr/verw real opcode is 0F 00 /4 /5, first byte 0F, never C4/C5/62.
    '  0000000180000020: 0F 00 34 25 00 00  verr        word ptr [0]',
    '  0000000180000030: 48 89 5C 24 08     mov         qword ptr [rsp+8],rbx',
  ].join('\n'));
  assert.equal(lines.length, 5);
  const hits = findVexEvexHits(lines);
  assert.equal(hits.length, 3, 'exactly the three real VEX/EVEX lines, verr/verw and mov excluded');
  assert.ok(hits.every((h) => isVexEvexHit(h)));
});

test('R1: a dumpbin continuation line (no address) is not parsed as its own instruction', () => {
  // Real dumpbin wraps long instructions onto a second line with no leading
  // address; that line must simply not match, not be mis-read as a hit.
  const lines = parseDisasmLines([
    '  0000000180000000: 48 8D 05 00 00 00 00',
    '                    00                 lea         rax,[rip]',
  ].join('\n'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].addr, 0x180000000);
});

test('.map row parsing: Lib:Object is the trailing token, f/i flags are stripped', () => {
  const symbols = parseMapSymbols([
    ' 0001:00091000       __std_find_trivial_1       0000000180092000 f   msvcprt:vector_algorithms.obj',
    ' 0003:000001b8       __isa_available            00000001800b51b8     MSVCRT:cpu_disp.obj',
    ' 0002:00020784       __NULL_IMPORT_DESCRIPTOR   00000001800b3784     ggml-base:ggml-base.dll',
  ].join('\n'));
  assert.equal(symbols.length, 3);
  const find = symbols.find((s) => s.name === '__std_find_trivial_1');
  assert.equal(find.obj, 'msvcprt:vector_algorithms.obj');
  assert.equal(find.va, 0x180092000);
  const isa = symbols.find((s) => s.name === '__isa_available');
  assert.equal(isa.obj, 'MSVCRT:cpu_disp.obj');
});

test('findOwner: largest symbol address <= target, function end is the next symbol', () => {
  const symbols = parseMapSymbols([
    ' 0001:00000000       f_one   0000000180001000 f   a.obj',
    ' 0001:00000100       f_two   0000000180001100 f   b.obj',
  ].join('\n'));
  const owned = findOwner(symbols, 0x180001050);
  assert.equal(owned.owner.name, 'f_one');
  assert.equal(owned.functionEnd, 0x180001100);
  assert.equal(findOwner(symbols, 0x180000fff), null, 'address before every symbol has no owner');
});

test('isAllowlisted: msvcprt:vector_algorithms.obj, MSVCRT:*, and wmemcmp/memcmp are allowed; own code is not', () => {
  assert.equal(isAllowlisted({ obj: 'msvcprt:vector_algorithms.obj', name: 'x' }), true);
  assert.equal(isAllowlisted({ obj: 'MSVCRT:cpu_disp.obj', name: 'x' }), true);
  assert.equal(isAllowlisted({ obj: 'ggml.obj', name: 'wmemcmp' }), true);
  assert.equal(isAllowlisted({ obj: 'ggml-quants.obj', name: 'iq2xs_init_impl$omp$1' }), false);
});

test('checkDominance: finds the isa-read-then-guarding-jump shape (Fundstelle 2a pattern)', () => {
  const lines = parseDisasmLines([
    '  0000000180027ED6: 8B 0D BC 19 07 00  mov         ecx,dword ptr [0000000180099898h]',
    '  0000000180027F7E: 83 F9 05           cmp         ecx,5',
    '  0000000180027F81: 7C 40              jl          0000000180027FC3',
    '  0000000180027F83: C4 C2 71 46 C2     vpsravd     xmm0,xmm1,xmm10',
    '  0000000180027FC3: 48 8D 94 24 88 00  lea         rdx,[rsp+88h]',
  ].join('\n'));
  const dom = checkDominance(lines, [0x180099898], 0x180027e10, 0x180028010, 0x180027f83);
  assert.equal(dom.protected, true);
});

test('checkDominance: an isa read with no bounding jump is NOT protected', () => {
  const lines = parseDisasmLines([
    '  0000000180027ED6: 8B 0D BC 19 07 00  mov         ecx,dword ptr [0000000180099898h]',
    '  0000000180027F83: C4 C2 71 46 C2     vpsravd     xmm0,xmm1,xmm10',
  ].join('\n'));
  const dom = checkDominance(lines, [0x180099898], 0x180027e10, 0x180028010, 0x180027f83);
  assert.equal(dom.protected, false);
});

test('checkDominance: no isa symbol in the map at all is NOT protected', () => {
  const lines = parseDisasmLines([
    '  0000000180027F83: C4 C2 71 46 C2     vpsravd     xmm0,xmm1,xmm10',
  ].join('\n'));
  const dom = checkDominance(lines, [], 0x180027e10, 0x180028010, 0x180027f83);
  assert.equal(dom.protected, false);
});

test('fixture: protected-own-code (real Fundstelle 2a pattern) -> ALLOWED_PROTECTED, zero unprotected', () => {
  const { disasmText, mapText } = loadFixture('protected-own-code');
  const result = evaluateModule({ moduleName: 'protected-own-code', disasmText, mapText });
  assert.equal(result.hitCount, 1);
  assert.equal(result.unprotected.length, 0);
  assert.equal(result.verdicts[0].verdict, 'ALLOWED_PROTECTED');
});

test('fixture: crt-allowed (real Fundstelle 1a pattern, no isa read in-function) -> ALLOWED_CRT via allowlist', () => {
  const { disasmText, mapText } = loadFixture('crt-allowed');
  const result = evaluateModule({ moduleName: 'crt-allowed', disasmText, mapText });
  assert.equal(result.hitCount, 1);
  assert.equal(result.unprotected.length, 0);
  assert.equal(result.verdicts[0].verdict, 'ALLOWED_CRT');
});

test('RED PROBE: unprotected-own-code MUST come out UNPROTECTED (review-k1-avx.md R4)', () => {
  const { disasmText, mapText } = loadFixture('unprotected-own-code');
  const result = evaluateModule({ moduleName: 'unprotected-own-code', disasmText, mapText });
  assert.equal(result.hitCount, 1);
  assert.equal(result.unprotected.length, 1, 'the red probe must never be silently allowed');
  assert.equal(result.verdicts[0].verdict, 'UNPROTECTED');
});

test('CLI: the script actually runs main() as a real subprocess and exits 1 on the red probe', () => {
  // Regression test for a real bug found running this exact guard on the
  // Windows box (lu-301/bau/waechter-windows.md): the old entry-point check
  // compared `import.meta.url` (a file:// URL, forward slashes) against
  // `'file://' + process.argv[1]` (a native path, backslashes on Windows),
  // never equal there, so main() silently never ran and `node
  // win-isa-guard.mjs check ...` exited 0 having checked nothing at all,
  // on every invocation. A plain function-level test that only imports the
  // module (as every other test in this file does) cannot catch that class
  // of bug, because import.meta.url never even enters the entry-point
  // branch when the file is merely imported, it has to actually be run as
  // node's entry script, hence a real subprocess here.
  const script = join(HERE, 'win-isa-guard.mjs');
  const result = spawnSync(process.execPath, [
    script,
    'check',
    '--module', 'red-probe',
    '--disasm', join(FIXTURES, 'unprotected-own-code.disasm.txt'),
    '--map', join(FIXTURES, 'unprotected-own-code.map.txt'),
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1, `expected exit 1 (unprotected hit), got ${result.status}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /UNPROTECTED/);
});

test('map-control: a module with VEX/EVEX hits but zero map symbols cannot resolve any owner', () => {
  const disasmText = '  0000000180000000: C5 F9 6E D8        vmovd       xmm3,eax';
  const result = evaluateModule({ moduleName: 'empty-map', disasmText, mapText: '' });
  assert.equal(result.symbolCount, 0);
  assert.equal(result.hitCount, 1);
  assert.equal(result.ownedHitCount, 0);
  assert.equal(result.unprotected.length, 1, 'an unresolved owner must fail closed, not pass silently');
  assert.equal(result.verdicts[0].verdict, 'UNKNOWN_OWNER');
});
