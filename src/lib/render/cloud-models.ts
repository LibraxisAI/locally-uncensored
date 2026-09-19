// Static SEED of the hosted render catalog — the offline/never-fetched
// fallback only. The live truth is GET /api/jobs/catalog (fetched into
// cloudCatalogStore on every account probe), so a shipped build picks up
// fleet/pricing changes without an app update. Keep the ids in sync with
// uselu apps/web/lib/render/cloud-models.ts when touching this file.

import type { RenderKind, RenderOp } from './cloud-jobs'

export interface CloudModel {
  id: string
  label: string
  kind: RenderKind
  /** Supports the masked img2img 'edit' op (flux-dev only today). */
  edit?: boolean
  /** R5-66: an instruction-based edit endpoint that takes prompt + image and
   *  needs no mask at all (Web parity: apps/web/lib/render/cloud-models.ts,
   *  qwen-image-edit). Only meaningful on an `ops: ['edit']` model; classic
   *  `edit: true` models (flux-dev) are always mask-required. */
  maskless?: boolean
  /** Video: renders text-to-video (the "Video" intent). Absent = yes; set false
   *  on an i2v-only model to keep it out of the Video picker. */
  t2v?: boolean
  /** Video: renders image-to-video (the "Animate Image" intent). Absent = yes;
   *  set false on a t2v-only model to keep it out of the Animate picker. */
  i2v?: boolean
  /** C2: the provider ships this endpoint with its own filter off, so it
   *  produces adult output when the account's content policy allows it (server
   *  migration 0042, uselu apps/web/lib/render/cloud-models.ts). Drives the
   *  "No refusals" picker mark (ModelChip.tsx) and grants nothing on its own:
   *  the server re-checks the account's policy on every job, this field is
   *  display only. Optional and defaults to falsy: the live catalog
   *  (GET /api/jobs/catalog) only started emitting it once the web-side fix
   *  landed, and an older/offline payload without the field must read as "not
   *  adult", never crash or silently mismark a model. */
  adult?: boolean
  /** 2.5.8 op-specialized models (trainers, lipsync, voice, music, extend,
   *  motion, LoRA-gen): exactly the ops this model serves. Absent on classic
   *  models — every classic picker filters on `!m.ops`. */
  ops?: RenderOp[]
  /** Character-Studio generation endpoint: accepts `params.loras`. */
  lora?: boolean
  /** Lipsync base input: still portrait ('image') or existing clip ('video'). */
  lipsync_source?: 'image' | 'video'
  /** Music: the endpoint has a real lyrics input (server truth, 2026-08-08:
   *  only ace-step-1.5). The lyrics box is offered only when set; the other
   *  music endpoints write their own lyrics from the prompt. */
  lyrics?: boolean
  /** Whether the hosted endpoint honours guidance_scale (CFG). */
  cfg?: boolean
  /** Whether the hosted endpoint honours negative_prompt. */
  negative_prompt?: boolean
  /** Video: clip lengths the model books (5s short / 8s long). */
  clip?: { short: number; long?: number }
  /** Per-run credit cost (base = image or 5s clip, long = 8s clip; music
   *  models additionally quote per_s for the duration slider).
   *
   *  `lora` is what one run costs when it carries a trained character: the
   *  worker then books the provider's `-lora` twin, a different endpoint at a
   *  different price. It REPLACES the base rate, it does not add to it, and it
   *  is set only where the twin really costs more than our base rate covers.
   *  /api/jobs/catalog emits it on exactly the same terms, so the client never
   *  needs a second price table. */
  credits?: { base: number; long?: number; per_s?: number; lora?: number }
}

const CLIP = { short: 5, long: 8 }

