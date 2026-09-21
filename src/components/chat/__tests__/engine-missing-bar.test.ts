/**
 * @vitest-environment jsdom
 *
 * The composer-side half of the R13D Nebenfund 1 notice (see
 * lib/builtin-engine-presence.ts and EngineMissingBar.tsx): when LU Engine
 * has fallen out of the `openai` slot and the app is in Local mode, the line
 * where the user actually notices, above the chat input, has to say so.
 *
 * Run: npx vitest run src/components/chat/__tests__/engine-missing-bar.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { ProviderConfig } from '../../../api/providers/types'
import { DEFAULT_SETTINGS } from '../../../lib/constants'

const { EngineMissingBar } = await import('../EngineMissingBar')
const { useProviderStore } = await import('../../../stores/providerStore')
const { useSettingsStore } = await import('../../../stores/settingsStore')

const openaiSlot = (extra: Partial<ProviderConfig>): ProviderConfig =>
  ({ id: 'openai', name: 'x', enabled: true, baseUrl: 'http://x', apiKey: '', isLocal: true, ...extra })

function setOpenai(config: ProviderConfig) {
  useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: config } }))
}

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'local' } })
  // Opus review: reset the opted-out flag so an earlier test's write cannot
  // leak into this one through the persisted singleton store.
  useProviderStore.setState({ engineOptedOut: false })
})
afterEach(cleanup)

describe('EngineMissingBar', () => {
  it('says nothing while LU Engine holds the slot', () => {
    setOpenai(openaiSlot({ managed: true, name: 'LU Engine' }))
    render(createElement(EngineMissingBar))
    expect(screen.queryByTestId('engine-missing-bar')).toBeNull()
  })

  it('names the way back when LU Engine is gone, in Local mode', () => {
    setOpenai(openaiSlot({ managed: false, name: 'Jan' }))
    render(createElement(EngineMissingBar))
    const bar = screen.getByTestId('engine-missing-bar')
    expect(bar.textContent).toContain('LU Engine is missing from your providers')
    expect(bar.textContent).toContain('Add Provider, then LU Engine')
    // Opus review, Blocker 2: must never claim local chat is broken, a
    // working local backend (Jan, here) can be the one holding the slot.
    expect(bar.textContent).not.toContain('Local chat will not answer')
  })

  // Opus review, Blocker 1: the exact same slot shape is what a customer
  // leaves behind by picking Ollama or LM Studio on purpose. Without
  // engineOptedOut this fired for every one of them, at every launch.
  it('NEGATIVE CONTROL: says nothing when the customer opted for a different backend on purpose (engineOptedOut)', () => {
    setOpenai(openaiSlot({ managed: false, name: 'Ollama-adjacent slot' }))
    useProviderStore.setState({ engineOptedOut: true })
    render(createElement(EngineMissingBar))
    expect(screen.queryByTestId('engine-missing-bar')).toBeNull()
  })

  it('is silent in Cloud mode even though the slot is really empty: the local slot is not on that path', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud' } })
    setOpenai(openaiSlot({ managed: false, name: 'Jan' }))
    render(createElement(EngineMissingBar))
    expect(screen.queryByTestId('engine-missing-bar')).toBeNull()
  })

  it('the X dismisses it', () => {
    setOpenai(openaiSlot({ managed: false, name: 'Jan' }))
    render(createElement(EngineMissingBar))
    expect(screen.getByTestId('engine-missing-bar')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByTestId('engine-missing-bar')).toBeNull()
  })

  // NEGATIVE CONTROL: LU Engine parked on standby is not "gone", it has a
  // card and a way back already, so nothing should be drawn here either.
  it('NEGATIVE CONTROL: LU Engine only parked on standby draws nothing', () => {
    setOpenai(openaiSlot({
      managed: false, name: 'Jan',
      displaced: { name: 'LU Engine', baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: true },
    }))
    render(createElement(EngineMissingBar))
    expect(screen.queryByTestId('engine-missing-bar')).toBeNull()
  })
})
