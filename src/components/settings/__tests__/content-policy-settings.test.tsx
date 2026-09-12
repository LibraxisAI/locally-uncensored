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
  api.get.mockResolvedValue({ policy: 'soft', ageConfirmedAt: null })
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

  /**
   * Derselbe Grund wie beim Blatt in A5 (R6-2): der Meldeweg steht nicht.
   * SAFETY_ALERT_WEBHOOK_URL ist auf dem Droplet nicht gesetzt, alertCsamBlock
   * steigt ohne Ziel sofort aus, und keine Migration legt eine Tabelle dafuer
   * an. Die Sperre selbst bleibt wortgleich und wird nie schwaecher; nur die
   * Zusage, die die App nicht einloest, faellt weg.
   */
  it('verspricht keine Meldung, die niemand verschickt', () => {
    render(<ContentPolicySettings />)
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/refused on every request whatever this is set to\./)
    expect(text).not.toMatch(/and reported/i)
  })

  it('NEGATIVKONTROLLE: die Sperre selbst steht unveraendert da', () => {
    render(<ContentPolicySettings />)
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/Material involving minors, and photographs of real people uploaded without their consent, are refused on every request/)
  })

  it('says plainly that the local machine is not affected', () => {
    render(<ContentPolicySettings />)
    expect(document.body.textContent ?? '').toMatch(/nothing on\s+your own machine is/i)
  })
})
