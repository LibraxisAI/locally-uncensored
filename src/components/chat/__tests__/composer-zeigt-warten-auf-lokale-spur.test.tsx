/**
 * @vitest-environment jsdom
 *
 * Runde 4 (review-lanes.md Blocker 1+6, Schritt 2): a send that is queued
 * behind another local run must be VISIBLE in the waiting conversation
 * (English line, disappears once it starts) and Stop must still work while
 * it waits.
 *
 * Two levels:
 *  - `ChatInput` itself: given `waitingForLocalLane`, does it show the right
 *    line and the Stop button (not Send), and does clicking Stop still call
 *    `onStop`?
 *  - `useIsQueuedForLocalLane`: does the hook that feeds that prop actually
 *    react to the real `lib/run-lanes.ts` queue (admit/release), the same
 *    module state the three send paths now book into via `runInLane`?
 *
 * Nachtrag Schritt 4: dieser Datei fehlt inzwischen ein COUNTER-CHECK gegen
 * `busyElsewhere`, das gab es hier einmal. `busyElsewhere` selbst ist mit
 * Schritt 4 aus `ChatInput` verschwunden (composer-busy.ts und ChatInput.tsx
 * sperren nur noch die eigene Unterhaltung), also gibt es nichts mehr, das
 * diese Wartezeile verdraengen koennte.
 *
 * Nachtrag Schritt 5 (Aufraeumen): `runQueuePosition` aus `lib/run-lanes.ts`
 * hatte bis dahin keinen Aufrufer ausser seinem eigenen Test. Statt es zu
 * loeschen, speist es jetzt die Wartezeile mit einer echten Zahl
 * (`useLocalLaneQueuePosition`), belegt am Ende dieser Datei.
 *
 * Run: npx vitest run src/components/chat/__tests__/composer-zeigt-warten-auf-lokale-spur.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, renderHook, act } from '@testing-library/react'
import { ChatInput } from '../ChatInput'
import { useIsQueuedForLocalLane, useLocalLaneQueuePosition } from '../../../lib/run-idle'
import { admit, release, __resetRunLanesForTests } from '../../../lib/run-lanes'

beforeEach(() => __resetRunLanesForTests())
afterEach(() => cleanup())

describe('ChatInput waehrend des Wartens auf die lokale Spur', () => {
  it('zeigt die englische Wartezeile und den Stop-Knopf statt Senden', () => {
    let stopped = 0
    render(
      <ChatInput
        onSend={() => { throw new Error('must not send while queued') }}
        onStop={() => { stopped += 1 }}
        isGenerating={true}
        waitingForLocalLane={true}
      />,
    )
    const line = screen.getByTestId('composer-waiting-local-lane')
    expect(line.textContent).toContain('Waiting for the local model to finish another answer')
    expect(line.getAttribute('role')).toBe('status')

    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()
    const stopBtn = screen.getByRole('button', { name: 'Stop generation' })
    fireEvent.click(stopBtn)
    expect(stopped).toBe(1)
  })

  it('die Zeile verschwindet, sobald der Lauf nicht mehr wartet', () => {
    render(
      <ChatInput onSend={() => {}} onStop={() => {}} isGenerating={false} waitingForLocalLane={false} />,
    )
    expect(screen.queryByTestId('composer-waiting-local-lane')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy()
  })

  it('nennt die Zahl der Wartenden davor, wenn mehr als einer wartet', () => {
    render(
      <ChatInput onSend={() => {}} onStop={() => {}} isGenerating={true} waitingForLocalLane={true} localLaneQueuePosition={3} />,
    )
    const line = screen.getByTestId('composer-waiting-local-lane')
    expect(line.textContent).toContain('2 more chats ahead of this one')
  })

  it('sagt nichts zur Position, wenn diese Unterhaltung als Naechste dran ist', () => {
    render(
      <ChatInput onSend={() => {}} onStop={() => {}} isGenerating={true} waitingForLocalLane={true} localLaneQueuePosition={1} />,
    )
    const line = screen.getByTestId('composer-waiting-local-lane')
    expect(line.textContent).not.toMatch(/ahead of/)
  })
})

describe('useLocalLaneQueuePosition reagiert auf die echte Warteschlange', () => {
  it('zaehlt die Position hoch und wieder herunter, wenn Wartende dazukommen und abbrechen', () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useLocalLaneQueuePosition(id), {
      initialProps: { id: 'conv-c' },
    })
    expect(result.current).toBeNull()

    act(() => {
      admit('local', 'conv-a', () => {})
      admit('local', 'conv-b', () => {})
      admit('local', 'conv-c', () => {})
    })
    rerender({ id: 'conv-c' })
    expect(result.current).toBe(2)

    act(() => {
      // b gives up waiting before its turn: c moves up one place, a still
      // holds the lane so c is not promoted yet.
      release('conv-b')
    })
    rerender({ id: 'conv-c' })
    expect(result.current).toBe(1)
  })
})

describe('useIsQueuedForLocalLane reagiert auf die echte Warteschlange', () => {
  it('wird wahr, waehrend die Unterhaltung wartet, und wieder falsch, sobald sie dran ist', () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useIsQueuedForLocalLane(id), {
      initialProps: { id: 'conv-b' },
    })
    expect(result.current).toBe(false)

    act(() => {
      // conv-a holds the lane first, so conv-b's admit queues instead of starting.
      admit('local', 'conv-a', () => {})
      admit('local', 'conv-b', () => {})
    })
    rerender({ id: 'conv-b' })
    expect(result.current).toBe(true)

    act(() => {
      // conv-a releases the lane; conv-b is promoted out of the queue.
      release('conv-a')
    })
    rerender({ id: 'conv-b' })
    expect(result.current).toBe(false)
  })
})
