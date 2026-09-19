/**
 * klaerung-n5a, Frage 1: `delegate_task` fiel unter denselben generischen
 * 60 s Werkzeug-Deckel wie jedes andere Werkzeug, obwohl sein Vordergrund-
 * zweig ABSICHTLICH lange laeuft (das `background`-Feld existiert nur dafuer,
 * siehe sub-agent.ts), und `Promise.race` brach den Verlierer nie ab, wenn
 * der Deckel doch zuschlug: der Sub-Agent lief verwaist weiter und hielt
 * seine lokale Spur, waehrend der Nutzer schon eine Fehlermeldung sah.
 *
 * Fix 1 (dieser Datei): `toolCallCapMs` gibt `delegate_task` (nur im
 * Vordergrund) und `run_workflow` keinen erreichbaren Deckel mehr, weil
 * beide ihre eigene Terminierung mitbringen (Iterations-/Schrittgrenze,
 * eigenes Stop-Signal). `check_tasks`/`message_agent` bleiben bewusst beim
 * generischen Deckel: sie lesen/schreiben nur den In-Memory-Task-Store, also
 * kann keiner von beiden je in die Naehe von 60 s kommen (Negativkontrolle).
 *
 * Fix 2 (dieser Datei): `raceWithToolTimeout` bricht den Verlierer jetzt
 * wirklich ab, statt ihn nur zu ignorieren.
 *
 * Lauf: npx vitest run src/lib/__tests__/tool-timeout.test.ts
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  toolCallCapMs,
  raceWithToolTimeout,
  NO_PRACTICAL_CAP_MS,
  SHELL_EXECUTE_DEFAULT_TIMEOUT_MS,
} from '../tool-timeout'

const settings = {}

describe('toolCallCapMs, Fix 1: wer bekommt keinen erreichbaren Deckel', () => {
  it('delegate_task im Vordergrund (kein background-Feld) bekommt den praktisch unerreichbaren Deckel', () => {
    expect(toolCallCapMs('delegate_task', {}, settings)).toBe(NO_PRACTICAL_CAP_MS)
    expect(toolCallCapMs('delegate_task', { goal: 'x' }, settings)).toBe(NO_PRACTICAL_CAP_MS)
    expect(toolCallCapMs('delegate_task', { background: false }, settings)).toBe(NO_PRACTICAL_CAP_MS)
  })

  it('Negativkontrolle: delegate_task IM HINTERGRUND behaelt den generischen 60 s Deckel', () => {
    // Der Hintergrundzweig bucht sich in Millisekunden selbst ein und kehrt
    // sofort zurueck (sub-agent.ts), er braucht keinen angehobenen Deckel,
    // und ein angehobener wuerde nur einen echten Haenger beim Start
    // verschleiern statt einen falschen zu vermeiden.
    expect(toolCallCapMs('delegate_task', { background: true }, settings)).toBe(60_000)
  })

  it('run_workflow bekommt denselben praktisch unerreichbaren Deckel, es hat kein background-Feld', () => {
    expect(toolCallCapMs('run_workflow', { name: 'x' }, settings)).toBe(NO_PRACTICAL_CAP_MS)
  })

  it('Negativkontrolle: check_tasks und message_agent bleiben beim generischen 60 s Deckel', () => {
    // Beide lesen/schreiben nur agentTaskStore, kein Lauf, kein I/O, anders
    // als delegate_task/run_workflow haben sie keine eigene Falle, die einen
    // angehobenen Deckel rechtfertigen wuerde.
    expect(toolCallCapMs('check_tasks', {}, settings)).toBe(60_000)
    expect(toolCallCapMs('message_agent', { task_id: 't1', message: 'x' }, settings)).toBe(60_000)
  })

  it('Negativkontrolle: ein voellig anderes Werkzeug bleibt unveraendert beim generischen Deckel', () => {
    expect(toolCallCapMs('file_read', { path: 'x' }, settings)).toBe(60_000)
  })

  it('shell_execute ist unveraendert: eigener Deckel + Gnadenfrist, unabhaengig von AGENT_LOOP_TOOLS', () => {
    expect(toolCallCapMs('shell_execute', {}, settings)).toBe(SHELL_EXECUTE_DEFAULT_TIMEOUT_MS + 15_000)
    expect(toolCallCapMs('shell_execute', { timeout: 5_000 }, settings)).toBe(5_000 + 15_000)
  })

  it('NO_PRACTICAL_CAP_MS bleibt unter dem 32-Bit-setTimeout-Ueberlauf (sonst feuert der Deckel sofort statt nie)', () => {
    expect(NO_PRACTICAL_CAP_MS).toBeLessThan(2 ** 31)
    expect(NO_PRACTICAL_CAP_MS).toBeGreaterThan(SHELL_EXECUTE_DEFAULT_TIMEOUT_MS)
  })
})

describe('raceWithToolTimeout, Fix 2: der Verlierer wird wirklich abgebrochen', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('wenn der Deckel zuschlaegt: die Ablehnung nennt Name+Sekunden, UND das an run() gereichte Signal ist abgebrochen', async () => {
    vi.useFakeTimers()
    let seenSignal: AbortSignal | undefined
    let signalWasAbortedWhenRejectFired = false
    const run = (signal: AbortSignal) => {
      seenSignal = signal
      return new Promise<string>(() => {}) // haengt absichtlich, wie ein verwaister Lauf vor dem Fix
    }

    const promise = raceWithToolTimeout('delegate_task', 1_000, run)
    const assertion = promise.catch((err: Error) => {
      // Zur Zeit der Ablehnung MUSS das Signal schon abgebrochen sein (Reihenfolge:
      // controller.abort() VOR reject(), siehe Kommentar in tool-timeout.ts).
      signalWasAbortedWhenRejectFired = seenSignal?.aborted === true
      return err.message
    })

    await vi.advanceTimersByTimeAsync(1_000)
    const message = await assertion

    expect(message).toBe('Tool execution timed out: delegate_task (1s)')
    expect(seenSignal?.aborted).toBe(true)
    expect(signalWasAbortedWhenRejectFired).toBe(true)
  })

  it('Negativkontrolle: gewinnt das Werkzeug vor dem Deckel, bleibt das Signal unabgebrochen und der Timer wird geraeumt', async () => {
    vi.useFakeTimers()
    let seenSignal: AbortSignal | undefined
    const run = (signal: AbortSignal) => {
      seenSignal = signal
      return Promise.resolve('real answer')
    }

    const result = await raceWithToolTimeout('file_read', 5_000, run)

    expect(result).toBe('real answer')
    expect(seenSignal?.aborted).toBe(false)

    // Der Timer ist im .finally() geraeumt (Audit B10): vorspulen darf jetzt
    // keine unbehandelte Ablehnung mehr ausloesen.
    let unhandled = false
    const onUnhandled = () => { unhandled = true }
    process.on('unhandledRejection', onUnhandled)
    await vi.advanceTimersByTimeAsync(10_000)
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toBe(false)
  })

  it('das Stop-Signal des Laufs (baseSignal) bricht sofort ab, ohne auf den Deckel zu warten', async () => {
    const baseController = new AbortController()
    let seenSignal: AbortSignal | undefined
    const run = (signal: AbortSignal) => {
      seenSignal = signal
      return new Promise<string>(() => {})
    }

    // baseSignal schon abgebrochen, BEVOR der Aufruf ueberhaupt beginnt,
    // genau der Fall, den toolRegistry.execute() als "cancelled before it
    // started" behandelt.
    baseController.abort()
    raceWithToolTimeout('delegate_task', 60_000, run, baseController.signal)

    expect(seenSignal?.aborted).toBe(true)
  })

  it('Negativkontrolle: ein baseSignal, das NIE abbricht, laesst run() unbeeinflusst laufen', async () => {
    const baseController = new AbortController()
    let seenSignal: AbortSignal | undefined
    const run = (signal: AbortSignal) => {
      seenSignal = signal
      return Promise.resolve('ok')
    }

    const result = await raceWithToolTimeout('file_read', 5_000, run, baseController.signal)
    expect(result).toBe('ok')
    expect(seenSignal?.aborted).toBe(false)
  })

  it('kein spaeteres Ergebnis des Verlierers erreicht noch irgendjemanden, nachdem der Deckel gewonnen hat', async () => {
    vi.useFakeTimers()
    let resolveLate: (v: string) => void = () => {}
    const run = () => new Promise<string>((res) => { resolveLate = res })

    const promise = raceWithToolTimeout('delegate_task', 100, run)
    const caught = promise.catch((err: Error) => err.message)

    await vi.advanceTimersByTimeAsync(100)
    const message = await caught
    expect(message).toMatch(/timed out/)

    // Der Verlierer loest jetzt SPAETER auf, nichts liest das mehr; die
    // Zusicherung ist: `promise` selbst bleibt fuer immer die Ablehnung von
    // oben, ein zweites .then/.catch auf demselben `promise` sieht dieselbe
    // Ablehnung, nie den spaeten Wert.
    resolveLate('LATE-RESULT, sollte nirgends ankommen')
    await vi.advanceTimersByTimeAsync(1)
    await expect(promise).rejects.toThrow(/timed out/)
  })
})
