/**
 * klaerung-n5a, Frage 1, Fix 1: `delegate_task` fiel unter denselben
 * generischen 60 s Werkzeug-Deckel wie jedes andere Werkzeug, obwohl sein
 * Vordergrundzweig ABSICHTLICH lange laeuft (das `background`-Feld existiert
 * nur dafuer, siehe sub-agent.ts). `run_workflow` sass in derselben Falle.
 *
 * `toolCallCapMs` gibt beiden im Vordergrund keinen erreichbaren Deckel mehr,
 * weil beide ihre eigene Terminierung mitbringen (Iterations-/Schrittgrenze,
 * eigenes Stop-Signal). `check_tasks`/`message_agent` bleiben bewusst beim
 * generischen Deckel: sie lesen/schreiben nur den In-Memory-Task-Store, also
 * kann keiner von beiden je in die Naehe von 60 s kommen (Negativkontrolle).
 *
 * Fix 2 (dass ein zuschlagender Deckel den Verlierer auch wirklich abbricht)
 * ist ein separater Nachtrag zu dieser Datei.
 *
 * Lauf: npx vitest run src/lib/__tests__/tool-timeout.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  toolCallCapMs,
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
