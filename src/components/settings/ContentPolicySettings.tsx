import { useCallback, useEffect, useState } from 'react'
import { HINWEIS_TEXT } from '../../lib/hinweis'
import { getContentPolicy, setContentPolicy, type ContentPolicy } from '../../api/cloud/jobs'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'

const OPTIONS: { value: ContentPolicy; label: string; hint: string }[] = [
  { value: 'strict', label: 'Strict', hint: 'The tightest filter we have. Choose this if others use your screen.' },
  { value: 'soft', label: 'Standard', hint: 'The default for every account.' },
  { value: 'off', label: 'Off', hint: 'No filter beyond the legal limits below. Requires an age confirmation.' },
]

/**
 * Die Inhaltsrichtlinie des Kontos, hier und in der Webanwendung dieselbe.
 *
 * Der Server entscheidet. Diese Steuerung schickt einen Wunsch und zeigt, was
 * zurueckkommt; sie haelt keinen eigenen Zustand vor, den der Server nicht
 * kennt. Wer sie faelscht, faelscht eine Beschriftung, keinen Zugang: die
 * Auftragsroute liest die Datenbank bei jedem Auftrag neu.
 *
 * Die gesetzlichen Grenzen sind kein Teil der Wahl. Sie gelten bei jedem Wert.
 */
export function ContentPolicySettings() {
  const signedIn = useCloudAuthStore((s) => s.status === 'signed-in')
  const [policy, setPolicy] = useState<ContentPolicy>('soft')
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null)
  const [pending, setPending] = useState<ContentPolicy | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!signedIn) return
    let live = true
    getContentPolicy()
      .then((s) => { if (live) { setPolicy(s.policy); setConfirmedAt(s.ageConfirmedAt) } })
      .catch(() => { /* signed out or offline: the default stands */ })
    return () => { live = false }
  }, [signedIn])

  const save = useCallback(async (next: ContentPolicy, ageConfirmed: boolean) => {
    setBusy(true)
    setError('')
    try {
      const saved = await setContentPolicy(next, ageConfirmed)
      setPolicy(saved)
      setConfirmedAt(saved === 'off' ? new Date().toISOString() : null)
      setPending(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the setting.')
    } finally {
      setBusy(false)
    }
  }, [])

  if (!signedIn) {
    return (
      <p className="text-[0.6rem] text-gray-500 leading-relaxed" data-testid="content-policy-signed-out">
        Sign in to your LU Cloud account to change this setting.
      </p>
    )
  }

  return (
    <div className="space-y-2" data-testid="content-policy">
      <p className="text-[0.6rem] text-gray-500 leading-relaxed">
        Applies to images and video rendered in the cloud. Text is unaffected, and nothing on
        your own machine is.
      </p>

      {OPTIONS.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="lu-content-policy"
            className="mt-1"
            value={o.value}
            checked={policy === o.value}
            disabled={busy}
            onChange={() => { if (o.value === 'off') setPending('off'); else void save(o.value, false) }}
          />
          <span>
            <span className="text-[0.7rem] text-gray-700 dark:text-gray-300">{o.label}</span>
            <span className="block text-[0.6rem] text-gray-500 dark:text-gray-600 leading-snug">{o.hint}</span>
          </span>
        </label>
      ))}

      {pending === 'off' && (
        <div className="space-y-2 rounded-md border border-gray-200 dark:border-white/10 p-2" data-testid="age-gate">
          <p className="text-[0.6rem] text-gray-600 dark:text-gray-400">
            Confirm that you are 18 or older and that you are turning this off for yourself.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md bg-violet-500/15 px-3 py-1 text-[0.65rem] font-medium text-violet-500 dark:text-violet-300 hover:bg-violet-500/25 disabled:opacity-50"
              disabled={busy}
              onClick={() => void save('off', true)}
            >
              I am 18 or older
            </button>
            <button
              type="button"
              className="rounded-md border border-gray-200 dark:border-white/10 px-3 py-1 text-[0.65rem]"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {policy === 'off' && confirmedAt && (
        <p className="text-[0.6rem] text-gray-500">
          Age confirmed on {new Date(confirmedAt).toLocaleDateString()}. Switching to another
          option clears that confirmation.
        </p>
      )}

      {error && <p className={`text-[0.6rem] ${HINWEIS_TEXT.fehler}`} role="alert">{error}</p>}

      <p className="text-[0.6rem] text-gray-500 leading-relaxed">
        Material involving minors, and photographs of real people uploaded without their consent,
        are refused on every request whatever this is set to, and reported.
      </p>
    </div>
  )
}
