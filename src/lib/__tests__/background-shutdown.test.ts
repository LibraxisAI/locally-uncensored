/**
 * @vitest-environment jsdom
 *
 * B1 Nachbesserung 1 (Opus-Review, 3.0.1): der Orchestrator-Entscheid "Stop
 * heisst Stop" gilt fuer fuenf Ausloeser, gebaut war nur einer (der
 * Stop-Knopf). Dieses Modul (`lib/background-shutdown.ts`) ist die eine
 * Stelle, die die anderen vier bedient: App beenden, Fenster schliessen,
 * Netzabbruch (Abmelden hat seinen eigenen Test in
 * hooks/__tests__/signing-out-must-not-lie.test.ts, weil es dort schon die
 * ganze Sign-out-Vertragspruefung gibt). Je Ausloeser ein Fall.
 *
 * Lauf: npx vitest run src/lib/__tests__/background-shutdown.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/** Die Horcher, die `@tauri-apps/api/event`s `listen()` eingesammelt hat. */
const listeners: Record<string, ((e: unknown) => void)[]> = {}
const unlisten = vi.fn()
let tauriOn = false

vi.mock('../../api/backend', () => ({
  isTauri: () => tauriOn,
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, cb: (e: unknown) => void) => {
    ;(listeners[name] ??= []).push(cb)
    return unlisten
  },
}))

import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { isRunStopped, __resetRunStopsForTests } from '../run-stop'
import {
  stopAllBackgroundWork,
  installBackgroundShutdown,
  __resetBackgroundShutdownForTests,
} from '../background-shutdown'

function laufendeAufgabe(id: string, convId: string): AbortController {
  const controller = new AbortController()
  useAgentTaskStore.getState().start({
    id, convId, goal: 'x', context: '', background: true, startedAt: Date.now(), controller,
  })
  return controller
}

beforeEach(() => {
  useAgentTaskStore.setState({ byConv: {} })
  __resetRunStopsForTests()
  __resetBackgroundShutdownForTests()
  tauriOn = false
  for (const k of Object.keys(listeners)) delete listeners[k]
  unlisten.mockClear()
})
afterEach(() => {
  __resetBackgroundShutdownForTests()
})

describe('stopAllBackgroundWork', () => {
  it('cancels every running task in every conversation, not just the visible one', () => {
    const a = laufendeAufgabe('task-a', 'conv-A')
    const b = laufendeAufgabe('task-b', 'conv-B')

    stopAllBackgroundWork()

    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(true)
    expect(isRunStopped('conv-A')).toBe(true)
    expect(isRunStopped('conv-B')).toBe(true)
  })

  it('is a no-op when nothing is running, not a throw', () => {
    expect(() => stopAllBackgroundWork()).not.toThrow()
  })

  it('a finished task is left alone (nothing to cancel), but the conversation still gets the sticky Stop marker', () => {
    const c = laufendeAufgabe('task-done', 'conv-1')
    useAgentTaskStore.getState().finish('task-done', { status: 'done', output: 'ok', endedAt: Date.now() })

    stopAllBackgroundWork()

    // cancelAll only touches 'running' tasks, a done one keeps its own
    // signal untouched, but the conversation is marked stopped regardless,
    // exactly like a Stop press after the work already finished.
    expect(c.signal.aborted).toBe(false)
    expect(isRunStopped('conv-1')).toBe(true)
  })
})

describe('installBackgroundShutdown: App beenden (pagehide + beforeunload)', () => {
  it('pagehide stops every running background task', () => {
    installBackgroundShutdown()
    const c = laufendeAufgabe('task-x', 'conv-1')

    window.dispatchEvent(new Event('pagehide'))

    expect(c.signal.aborted).toBe(true)
    expect(isRunStopped('conv-1')).toBe(true)
  })

  it('beforeunload stops every running background task too: the earlier of the pair', () => {
    installBackgroundShutdown()
    const c = laufendeAufgabe('task-y', 'conv-1')

    window.dispatchEvent(new Event('beforeunload'))

    expect(c.signal.aborted).toBe(true)
  })
})

describe('installBackgroundShutdown: Netzabbruch (offline)', () => {
  it('a dropped connection stops every running background task', () => {
    installBackgroundShutdown()
    const c = laufendeAufgabe('task-z', 'conv-1')

    window.dispatchEvent(new Event('offline'))

    expect(c.signal.aborted).toBe(true)
    expect(isRunStopped('conv-1')).toBe(true)
  })
})

describe('installBackgroundShutdown: Fenster schliessen (app:hidden, nicht onCloseRequested)', () => {
  /**
   * main.rs intercepts CloseRequested with api.prevent_close() and hides to
   * the tray, the window's X does not quit this app. A JS onCloseRequested
   * listener would fire on that exact same click and stop every background
   * agent on a plain tray-hide, which is not what "Fenster schliessen" as a
   * Stop trigger should mean here. main.rs already relays that moment to the
   * frontend as `app:hidden` (useVoice.ts listens to it for the identical
   * reason, mic/playback must not keep running behind a hidden window), so
   * this module reuses that signal instead of registering a second listener
   * for the same event.
   */
  it('reacts to app:hidden and stops every running background task', async () => {
    tauriOn = true
    installBackgroundShutdown()
    await new Promise((r) => setTimeout(r, 0))

    expect(listeners['app:hidden']).toBeDefined()
    const c = laufendeAufgabe('task-w', 'conv-1')
    for (const cb of listeners['app:hidden']) cb(undefined)

    expect(c.signal.aborted).toBe(true)
    expect(isRunStopped('conv-1')).toBe(true)
  })

  it('does not register app:hidden outside Tauri (browser-dev / web build)', async () => {
    tauriOn = false
    installBackgroundShutdown()
    await new Promise((r) => setTimeout(r, 0))

    expect(listeners['app:hidden']).toBeUndefined()
  })
})

describe('installBackgroundShutdown: idempotent', () => {
  it('installing twice wires only one set of window listeners', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    installBackgroundShutdown()
    const callsAfterFirst = addSpy.mock.calls.length

    installBackgroundShutdown()

    expect(addSpy.mock.calls.length).toBe(callsAfterFirst)
    addSpy.mockRestore()
  })

  it('the uninstaller removes exactly what was installed', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const uninstall = installBackgroundShutdown()

    uninstall()

    expect(removeSpy.mock.calls.length).toBe(addSpy.mock.calls.length)
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
