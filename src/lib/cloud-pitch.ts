/**
 * Was der Wolkenschalter dem Nutzer verspricht, in Zahlen.
 *
 * Bis 3.0.0 war der Schalter ein Schalter ohne Argument: er sagte, dass etwas
 * umgestellt wird, nie, was man dafuer bekommt. Die drei Zeilen unten sind das
 * Argument, in der Reihenfolge, in der es zaehlt: erst was die Modelle duerfen,
 * dann was nichts kostet, dann was die eigene Maschine nicht kann.
 *
 * ## Warum die Zahlen hier fest stehen
 *
 * Der Katalog liegt im Web-Repo. Diese Oberflaeche zeigt die Zahlen, BEVOR
 * jemand angemeldet ist, also bevor es einen Katalog zu lesen gibt. Sie stehen
 * deshalb hier, und `scripts/check-cloud-sales.mjs` haelt jede einzelne gegen
 * ihre Quelle im Web-Repo. Wer eine Zahl aendert, ohne die andere Seite zu
 * aendern, faellt dort auf.
 *
 * Nichts hier ist eine Zusage fuer den Einzelfall. "Ohne Ablehnung" ist eine
 * MESSUNG vom 10.09.2026, kein Vertrag, und was eine Anfrage enthalten darf,
 * entscheidet der Server bei jedem Aufruf neu.
 */

export interface CloudPitchNumbers {
  /** Chatmodelle im Katalog. */
  chatModels: number
  /** Davon im Messlauf vom 10.09.2026 dabei. V4.1 Flash kam am selben Tag
   *  nach dem Lauf in den Katalog und traegt bis zur Messung keine Marke. */
  measuredChatModels: number
  /** Davon gemessen ohne Ablehnung. */
  unfilteredChatModels: number
  /** Modelle der Flash-Klasse, die im Chat keine Credits kosten. */
  flashModels: number
  /** Taegliche Obergrenze der Flash-Klasse, Ein- und Ausgabe zusammen. */
  flashDailyTokens: number
  /** Bildmodelle. */
  imageModels: number
  /** Videomodelle. */
  videoModels: number
}

export const CLOUD_PITCH: CloudPitchNumbers = {
  chatModels: 47,
  measuredChatModels: 46,
  unfilteredChatModels: 27,
  flashModels: 12,
  flashDailyTokens: 500_000,
  imageModels: 10,
  videoModels: 11,
}

const n = (v: number) => v.toLocaleString('en-US')

/**
 * Die drei Zeilen, in fester Reihenfolge.
 *
 * Die Reihenfolge ist Absicht und kein Layoutdetail: das Alleinstellungsmerkmal
 * steht zuerst, der Preis danach, die Ausstattung zuletzt. Wer mit der
 * Ausstattung anfaengt, klingt wie jeder andere Anbieter.
 */
export function cloudPitchLines(p: CloudPitchNumbers = CLOUD_PITCH): string[] {
  return [
    `${p.unfilteredChatModels} of the ${p.measuredChatModels} chat models we measured answer without refusing. Measured, not guessed, and marked in the picker.`,
    `${p.flashModels} of them cost no credits at all in chat, up to ${n(p.flashDailyTokens)} tokens a day on a paid plan.`,
    `${p.chatModels} chat, ${p.imageModels} image and ${p.videoModels} video models on our GPUs, including the ones your own machine cannot run.`,
  ]
}
