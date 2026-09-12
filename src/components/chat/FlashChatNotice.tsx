import { useEffect } from 'react'
import { useModelStore } from '../../stores/modelStore'
import { clearFlashNotices, useFlashBillingStore } from '../../lib/flash-ui'
import { FLASH_UNPAID_NOTICE, useFlashEntitlement } from '../../lib/flash-entitlement'

/**
 * Was eine Runde auf dem gewaehlten Modell dieses Konto kostet.
 *
 * Der stehende Satz beschreibt die Freimenge, und die hat nur ein bezahlter
 * Plan. Ein Starter-Konto zahlt fuer genau diese Modelle und liest deshalb
 * einen ehrlichen Satz statt der Zusage (T7 hat am 11.09.2026 das Gegenteil
 * gemessen: dieselbe Zusage wie beim Planbesitzer, und ein Credit war weg).
 *
 * Zwei Sorten Text leben hier und verhalten sich mit Absicht verschieden:
 *   - die Zeilen je Anfrage melden eine Antwort, die schon zurueck ist. Sie
 *     veralten, sobald diese Oberflaeche weg ist, also raeumen Fokus und Blur
 *     sie ab.
 *   - der stehende Satz darueber beschreibt das gewaehlte Modell und den Plan
 *     dieses Kontos. Das veraltet durch einen Blur nicht, er bleibt stehen.
 *     Seine Kontohaelfte kommt aus dem Kontospeicher, den `useCloudAuth` im
 *     Takt aus `/api/me` nachzieht.
 */
export function FlashChatNotice() {
  useEffect(() => {
    // Another tab can change the account while this surface is unfocused.
    window.addEventListener('blur', clearFlashNotices)
    window.addEventListener('focus', clearFlashNotices)
    return () => {
      window.removeEventListener('blur', clearFlashNotices)
      window.removeEventListener('focus', clearFlashNotices)
      clearFlashNotices()
    }
  }, [])
  const active = useModelStore((s) => s.models.find((m) => m.name === s.activeModel))
  const policy = active && 'flash' in active ? active.flash : undefined
  const notice = useFlashBillingStore((s) => policy ? s.entries[policy.billingKey] : undefined)
  const paidPlan = useFlashEntitlement()
  if (!policy) return null
  // Noch nicht beantwortet. Schweigen ist der einzige ehrliche Zustand: beide
  // Saetze darunter sind Aussagen ueber Geld.
  if (paidPlan === null) return null
  if (!paidPlan) {
    return (
      <div className="mb-2 text-xs text-gray-500" data-testid="flash-chat-notice">
        <p>{FLASH_UNPAID_NOTICE}</p>
      </div>
    )
  }
  return (
    <div className="mb-2 text-xs text-gray-500" data-testid="flash-chat-notice">
      <details>
        <summary className="cursor-pointer">Flash: {policy.dailyTokens.toLocaleString('en-US')} input and output tokens per UTC day without credits</summary>
        <p className="mt-1">
          One free request at a time per account. Resets at 00:00 UTC. API keys always use credits.
          A request that exceeds the remaining allowance uses credits instead.
          Without an explicit output limit, free requests allow up to {policy.defaultMaxOutput.toLocaleString('en-US')} output tokens.
          Each free request lasts at most {policy.requestSeconds} seconds.
          The request budget is reserved before generation. Failed or interrupted requests without final usage keep that reservation.
        </p>
      </details>
      {notice?.billing === 'credits' && (
        <p role="alert" className="mt-1 text-gray-700 dark:text-gray-200">
          {notice.ok ? 'This request uses credits instead of the free Flash allowance.' : 'This request requires credits. No generation started.'}
          {' '}Its token budget exceeds the available allowance.
        </p>
      )}
      {notice?.billing === 'flash' && (
        <p role="status" className="mt-1">
          Free Flash request. Remaining after reservation: {notice.remaining.toLocaleString('en-US')} tokens.
        </p>
      )}
    </div>
  )
}
