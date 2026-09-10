import type { CloudModel } from '../../types/models'

/**
 * Die Marken an einer Zeile der Modellauswahl.
 *
 * Wortgleich mit dem Bauteil derselben Aufgabe in der Webanwendung. Beide
 * Marken kommen aus dem Server-Katalog und nie aus dem Modellnamen:
 * `unfiltered` ist gemessen, `flash` ist die Klasse, die keine Credits kostet.
 * Eine Marke beschreibt das Modell, sie erlaubt nichts. Was eine Anfrage
 * enthalten darf, entscheidet der Server bei jedem Aufruf neu.
 *
 * Nur `full` wird markiert. Ein Modell, das teilweise mitgeht, bekommt keine
 * Marke: eine Marke, die manchmal stimmt, ist im Kaufmoment schlimmer als
 * keine, weil der Kunde sie als Zusage liest.
 */
export function ModelRowMarks({ model }: { model: { flash?: CloudModel['flash']; unfiltered?: CloudModel['unfiltered'] } }) {
  return (
    <>
      {model.unfiltered === 'full' && (
        <span
          className="t-micro text-purple-600 dark:text-purple-300"
          title="Measured: this model answers without refusing. Your account's content policy still applies."
          data-mark="unfiltered"
        >
          No refusals
        </span>
      )}
      {model.flash && (
        <span
          className="t-micro text-emerald-600 dark:text-emerald-400"
          title={`No credits, up to ${model.flash.dailyTokens.toLocaleString('en-US')} tokens per day on a paid plan. Chat only, one request at a time.`}
          data-mark="unlimited"
        >
          No credits
        </span>
      )}
    </>
  )
}
