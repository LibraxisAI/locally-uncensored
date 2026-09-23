import { useCreateStore } from '../../../stores/createStore'
import { useCreateExp } from './CreateContext'
import { intentToJob } from '../../../lib/render/cloud-jobs'
import { defaultCloudModel, resolveOpPick, runCredits } from '../../../stores/cloudCatalogStore'
import { createStudioCost, intentRoles, isStudioModel, resolveIntentPick } from '../../../lib/render/create-studio'
import { STUDIO_MODELS } from '../../../lib/render/studio-contract'
import { resolveCharacterModel } from '../../../hooks/useCloudCreate'
import { meterState } from '../../../lib/render/credits-meter'
import { Tooltip } from '../ui/Tooltip'
import { openExternal } from '../../../api/backend'
import { CLOUD_BASE } from '../../../api/cloud/config'
import { cn } from '../ui/cn'
import { HINWEIS_TEXT, PUNKT_FARBE } from '../../../lib/hinweis'

// Compact credits meter for the cloud backend: remaining vs monthly budget,
// plus the cost of the run the user is about to start. One shared pool, so
// images and clips draw from the same number. At 0 (or not enough for this
// run) it becomes the upsell chip and the Create button is gated off.
//
// Der Balken kennt zwei Zustaende, keinen dritten: er laeuft (gruen) oder er
// ist so gut wie leer (grau). Der knappe Kontostand war gelb und hat damit
// wie eine Stoerung ausgesehen, obwohl noch jeder Lauf durchgeht. Leer ist
// keine Farbe am Balken, sondern der rote Knopf darunter.
export function CreditsMeter() {
  const { quota } = useCreateExp()
  const intent = useCreateStore((s) => s.intent())
  const cloudImageModel = useCreateStore((s) => s.cloudImageModel)
  const cloudVideoModel = useCreateStore((s) => s.cloudVideoModel)
  const cloudOpModel = useCreateStore((s) => s.cloudOpModel)
  const characterTab = useCreateStore((s) => s.characterTab)
  const selectedCharacter = useCreateStore((s) => s.selectedCharacter)
  // Review A kleiner Punkt 1: this meter is cloud-only (Composer renders it
  // only for backend 'cloud'), so it must price the SAME length the cloud
  // Length control shows and useCloudCreate books, cloudFrames/cloudFps, not
  // the local track's frames/fps.
  const frames = useCreateStore((s) => s.cloudFrames)
  const fps = useCreateStore((s) => s.cloudFps)
  const musicDuration = useCreateStore((s) => s.musicDuration)
  const targetResolution = useCreateStore((s) => s.targetResolution)
  const cloudStudioOptions = useCreateStore((s) => s.cloudStudioOptions)
  const cloudStudioCredits = useCreateStore((s) => s.cloudStudioCredits)
  const prompt = useCreateStore((s) => s.prompt)
  if (!quota) return null
  // No character picked yet: there is no run to price (resolveCharacterModel
  // would fall onto the family's first model and show a number for a run
  // nobody asked for). uselu main 5be5dec3 fixed the same false reading.
  if (intent === 'character' && characterTab === 'use' && !selectedCharacter) return null

  let { kind, op } = intentToJob(intent)
  // Mirror Composer's creditsOk pick exactly — meter and gate must show the
  // same number: the character use-surface prices the family's real
  // generation endpoint (never a hardcoded single default), the role
  // intents (lipsync/music/extend/motion) run whichever Studio or classic
  // op-picker model is chosen, everything else prices the per-kind
  // picker's model.
  const characterUse = intent === 'character' && characterTab === 'use'
  if (characterUse) {
    kind = 'image'
    op = 'generate'
  }
  const special =
    op === 'lipsync' || op === 'extend' || op === 'motion' ||
    op === 'music' || op === 'tts' || op === 'lora-train'
  const roleIntent = !characterUse && intentRoles(intent).length > 0
  const rolePick = roleIntent ? resolveIntentPick(intent, cloudOpModel) : undefined
  const studioPick = rolePick && isStudioModel(rolePick) ? rolePick : undefined
  const picked = characterUse
    ? (resolveCharacterModel(selectedCharacter?.family ?? '', cloudOpModel) ?? '')
    : roleIntent
      ? (rolePick ?? '')
      : special
        ? resolveOpPick(op, cloudOpModel)
        : (kind === 'video' ? cloudVideoModel : cloudImageModel) || defaultCloudModel(kind)?.id || ''
  if (studioPick) kind = STUDIO_MODELS[studioPick].kind
  const seconds =
    op === 'music'
      ? musicDuration
      : kind === 'video' && (op === 'generate' || op === 'animate') && fps > 0
        ? frames / fps
        : undefined
  // A Studio model prices from its own provider schema, never runCredits()
  // (P3's guard there returns the caller's fallback on purpose, Portplan
  // Abschnitt 7, Risiko 1). The Composer fetches the live number once
  // (useStudioPrice) and leaves it here; this chip never asks twice for the
  // same figure.
  const cost = studioPick
    ? cloudStudioCredits ?? createStudioCost(studioPick, cloudStudioOptions, Array.from(prompt).length)
    : runCredits(kind, op, picked, seconds, quota.costs[kind === 'audio' ? 'image' : kind], targetResolution)
  const remaining = quota.remaining.credits
  const limit = quota.limits.credits
  const state = meterState(quota, cost, kind, op)
  // Every shortfall this chip can show is wallet-fixable now, trainings
  // included since a topup wallet can fund a run past the included count
  // (server migration 0047), so all three send the customer to the credits
  // tab, not to a plan change.
  //
  // Der Knopf traegt die Flaeche des Zaehlers daneben und den Fehlerton als
  // SCHRIFT. Vorher war er gelb gefuellt, also dieselbe Farbe, mit der ein
  // knapper Kontostand nur informiert hat. Kein Geld mehr zu haben ist kein
  // Zwischenton: es haelt den Lauf an. Regel in lib/hinweis.ts.
  const upsell = (label: string, tab?: 'credits') => (
    <button
      onClick={() => void openExternal(`${CLOUD_BASE}/pricing${tab ? '?tab=credits' : ''}`)}
      className={cn(
        't-control px-2 h-[var(--control-h-sm)] inline-flex items-center rounded-md',
        'bg-white/[0.04] hover:bg-white/[0.08] transition-colors',
        HINWEIS_TEXT.fehler,
      )}
    >
      {label}
    </button>
  )

  if (state.kind === 'insufficient') {
    return upsell(
      state.remaining <= 0
        ? 'Out of credits, top up'
        : `Needs ${state.cost} credits (${state.remaining} left)`,
      'credits',
    )
  }
  if (state.kind === 'no-trainings') return upsell('No included trainings left, top up', 'credits')
  if (state.kind === 'no-video-budget') return upsell('Video budget used up, top up', 'credits')

  const noun = op === 'lora-train' ? 'training' : kind === 'video' ? 'clip' : kind === 'audio' ? 'track' : 'image'
  const tail = state.runsLeft === null ? '' : `, about ${state.runsLeft} more like it`
  const videoTail =
    state.showVideoBudget && quota.video
      ? ` (monthly video budget: ${quota.video.remaining} of ${quota.video.limit} credits left)`
      : ''
  // B3 (review-a1.md): the chip beside this tooltip can already show more
  // runs than the included count once a topup wallet covers the run
  // (trainingPackRun in credits-meter.ts). Without this half-sentence the
  // tooltip named only the included count and read as a contradiction next
  // to the chip's own number.
  const topup = quota.topup?.credits ?? 0
  const trainingPackRun = op === 'lora-train' && cost > 0 && topup >= cost
  const trainingTail =
    op === 'lora-train' && quota.trainings
      ? ` (${quota.trainings.remaining} of ${quota.trainings.limit} included trainings left${trainingPackRun ? '; paid credits unlock more' : ''})`
      : ''

  return (
    <Tooltip
      content={`${remaining} of ${limit} credits left this billing period. This ${noun} uses ${cost}${tail}${videoTail}${trainingTail}.`}
    >
      <div className="flex items-center gap-1.5 px-2 h-[var(--control-h-sm)] rounded-md bg-white/[0.04] text-gray-400 t-control">
        <div className="w-12 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className={cn('h-full rounded-full', state.pct > 0.25 ? PUNKT_FARBE.an : PUNKT_FARBE.aus)}
            style={{ width: `${state.pct * 100}%` }}
          />
        </div>
        <span className="tabular-nums">{remaining}</span>
        {state.runsLeft !== null && (
          <>
            <span className="text-gray-600">·</span>
            <span className="tabular-nums whitespace-nowrap">≈{state.runsLeft} {state.unit}</span>
          </>
        )}
      </div>
    </Tooltip>
  )
}
