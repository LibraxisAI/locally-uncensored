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
import { presetModels, requiredRoleInputs, roleInputs, type PresetModel, type StepRole } from './preset-models'
import { opPickerModels } from '../../stores/cloudCatalogStore'

// Desktop port (P2): the web's CreateIntent already carries 'video_upscale'
// as a distinct intent from the plain 'upscale' (image upscale). The
// desktop's CreateIntent (in stores/createStore.ts, P5's file) has a single
// 'upscale' that serves BOTH image and video upscale today via the older
// utility-op path; splitting it into its own value is a store/Composer
// decision (P5/P7), not this package's. StudioIntent stands in locally so
// tsc stays green without touching createStore.ts. P9: once P5/P7 decide how
// video upscale reaches the Composer (new CloudOp, or a kind check on
// 'upscale'), fold this back into CreateIntent and drop the shim below.
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
 *  in der Oberflaeche aber seit jeher hierher. */
export function intentPickerModels(intent: StudioIntent): PresetModel[] {
  const roles = intentRoles(intent)
  if (!roles.length) return []
  const out: PresetModel[] = []
  const seen = new Set<string>()
  const add = (m: PresetModel) => { if (!seen.has(m.id)) { seen.add(m.id); out.push(m) } }
  if (intent === 'lipsync') for (const m of opPickerModels('lipsync')) {
    add({ id: m.id, label: m.label, kind: m.kind, op: 'lipsync', adult: m.adult === true })
  }
  for (const role of roles) for (const m of presetModels(role)) add(m)
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

/** Was dieses Modell in dieser Absicht an Eingaben liest, als Anbieterfeld ->
 *  Job-Parameter. */
export function intentInputs(intent: StudioIntent, model: string): Record<string, string> {
  const role = intentRoleFor(intent, model)
  return role ? roleInputs(role, model) : {}
}

/** Die Eingaben, ohne die dieses Modell nicht starten kann. */
export function intentRequiredInputs(intent: StudioIntent, model: string): string[] {
  const role = intentRoleFor(intent, model)
  return role ? requiredRoleInputs(role, model) : []
}

/** Der Preis eines Studio-Laufs fuer die Anzeige. `null`, wenn die Optionen
 *  noch nicht vollstaendig sind: dann steht im Zaehler nichts statt einer
 *  erfundenen Zahl. */
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

export function studioDisplayCredits(
  model: string,
  options: Record<string, unknown>,
  seconds?: number,
  imageCount = 1,
  promptLength = 100,
): number | null {
  return studioPreviewCredits(model, options, seconds, imageCount, promptLength)
}
