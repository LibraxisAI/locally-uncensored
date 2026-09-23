// Die Bruecke zwischen dem Create-Tab und der Studio-Registrierung.
//
// 19.09.2026, Entscheid von David: die neuen Endpunkte sollen nicht nur in den
// Presets waehlbar sein, sondern auch in den Unterkategorien von Create. Bis
// heute war der Studio-Pfad ausschliesslich im Preset-Fenster zu Hause, und
// keine der Unterkategorien konnte ein Studio-Modell fahren.
//
// Statt eine zweite Liste zu pflegen, bekommt jede spezialisierte Absicht die
// Rolle, die sie ohnehin schon meint. Damit sind Preset-Fenster und Create-Tab
// per Bauart dieselbe Menge, und der Vertragstest in preset-models.test.ts
// deckt beide Oberflaechen ab.

import type { CreateIntent } from '../../stores/createStore'
import { STUDIO_MODELS, studioBaseCredits, studioPreviewCredits } from './studio-contract'
import { presetModels, requiredRoleInputs, type PresetModel, type StepRole } from './preset-models'
import { catalogHasStudio, opPickerModels } from '../../stores/cloudCatalogStore'

// Desktop port (P2, checked again in P9): the web's CreateIntent already
// carries 'video_upscale' as a distinct intent from the plain 'upscale'
// (image upscale). The desktop's CreateIntent (in stores/createStore.ts,
// P5's file, merged) still has a single 'upscale' that serves BOTH image and
// video upscale via the older utility-op path. This is not a leftover type
// gap: components/create/experimental/intents.ts documents (comment at the
// 'upscale' intent, predates the Studio port) that a separate video-upscale
// intent is "a feature decision for David ... out of scope here": it needs
// a new IntentBar tile and Composer wiring, a UI feature addition, not an
// integration fold. StudioIntent stays as the local shim until that decision
// is made; the video_upscale role list below (STUDIO_MODELS entries
// video-upscaler, flashvsr, video-upscaler-pro, ultimate-video-upscaler,
// crystal-upscaler, flux-3-upscale) is correctly wired and tested, but
// reachable only by calling these functions directly with 'video_upscale',
// which no UI path does today.
export type StudioIntent = CreateIntent | 'video_upscale'

/** Die Rolle, die eine Create-Unterkategorie faehrt. Absichten ohne Eintrag
 *  (Bild, Video, Animate, Edit) haben ihre eigenen, aelteren Waehler. */
const INTENT_ROLE: Partial<Record<StudioIntent, StepRole[]>> = {
  // Ein Foto plus eine Stimme. Der Presenter braucht nicht einmal das Foto,
  // gehoert aber in dieselbe Zeile: der Kunde will hier jemanden sprechen sehen.
  lipsync: ['talking', 'presenter'],
  music: ['music'],
  extend: ['extend'],
  motion: ['motion'],
  video_upscale: ['upscale'],
}

export function intentRoles(intent: StudioIntent): StepRole[] {
  return INTENT_ROLE[intent] ?? []
}

/** Die Rolle, unter der ein bestimmtes Modell in dieser Absicht laeuft. */
export function intentRoleFor(intent: StudioIntent, model: string): StepRole | undefined {
  return intentRoles(intent).find((role) => presetModels(role).some((m) => m.id === model))
}

