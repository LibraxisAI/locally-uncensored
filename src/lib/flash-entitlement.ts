import { useCloudAuthStore } from '../stores/cloudAuthStore'

/**
 * Das Etikett der Freimengenmarke, an genau einer Stelle.
 *
 * "No credits" las sich als Eigenschaft des Modells. Sie ist eine Eigenschaft
 * des Kontos: dieselben Modelle kosten ein Konto ohne bezahlten Plan Credits.
 * "Included" sagt, was gemeint ist, und steht hier, damit ein Wortwechsel eine
 * Zeile bleibt und nicht drei Stellen im JSX sucht.
 */
export const FLASH_MARK_LABEL = 'Included'

/** Der Satz, den ein Konto ohne bezahlten Plan liest. Wortgleich mit dem Web. */
export const FLASH_UNPAID_NOTICE = 'Flash models are free on a paid plan. This account uses credits.'

/**
 * Bekommt DIESES Konto die Freimenge?
 *
 * Die Regel ist `accountPlanPays`, und die Tatsache, die sie braucht, ob je
 * Geld angekommen ist, liegt in der Datenbank. Die Antwort wird deshalb geholt
 * und nicht im Klienten nachgerechnet: `/api/me` fuehrt genau die Funktion aus,
 * die der Chat-Vermittler vor dem Abrechnen einer Runde fuehrt. Eine Regel,
 * eine Antwort, damit eine Marke auf dem Schirm nicht verspricht, was die
 * Rechnung danach widerlegt.
 *
 * `null` heisst "noch nicht beantwortet", und jede Oberflaeche liest das als
 * "verspricht nichts", nie als Ja. Der Desktop fragt die Route ohnehin im
 * Takt ab (`hooks/useCloudAuth`), der Wert steht deshalb im Kontospeicher und
 * braucht keine zweite Abfrage.
 */
export function useFlashEntitlement(): boolean | null {
  return useCloudAuthStore((s) => s.paidPlan)
}