export const CLOUD_MODEL_SEED: CloudModel[] = [
  { id: 'flux-schnell', label: 'Flux Schnell (fast)', kind: 'image', cfg: true },
  { id: 'flux-dev', label: 'Flux Dev (quality)', kind: 'image', edit: true, cfg: true },
  { id: 'flux-2-dev', label: 'Flux 2 Dev', kind: 'image' },
  { id: 'qwen-image', label: 'Qwen Image', kind: 'image' },
  { id: 'hidream', label: 'HiDream', kind: 'image' },
  { id: 'hunyuan-image', label: 'HunyuanImage 2.1', kind: 'image' },
  { id: 'z-image-turbo', label: 'Z-Image Turbo (fast)', kind: 'image' },
  { id: 'chroma', label: 'Chroma Spicy', kind: 'image', adult: true },
  { id: 'prefect-pony', label: 'Prefect Pony XL Spicy', kind: 'image', adult: true },
  { id: 'neta-lumina', label: 'Neta Lumina (anime) Spicy', kind: 'image', adult: true },
  // Every hosted clip model does both t2v + i2v, so both flags are true. They're
  // the enforced contract (Video/Animate pickers + submit filter on them), not a
  // note — a future t2v-only or i2v-only model MUST set the flag it lacks to
  // false. Server truth is /api/jobs/catalog; keep in sync with uselu.
  { id: 'wan-2.2-720p', label: 'Wan 2.2 720p', kind: 'video', t2v: true, i2v: true, negative_prompt: true, clip: CLIP },
  { id: 'wan-2.2-fast', label: 'Wan 2.2 Fast', kind: 'video', t2v: true, i2v: true, negative_prompt: true, clip: CLIP },
  { id: 'ltx-2', label: 'LTX-2 (with audio)', kind: 'video', t2v: true, i2v: true, clip: CLIP, credits: { base: 8000, lora: 10000 } },
  { id: 'hunyuan-video', label: 'HunyuanVideo 1.5', kind: 'video', t2v: true, i2v: true, negative_prompt: true, clip: CLIP },
  { id: 'ltx-2.3', label: 'LTX 2.3', kind: 'video', t2v: true, i2v: true, clip: CLIP },

  // Image-to-video endpoints the provider ships with its own filter off
  // (mirroring uselu apps/web/lib/render/cloud-models.ts). None of them has a
  // text-to-video twin at the provider, hence t2v: false: the path is an image
  // first, then one of these. CLIP does not fit here, the provider quotes only
  // a 5 s rate for them, so there is no 8s button to offer.
  // 2026-09-10:
  { id: 'wan-2.2-spicy', label: 'Wan 2.2 Spicy', kind: 'video', t2v: false, i2v: true, adult: true, clip: { short: 5 }, credits: { base: 15000, lora: 20000 } },
  { id: 'ltx-2.3-spicy', label: 'LTX 2.3 Spicy', kind: 'video', t2v: false, i2v: true, adult: true, clip: { short: 5 }, credits: { base: 10000, lora: 15000 } },
  { id: 'wan-2.6-spicy', label: 'Wan 2.6 Spicy', kind: 'video', t2v: false, i2v: true, adult: true, clip: { short: 5 }, credits: { base: 50000 } },
  { id: 'wan-2.7-spicy', label: 'Wan 2.7 Spicy', kind: 'video', t2v: false, i2v: true, adult: true, clip: { short: 5 }, credits: { base: 50000 } },
  { id: 'minimax-h3-spicy', label: 'MiniMax H3 Spicy', kind: 'video', t2v: false, i2v: true, adult: true, clip: { short: 5 }, credits: { base: 20000 } },
  { id: 'seedance-1.5-pro-spicy', label: 'Seedance 1.5 Pro Spicy', kind: 'video', t2v: false, i2v: true, adult: true, clip: { short: 5 }, credits: { base: 26000 } },
  // 2026-09-13:
  { id: 'seedance-2.5-spicy', label: 'Seedance 2.5 Spicy', kind: 'video', t2v: false, i2v: true, adult: true, clip: { short: 5 }, credits: { base: 90000 } },
  { id: 'seedance-2.0-spicy', label: 'Seedance 2.0 Spicy', kind: 'video', t2v: false, i2v: true, adult: true, clip: { short: 5 }, credits: { base: 60000 } },
  { id: 'seedance-2.0-fast-spicy', label: 'Seedance 2.0 Fast Spicy', kind: 'video', t2v: false, i2v: true, adult: true, clip: { short: 5 }, credits: { base: 50000 } },
  { id: 'vidu-q3-spicy', label: 'Vidu Q3 Spicy', kind: 'video', t2v: false, i2v: true, adult: true, clip: { short: 5 }, credits: { base: 35000 } },

  // ── 2.5.8 op-specialized fleet (Character-Studio / lipsync / voice / music /
  // extend / motion). `ops` keeps them out of every classic picker; the live
  // catalog (?v=2) is the pricing truth. Face-swap is banned from this list. ──
  { id: 'flux-lora-trainer', label: 'Flux Character Training', kind: 'image', ops: ['lora-train'] },
  { id: 'z-image-lora-trainer', label: 'Z-Image Character Training', kind: 'image', ops: ['lora-train'] },
  { id: 'qwen-image-lora-trainer', label: 'Qwen Character Training', kind: 'image', ops: ['lora-train'] },
  { id: 'ltx-2-video-lora-trainer', label: 'LTX-2 Video Character Training', kind: 'video', ops: ['lora-train'], t2v: false, i2v: false },
  { id: 'flux-schnell-lora', label: 'Flux Schnell + Character', kind: 'image', ops: ['generate'], lora: true, cfg: true },
  { id: 'flux-dev-lora-ultra-fast', label: 'Flux Dev Fast + Character', kind: 'image', ops: ['generate'], lora: true, cfg: true },
  { id: 'z-image-turbo-lora', label: 'Z-Image Turbo + Character', kind: 'image', ops: ['generate'], lora: true },
  { id: 'z-image-base-lora', label: 'Z-Image + Character', kind: 'image', ops: ['generate'], lora: true },
  // R5-57/58: missing from this seed entirely, so the edit picker never
  // offered it and the model was unreachable until the live catalog fetch
  // landed. Label and maskless flag copied verbatim from uselu
  // apps/web/lib/render/cloud-models.ts.
  { id: 'qwen-image-lora', label: 'Qwen Image + Character', kind: 'image', ops: ['generate'], lora: true },
  { id: 'qwen-image-edit', label: 'Qwen Image Edit (no mask needed)', kind: 'image', ops: ['edit'], maskless: true },
  { id: 'infinitetalk-fast', label: 'InfiniteTalk (photo avatar)', kind: 'video', ops: ['lipsync'], lipsync_source: 'image', t2v: false, i2v: false },
  { id: 'p-video-avatar', label: 'P-Video Avatar (photo, fast)', kind: 'video', ops: ['lipsync'], lipsync_source: 'image', t2v: false, i2v: false },
  { id: 'latentsync', label: 'LatentSync (resync a clip)', kind: 'video', ops: ['lipsync'], lipsync_source: 'video', t2v: false, i2v: false },
  { id: 'lipsync-2', label: 'Lipsync-2 (resync a clip)', kind: 'video', ops: ['lipsync'], lipsync_source: 'video', t2v: false, i2v: false },
  { id: 'qwen3-tts', label: 'Qwen3 TTS (voices)', kind: 'audio', ops: ['tts'] },
  { id: 'qwen3-tts-clone', label: 'Qwen3 TTS Voice Clone', kind: 'audio', ops: ['tts'] },
  { id: 'qwen3-tts-design', label: 'Qwen3 TTS Voice Design', kind: 'audio', ops: ['tts'] },
  { id: 'ace-step', label: 'ACE-Step (fast)', kind: 'audio', ops: ['music'], credits: { base: 1200, per_s: 20 } },
  { id: 'ace-step-1.5', label: 'ACE-Step 1.5', kind: 'audio', ops: ['music'], lyrics: true, credits: { base: 1800, per_s: 30 } },
  { id: 'sonilo-music', label: 'Sonilo Music', kind: 'audio', ops: ['music'], credits: { base: 15000, per_s: 250 } },
  { id: 'wan-2.2-spicy-extend', label: 'Wan 2.2 Spicy Extend', kind: 'video', ops: ['extend'], t2v: false, i2v: false, adult: true, credits: { base: 15000, lora: 20000 } },
  { id: 'ltx-2-extend', label: 'LTX-2 Extend', kind: 'video', ops: ['extend'], t2v: false, i2v: false },
  { id: 'pixverse-extend', label: 'Pixverse Extend (fast)', kind: 'video', ops: ['extend'], t2v: false, i2v: false },
  { id: 'wan-2.2-animate', label: 'Wan 2.2 Animate', kind: 'video', ops: ['motion'], t2v: false, i2v: false },
  { id: 'steady-dancer', label: 'SteadyDancer', kind: 'video', ops: ['motion'], t2v: false, i2v: false },
  { id: 'p-video-animate', label: 'P-Video Animate (fast)', kind: 'video', ops: ['motion'], t2v: false, i2v: false },
  { id: 'dreamactor-v2', label: 'DreamActor v2', kind: 'video', ops: ['motion'], t2v: false, i2v: false },
]
