// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FlashChatNotice } from '../FlashChatNotice'
import { useModelStore } from '../../../stores/modelStore'
import { captureFlashGeneration, clearFlashNotices, parseFlashPolicy, recordFlashResponse, useFlashBillingStore } from '../../../lib/flash-ui'
import { FLASH_UNPAID_NOTICE } from '../../../lib/flash-entitlement'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'

const wire = { daily_tokens: 50000, default_max_output: 8192, request_seconds: 240, sessions_only: true, concurrent_requests: 1 }
const policy = parseFlashPolicy(wire, 'flash', 'test-endpoint|model')!
const signIn = (paidPlan: boolean | null) =>
  useCloudAuthStore.getState().setSignedIn(
    { id: 'u1' },
    { licenseActive: true, tier: 'hosted', access: true, quota: null, paidPlan },
  )

beforeEach(() => {
  useFlashBillingStore.setState({ entries: {} })
  // Die bestehenden Faelle beschreiben das zahlende Konto.
  signIn(true)
  useModelStore.setState({ activeModel: 'test-model', models: [{
    name: 'test-model', model: 'test-model', size: 0, type: 'text', provider: 'openai', providerName: 'Test', flash: policy,
  }] })
})
afterEach(cleanup)

describe('visible flash policy and billing', () => {
  it('clears notices across focus changes and fences late responses', () => {
    render(createElement(FlashChatNotice))
    const generation = captureFlashGeneration()
    const response = new Response('', { headers: { 'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0' } })
    act(() => recordFlashResponse(policy.billingKey, response, generation))
    expect(screen.queryByRole('alert')).not.toBeNull()
    act(() => window.dispatchEvent(new Event('blur')))
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => recordFlashResponse(policy.billingKey, response, generation))
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => window.dispatchEvent(new Event('focus')))
    act(() => recordFlashResponse(policy.billingKey, response, captureFlashGeneration()))
    expect(screen.queryByRole('alert')).not.toBeNull()
    act(clearFlashNotices)
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('publishes the server-provided limits before a request', () => {
    render(createElement(FlashChatNotice))
    fireEvent.click(screen.getByText(/50,000 input and output tokens/))
    expect(screen.getByText(/API keys always use credits/).textContent).toContain('8,192')
    expect(screen.getByText(/API keys always use credits/).textContent).toContain('240 seconds')
    expect(screen.getByText(/API keys always use credits/).textContent).toContain('00:00 UTC')
  })
  it('renders a persistent paid-fallback alert from response headers', () => {
    render(createElement(FlashChatNotice))
    act(() => recordFlashResponse(policy.billingKey, new Response('', { headers: {
      'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0',
    } })))
    expect(screen.getByRole('alert').textContent).toContain('This request uses credits')
  })
  it('does not claim a failed credit check started generation', () => {
    render(createElement(FlashChatNotice))
    act(() => recordFlashResponse(policy.billingKey, new Response('', { status: 429, headers: {
      'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0',
    } })))
    expect(screen.getByRole('alert').textContent).toContain('No generation started')
  })
  it('labels remaining tokens as a reservation, not final usage', () => {
    render(createElement(FlashChatNotice))
    act(() => recordFlashResponse(policy.billingKey, new Response('', { headers: {
      'x-lu-chat-billing': 'flash', 'x-lu-flash-remaining': '12345',
    } })))
    expect(screen.getByRole('status').textContent).toContain('Remaining after reservation: 12,345')
  })
  it('does not show a notice for another endpoint or model', () => {
    recordFlashResponse('other|model', new Response('', { headers: { 'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0' } }))
    render(createElement(FlashChatNotice))
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('offers no free usage claim when an old backend omits metadata', () => {
    const row = useModelStore.getState().models[0]
    if (!('flash' in row)) throw new Error('Expected the flash model fixture')
    useModelStore.setState({ models: [{ ...row, flash: undefined }] })
    render(createElement(FlashChatNotice))
    expect(screen.queryByTestId('flash-chat-notice')).toBeNull()
    expect(parseFlashPolicy(undefined, undefined, 'key')).toBeUndefined()
  })
  it('rejects malformed policy and billing metadata', () => {
    expect(parseFlashPolicy({ ...wire, daily_tokens: -1 }, 'flash', 'key')).toBeUndefined()
    expect(parseFlashPolicy({ ...wire, sessions_only: false }, 'flash', 'key')).toBeUndefined()
    expect(parseFlashPolicy(wire, 'anything', 'key')).toBeUndefined()
    recordFlashResponse(policy.billingKey, new Response('', { headers: { 'x-lu-chat-billing': 'credits' } }))
    expect(useFlashBillingStore.getState().entries).toEqual({})
  })
})

/**
 * R5-18: der stehende Satz versprach die Freimenge ohne jede Bedingung. T7 hat
 * am 11.09.2026 das Gegenteil gemessen: dieselbe Zusage wie beim Planbesitzer,
 * und ein Credit war weg. Drei Zustaende, drei Ausgaben, wie im Web.
 */
describe('was der Satz ueber das Konto sagt', () => {
  it('reads one honest sentence on an account that pays for these models', () => {
    signIn(false)
    render(createElement(FlashChatNotice))
    expect(screen.getByTestId('flash-chat-notice').textContent).toBe(FLASH_UNPAID_NOTICE)
    expect(screen.queryByText(/50,000 input and output tokens/)).toBeNull()
  })

  it('says nothing at all while the account probe has not answered', () => {
    signIn(null)
    render(createElement(FlashChatNotice))
    expect(screen.queryByTestId('flash-chat-notice')).toBeNull()
  })

  it('keeps the full allowance text for a paid plan', () => {
    signIn(true)
    render(createElement(FlashChatNotice))
    expect(screen.getByText(/50,000 input and output tokens/)).toBeTruthy()
    expect(screen.queryByText(FLASH_UNPAID_NOTICE)).toBeNull()
  })

  it('stays silent for a model without the free class, whatever the plan', () => {
    const row = useModelStore.getState().models[0]
    if (!('flash' in row)) throw new Error('Expected the flash model fixture')
    useModelStore.setState({ models: [{ ...row, flash: undefined }] })
    for (const plan of [true, false, null] as const) {
      cleanup()
      signIn(plan)
      render(createElement(FlashChatNotice))
      expect(screen.queryByTestId('flash-chat-notice')).toBeNull()
    }
  })
})
