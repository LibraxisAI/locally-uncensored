// Cloud twin of useCreate's generate/cancel — port of uselu's useCloudCreate
// onto the desktop cloud client (bearer auth via api/cloud/jobs). Submits the
// current Create state to the hosted render queue instead of local ComfyUI,
// then polls to completion. Store choreography (isGenerating, progress,
// gallery) mirrors the local path so every downstream component works
// unchanged. useCreate itself is untouched: the seam lives in CreateExpProvider.
//
// Desktop delta vs uselu: results keep remoteUrl + jobId in the persisted
// gallery — multi-MB base64 dataUrls would blow the localStorage quota and
// kill all create-store persistence. Signed URLs expire ~1 h after the last
// read, so playback surfaces re-sign lazily via refreshResultUrl().

import { useCallback } from 'react'
import { useCreateStore, type GalleryItem } from '../stores/createStore'
import { intentToJob, galleryItemFromJob } from '../lib/render/cloud-jobs'
import {
  cancelJob,
  getJob,
  pollJob,
  submitCloudJob,
  uploadInput,
  CloudJobError,
  QuoteChangedError,
  type CloudJobParams,
} from '../api/cloud/jobs'
import {
  defaultCloudModel,
  modelForOp,
  resolveOpPick,
  cloudModelById,
  cloudMediaLive,
  loraGenModels,
} from '../stores/cloudCatalogStore'
import { checkPromptSafety, blockMessageFor, type SafetyVerdict } from '../lib/render/safety'
import { contentPolicySnapshot, loadContentPolicy } from './useContentPolicy'
import { signalCreditsExhausted } from '../lib/credits-exhausted'
import { resolveRunSeed } from '../lib/run-seed'
import { intentRoles, intentRequiredInputs, isStudioModel, resolveIntentPick } from '../lib/render/create-studio'
import { STUDIO_MODELS, studioFields } from '../lib/render/studio-contract'
import { modelLabel } from '../lib/render/preset-models'
import { bookedVideoSeconds } from '../lib/render/video-duration'
import { studioQuote, StudioQuoteChangedError } from '../api/cloud/studio'

// B3 (review-w2ui.md, 18.09.2026): the CSAM floor above runs regardless of
// tier, but the adult half of safety.ts (ADULT_SOFT_TERMS/ADULT_HARD_TERMS)
// only ever fires on tier: 'cloud', which no caller passed until now, making
// half the module unreachable. R5-9 exists precisely so "the rejection comes
// before the upload" for the cloud path too, matching uselu's own
// useCloudCreate (apps/web/hooks/useCloudCreate.ts, clientSafety()).
//
// If the account policy has not loaded yet, this checks CSAM only ('off'):
// never block on a guessed rule, the server is the authority for the rest,
// same reasoning as uselu's own comment on clientSafety().
function clientSafety(text: string): SafetyVerdict {
  const policy = contentPolicySnapshot()
  if (!policy) void loadContentPolicy() // for the next run
  return checkPromptSafety(text, { tier: 'cloud', policy: policy ?? 'off' })
}

// Which generation models accept which trained-LoRA family. Ported from
// uselu main 5be5dec3 (apps/web/lib/render/cloud-models.ts,
// CHARACTER_MODEL_FAMILY): the picker (ModelChip), the meter (CreditsMeter)
// and this submit path all resolve through the SAME table now, so the UI
// cannot show Flux while quietly running Z-Image. Replaces the old fixed
// single-entry default (CHARACTER_GEN_DEFAULT) that only ever offered ONE
// endpoint per family and silently ignored the catalog. `qwen-image-lora` is
// already in the desktop seed (cloud-models.ts); flux/z-image keep their two
// endpoints each (a fast + a slower/quality one).
export const CHARACTER_MODEL_FAMILY: Readonly<Record<string, string>> = {
  'flux-schnell-lora': 'flux',
  'flux-dev-lora-ultra-fast': 'flux',
  'z-image-turbo-lora': 'z-image',
  'z-image-base-lora': 'z-image',
  'qwen-image-lora': 'qwen-image',
  'ltx-2': 'ltx-2',
  'ltx-2.3': 'ltx-2',
}

/** Generation models that accept this trained-LoRA family's weights. */
export function characterGenerationModels(family: string) {
  return loraGenModels().filter((m) => CHARACTER_MODEL_FAMILY[m.id] === family)
}

/** The model a character run will really use: the stored pick if it still
 *  fits the trained family, else the family's first compatible model, else
 *  null (no compatible generation endpoint exists yet for this family). */
export function resolveCharacterModel(family: string, pickedId: string): string | null {
  const list = characterGenerationModels(family)
  return list.some((m) => m.id === pickedId) ? pickedId : (list[0]?.id ?? null)
}

