import { Unlock } from 'lucide-react'
import type { CloudModel } from '../../types/models'
import { FLASH_MARK_LABEL, flashMarkTitle, useFlashEntitlement } from '../../lib/flash-entitlement'

/**
 * Die Marken an einer Zeile der Modellauswahl.
 *
 * Beide kommen aus dem Server-Katalog und nie aus dem Modellnamen:
 * `unfiltered` ist gemessen, `flash` ist die Klasse, die keine Credits kostet.
 * Eine Marke beschreibt das Modell, sie erlaubt nichts. Was eine Anfrage
 * enthalten darf, entscheidet der Server bei jedem Aufruf neu.
 *
 * Nur `full` wird markiert. Ein Modell, das teilweise mitgeht, bekommt keine
 * Marke: eine Marke, die manchmal stimmt, ist im Kaufmoment schlimmer als
 * keine, weil der Kunde sie als Zusage liest.
 *
 * Die Freimengenmarke sagt etwas ueber das KONTO und nicht nur ueber das
 * Modell, also fragt die Zeile das Konto (lib/flash-entitlement, dieselbe
 * Regel, nach der der Chat-Vermittler abrechnet). Der Server liefert `flash`
 * an jedes Konto mit Cloud; ein Konto ohne bezahlten Plan zahlt fuer genau
 * diese Modelle und darf die Marke nicht sehen. Eine noch unbeantwortete
 * Abfrage verspricht nichts.
 */
export function ModelRowMarks({ model }: { model: { flash?: CloudModel['flash']; unfiltered?: CloudModel['unfiltered'] } }) {
  const paidPlan = useFlashEntitlement()
  const freeFlash = model.flash && paidPlan === true ? model.flash : undefined
  return (
    <>
      {model.unfiltered === 'full' && (
        // K12 (3.0.1): unbeantwortete Discord-Meldung, die Marke war nicht
        // auffindbar. Sie stand als reiner Fliesstext in derselben Groesse
        // wie jede andere Kleinschrift der Zeile, ohne Icon, ohne Gewicht,
        // im Sammelbild der Liste ging sie unter. Bleibt auf derselben
        // Stufe der Typo-Leiter (t-micro setzt NUR die Groesse, siehe
        // index.css), bekommt aber ein Icon und Fettung dazu, beides
        // Tailwind-Utilities, die t-micro nicht ueberschreibt.
        <span
          className="t-micro font-semibold text-purple-600 dark:text-purple-300 inline-flex items-center gap-0.5"
          title="Measured: this model answers without refusing. Your account's content policy still applies."
          data-mark="unfiltered"
        >
          <Unlock size={9} className="shrink-0" aria-hidden="true" />
          No refusals
        </span>
      )}
      {freeFlash && (
        <span
          className="t-micro text-emerald-600 dark:text-emerald-400"
          title={flashMarkTitle(freeFlash.dailyTokens)}
          data-mark="unlimited"
        >
          {FLASH_MARK_LABEL}
        </span>
      )}
    </>
  )
}