/** Alle Modelle, die diese Unterkategorie fahren koennen.
 *
 *  Die klassischen Mitglieder stehen zuerst: sie sind die, die der Kunde schon
 *  kennt, und ein Wechsel der Liste darf seine bisherige Wahl nicht verschieben.
 *  `lipsync` fuehrt zusaetzlich die beiden Nachvertonungsmodelle, die einen
 *  fertigen Clip statt eines Fotos lesen. Die sind kein Rollenmitglied, gehoeren
 *  in der Oberflaeche aber seit jeher hierher.
 *
 *  Review B1 (Runde 2, 20.09.2026): ein Studio-Mitglied (`m.op === 'studio'`)
 *  erscheint NUR, wenn der lebende Katalog `quote_required` fuehrt
 *  (catalogHasStudio(), cloudCatalogStore.ts). Ein aelterer Server (oder ein
 *  frischer Zustand vor der ersten Katalogabfrage) sagt damit selbst, dass er
 *  die Studio-Endpunkte nicht kennt, und diese EINE Stelle traegt die Regel
 *  fuer alle fuenf Aufrufer (Composer, CreditsMeter, CreateExperimental,
 *  ModelChip direkt, useCloudCreate ueber resolveIntentPick). Vorher wich
 *  jede Rolle auf ihr erstes STUDIO_MODELS-Mitglied aus, sobald der
 *  gespeicherte cloudOpModel nicht (mehr) in der Liste stand, und Extend/
 *  Motion liefen damit auf einem Server ohne Studio ins Leere
 *  (review-studio-B.md B1). Jede klassische Absicht (lipsync/music) faellt
 *  auf ihre klassischen Mitglieder zurueck, genau wie vor dem Port. */
export function intentPickerModels(intent: StudioIntent): PresetModel[] {
  const roles = intentRoles(intent)
  if (!roles.length) return []
  const out: PresetModel[] = []
  const seen = new Set<string>()
  const add = (m: PresetModel) => { if (!seen.has(m.id)) { seen.add(m.id); out.push(m) } }
  if (intent === 'lipsync') for (const m of opPickerModels('lipsync')) {
    add({ id: m.id, label: m.label, kind: m.kind, op: 'lipsync', adult: m.adult === true })
  }
  const studioLive = catalogHasStudio()
  for (const role of roles) for (const m of presetModels(role)) {
    if (m.op === 'studio' && !studioLive) continue
    add(m)
  }
  return out
}

/** Die Wahl, auf die diese Absicht wirklich laeuft.
 *
 *  Waehler und Absenden benutzen denselben Aufruf. Stuende die Regel zweimal
 *  da, zeigte der Waehler irgendwann ein anderes Modell an als das, was
 *  abgerechnet wird. */
export function resolveIntentPick(intent: StudioIntent, picked: string): string {
  const list = intentPickerModels(intent)
  if (!list.length) return picked
  return list.some((m) => m.id === picked) ? picked : list[0].id
}

export function isStudioModel(id: string): boolean {
  return !!STUDIO_MODELS[id]
}

/** Die Eingaben, ohne die dieses Modell nicht starten kann. */
export function intentRequiredInputs(intent: StudioIntent, model: string): string[] {
  const role = intentRoleFor(intent, model)
  return role ? requiredRoleInputs(role, model) : []
}

/** Der Preis eines Studio-Laufs fuer Zaehler und Startknopf im Create-Tab.
 *
 *  Endpunkte, die nach der gewuenschten Laenge abrechnen, stehen hier genau.
 *  Endpunkte, die die HOCHGELADENE Laenge abrechnen, bekommen die im Browser
 *  gemessene Laenge herein und stehen damit ebenfalls genau. Ohne Datei bleibt
 *  der Preis eines Laufs von fuenf Sekunden als Anhaltspunkt stehen. */
export function createStudioCost(
  model: string,
  options: Record<string, unknown>,
  promptLength = 100,
  seconds?: number,
): number {
  return studioPreviewCredits(model, options, seconds, 1, promptLength) ?? studioBaseCredits(model)
}

/** Haengt der Preis dieses Modells an der Laenge einer hochgeladenen Datei?
 *
 *  Nur solche Modelle brauchen eine Messung im Browser. Alle anderen kann der
 *  Anbieter sofort beziffern, weil nichts zu messen ist. */
export function pricesByInput(model: string): boolean {
  const mode = STUDIO_MODELS[model]?.price.mode
  return mode === 'input' || mode === 'both'
}
