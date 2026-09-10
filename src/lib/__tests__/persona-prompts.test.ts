// The built-in personas, and what a system prompt may never contain.
//
// Measured on 2026-09-10 across the cloud catalogue: the system prompt decides
// more than any sampling value. Six models that declined a bare instruction
// answered once a role was set. The default persona shipped with an empty
// prompt, which is not neutral, so it now states a role.
//
// The rule these tests defend: a system prompt states role and task. It never
// carries a content policy. Enforcement belongs on the server, in
// lib/render/safety.ts, where it can be tested and cannot be edited away by a
// user who owns their own prompt field.

import { describe, expect, it } from 'vitest'
import { BUILT_IN_PERSONAS } from '../constants'

const byId = (id: string) => BUILT_IN_PERSONAS.find((p) => p.id === id)
const defaultPersona = byId('unrestricted')

describe('built-in persona prompts', () => {
  it('ships the default persona with an actual role', () => {
    expect(defaultPersona).toBeDefined()
    expect(defaultPersona!.systemPrompt.trim().length).toBeGreaterThan(40)
  })

  it('gives every built-in persona a non-empty prompt', () => {
    for (const p of BUILT_IN_PERSONAS) {
      expect(p.systemPrompt.trim(), p.id).not.toBe('')
    }
  })

  it('keeps content policy out of every built-in prompt', () => {
    // A prompt that asks the model to refuse is both weaker than the server
    // gate and unmeasurable. If one of these ever appears, the enforcement
    // moved to the wrong layer.
    const forbidden = [
      /\brefuse\b/i, /\bdecline\b/i, /\bnot generate\b/i, /\bmust not\b/i,
      /\bcontent polic/i, /\bguidelines\b/i, /\bsafe(ty)? (rules|policy)\b/i,
      /\bnsfw\b/i, /\bexplicit\b/i, /\badult content\b/i,
    ]
    for (const p of BUILT_IN_PERSONAS) {
      for (const pattern of forbidden) {
        expect(pattern.test(p.systemPrompt), `${p.id} matched ${pattern}`).toBe(false)
      }
    }
  })

  it('keeps assistant-identity filler out of the default persona', () => {
    // The exact phrasing that pushes a model into its built-in assistant mode.
    for (const pattern of [/helpful/i, /friendly/i, /\bassistant\b/i]) {
      expect(pattern.test(defaultPersona!.systemPrompt), String(pattern)).toBe(false)
    }
  })

  it('tells the model not to volunteer disclaimers, which is a style rule and not a filter', () => {
    expect(defaultPersona!.systemPrompt).toMatch(/disclaimer/i)
    expect(defaultPersona!.systemPrompt).toMatch(/did not ask for/i)
  })

  it('leaves the named personas free to describe their own job', () => {
    // They are the user's deliberate choice, so their wording stays. Only the
    // default changed. This assertion exists so a future sweep does not
    // flatten them all into one voice.
    expect(byId('coder')!.systemPrompt).toMatch(/software engineer/i)
    expect(byId('writer')?.systemPrompt ?? byId('assistant')!.systemPrompt).toBeTruthy()
  })
})