// Gallery label for ops that never read the composer prompt. Without this
// they inherit whatever was typed last, and the extend picker then shows a
// motion clip wearing the previous t2v prompt as its name (live find
// 2026-07-18: two different clips, identical "…dancing…" label).
const OP_GALLERY_LABEL: Record<string, string> = {
  lipsync: 'Talking character',
  motion: 'Motion transfer',
  removebg: 'Background removed',
  upscale: 'Upscaled image',
  eraser: 'Object erased',
}

// Per-op progress verb — "Rendering" reads wrong for a training run or a song.
function opProgressVerb(op: string): string {
  switch (op) {
    case 'lora-train': return 'Training your character…'
    case 'music': return 'Composing…'
    case 'tts': return 'Generating the voice…'
    case 'lipsync': return 'Syncing the performance…'
    case 'extend': return 'Extending the clip…'
    case 'motion': return 'Transferring the motion…'
    default: return 'Rendering in the cloud…'
  }
}

// What a 429 from the render queue actually means.
//
// The queue answers 429 for five different things (lib/http-status states the
// same policy for the chat path): the per-user burst guard and an upstream
// provider throttle, both transient and both carrying retry-after, and three
// that are about money, each with a different way out. Every one of them used
// to read "Monthly credit budget exhausted, upgrade your plan", so a subscriber
// who was merely clicking too fast, with credits left in the meter next to the
// message, was told to buy a bigger plan.
//
// The repair after that asked `/credit/i` about the message, and the server's
// video-budget sentence carries the word "credits". The wrong branch won and
// the customer was offered a plan change instead of the pack that unblocks him
// (R5-49). `trainings_exhausted` carries the word nowhere and fell into the
// throttle text, which points at a clock that never runs out (R5-50). So the
// code the server sends decides, in that order, and the heuristic is gone: a
// message is prose, a code is a decision. Wordings come from the web
// (apps/web/hooks/useCloudCreate.ts), because the same refusal must not read
// differently depending on which of the two apps the customer happens to use.
export function throttleMessage(err: CloudJobError): string {
  switch (err.code) {
    case 'credits_exhausted':
      // R5-52: the buy dialog had exactly one caller and it sat in the chat
      // path, so a render that ran the wallet dry left the customer with a red
      // line and no way to pay.
      signalCreditsExhausted('credits')
      return "You're out of credits. Load up your credits or upgrade your plan."
    case 'video_budget_exhausted':
      // R5-51: this cap and 'trainings_exhausted' below used to only print a
      // line and never opened the dialog, so a Create render that hit either
      // one left the customer with prose and no way to act on it, same gap
      // R5-52 had already found and closed for 'credits_exhausted'.
      signalCreditsExhausted('video_budget')
      return "This month's video budget is used up. Top-up credits keep video going, or upgrade your plan."
    case 'trainings_exhausted':
      signalCreditsExhausted('trainings')
      // B1 (review-a1.md): a pack buyer with topup credits can still start a
      // training the moment this fires, the server race between quota read
      // and submit is what triggers it. The old sentence only offered a plan
      // change and hid that path, so it now matches the web word for word
      // (89055415, apps/web/hooks/useCloudCreate.ts).
      return 'Your included character trainings are used up. Top-up credits keep training going, or upgrade your plan.'
  }
  const secs = err.retryAfterMs && err.retryAfterMs > 0 ? Math.ceil(err.retryAfterMs / 1000) : null
  return secs
    ? `Too many requests at once. Wait ${secs}s and try again.`
    : 'Too many requests at once. Wait a moment and try again.'
}

// Decoded by hand instead of fetch(dataUrl): the webview CSP's connect-src
// (rightly) has no data: entry, so fetching a data URL throws "Load failed"
// and killed every source-needing op before the upload even started.
export function dataUrlToBlob(dataUrl: string): Blob {
  // A blob:/http(s) url here means an ImageRef broke the "url is always a data
  // url" invariant. Parsing it as a data url silently yields a text blob the
  // server 415s ("unsupported image format") — fail loudly at the source.
  if (!dataUrl.startsWith('data:')) {
    throw new Error(`dataUrlToBlob expects a data: URL, got "${dataUrl.slice(0, 16)}…"`)
  }
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.slice(5, comma)
  const data = dataUrl.slice(comma + 1)
  const mime = meta.split(';')[0] || 'application/octet-stream'
  if (meta.includes('base64')) {
    const bin = atob(data)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(data)], { type: mime })
}

// The in-flight job handle lives at module scope, matching the lifetime of the
// generate() closure (which keeps polling across view switches). Instance refs
// died with the Create view's remount, leaving the Cancel button a no-op
// mid-render. At most one cloud job runs per app (the store-level isGenerating
// gate), so a singleton is correct.
let activeJobId: string | null = null
let activeAbort: AbortController | null = null

/** True while a cloud run (generate or enhance) is in flight. CreateContext
 *  routes Cancel by the backend that STARTED the run, not the current axis —
 *  the header switch (or the 5-min license probe) can flip local/cloud
 *  mid-render, and a mis-routed cancel strands a billing cloud job. */
export const hasActiveCloudRun = (): boolean => activeAbort !== null

