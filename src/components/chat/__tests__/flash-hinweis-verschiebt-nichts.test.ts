/**
 * David, 19.09.2026: das Flash-Band stand dauerhaft ueber dem Eingabefeld und
 * schob den Agent-Schalter, die Kontextanzeige und Memories nach oben. Der
 * Hinweis ist jetzt ein einzeiliges Etikett in der Sitzungsleiste, direkt
 * neben `AgentModeToggle`, mit einem Popup ausserhalb des Layoutflusses, genau
 * wie `SamplingControls` (der Sampling-Regler).
 *
 * Dieser Test liest Quelltext, nicht das gerenderte DOM, aus demselben Grund
 * wie `zwei-baender-sind-eine-flaeche.test.ts`: die Behauptung ist eine
 * Platzierung im Baum, nicht ein Pixelwert, und der Quelltext sagt sie direkt.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const COMPONENTS = resolve(__dirname, '..', '..')
const read = (rel: string) => readFileSync(resolve(COMPONENTS, rel), 'utf-8')

const CHAT_INPUT = read('chat/ChatInput.tsx')
const CHAT_VIEW = read('chat/ChatView.tsx')
const CODEX_VIEW = read('chat/CodexView.tsx')
const NOTICE = read('chat/FlashChatNotice.tsx')
const SAMPLING = read('chat/SamplingControls.tsx')

describe('kein Element des Flash-Hinweises oberhalb des Eingabefelds', () => {
  it('ChatInput kennt FlashChatNotice nicht mehr', () => {
    expect(CHAT_INPUT).not.toContain('FlashChatNotice')
  })
})

describe('der Hinweis steht in der Sitzungsleiste, neben dem Agent-Schalter', () => {
  const stripStart = CHAT_VIEW.indexOf('data-testid="chat-session-strip"')

  it('die Leiste wurde gefunden', () => {
    expect(stripStart).toBeGreaterThan(-1)
  })

  it('AgentModeToggle und FlashChatNotice stehen beide darin, FlashChatNotice direkt danach', () => {
    const strip = CHAT_VIEW.slice(stripStart, stripStart + 1500)
    const agent = strip.indexOf('<AgentModeToggle')
    const notice = strip.indexOf('<FlashChatNotice')
    const spacer = strip.indexOf('flex-1')
    expect(agent).toBeGreaterThan(-1)
    expect(notice).toBeGreaterThan(-1)
    expect(spacer).toBeGreaterThan(-1)
    expect(notice).toBeGreaterThan(agent)
    expect(notice).toBeLessThan(spacer)
  })

  it('und in der Code-Symbolleiste, derselbe Baustein wie im Chat', () => {
    expect(CODEX_VIEW).toContain('<FlashChatNotice')
  })
})

describe('das Popup liegt ausserhalb des Layoutflusses, wie der Sampling-Regler', () => {
  it('FlashChatNotice setzt position: absolute fuers Panel, dieselbe Bauart', () => {
    expect(NOTICE).toMatch(/position:\s*'absolute'/)
    expect(SAMPLING).toMatch(/position:\s*'absolute'/)
  })

  it('der Ausloeser ist eine einzeilige Zeile, kein Block mit eigener Hoehe', () => {
    // Kein `mb-*` und kein `flex-col` am Wurzelelement: eine Marke, die selbst
    // Rand oder Zeilenumbruch mitbringt, macht die Leiste hoeher.
    const wurzel = NOTICE.slice(NOTICE.indexOf('return ('), NOTICE.indexOf('{open &&'))
    expect(wurzel).not.toMatch(/\bmb-\d/)
    expect(wurzel).not.toMatch(/flex-col/)
    expect(wurzel).toMatch(/whitespace-nowrap/)
  })

  it('schliesst per Escape, X und Aussenklick, wie SamplingControls', () => {
    expect(NOTICE).toMatch(/useDismissOnEscape\(open, close\)/)
    expect(NOTICE).toContain('pointerdown')
    expect(NOTICE).toContain('FLASH_NOTICE_CLOSE_LABEL')
  })
})
