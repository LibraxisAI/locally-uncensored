/**
 * F3 (3.0.1, T4 Nebenfund): "a freshly added provider comes with a prefilled
 * value". Add Provider pushes a new backend into the shared `openai` slot via
 * `slotTakeoverUpdate`, whose patch never mentions `apiKey` — the plain store
 * merge in ProviderConfig.tsx's setProviderConfig therefore left whatever key
 * the DISPLACED backend had sitting in the field, so a brand new custom
 * OpenAI-compatible provider showed (and would have submitted) a secret that
 * belongs to a completely different endpoint.
 *
 * Run: npx vitest run src/lib/__tests__/openai-slot-handover-api-key.test.ts
 */
import { describe, it, expect } from 'vitest'
import { takeoverClearsApiKey, type HandoverSlot } from '../openai-slot-handover'

const jan: HandoverSlot = {
  enabled: true, name: 'Jan', baseUrl: 'http://localhost:1337/v1', isLocal: true, managed: false,
}

describe('F3 — a slot takeover clears the inherited API key', () => {
  it('a genuinely different backend clears it — the old key belongs elsewhere', () => {
    const incoming = { name: 'My Server', baseUrl: 'http://localhost:5001/v1', isLocal: true, managed: false }
    expect(takeoverClearsApiKey(jan, incoming)).toBe(true)
  })

  it('re-selecting the SAME backend that already holds the slot keeps the key', () => {
    const incoming = { name: jan.name, baseUrl: jan.baseUrl, isLocal: jan.isLocal, managed: jan.managed }
    expect(takeoverClearsApiKey(jan, incoming)).toBe(false)
  })

  it('an empty/disabled slot has nothing to leak, so nothing is cleared', () => {
    const empty: HandoverSlot = { enabled: false, name: '', baseUrl: '', isLocal: true, managed: false }
    const incoming = { name: 'My Server', baseUrl: 'http://localhost:5001/v1', isLocal: true, managed: false }
    expect(takeoverClearsApiKey(empty, incoming)).toBe(false)
  })

  it('switching only the managed flag (Built-in Engine <-> foreign backend) still counts as different', () => {
    const builtin: HandoverSlot = { enabled: true, name: 'Built-in Engine', baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: true }
    const incoming = { name: 'Built-in Engine', baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: false }
    expect(takeoverClearsApiKey(builtin, incoming)).toBe(true)
  })
})
