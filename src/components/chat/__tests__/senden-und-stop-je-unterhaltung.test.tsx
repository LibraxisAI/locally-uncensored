/**
 * @vitest-environment jsdom
 *
 * Senden und Stop gehoeren der Unterhaltung, nicht der App.
 *
 * Befund T1 (Box, 11.09.2026), Punkt 4 und Nebenfund 4: "Der Sendeknopf
 * verschwindet global, solange irgendwo eine Antwort laeuft. In jedem anderen
 * Chat steht dort der Stopp-Knopf, der die fremde Erzeugung abbricht." Der
 * Komposer las eine einzige app-weite Fahne (`useChat().isGenerating`),
 * obwohl der generationStore die Wahrheit seit 22f76b04 je Unterhaltung
 * fuehrt und die Schreibanzeige sie auch schon las.
 *
 * Warum hier nur die halbe Strecke steht: ein vollstaendiges "jede
 * Unterhaltung darf gleichzeitig senden" haengt an den geteilten
 * Stream-Puffern in useChat.ts (contentRef, thinkingRef, abortRef) und
 * useAgentChat.ts, rund 110 Zugriffe, und daran, dass `runInLane` aus
 * lib/run-slot.ts bis heute keinen Aufrufer in der Produktion hat: ohne
 * Warteschlange liefen zwei lokale Laeufe gegen einen llama-server mit einem
 * einzigen Slot. Das ist mehr als eine Stunde Arbeit und gehoert in einen
 * eigenen Auftrag. Was hier steht, ist das, was ohne diese Entflechtung
 * richtig wird: der laufende Chat behaelt Stop und bricht nur sich selbst ab,
 * der andere behaelt seinen Sendeknopf und bekommt einen englischen Satz
 * statt eines stummen Tauschs.
 *
 * Run: npx vitest run src/components/chat/__tests__/senden-und-stop-je-unterhaltung.test.tsx
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChatInput } from '../ChatInput'
import { composerBusy } from '../../../lib/composer-busy'

const src = (rel: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

const sendButton = () => screen.queryByRole('button', { name: 'Send message' }) as HTMLButtonElement | null
const stopButton = () => screen.queryByRole('button', { name: 'Stop generation' })

beforeEach(() => cleanup())

describe('the composer of a chat that is NOT the one answering', () => {
  /** What ChatView hands down while conversation `b` is the one generating. */
  const asSeenFromA = composerBusy(true, { b: true }, 'a')

  it('keeps its Send button instead of losing it to a foreign run', () => {
    render(
      <ChatInput
        onSend={() => {}}
        onStop={() => { throw new Error('a foreign run must not be stoppable from here') }}
        isGenerating={asSeenFromA.thisChat}
        busyElsewhere={asSeenFromA.otherChat}
      />,
    )
    expect(sendButton()).toBeTruthy()
    expect(stopButton()).toBeNull()
  })

  it('says in English why it is waiting, instead of going quiet', () => {
    render(
      <ChatInput onSend={() => {}} onStop={() => {}} isGenerating={asSeenFromA.thisChat} busyElsewhere={asSeenFromA.otherChat} />,
    )
    const line = screen.getByTestId('composer-busy-elsewhere')
    expect(line.textContent).toContain('Another chat is still answering')
    expect(line.textContent).toContain('one answer at a time')
    // It has to tell the user what to do next, not just that something is off.
    expect(line.textContent).toMatch(/wait for it to finish or stop it in that chat/)
    expect(line.getAttribute('role')).toBe('status')
  })

  it('does not fire a send while another chat holds the engine', () => {
    let sent = 0
    render(
      <ChatInput onSend={() => { sent += 1 }} onStop={() => {}} isGenerating={asSeenFromA.thisChat} busyElsewhere={asSeenFromA.otherChat} />,
    )
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'hello' } })
    expect(sendButton()!.disabled).toBe(true)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(sent).toBe(0)
  })
})

describe('the composer of the chat that IS answering', () => {
  const asSeenFromB = composerBusy(true, { b: true }, 'b')

  it('shows Stop, and no waiting line', () => {
    let stopped = 0
    render(
      <ChatInput onSend={() => {}} onStop={() => { stopped += 1 }} isGenerating={asSeenFromB.thisChat} busyElsewhere={asSeenFromB.otherChat} />,
    )
    expect(sendButton()).toBeNull()
    expect(screen.queryByTestId('composer-busy-elsewhere')).toBeNull()
    fireEvent.click(stopButton()!)
    expect(stopped).toBe(1)
  })

  it('COUNTER-CHECK: an idle chat shows Send and says nothing', () => {
    const idle = composerBusy(false, {}, 'b')
    render(<ChatInput onSend={() => {}} onStop={() => {}} isGenerating={idle.thisChat} busyElsewhere={idle.otherChat} />)
    expect(sendButton()).toBeTruthy()
    expect(sendButton()!.disabled).toBe(true) // empty box, not a busy engine
    expect(screen.queryByTestId('composer-busy-elsewhere')).toBeNull()
  })
})

