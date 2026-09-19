/**
 * BLOCKER 3 (Nachpruefung 2, bau/review-w2lane.md, Kopf `a9ded97d`): ein
 * Arbeitsablauf nimmt dem laufenden Chat seinen Abbruchgriff.
 *
 * Gemessen: eine fremde Unterhaltung haelt die lokale Spur, in Unterhaltung
 * `a` laeuft ein Chat und hat seinen Abbruchgriff registriert, dann startet
 * aus dem Ablauf-Fenster ein Arbeitsablauf, der `activeConversationId` als
 * Buchungskennung nimmt (`useWorkflow.ts:30`) und sich anstellt.
 * `run-slot.ts` registrierte beim Anstellen seinen eigenen Griff unter
 * DERSELBEN Kennung und ueberschrieb damit den des laufenden Chats; am Ende
 * loeschte `aufraeumen` ihn ersatzlos. Solange der Ablauf wartete, rief
 * `abortConversation('a')` NUR den Griff des Ablaufs: der Nutzer drueckte
 * Stop, der Chat-Strom lief weiter und kostete weiter, und still gestorben
 * ist stattdessen der wartende Arbeitsablauf.
 *
 * Fix AN DER WURZEL in `run-slot.ts` (nicht an der Aufrufstelle): der
 * normale Buchungsweg merkt sich einen vorgefundenen Griff, verkettet ihn
 * mit dem eigenen (Stop erreicht BEIDE, solange beide leben), und schreibt
 * ihn im `finally` identitaetsgeprueft zurueck statt ihn zu loeschen. Das
 * deckt jeden Aufrufer, der sich eine Kennung mit einem anderen Halter
 * teilt, nicht nur `WorkflowEngine`.
 *
 * `WorkflowEngine.run()` bucht weiterhin bewusst unter `this.conversationId`
 * (nicht unter einer privaten Kennung wie der Sub-Agent seit `a9ded97d`):
 * ein aus dem Ablauf-Fenster gestarteter Arbeitsablauf teilt sich absichtlich
 * die sichtbare Unterhaltung (er schreibt seine Schritte dort hinein), eine
 * private Kennung wuerde die Wartezeile ("wartet auf die Grafikkarte") von
 * dieser Unterhaltung lösen. Siehe den Kommentar in `workflow-engine.ts`s
 * `run()`.
 *
 * Lauf: npx vitest run src/lib/__tests__/workflow-teilt-sich-unterhaltung-mit-laufendem-chat.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowEngine } from '../workflow-engine'
import { runInLane } from '../run-slot'
import { localLaneHolder, queuedRunIds, __resetRunLanesForTests } from '../run-lanes'
import { useGenerationStore } from '../../stores/generationStore'
import { useModelStore } from '../../stores/modelStore'
import { useMemoryStore } from '../../stores/memoryStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { stopAllBackgroundWork } from '../background-shutdown'
import { __resetRunStopsForTests } from '../run-stop'
import type { AgentWorkflow, WorkflowStep, WorkflowEngineCallbacks } from '../../types/agent-workflows'

const LOCAL_MODEL = 'qwen3:8b'

function noteStep(id: string): WorkflowStep {
  return {
    id, type: 'memory_save', label: id,
    memorySave: { type: 'reference', titleTemplate: id, contentTemplate: 'x', tags: [] },
  }
}

function workflowOf(steps: WorkflowStep[]): AgentWorkflow {
  return { id: 'wf', name: 'test', description: '', icon: 'Zap', steps, variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0 }
}

function callbacks(onError: (e: string) => void = () => {}): WorkflowEngineCallbacks {
  return {
    onStepStart: () => {}, onStepComplete: () => {}, onStepError: () => {},
    onWaitingForInput: () => {}, onComplete: () => {}, onError,
  }
}

function steuerbar() {
  let aufloesen!: () => void
  const versprechen = new Promise<void>((res) => { aufloesen = res })
  return { versprechen, aufloesen }
}

async function takte(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

beforeEach(() => {
  __resetRunLanesForTests()
  __resetRunStopsForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useModelStore.setState({ activeModel: LOCAL_MODEL })
  vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => 'mem-id')
})

describe("Opus' Messfall: ein Chat laeuft in 'a', ein Arbeitsablauf stellt sich unter derselben Kennung an", () => {
  it('Stop stoppt den Chat-Strom UND den wartenden Arbeitsablauf, danach ist kein Griff verwaist', async () => {
    let chatAbortCalled = false
    const chat = steuerbar()
    const chatLauf = runInLane(
      { conversationId: 'a', lane: 'local', abort: () => { chatAbortCalled = true; chat.aufloesen() } },
      async () => { await chat.versprechen },
    )
    await takte(3)
    expect(localLaneHolder()).toBe('a')

    const errors: string[] = []
    const engine = new WorkflowEngine(workflowOf([noteStep('x')]), 'a', callbacks((e) => errors.push(e)))
    const ablaufLauf = engine.run()
    await takte(3)

    // Aufbau wie im Messfall: der Chat haelt, der Arbeitsablauf steht in der
    // Schlange unter derselben Kennung.
    expect(queuedRunIds()).toEqual(['a'])
    expect(localLaneHolder()).toBe('a')

    // Stop, derselbe Griff, den ein Stop-Knopf in der Unterhaltung riefe.
    useGenerationStore.getState().aborters['a']?.()

    const [ablaufErgebnis] = await Promise.all([ablaufLauf, chatLauf])

    // Beide sind getroffen: der Chat-Strom (sein eigener Abbruch wurde
    // gerufen) und der wartende Arbeitsablauf (kein Schritt lief je an).
    expect(chatAbortCalled).toBe(true)
    expect(ablaufErgebnis).toEqual([])
    expect(errors.join(' ')).toMatch(/Cancelled before it could start/)

    // Kein Griff verwaist: nichts laeuft mehr unter 'a', also ist auch
    // nichts mehr registriert.
    expect(useGenerationStore.getState().aborters['a']).toBeUndefined()
    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
  })

  it('dasselbe ueber stopAllBackgroundWork (Abmelden, Fenster schliessen, App beenden)', async () => {
    let chatAbortCalled = false
    const chat = steuerbar()
    const chatLauf = runInLane(
      { conversationId: 'a', lane: 'local', abort: () => { chatAbortCalled = true; chat.aufloesen() } },
      async () => { await chat.versprechen },
    )
    await takte(3)

    const errors: string[] = []
    const engine = new WorkflowEngine(workflowOf([noteStep('x')]), 'a', callbacks((e) => errors.push(e)))
    const ablaufLauf = engine.run()
    await takte(3)
    expect(queuedRunIds()).toEqual(['a'])

    stopAllBackgroundWork()

    const [ablaufErgebnis] = await Promise.all([ablaufLauf, chatLauf])

    expect(chatAbortCalled).toBe(true)
    expect(ablaufErgebnis).toEqual([])
    expect(errors.join(' ')).toMatch(/Cancelled before it could start/)
    expect(useGenerationStore.getState().aborters['a']).toBeUndefined()
    expect(localLaneHolder()).toBeNull()
  })
})

describe('NEGATIVKONTROLLE: ohne einen zweiten, sich die Kennung teilenden Lauf aendert der Fix nichts am einfachen Fall', () => {
  it('ein Arbeitsablauf allein in seiner Unterhaltung: Stop trifft ihn, der Griff ist danach sauber weg', async () => {
    // Ein `user_input`-Schritt haelt den Lauf an, bis der Test antwortet,
    // sonst waere der synchrone memory_save-Schritt schon durch, bevor
    // ueberhaupt geprueft werden kann, dass er noch laeuft.
    const step: WorkflowStep = { id: 'warte', type: 'user_input', label: 'warte', userInputPrompt: 'weiter?' }
    const errors: string[] = []
    const engine = new WorkflowEngine(workflowOf([step]), 'allein', callbacks((e) => errors.push(e)))
    const ablaufLauf = engine.run()
    await takte(2)
    expect(localLaneHolder()).toBe('allein')

    useGenerationStore.getState().aborters['allein']?.()
    await ablaufLauf

    expect(useGenerationStore.getState().aborters['allein']).toBeUndefined()
    expect(localLaneHolder()).toBeNull()
  })

  it('ein Chat allein: sein eigener Griff bleibt unveraendert erreichbar, bis er selbst fertig ist', async () => {
    let chatAbortCalled = false
    const chat = steuerbar()
    const chatLauf = runInLane(
      { conversationId: 'nur-chat', lane: 'local', abort: () => { chatAbortCalled = true; chat.aufloesen() } },
      async () => { await chat.versprechen },
    )
    await takte(2)
    expect(useGenerationStore.getState().aborters['nur-chat']).toBeDefined()

    useGenerationStore.getState().aborters['nur-chat']?.()
    await chatLauf

    expect(chatAbortCalled).toBe(true)
    expect(useGenerationStore.getState().aborters['nur-chat']).toBeUndefined()
  })
})
