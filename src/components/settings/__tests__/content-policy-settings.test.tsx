// @vitest-environment jsdom
/**
 * Die Inhaltsrichtlinie im Desktop: dieselbe Route, dieselbe Alterssperre,
 * derselbe Wortlaut wie in der Webanwendung.
 *
 * Der Posten ist Mechanik. Es wird nichts erzeugt und nichts bewertet,
 * geprueft werden Anfrage, Sperre und Beschriftung.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  get: vi.fn(async (): Promise<{ policy: 'strict' | 'soft' | 'off'; ageConfirmedAt: string | null }> =>
    ({ policy: 'soft', ageConfirmedAt: null })),
  set: vi.fn(async (p: string) => p),
}))
vi.mock('../../../api/cloud/jobs', () => ({
  getContentPolicy: api.get,
  setContentPolicy: api.set,
}))

import { ContentPolicySettings } from '../ContentPolicySettings'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'

const signIn = () => useCloudAuthStore.setState({ status: 'signed-in' })

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  // mockReset, nicht nur clearAllMocks: das leert auch die Warteschlange der
  // mockResolvedValueOnce. Ohne das erbt ein Fall die uebrig gebliebene
  // Einmalantwort des vorigen und misst etwas anderes, als er behauptet.
  api.get.mockReset()
  api.set.mockReset()
  api.get.mockResolvedValue({ policy: 'soft', ageConfirmedAt: null })
  api.set.mockImplementation(async (p: string) => p)
  signIn()
})

describe('ContentPolicySettings', () => {
  it('asks the server instead of keeping its own copy', async () => {
    api.get.mockResolvedValue({ policy: 'strict', ageConfirmedAt: null })
    render(<ContentPolicySettings />)
    await waitFor(() => expect((screen.getByDisplayValue('strict') as HTMLInputElement).checked).toBe(true))
  })

  it('says what to do instead of showing a dead control while signed out', () => {
    useCloudAuthStore.setState({ status: 'signed-out' })
    render(<ContentPolicySettings />)
    expect(screen.getByTestId('content-policy-signed-out')).toBeTruthy()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('never sends off without an age confirmation in the same request', async () => {
    render(<ContentPolicySettings />)
    fireEvent.click(screen.getByDisplayValue('off'))
    expect(api.set).not.toHaveBeenCalled()
    expect(screen.getByTestId('age-gate')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'I am 18 or older' }))
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('off', true))
  })

  it('lets the gate be cancelled without changing anything', () => {
    render(<ContentPolicySettings />)
    fireEvent.click(screen.getByDisplayValue('off'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('age-gate')).toBeNull()
    expect(api.set).not.toHaveBeenCalled()
  })

  it('sends the two harmless values straight through', async () => {
    render(<ContentPolicySettings />)
    fireEvent.click(screen.getByDisplayValue('strict'))
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('strict', false))
  })

  it('uses no adult vocabulary and states the floor that no setting moves', () => {
    render(<ContentPolicySettings />)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/adult|nsfw|nude|nudity|porn|hardcore|explicit|uncensored/i)
    expect(text).toMatch(/minors/i)
    expect(text).toMatch(/consent/i)
  })

  it('says plainly that the local machine is not affected', () => {
    render(<ContentPolicySettings />)
    expect(document.body.textContent ?? '').toMatch(/nothing on\s+your own machine is/i)
  })

  /**
   * R5-7: dieselbe Bedienung, zwei Verben. Der Desktop sagte "Choosing another
   * option", das Web "Switching to another option". Beide Saetze stehen vor
   * demselben Kunden, und Paritaet ist Hausregel, wo dasselbe Feature existiert.
   *
   * Der Wortlaut steht hier ausgeschrieben und nicht aus dem Web-Baum gelesen:
   * ein Checkout ohne das Nachbar-Repo wuerde sonst entweder fehlschlagen oder,
   * schlimmer, still gruen melden. Quelle des Satzes:
   * `apps/web/components/settings/ContentPolicySettings.tsx:135-136`.
   */
  const WEB_SATZ = 'Switching to another option clears that confirmation.'

  it('nennt die Altersbestaetigung mit dem Verb des Web', async () => {
    api.get.mockResolvedValue({ policy: 'off', ageConfirmedAt: '2026-09-10T08:00:00.000Z' })
    render(<ContentPolicySettings />)
    await waitFor(() => {
      const text = (document.body.textContent ?? '').replace(/\s+/g, ' ')
      expect(text).toContain(WEB_SATZ)
      expect(text).toContain('Age confirmed on ')
    })
    // Negativkontrolle: das alte Verb darf nirgends mehr stehen.
    expect(document.body.textContent ?? '').not.toMatch(/Choosing another option/)
  })

  it('nimmt das Bestaetigungsdatum vom Server, nicht von der Uhr des Rechners', async () => {
    // R2-30: `setContentPolicy` gibt nur die Richtlinie zurueck, den
    // Zeitstempel setzt der Server. Bis 3.0.0 stempelte die Oberflaeche
    // stattdessen `new Date()`, und wer seine Uhr verstellt hat, las ein
    // Datum, das in keiner Datenbank steht.
    const SERVERDATUM = '2019-03-04T12:00:00.000Z'
    const ALS_TEXT = new Date(SERVERDATUM).toLocaleDateString()
    api.get
      .mockResolvedValueOnce({ policy: 'soft', ageConfirmedAt: null })
      .mockResolvedValueOnce({ policy: 'off', ageConfirmedAt: SERVERDATUM })
    render(<ContentPolicySettings />)
    fireEvent.click(screen.getByDisplayValue('off'))
    fireEvent.click(screen.getByRole('button', { name: 'I am 18 or older' }))

    await waitFor(() => expect(document.body.textContent ?? '').toContain(`Age confirmed on ${ALS_TEXT}`))
    // Die Oberflaeche hat nach dem Speichern wirklich nachgefragt.
    expect(api.get).toHaveBeenCalledTimes(2)
    // Negativkontrolle: das heutige Datum steht nur dann da, wenn es zufaellig
    // dasselbe ist, und das ist es bei 2019 nicht.
    expect(document.body.textContent ?? '').not.toContain(new Date().toLocaleDateString())
  })

  it('erfindet auch dann kein Datum, wenn die Nachfrage scheitert', async () => {
    // Der Wunsch ist gespeichert, sobald setContentPolicy zurueck ist. Faellt
    // das Netz genau dazwischen aus, gibt es keinen Fehler zu lesen und
    // trotzdem kein erfundenes Datum.
    api.get
      .mockResolvedValueOnce({ policy: 'soft', ageConfirmedAt: null })
      .mockRejectedValueOnce(new Error('offline'))
    render(<ContentPolicySettings />)
    fireEvent.click(screen.getByDisplayValue('off'))
    fireEvent.click(screen.getByRole('button', { name: 'I am 18 or older' }))

    await waitFor(() => expect(api.set).toHaveBeenCalledWith('off', true))
    await waitFor(() => expect(screen.queryByTestId('age-gate')).toBeNull())
    expect(document.body.textContent ?? '').not.toContain('Age confirmed on')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('und zeigt den Satz nur, solange die Regel wirklich aus ist', async () => {
    // Negativkontrolle zur Bedingung: bei strict und soft steht die Zeile gar
    // nicht da, auch wenn der Server ein Bestaetigungsdatum mitliefert.
    for (const policy of ['strict', 'soft'] as const) {
      cleanup()
      api.get.mockResolvedValue({ policy, ageConfirmedAt: '2026-09-10T08:00:00.000Z' })
      render(<ContentPolicySettings />)
      await waitFor(() => expect((screen.getByDisplayValue(policy) as HTMLInputElement).checked).toBe(true))
      expect(document.body.textContent ?? '', policy).not.toContain('Age confirmed on')
    }
  })
})
