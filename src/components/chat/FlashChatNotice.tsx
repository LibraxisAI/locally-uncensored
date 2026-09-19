import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useModelStore } from '../../stores/modelStore'
import { clearFlashNotices, useFlashBillingStore } from '../../lib/flash-ui'
import { FLASH_UNPAID_NOTICE, useFlashEntitlement } from '../../lib/flash-entitlement'
import { useDismissOnEscape } from '../../hooks/useDismissOnEscape'

/**
 * Was eine Runde auf dem gewaehlten Modell dieses Konto kostet, als kleiner
 * Hinweis in der Sitzungsleiste statt als stehendes Band ueber der Eingabe.
 *
 * David, 19.09.2026: das alte Band stand dauerhaft ueber dem Eingabefeld, sah
 * schlecht aus und schob den Agent-Schalter, die Kontextanzeige und Memories
 * nach oben. Der Hinweis ist jetzt ein einzeiliges Etikett neben dem
 * Agent-Schalter, das ein Popup oeffnet statt Platz zu beanspruchen. Bauart
 * wortgleich mit `SamplingControls`, dem Haus-Muster fuer genau dieses Popup
 * (Trigger oeffnet, Escape/X/Aussenklick schliessen, Fokus geht rein und
 * zurueck), damit nicht ein zweites Muster fuer dasselbe Verhalten entsteht.
 *
 * Zwei Sorten Text leben hier und verhalten sich mit Absicht verschieden:
 *   - die Zeilen je Anfrage melden eine Antwort, die schon zurueck ist. Sie
 *     veralten, sobald diese Oberflaeche weg ist, also raeumen Fokus und Blur
 *     sie ab.
 *   - der stehende Satz darueber beschreibt das gewaehlte Modell und den Plan
 *     dieses Kontos. Das veraltet durch einen Blur nicht, er bleibt stehen.
 *     Seine Kontohaelfte kommt aus dem Kontospeicher, den `useCloudAuth` im
 *     Takt aus `/api/me` nachzieht.
 *
 * Das Etikett selbst traegt die Farbe: GRUEN nur, wenn diese Runde wirklich
 * keine Credits kostet (bezahlter Plan, Freimenge nicht aufgebraucht). Faellt
 * die Anfrage auf Credits zurueck (Freimenge aufgebraucht) oder zahlt das
 * Konto ohnehin fuer dieses Modell (kein bezahlter Plan), steht an derselben
 * Stelle derselbe neutrale Text, nie Gruen: eine falsche Zusage waere hier
 * schlimmer als keine.
 */

const FOCUSABLE = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Panel width, matching the sampling popup's own fixed width. */
const PANEL_WIDTH = 260

/** The close button's accessible name, mirrored in the web app. */
export const FLASH_NOTICE_CLOSE_LABEL = 'Close Flash usage details'

/** What the popup is called for a screen reader, mirrored in the web app. */
export const FLASH_NOTICE_DIALOG_LABEL = 'Flash usage'

/** The trigger's own label per state, mirrored in the web app. */
export const FLASH_NOTICE_LABEL_FREE = 'Using no credits'
export const FLASH_NOTICE_LABEL_CREDITS = 'Using credits'

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

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const active = useModelStore((s) => s.models.find((m) => m.name === s.activeModel))
  const policy = active && 'flash' in active ? active.flash : undefined
  const notice = useFlashBillingStore((s) => (policy ? s.entries[policy.billingKey] : undefined))
  const paidPlan = useFlashEntitlement()

  // Give the keyboard back to the trigger, but only while it is still in the
  // popup: on an outside press the browser is already moving it somewhere the
  // user chose. Same rule as SamplingControls.close.
  const close = useCallback(() => {
    const panel = panelRef.current
    if (panel && panel.contains(document.activeElement)) {
      wrapRef.current?.querySelector('button')?.focus()
    }
    setOpen(false)
  }, [])
  useDismissOnEscape(open, close)

  useEffect(() => {
    if (!open) return
    const aus = (e: Event) => {
      const target = e.target as Node | null
      if (!target) return
      if (wrapRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('pointerdown', aus)
    return () => document.removeEventListener('pointerdown', aus)
  }, [open, close])

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [open])

  if (!policy) return null
  // Noch nicht beantwortet. Schweigen ist der einzige ehrliche Zustand: beide
  // Saetze im Popup sind Aussagen ueber Geld.
  if (paidPlan === null) return null

  // Gruen ist nur wahr, solange diese Runde wirklich nichts kostet: ein
  // bezahlter Plan UND keine bereits gemeldete Rueckkehr auf Credits.
  const usesCredits = !paidPlan || notice?.billing === 'credits'
  const label = usesCredits ? FLASH_NOTICE_LABEL_CREDITS : FLASH_NOTICE_LABEL_FREE

  return (
    <div className="relative shrink-0" ref={wrapRef} data-testid="flash-chat-notice">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="flash-chat-notice-trigger"
        title="Flash usage for this chat"
        className={
          usesCredits
            ? 't-micro whitespace-nowrap text-gray-500 hover:text-gray-300 transition-colors'
            : 't-micro whitespace-nowrap text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors'
        }
        onClick={() => setOpen(true)}
      >
        {label}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={FLASH_NOTICE_DIALOG_LABEL}
          data-testid="flash-chat-notice-panel"
          // Out of flow, exactly like SamplingControls: the row it hangs off
          // keeps its size and position to the pixel, whatever this says.
          style={{
            position: 'absolute',
            left: 0,
            top: '100%',
            marginTop: 6,
            width: PANEL_WIDTH,
          }}
          className="z-50 space-y-1.5 rounded-lg p-2.5 lu-elevated text-xs text-gray-500"
        >
          <div className="flex justify-end">
            <button
              type="button"
              aria-label={FLASH_NOTICE_CLOSE_LABEL}
              title={FLASH_NOTICE_CLOSE_LABEL}
              data-testid="flash-chat-notice-close"
              className="rounded p-0.5 text-gray-500 hover:text-gray-300"
              onClick={close}
            >
              <X size={11} />
            </button>
          </div>

          {!paidPlan ? (
            <p>{FLASH_UNPAID_NOTICE}</p>
          ) : (
            <>
              <p>
                Flash: {policy.dailyTokens.toLocaleString('en-US')} input and output tokens per UTC day without credits.
                Resets at 00:00 UTC.
              </p>
              <p>
                One free request at a time per account. API keys always use credits.
                A request that exceeds the remaining allowance uses credits instead.
                Without an explicit output limit, free requests allow up to {policy.defaultMaxOutput.toLocaleString('en-US')} output tokens.
                Each free request lasts at most {policy.requestSeconds} seconds.
                The request budget is reserved before generation. Failed or interrupted requests without final usage keep that reservation.
              </p>
              {notice?.billing === 'credits' && (
                <p role="alert" className="text-gray-700 dark:text-gray-200">
                  {notice.ok ? 'This request uses credits instead of the free Flash allowance.' : 'This request requires credits. No generation started.'}
                  {' '}Its token budget exceeds the available allowance.
                </p>
              )}
              {notice?.billing === 'flash' && (
                <p role="status">
                  Free Flash request. Remaining after reservation: {notice.remaining.toLocaleString('en-US')} tokens.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
