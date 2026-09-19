/**
 * @vitest-environment jsdom
 *
 * F1, N9-Nachtest Windows-Box (David, 19.09.2026, box-gruen/n2/BERICHT.md
 * Teil A): "+ New Chat" legt sofort eine aktive, aber leere Unterhaltung an
 * (`createConversation` in chatStore.ts setzt `activeConversationId`
 * synchron). Bei AUFGEKLAPPTER Seitenleiste (dem Normalzustand) griff die
 * alte Bedingung `showRecentsAboveComposer = !sidebarOpen && activeConvIsEmpty`
 * nie, und `<MessageList>` mit null Nachrichten zeichnet selbst keinen
 * Platzhalter. Ergebnis: ein vollstaendig leerer Hauptbereich, reproduzierbar
 * auch nach vollem Neuladen (auf der Windows-Box zweimal beobachtet), bis ein
 * Wechsel auf einen anderen Reiter `activeConversationId` ueber
 * `Sidebar.tsx` (Klick auf "Chat") auf `null` zurueckstellt und dabei den
 * ECHTEN Leerzustand zeigt.
 *
 * Dieser Test haelt fest: eine aktive, leere Unterhaltung zeigt den
 * Leerzustand-Block ("Ask LU anything") IMMER, unabhaengig vom
 * Seitenleisten-Zustand, nicht nur wenn `activeConversationId === null`
 * ist. Die Liste der letzten Chats bleibt darin weiterhin nur bei
 * zugeklappter Seitenleiste (D-S06, siehe home-recent-chats.test.ts).
 *
 * Run: npx vitest run src/components/chat/__tests__/leer-aktive-unterhaltung.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { ChatView } from '../ChatView'
import { useUIStore } from '../../../stores/uiStore'
import { useChatStore } from '../../../stores/chatStore'
import { useCompareStore } from '../../../stores/compareStore'
import { useModelStore } from '../../../stores/modelStore'
import type { Conversation } from '../../../types/chat'

vi.mock('../VoiceButton', () => ({ VoiceButton: () => null }))

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0)
const conv = (id: string, title: string, updatedAt: number): Conversation => ({
  id, title, messages: [], model: 'test-model', systemPrompt: '', mode: 'lu',
  createdAt: updatedAt, updatedAt,
})

beforeEach(() => {
  useCompareStore.setState({ isComparing: false })
  useModelStore.setState({ activeModel: 'test-model', models: [{ name: 'test-model' } as never] })
  useChatStore.setState({
    conversations: [conv('fresh', 'New Chat', NOW)],
    activeConversationId: 'fresh',
  })
})

afterEach(() => {
  cleanup()
})

describe('F1: eine aktive, leere Unterhaltung zeigt nie einen komplett leeren Hauptbereich', () => {
  it('aufgeklappte Seitenleiste: der Leerzustand-Block steht trotzdem da (vorher: GAR NICHTS)', () => {
    useUIStore.setState({ sidebarOpen: true })
    render(createElement(ChatView))
    expect(screen.getByTestId('chat-landing')).toBeTruthy()
    expect(screen.getByText('Ask LU anything')).toBeTruthy()
  })

  it('aufgeklappte Seitenleiste: keine zweite Chat-Liste im Hauptbereich (Doppelung mit der Seitenleiste)', () => {
    useUIStore.setState({ sidebarOpen: true })
    render(createElement(ChatView))
    expect(screen.queryByTestId('home-recent-chats')).toBeNull()
  })

  it('zugeklappte Seitenleiste: derselbe Block, plus die Liste der letzten Chats darin', () => {
    useChatStore.setState({
      conversations: [conv('a', 'Yesterdays thread', NOW - 3600_000), conv('fresh', 'New Chat', NOW)],
      activeConversationId: 'fresh',
    })
    useUIStore.setState({ sidebarOpen: false })
    render(createElement(ChatView))
    expect(screen.getByTestId('chat-landing')).toBeTruthy()
    expect(screen.getByText('Ask LU anything')).toBeTruthy()
    expect(screen.getByTestId('home-recent-chats').textContent).toContain('Yesterdays thread')
  })

  it('NEGATIVKONTROLLE: sobald die erste Nachricht da ist, weicht der Block dem Transkript', () => {
    useUIStore.setState({ sidebarOpen: true })
    useChatStore.setState({
      conversations: [{
        ...conv('fresh', 'New Chat', NOW),
        messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: NOW }],
      }],
      activeConversationId: 'fresh',
    })
    render(createElement(ChatView))
    expect(screen.queryByTestId('chat-landing')).toBeNull()
  })

  it('NEGATIVKONTROLLE: keine aktive Unterhaltung bleibt der bekannte Leerzustand (unveraendert)', () => {
    useUIStore.setState({ sidebarOpen: true })
    useChatStore.setState({ conversations: [], activeConversationId: null })
    render(createElement(ChatView))
    expect(screen.getByTestId('chat-landing')).toBeTruthy()
  })
})