export function useCloudCreate(opts: { onQuotaChange?: () => void } = {}) {
  const { onQuotaChange } = opts

  const generate = useCallback(async () => {
    const s = useCreateStore.getState()
    if (s.isGenerating) return
    const intent = s.intent()
    let { kind, op } = intentToJob(intent)
    // Character-Studio 'use' surface: a plain image generate with the trained
    // character attached; 'train' (the intentToJob default) books the trainer.
    const characterUse = intent === 'character' && s.characterTab === 'use'
    if (characterUse) {
      kind = 'image'
      op = 'generate'
    }
    const specialOp =
      op === 'lipsync' || op === 'extend' || op === 'motion' ||
      op === 'music' || op === 'tts' || op === 'lora-train'
    // Portplan P7: the four role intents (lipsync/music/extend/motion) reach
    // the Studio track through the SAME picker as their classic op-specialized
    // models (create-studio.ts, ported P2); resolveIntentPick's list already
    // contains both, so it replaces resolveOpPick for exactly these four.
    // Character-use never touches Studio: it stays on its fixed -lora family.
    const roleIntent = !characterUse && intentRoles(intent).length > 0
    let picked: string
    if (characterUse) {
      picked = resolveCharacterModel(s.selectedCharacter?.family ?? '', s.cloudOpModel) ?? ''
    } else if (roleIntent) {
      picked = resolveIntentPick(intent, s.cloudOpModel)
    } else if (specialOp) {
      // Same resolution rule as the chip's display — a pick left over from
      // another intent must not survive into this op's submit (take-01: the
      // lipsync model steered the training job onto the LTX video trainer
      // while the chip showed Flux).
      picked = resolveOpPick(op, s.cloudOpModel)
    } else {
      picked = (kind === 'video' ? s.cloudVideoModel : s.cloudImageModel) || defaultCloudModel(kind)?.id || ''
    }
    // A Studio pick runs its own schema-driven endpoint (op: 'studio'), never
    // through modelForOp's classic op coercion, STUDIO_MODELS is a disjoint
    // registry the classic picker functions do not know about.
    const studioModel = !characterUse && isStudioModel(picked) ? picked : undefined
    if (studioModel) kind = STUDIO_MODELS[studioModel].kind
    // Coerce a leftover/incapable pick onto a model that can run this op
    // (edit→i2i, animate→i2v, video→t2v, specialized ops→their family) so the
    // submit never 400s.
    const model = studioModel ?? modelForOp(kind, op, picked)

    s.setError(null)
    if (!cloudMediaLive()) {
      // Server MEDIA_LIVE switch is off — the GPU fleet isn't up, a submit
      // would only 503. Mirror the server's honest "coming soon".
      s.setError('Cloud rendering is coming soon, the GPU fleet is not live yet.')
      return
    }
    if ((op === 'generate' || op === 'music' || op === 'tts') && s.prompt.trim().length === 0) {
      s.setError('Please enter a prompt.')
      return
    }
    // Client-side CSAM + account-adult-policy gate (UX) over every free-text
    // field this run sends. The server additionally enforces its own policy
    // read fresh from the account row, its 422 message lands in setError
    // below either way; this only saves the round trip when the client
    // already knows the verdict (B3).
    {
      const verdict = clientSafety(`${s.prompt} ${s.negativePrompt} ${s.musicLyrics} ${s.triggerWord}`)
      if (verdict.blocked) {
        s.setError(blockMessageFor(verdict.reason))
        return
      }
    }
    // Per-intent input contracts (client UX; the server re-checks all of it).
    if (characterUse && !s.selectedCharacter) {
      s.setError('Pick a character from your shelf first, or train one.')
      return
    }
    if (characterUse && !model) {
      s.setError('This character has no compatible generation model yet.')
      return
    }
    if (op === 'lora-train' && s.trainImages.length < 4) {
      s.setError('Add at least 4 photos of your character (more is better, up to 30).')
      return
    }
    // A Studio pick names its own required inputs (studio-contract.ts's
    // schema). A presenter endpoint (HeyGen) reads only the voice and needs
    // no photo at all, unlike every classic lipsync model.
    const studioRequired = studioModel ? intentRequiredInputs(intent, studioModel) : []
    if (op === 'lipsync') {
      if (!s.audioInput && !s.voiceFromJob) {
        s.setError('Add a voice first, upload an audio file or pick a generated one.')
        return
      }
      if (studioModel) {
        if (studioRequired.includes('source_path') && !s.source) {
          s.setError('Add a portrait image for your character.')
          return
        }
        if (studioRequired.includes('video_path') && !s.videoInput) {
          s.setError('Add the video clip to re-sync.')
          return
        }
      } else {
        const needsClip = cloudModelById(model)?.lipsync_source === 'video'
        if (needsClip ? !s.videoInput : !s.source) {
          s.setError(needsClip ? 'Add the video clip to re-sync.' : 'Add a portrait image for your character.')
          return
        }
      }
    }
    if (op === 'extend' && !s.extendSource) {
      s.setError('Pick one of your cloud videos to extend.')
      return
    }
    if (op === 'motion' && (!s.source || !s.videoInput)) {
      s.setError('Motion control needs a character image and a driving video.')
      return
    }
    if (!specialOp && op !== 'generate' && !s.source) {
      s.setError('Add a source image first.')
      return
    }
    // Studio: only the fields THIS endpoint's schema actually knows,
    // stored options are per-model in the store (cloudOpModel keyed), but
    // setCloudOpModel already drops them on a model switch (createStore, P5)
    // and this filter is the second net: a stray key from a schema this
    // model does not share must not go out, or the request looks like it
    // asked for something it never did (Portplan: "wirft einen Rest aus
    // einem anderen Modell weg, statt ihn mitzuschicken"). Full type
    // validation against the schema happens server-side (prepareStudio());
    // studio-contract.ts's own `studioOptions()` is used for the on-screen
    // PRICE PREVIEW only (useStudioPrice), never to gate or reshape a submit.
    const studioOptionsFiltered = studioModel
      ? Object.fromEntries(
          Object.entries(s.cloudStudioOptions).filter(([key]) => studioFields(studioModel)[key] !== undefined),
        )
      : undefined

    s.setIsGenerating(true)
    s.setProgressPhase('queued')
    s.setProgress(5, 'Uploading inputs…')
    // Arm the aborter BEFORE the upload/submit awaits so a Cancel click during
    // "Uploading inputs…" (seconds for large sources/masks) actually stops the
    // run before any credits are claimed — not only once polling has started.
    const ac = new AbortController()
    activeAbort = ac

    // Same rule as the local path (#110): throw the dice here, send that exact
    // number, record that exact number. Leaving the seed out let the provider
    // roll one we never learn, and the gallery wrote 0 for it.
    const runSeed = resolveRunSeed(s.seed)
    // Idempotency key (Portplan Abschnitt 4/6): a retried submit after a
    // dropped response replays the SAME booking server-side instead of
    // charging twice (CloudJobSubmitResult.replayed).
    const requestId = crypto.randomUUID()

    try {
      // Utility endpoints (removebg/upscale/eraser) and the 2.5.8 specialized
      // ops take no generation knobs — send only what the op consumes so the
      // submit schema stays honest.
      const isUtility = op === 'removebg' || op === 'upscale' || op === 'eraser'
      const bare = isUtility || specialOp
      // Studio: a schema-driven step booked against its own `studio_options`,
      // never one of the fixed classic shapes below. max_credits is filled
      // in once the price is confirmed, after the uploads (Portplan Abschnitt
      // 3, GEBUCHT wird nur gegen den bestaetigten Serverpreis).
      const params: CloudJobParams = studioModel
        ? { op: 'studio', studio_options: studioOptionsFiltered, client_request_id: requestId }
        : bare
          ? { op, client_request_id: requestId }
          : {
              op,
              client_request_id: requestId,
              negative_prompt: s.negativePrompt || undefined,
              width: s.width,
              height: s.height,
              steps: s.steps,
              cfg: s.cfgScale,
              seed: runSeed,
            }
      if (kind === 'video' && !bare) {
        // dd29f359 (Portplan Abschnitt 6), review A2 (Runde 2): book exactly
        // a length the model prices, read from the SAME catalog-first list
        // LaneControls shows (effectiveVideoDurations, in video-duration.ts),
        // never the static JSON alone, that mismatch silently booked a
        // shorter clip than the one shown and priced (review-studio-A.md
        // B2). bookedVideoSeconds throws loud, in English, if frames/fps
        // still fall outside the model's list, before any credit is claimed.
        // Review A kleiner Punkt 1 (studio-r2): reads the cloud track's OWN
        // cloudFrames/cloudFps, the same fields LaneControls' Length control
        // writes, not the local track's shared frames/fps.
        const seconds = bookedVideoSeconds(model, { frames: s.cloudFrames, fps: s.cloudFps })
        params.frames = seconds * 16
        params.fps = 16
      }
      if (op === 'music' && !studioModel) {
        params.duration = s.musicDuration
        if (s.musicLyrics.trim()) params.lyrics = s.musicLyrics.trim()
      }
      if (op === 'lora-train') {
        params.trigger_word = s.triggerWord || 'oxlu'
        if (s.triggerWord) params.name = s.triggerWord
      }
      if (characterUse && s.selectedCharacter) {
        params.loras = [{ id: s.selectedCharacter.id }]
      }
      if (op === 'edit') {
        params.denoise = s.denoise
        params.grow_mask_by = s.growMaskBy
        // The mask is exported at the SOURCE image's resolution, so the output
        // must match it too — otherwise the painted region no longer aligns.
        // The generation sliders (s.width/height) are unrelated to a dropped
        // source, so drive width/height from the source when we have it.
        if (s.source?.width && s.source?.height) {
          params.width = s.source.width
          params.height = s.source.height
        }
      }
      if (op === 'upscale') {
        params.target_resolution = s.targetResolution
      }
      // ImageRef.url is always a data URL preview; the cloud path re-uploads
      // from it, so a source picked while on the local backend still works.
      // Also exactly what a Studio role's `image` input needs (source_path),
      // the SAME staged upload, studio-contract.ts just names it a schema
      // field instead of a fixed param.
      if (op !== 'generate' && s.source) {
        params.source_path = await uploadInput(dataUrlToBlob(s.source.url), 'source')
      }
      if (op === 'edit' || op === 'eraser') {
        if (!s.mask) {
          s.setError(
            op === 'eraser'
              ? 'Paint a mask first, the eraser removes what you painted.'
              : 'Paint a mask first, the edit only changes the painted area.',
          )
          s.setIsGenerating(false)
          return
        }
        params.mask_path = await uploadInput(dataUrlToBlob(s.mask.url), 'mask')
      }
      // ── 2.5.8 specialized inputs ──
      if ((op === 'lipsync' || op === 'motion') && s.videoInput) {
        s.setProgress(6, 'Uploading video…')
        params.video_path = await uploadInput(s.videoInput.blob, 'video')
      }
      if (op === 'lipsync') {
        if (s.audioInput) {
          s.setProgress(8, 'Uploading audio…')
          params.audio_path = await uploadInput(s.audioInput.blob, 'audio')
        } else if (s.voiceFromJob && studioModel) {
          // A Studio role's `audio` input is always a staged path
          // (studio-models.json never lists `audio_url`), re-upload rather
          // than pass the signed URL through, unlike the classic branch below.
          s.setProgress(8, 'Fetching the voice…')
          const vj = await getJob(s.voiceFromJob.jobId)
          if (!vj.result_url) throw new Error('That voice has expired, generate it again first.')
          const res = await fetch(vj.result_url)
          if (!res.ok) throw new Error('Could not load the generated voice.')
          params.audio_path = await uploadInput(await res.blob(), 'audio')
        } else if (s.voiceFromJob) {
          // A prior own render (tts/music) — fresh signed URL, zero re-upload.
          const vj = await getJob(s.voiceFromJob.jobId)
          if (!vj.result_url) throw new Error('That voice has expired, generate it again first.')
          params.audio_url = vj.result_url
        }
      }
      if (op === 'lora-train') {
        const paths: string[] = []
        for (const [i, img] of s.trainImages.entries()) {
          if (ac.signal.aborted) return
          s.setProgress(5, `Uploading training photos… ${i + 1}/${s.trainImages.length}`)
          paths.push(await uploadInput(img.blob, 'train'))
        }
        params.image_paths = paths
      }
      if (op === 'extend' && s.extendSource) {
        const src = await getJob(s.extendSource.jobId)
        if (!src.result_url) throw new Error('The source clip has expired, re-render it first.')
        if (studioModel) {
          // A Studio extend role reads a staged `video_path`, not a URL the
          // provider would have to fetch itself, re-upload the finished clip
          // (mirrors the Preset Workshop's own adopt()).
          s.setProgress(6, 'Fetching the clip to extend…')
          const res = await fetch(src.result_url)
          if (!res.ok) throw new Error('Could not load the clip to extend.')
          params.video_path = await uploadInput(await res.blob(), 'video')
        } else {
          params.source_url = src.result_url
        }
      }

      // Bail before the (credit-claiming) submit if the user cancelled while
      // we were uploading inputs.
      if (ac.signal.aborted) return

      // Review A1/B3 (Runde 2, 20.09.2026): a Studio run books against a
      // SERVER-CONFIRMED number, never the client formula alone
      // (studio-contract.ts's createStudioCost is a PREVIEW for the meter,
      // this call is what actually gets charged). Fetched HERE, right after
      // the uploads and right before the credits claim, against the SAME
      // staged paths the submit below sends, that is "before the render
      // starts" for every Studio pick, including the 17 price.mode
      // 'input'/'both' endpoints (talking/presenter/duo/motion/restyle/
      // upscale/extend) that Composer's live meter can only PREVIEW: those
      // price off the uploaded file's measured length, which the provider
      // only knows once the file is staged, so a true confirmed number
      // cannot exist before this point without uploading a file the
      // customer might never submit. useStudioPrice (Composer's live meter)
      // already confirms output/characters-mode picks continuously while
      // typing; this call re-confirms fresh, right before the claim, so a
      // stale live quote can never book either.
      //
      // Bewusste Abweichung von der Web-Referenz (Portplan Abschnitt 4/7):
      // apps/web/hooks/useCloudCreate.ts sendet `max_credits` NIE aus dem
      // normalen Create-Weg, nur die Preset-Werkstatt tut das
      // (PresetWorkshop.tsx:191). Das Web bucht also aus dem Create-Tab ohne
      // Deckel, genau das Risiko 1 des Portplans. Der Desktop weicht hier
      // bewusst ab und deckelt auch den Create-Tab. Der Eigner sollte den
      // Web-Client nachziehen (review-studio-A.md B1, review-studio-B.md B3).
      if (studioModel) {
        s.setProgress(9, 'Confirming the price…')
        const quoteFields: Record<string, unknown> = {}
        for (const k of ['source_path', 'mask_path', 'audio_path', 'audio2_path', 'video_path', 'last_image_path', 'shot_type'] as const) {
          if (params[k] !== undefined) quoteFields[k] = params[k]
        }
        const quote = await studioQuote(studioModel, s.prompt, {
          op: 'studio',
          studio_options: studioOptionsFiltered ?? {},
          ...quoteFields,
        })
        // Review A kleiner Punkt 1 (Runde 3, 20.09.2026): the cap is the
        // SERVER's confirmed number, not the number the customer actually
        // saw before pressing Create. That protects LU (never books more
        // than the provider confirms) but not the customer (a quote that
        // came back higher than the shown price would still book, silently,
        // just like the bug this whole mechanism exists to close). Compare
        // against `s.cloudStudioCredits`, the same value CreditsMeter/the
        // Composer meter rendered at the moment this run started: a HIGHER
        // confirmed number is treated exactly like a 409 quote_changed (new
        // price shown, a second click required, nothing booked this time). A
        // LOWER or equal confirmed number books directly, same as before,
        // since the customer never sees a bill bigger than what was shown.
        // `cloudStudioCredits` can be null in the narrow race before the
        // meter's first paint; nothing to compare against there, so that
        // case books as before rather than blocking on nothing.
        if (s.cloudStudioCredits !== null && quote.credits > s.cloudStudioCredits) {
          throw new StudioQuoteChangedError(
            'The price changed. Review the new quote before starting.',
            quote.credits,
            quote.seconds,
          )
        }
        params.max_credits = quote.credits
      }

      // Der Titel geht mit an den Server, sonst hiesse der Eintrag nach dem
      // naechsten Laden wieder nur nach seiner Gattung (Portplan Abschnitt 1,
      // Punkt 9). A Studio run with no prompt (or a schema whose prompt field
      // is something else entirely, e.g. a picked visual style) needs the
      // SAME fallback name classic ops already have via OP_GALLERY_LABEL;
      // galleryLabel.ts also falls back to modelLabel(model), which reads
      // STUDIO_MODELS too, so this is a convenience for the server's own
      // list view (GET /api/jobs), not the only source of the gallery name.
      let label: string | undefined
      if (studioModel) {
        label = s.prompt.trim() ? undefined : modelLabel(studioModel)
        if (label) params.label = label
      } else if (OP_GALLERY_LABEL[op]) {
        label = OP_GALLERY_LABEL[op]
        params.label = label
      }

      s.setProgress(10, 'Submitting to the render queue…')
      const { id } = await submitCloudJob({ kind, model, prompt: s.prompt, params })
      // A Cancel during the submit round-trip saw activeJobId still null, so
      // nothing was cancelled server-side. Now that the id exists, cancel the
      // just-queued job so its claimed credits refund instead of orphaning a
      // render we're no longer watching.
      if (ac.signal.aborted) {
        cancelJob(id).then(() => onQuotaChange?.()).catch(() => {})
        return
      }
      activeJobId = id
      onQuotaChange?.()
      if (s.prompt.trim()) s.addToPromptHistory(s.prompt.trim())

      const startedAt = Date.now()
      // Video renders and character training routinely run several minutes
      // and can queue behind other jobs on the shared fleet — give them a
      // much longer client deadline than images.
      const verb = opProgressVerb(op)
      const job = await pollJob(id, {
        timeoutMs: kind === 'video' || op === 'lora-train' ? 45 * 60_000 : 15 * 60_000,
        signal: ac.signal,
        onTick: (j) => {
          const st = useCreateStore.getState()
          const elapsed = Math.round((Date.now() - startedAt) / 1000)
          if (j.status === 'queued') {
            st.setProgressPhase('queued')
            st.setProgress(15, `Waiting for a cloud GPU… ${elapsed}s`)
          } else if (j.status === 'running') {
            st.setProgressPhase('sampling')
            st.setProgress(Math.min(90, 20 + elapsed), `${verb} ${elapsed}s`)
          }
        },
      })

      const st = useCreateStore.getState()
      if (job.status === 'succeeded' && op === 'lora-train') {
        // Training output is a LoRA on the user's shelf, not a media item —
        // flip Character-Studio to the use-surface with a fresh shelf.
        st.setProgressPhase('complete')
        st.setProgress(100, 'Character trained!')
        st.clearTrainImages()
        st.setCharacterTab('use')
        st.bumpCharactersVersion()
      } else if (job.status === 'succeeded' && job.result_url) {
        st.setProgressPhase('complete')
        st.setProgress(100, 'Complete!')
        st.addToGallery({
          ...galleryItemFromJob(job),
          prompt: OP_GALLERY_LABEL[op] ?? s.prompt,
          label,
          negativePrompt: s.negativePrompt,
          seed: runSeed,
          steps: s.steps,
          cfgScale: s.cfgScale,
          sampler: s.sampler,
          scheduler: s.scheduler,
          width: s.width,
          height: s.height,
          intent,
        })
      } else if (job.status === 'canceled') {
        st.setError(null)
      } else {
        st.setError(job.error ?? 'Cloud render failed.')
        onQuotaChange?.() // failure refunds — refresh the meter
      }
    } catch (err) {
      const st = useCreateStore.getState()
      if (err instanceof QuoteChangedError || err instanceof StudioQuoteChangedError) {
        // 409 quote_changed (Portplan Abschnitt 3/4, review A1/B3 Runde 2):
        // the confirmed number went stale between the pre-submit
        // studioQuote() call above and the server's own booking check
        // (QuoteChangedError), or the quote call itself came back stale
        // (StudioQuoteChangedError, e.g. the provider's price moved between
        // two calls, or the shown-price guard right above this catch block
        // rejected a quote higher than what the customer saw). Either way:
        // show the NEW price and stop, never silently rebook against it.
        //
        // Review B6 (Runde 4, 20.09.2026): this used to only setError, never
        // touching cloudStudioCredits, the ONE value the shown-price guard
        // compares the next quote against (Composer.tsx's meter is the only
        // writer otherwise, and nothing re-primes it unless the price key
        // itself changes). Without this line a rejected run stayed rejected
        // forever: click again, same stale low number, same rejection, on
        // and on, even though the error text promised "hit Create again"
        // would work. Setting it here means the SECOND click compares the
        // new quote against the number this message just showed, and books.
        st.setCloudStudioCredits(err.credits)
        st.setError(`The price changed to ${err.credits.toLocaleString('en-US')} credits. Review it, then hit Create again.`)
      } else if (err instanceof CloudJobError && err.status === 429) {
        st.setError(throttleMessage(err))
      } else if (err instanceof CloudJobError && err.status === 401) {
        st.setError('Sign in to your LU Cloud account to render in the cloud.')
      } else if (err instanceof CloudJobError && err.message === 'render timed out') {
        // The desktop app has no jobs-history view — point at the account
        // page instead of promising an in-app surface that doesn't exist.
        st.setError('Still rendering, this is taking longer than expected. When it completes you can view it in your account at lu-labs.ai.')
      } else if (!(err instanceof CloudJobError && err.message === 'polling aborted')) {
        st.setError(err instanceof Error ? err.message : String(err))
      }
      onQuotaChange?.()
    } finally {
      activeJobId = null
      activeAbort = null
      const st = useCreateStore.getState()
      st.setIsGenerating(false)
      st.setProgress(0)
    }
  }, [onQuotaChange])

  const cancel = useCallback(async () => {
    const id = activeJobId
    activeAbort?.abort() // stop polling immediately either way
    if (!id) return
    try {
      await cancelJob(id)
      onQuotaChange?.() // queued-cancel refunds
    } catch {
      // 409 (already running/finished) — poll stop is all the client can do
    }
  }, [onQuotaChange])

  // Talking-character voice maker (qwen3-tts speak/design): a small tts run
  // whose result lands as an audio gallery item AND as the lipsync voice pick
  // (voiceFromJob → audio_url at submit, no client-side byte shuffling).
  const makeVoice = useCallback(
    async (opts: { text: string; mode: 'speak' | 'design'; voice?: string; description?: string }) => {
      const s = useCreateStore.getState()
      if (s.isGenerating) return
      const text = opts.text.trim()
      if (!text) {
        s.setError('Type what the character should say.')
        return
      }
      const voiceVerdict = clientSafety(`${text} ${opts.description ?? ''}`)
      if (voiceVerdict.blocked) {
        s.setError(blockMessageFor(voiceVerdict.reason))
        return
      }
      s.setError(null)
      s.setIsGenerating(true)
      s.setProgressPhase('queued')
      s.setProgress(10, 'Submitting to the render queue…')
      const ac = new AbortController()
      activeAbort = ac
      try {
        const model = opts.mode === 'design' ? 'qwen3-tts-design' : 'qwen3-tts'
        const params: CloudJobParams = { op: 'tts', client_request_id: crypto.randomUUID() }
        if (opts.mode === 'speak' && opts.voice) params.voice = opts.voice
        if (opts.mode === 'design' && opts.description) params.voice_description = opts.description
        const { id } = await submitCloudJob({ kind: 'audio', model, prompt: text, params })
        if (ac.signal.aborted) {
          cancelJob(id).then(() => onQuotaChange?.()).catch(() => {})
          return
        }
        activeJobId = id
        onQuotaChange?.()

        const startedAt = Date.now()
        const job = await pollJob(id, {
          timeoutMs: 15 * 60_000,
          signal: ac.signal,
          onTick: (j) => {
            const st = useCreateStore.getState()
            const elapsed = Math.round((Date.now() - startedAt) / 1000)
            if (j.status === 'running') {
              st.setProgressPhase('sampling')
              st.setProgress(Math.min(90, 20 + elapsed), `Generating the voice… ${elapsed}s`)
            }
          },
        })

        const st = useCreateStore.getState()
        if (job.status === 'succeeded' && job.result_url) {
          st.setProgressPhase('complete')
          st.setProgress(100, 'Voice ready!')
          const label = text.length > 40 ? `${text.slice(0, 40)}…` : text
          st.addToGallery({
            ...galleryItemFromJob(job),
            prompt: text,
            intent: 'lipsync',
          })
          st.setVoiceFromJob({ jobId: job.id, label })
        } else if (job.status !== 'canceled') {
          st.setError(job.error ?? 'Voice generation failed.')
          onQuotaChange?.()
        }
      } catch (err) {
        const st = useCreateStore.getState()
        if (err instanceof CloudJobError && err.status === 429) {
          st.setError(throttleMessage(err))
        } else if (!(err instanceof CloudJobError && err.message === 'polling aborted')) {
          st.setError(err instanceof Error ? err.message : String(err))
        }
        onQuotaChange?.()
      } finally {
        activeJobId = null
        activeAbort = null
        const st = useCreateStore.getState()
        st.setIsGenerating(false)
        st.setProgress(0)
      }
    },
    [onQuotaChange],
  )

  // Video super-resolution on a finished cloud render ("Enhance" in the
  // Lightbox). Re-signs the item's result URL, submits a video:upscale job
  // against the user's own storage clip, polls, and lands the enhanced clip
  // as a new gallery item. Runs through the same isGenerating choreography.
  const enhanceVideo = useCallback(
    async (item: GalleryItem, targetResolution: '720p' | '1080p' = '1080p') => {
      const s = useCreateStore.getState()
      if (s.isGenerating || !item.jobId) return
      s.setError(null)
      s.setIsGenerating(true)
      s.setProgressPhase('queued')
      s.setProgress(5, 'Fetching the source clip…')
      // Same pre-await arming as generate(): a Cancel during the re-sign
      // window must stop the run before the credit-claiming submit.
      const ac = new AbortController()
      activeAbort = ac
      try {
        // Fresh signed URL — the stored one expires ~1 h after the last read.
        const sourceJob = await getJob(item.jobId)
        if (!sourceJob.result_url) throw new Error('The source clip has expired, re-render it first.')

        if (ac.signal.aborted) return

        s.setProgress(10, 'Submitting to the render queue…')
        const { id } = await submitCloudJob({
          kind: 'video',
          model: item.model || 'wan-2.2-720p',
          prompt: '',
          params: {
            op: 'upscale', source_url: sourceJob.result_url, target_resolution: targetResolution,
            client_request_id: crypto.randomUUID(),
          },
        })
        // Same submit-window race as generate(): cancel the just-queued job
        // if the user aborted while the POST was in flight.
        if (ac.signal.aborted) {
          cancelJob(id).then(() => onQuotaChange?.()).catch(() => {})
          return
        }
        activeJobId = id
        onQuotaChange?.()

        const startedAt = Date.now()
        const job = await pollJob(id, {
          timeoutMs: 45 * 60_000,
          signal: ac.signal,
          onTick: (j) => {
            const st = useCreateStore.getState()
            const elapsed = Math.round((Date.now() - startedAt) / 1000)
            if (j.status === 'queued') {
              st.setProgressPhase('queued')
              st.setProgress(15, `Waiting for a cloud GPU… ${elapsed}s`)
            } else if (j.status === 'running') {
              st.setProgressPhase('sampling')
              st.setProgress(Math.min(90, 20 + elapsed), `Enhancing in the cloud… ${elapsed}s`)
            }
          },
        })

        const st = useCreateStore.getState()
        if (job.status === 'succeeded' && job.result_url) {
          st.setProgressPhase('complete')
          st.setProgress(100, 'Complete!')
          st.addToGallery({
            ...item,
            id: job.id,
            createdAt: Date.now(),
            remoteUrl: job.result_url,
            dataUrl: undefined,
            attestation: job.attestation,
            jobId: job.id,
          })
        } else if (job.status !== 'canceled') {
          st.setError(job.error ?? 'Cloud enhance failed.')
          onQuotaChange?.()
        }
      } catch (err) {
        const st = useCreateStore.getState()
        if (err instanceof CloudJobError && err.status === 429) {
          st.setError(throttleMessage(err))
        } else if (!(err instanceof CloudJobError && err.message === 'polling aborted')) {
          st.setError(err instanceof Error ? err.message : String(err))
        }
        onQuotaChange?.()
      } finally {
        activeJobId = null
        activeAbort = null
        const st = useCreateStore.getState()
        st.setIsGenerating(false)
        st.setProgress(0)
      }
    },
    [onQuotaChange],
  )

  return { generate, cancel, enhanceVideo, makeVoice }
}
