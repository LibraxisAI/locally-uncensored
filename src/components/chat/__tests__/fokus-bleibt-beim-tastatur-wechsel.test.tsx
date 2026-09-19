/**
 * @vitest-environment jsdom
 *
 * Auflage 1 (Review composer, 19.09.2026, review-composer.md Punkt 1):
 * `key={conversationId}` (ChatInput.tsx) loest den Geisterzustand und die
 * Entwurfs-Vermischung, montiert das Textfeld beim Gespraechswechsel aber
 * NEU. Ein frischer DOM-Knoten hat nie von selbst Fokus, der landet also auf
 * `body`. `useKeyboardShortcuts.ts` ("new-conversation", Ctrl/Cmd+N) wechselt
 * ohne Mausklick - der Cursor lag mit hoher Wahrscheinlichkeit im Feld, und
 * die naechsten Tastendruecke gingen danach ins Leere.
 *
 * FIX: `useKeyboardShortcuts.ts` merkt sich (nur wenn der Tastendruck selbst
 * aus dem Composer-Feld kam, erkannt am Attribut `data-lu-quiet-focus`), dass
 * der naechste Wechsel den Fokus zurueckholen soll. `ChatInput.tsx` liest das
 * in einem `useLayoutEffect` auf `conversationId` und ruft `focus()` auf dem
 * NEUEN Knoten.
 *
 * Zwei Negativkontrollen: ein Wechsel ohne Tastatur (Sidebar-Klick) darf
 * nichts stehlen, und ein Ctrl+N aus einem FREMDEN Feld (Suchfeld/Modal) darf
 * dessen Fokus nicht antasten.
 *
 * Run: npx vitest run src/components/chat/__tests__/fokus-bleibt-beim-tastatur-wechsel.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { ChatInput } from '../ChatInput'
import { useKeyboardShortcuts } from '../../../hooks/useKeyboardShortcuts'
import { useChatStore } from '../../../stores/chatStore'
import { useModelStore } from '../../../stores/modelStore'

const MODEL = 'ollama::qwen3:14b'

function Host() {
  useKeyboardShortcuts()
  return (
    <>
      <input aria-label="Suchfeld" />
      <ChatInput onSend={() => {}} onStop={() => {}} isGenerating={false} />
    </>
  )
}

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useModelStore.setState({ activeModel: MODEL })
})
afterEach(() => cleanup())

describe('Fokus nach Gespraechswechsel per Tastatur', () => {
  it('Ctrl+N aus dem Composer-Feld: der NEUE Knoten bekommt den Fokus zurueck', () => {
    const convA = useChatStore.getState().createConversation(MODEL, '')
    useChatStore.getState().setActiveConversation(convA)
    render(<Host />)

    const nodeA = screen.getByPlaceholderText('Message...') as HTMLTextAreaElement
    nodeA.focus()
    expect(document.activeElement).toBe(nodeA)

    act(() => {
      fireEvent.keyDown(nodeA, { key: 'n', ctrlKey: true })
    })

    const nodeB = screen.getByPlaceholderText('Message...') as HTMLTextAreaElement
    expect(nodeB).not.toBe(nodeA)
    expect(document.activeElement).toBe(nodeB)
  })

  it('NEGATIVKONTROLLE: ein Wechsel per Sidebar-Klick (ohne Tastatur) stiehlt keinen Fokus', () => {
    const convA = useChatStore.getState().createConversation(MODEL, '')
    useChatStore.getState().setActiveConversation(convA)
    render(<Host />)

    const suchfeld = screen.getByLabelText('Suchfeld') as HTMLInputElement
    suchfeld.focus()
    expect(document.activeElement).toBe(suchfeld)

    const convB = useChatStore.getState().createConversation(MODEL, '')
    act(() => { useChatStore.getState().setActiveConversation(convB) })

    // Das neue Textfeld existiert, aber der Fokus blieb im Suchfeld stehen.
    expect(document.activeElement).toBe(suchfeld)
  })

  it('NEGATIVKONTROLLE: Ctrl+N aus einem fremden Feld (Suchfeld) stiehlt dessen Fokus nicht', () => {
    const convA = useChatStore.getState().createConversation(MODEL, '')
    useChatStore.getState().setActiveConversation(convA)
    render(<Host />)

    const suchfeld = screen.getByLabelText('Suchfeld') as HTMLInputElement
    suchfeld.focus()
    expect(document.activeElement).toBe(suchfeld)

    act(() => {
      fireEvent.keyDown(suchfeld, { key: 'n', ctrlKey: true })
    })

    // Ctrl+N ausserhalb eines Composer-Feldes loest trotzdem den Wechsel aus
    // (shortcutOwner kennt nur EDITING_KEYS/NAV_KEYS als Feld-Ausnahmen),
    // aber die Fahne wurde nie gesetzt: das Suchfeld behaelt seinen Fokus.
    expect(document.activeElement).toBe(suchfeld)
  })
})
