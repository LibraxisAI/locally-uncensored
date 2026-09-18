/**
 * K2 nachbessert (review-create.md): "K2 ist erst fertig, wenn KEIN
 * Workflow-Bauer mehr einen Loader-Wert als Literal einsetzt." Punkt 1
 * (buildWan22Workflow) and Punkt 2 (FramePack's DualCLIPLoader) closed the
 * two gaps the review found; this is the systematic check the coordinator
 * asked for on top: grep every workflow-building source file under src/api
 * for a ComfyUI loader node's `*_name` input written as a string literal,
 * so a future builder (or a regression in an existing one) that reintroduces
 * a hardcoded loader value fails a test instead of shipping a "Value not in
 * list" the customer hits.
 *
 * Only fields that name a FILE ON DISK a loader resolves are checked
 * (ckpt_name, unet_name, vae_name, clip_name/clip_name1/clip_name2,
 * lora_name, audio_encoder_name, clip_vision_name, controlnet_name,
 * upscale_model_name, style_model_name, embedding_name, model_name).
 * `sampler_name` is deliberately excluded: it names a SAMPLING ALGORITHM
 * ('euler', 'dpmpp_2m', ...), a fixed enum ComfyUI ships built in, not a
 * file the Model Manager can install or a value that goes missing depending
 * on what the customer downloaded, so it is not K2's bug class at all.
 *
 * Run: npx vitest run src/api/__tests__/no-hardcoded-loader-names-k2.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const API_DIR = join(HERE, '..')

const LOADER_NAME_FIELDS = new Set([
  'ckpt_name', 'unet_name', 'vae_name',
  'clip_name', 'clip_name1', 'clip_name2',
  'lora_name', 'audio_encoder_name', 'clip_vision_name',
  'controlnet_name', 'upscale_model_name', 'style_model_name',
  'embedding_name', 'model_name',
])

interface Hit { file: string; line: number; field: string; value: string }

function scanFile(path: string): Hit[] {
  const hits: Hit[] = []
  const lines = readFileSync(path, 'utf-8').split('\n')
  const pattern = /(\w+)\s*:\s*(['"])([^'"]+)\2/g
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    for (const m of line.matchAll(pattern)) {
      const [, field, , value] = m
      if (LOADER_NAME_FIELDS.has(field)) {
        hits.push({ file: relative(API_DIR, path), line: i + 1, field, value })
      }
    }
  })
  return hits
}

function scanDir(dir: string): Hit[] {
  const hits: Hit[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) { hits.push(...scanDir(full)); continue }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue
    hits.push(...scanFile(full))
  }
  return hits
}

// Documented, justified exceptions. Each entry needs a reason a reader can
// verify against the code, not just a filename.
const EXCEPTIONS: Record<string, string> = {
  // getBuiltinTemplates() in workflows.ts ships three STARTER templates for
  // the (currently unwired, no UI calls getBuiltinTemplates or reads
  // .rawWorkflow anywhere) Workflow Manager's template gallery. Their
  // 'model.safetensors' / 'clip.safetensors' / 'ae.safetensors' /
  // 'vae.safetensors' values are editable PLACEHOLDERS in a graph the
  // system never submits to /prompt as-is: a real generation always goes
  // through parseImportedWorkflow -> autoDetectParameterMap ->
  // injectParameters, which writes the live-picked model name in at
  // generation time. Not K2's bug class (a live request silently sending a
  // stale/wrong value): nothing here is ever silently submitted.
  'workflows.ts': 'getBuiltinTemplates() starter-template placeholders, never submitted directly (see comment above)',
}

describe('no ComfyUI loader node in src/api hardcodes a *_name file value (K2)', () => {
  it('sanity: the scanner actually walks files and the field set is non-empty', () => {
    const all = scanDir(API_DIR)
    expect(LOADER_NAME_FIELDS.size).toBeGreaterThan(5)
    // Sanity that the scanner itself works: the exception file must show up.
    expect(all.some((h) => h.file === 'workflows.ts')).toBe(true)
  })

  it('every hit is inside a documented exception file', () => {
    const hits = scanDir(API_DIR)
    const undocumented = hits.filter((h) => !(h.file in EXCEPTIONS))
    expect(
      undocumented,
      `Hardcoded loader value(s) found: ${undocumented.map((h) => `${h.file}:${h.line} ${h.field}="${h.value}"`).join(', ')}. ` +
      `Resolve against the live enum (findMatchingVAE/findMatchingCLIP/findMatchingAudioEncoder/findMatchingClipVision/findFramePackCLIPPair/findFluxCLIPPair, ` +
      `or resolveLoraNames), or add a justified, reasoned entry to EXCEPTIONS above.`,
    ).toEqual([])
  })

  it('sampler_name literals are NOT flagged (algorithm choice, not a file)', () => {
    // Regression guard for the scanner itself: dynamic-workflow.ts writes
    // sampler_name: 'euler' for music generation, and that must stay legal.
    const hits = scanDir(API_DIR)
    expect(hits.some((h) => h.field === 'sampler_name')).toBe(false)
  })
})
