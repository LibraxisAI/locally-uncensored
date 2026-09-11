/**
 * Der Grundtext geht wirklich raus, auf jeder Oberflaeche.
 *
 * Der Fund, den dieser Test festhaelt: der Personenschalter steht bewusst auf
 * aus, und die Zusammensetzung fiel damit auf einen LEEREN Systemtext zurueck.
 * Die Person zu reparieren half nichts, weil die Person gar nicht gefragt
 * wurde. Gemessen am 10.09.2026 kostet ein leerer Systemtext sechs von 46
 * Katalogmodellen die Antwort.
 *
 * Run: npx vitest run src/lib/__tests__/system-prompt.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CHAT_BASE_SYSTEM_PROMPT,
  HOUSE_CONDUCT,
  buildChatSystemPrompt,
  withHouseConduct,
} from '../system-prompt'
import { BUILT_IN_PERSONAS } from '../constants'

const SRC = resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8')

/** Vokabular, das dem Modell erst die Kategorie beibringt, an der es haengt. */
const POLICY = /\b(refuse|decline|disallowed|nsfw|explicit content|inappropriate|content policy|guidelines)\b/i

describe('system prompt', () => {
  it('never sends an empty system prompt, whatever the persona switch says', () => {
    for (const conv of [
      {},
      { personaEnabled: false, systemPrompt: 'ignored while off' },
      { personaEnabled: true, systemPrompt: '' },
      { personaEnabled: true, systemPrompt: '   ' },
      { personaEnabled: undefined, systemPrompt: undefined },
    ]) {
      const built = buildChatSystemPrompt(conv as never)
      expect(built.trim().length).toBeGreaterThan(40)
      expect(built).toContain(HOUSE_CONDUCT)
    }
  })

  it('falls back to the base role only when no persona is in play', () => {
    expect(buildChatSystemPrompt({ personaEnabled: false, systemPrompt: 'x' }))
      .toBe(CHAT_BASE_SYSTEM_PROMPT)
  })

  it('lets an enabled persona carry the role and only appends the conduct line', () => {
    const devil = BUILT_IN_PERSONAS.find((p) => p.id === 'devil')!
    const built = buildChatSystemPrompt({ personaEnabled: true, systemPrompt: devil.systemPrompt })
    expect(built).toBe(`${devil.systemPrompt}\n\n${HOUSE_CONDUCT}`)
    expect(built).not.toContain("You are the user's own model")
  })

  it('states no content rule, neither permitting nor forbidding', () => {
    expect(CHAT_BASE_SYSTEM_PROMPT).not.toMatch(POLICY)
    expect(HOUSE_CONDUCT).not.toMatch(POLICY)
    // Und keine Assistenten-Floskel, die die antrainierte Vorsicht anzieht.
    expect(CHAT_BASE_SYSTEM_PROMPT).not.toMatch(/\bhelpful\b|\bharmless\b|\bassistant\b/i)
  })

  it('appends the conduct line to a surface prompt exactly once', () => {
    const surface = 'You are the Coding Agent inside LU.'
    const once = withHouseConduct(surface)
    expect(once).toContain(HOUSE_CONDUCT)
    expect(withHouseConduct(once)).toBe(once)
  })

  /**
   * Der Waechter gegen den Rueckfall. Wer die naechste Oberflaeche baut,
   * schreibt sonst wieder `personaEnabled === true ? conv.systemPrompt : ''`,
   * und der Grundtext ist still wieder weg.
   */
  it('leaves no assembly point that can fall back to an empty string', () => {
    for (const file of ['hooks/useChat.ts', 'hooks/useAgentChat.ts']) {
      expect(read(file)).not.toMatch(/personaEnabled === true \? conv\.systemPrompt : ''/)
      expect(read(file)).toContain('buildChatSystemPrompt(conv)')
    }
  })

  it('carries the conduct line on the coding surface too', () => {
    expect(read('hooks/useCodex.ts')).toContain('withHouseConduct(')
  })
})