/**
 * Die zweite Haelfte des Befunds sitzt in zwei Hooks, deren Abbruchgriffe der
 * Hook-INSTANZ gehoeren und nicht der Unterhaltung. Ein echter Lauf mit zwei
 * gleichzeitigen Unterhaltungen ist von hier aus nicht zu fahren, deshalb
 * steht hier der Quelltext-Waechter auf die Bedingung. Nachgemessen werden
 * muss das an der laufenden App (siehe Bericht).
 */
describe('Stop bricht nur die eigene Erzeugung ab', () => {
  it('useChat abortet den Controller der Instanz nur fuer die eigene Unterhaltung', () => {
    const chat = src('../../../hooks/useChat.ts')
    expect(chat).toMatch(/const abortConvRef = useRef<string \| null>\(null\)/)
    expect(chat).toMatch(/if \(abortConvRef\.current === convId\) \{\s*\n\s*abortRef\.current\?\.abort\(\)/)
    // Und der Ref wird auch wirklich gesetzt, sonst bricht Stop nie etwas ab.
    expect(chat.match(/abortConvRef\.current = convId/g)?.length).toBe(2)
  })

  it('useAgentChat beendet den Agentenlauf nur fuer die eigene Unterhaltung', () => {
    const agent = src('../../../hooks/useAgentChat.ts')
    expect(agent).toMatch(/if \(abortConvRef\.current === stoppedConvId\) \{/)
    expect(agent).toMatch(/abortConvRef\.current = convId/)
    // setIsAgentRunning(false) darf NICHT mehr unbedingt am Ende stehen: das
    // war die Zeile, die den fremden Lauf aus der Oberflaeche loeschte.
    expect(agent).not.toMatch(/drainApprovals\(stoppedConvId\)\s*\n\s*setIsAgentRunning\(false\)/)
  })

  /**
   * R2-19: der dritte Hook mit demselben Griff. `stopCodex` brach ihn
   * bedingungslos ab, und V2a hat nachgewiesen, dass `CodexView` beim
   * Unterhaltungswechsel NICHT neu montiert wird (`ChatView.tsx` gibt ihm kein
   * `key`). Ein Lauf in A, Wechsel nach B, Stop gedrueckt: A war tot.
   */
  it('useCodex bricht den Controller der Instanz nur fuer die eigene Unterhaltung ab', () => {
    const codex = src('../../../hooks/useCodex.ts')
    expect(codex).toMatch(/const abortConvRef = useRef<string \| null>\(null\)/)
    expect(codex).toMatch(/if \(abortConvRef\.current === stoppedConvId\) \{/)
    // Und der Ref wird gesetzt UND geleert, sonst bricht Stop nie etwas ab
    // oder bricht einen laengst beendeten Lauf ab.
    expect(codex).toMatch(/abortConvRef\.current = convId/)
    expect(codex).toMatch(/abortConvRef\.current = null/)
    // Der richtige Griff je Unterhaltung liegt weiter davor und bleibt
    // bedingungslos: er trifft genau die gemeinte Unterhaltung.
    expect(codex).toMatch(/stopRun\(stoppedConvId\)/)
    expect(codex).toMatch(/abortConversation\(stoppedConvId\)/)
  })

  it('und CodexView wird beim Unterhaltungswechsel wirklich nicht neu montiert', () => {
    // Die Voraussetzung des Befunds, damit sie nicht still verschwindet: gaebe
    // es hier ein `key`, waere der Griff bei jedem Wechsel frisch und die
    // Klammer oben ueberfluessig. Sie ist es nicht.
    const view = src('../ChatView.tsx')
    expect(view).toMatch(/<CodexView\b/)
    expect(view).not.toMatch(/<CodexView[^>]*\skey=/)
  })

  it('der Komposer liest nicht mehr die app-weite Fahne', () => {
    const view = src('../ChatView.tsx')
    const composer = view.slice(view.indexOf('<ChatInput'), view.indexOf('composerActions='))
    expect(composer).toContain('isGenerating={busy.thisChat}')
    expect(composer).toContain('busyElsewhere={busy.otherChat}')
    expect(composer).not.toContain('isGenerating={isGenerating}')
    // Die MessageList behaelt die app-weite Fahne mit Absicht: Regenerate und
    // Edit STARTEN einen Lauf, und solange die Stream-Puffer geteilt sind,
    // darf ein zweiter Lauf nirgends anfangen. Genau deshalb sagt der
    // Komposer den Grund, statt den Knopf wegzunehmen.
    expect(view).toContain('isGenerating={isGenerating}')
    expect(view).toContain('isThisChatGenerating={activeGenerating}')
  })
})
