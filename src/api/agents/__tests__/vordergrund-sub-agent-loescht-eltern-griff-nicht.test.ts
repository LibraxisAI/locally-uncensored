/**
 * BLOCKER 2 (Nachpruefung, bau/review-w2lane.md, Runde nach `1c9d8043`):
 * eine verschachtelte Buchung raeumt den Abbruchgriff des Elternzugs weg.
 *
 * Gemessen: ein Cloud-Elternzug registriert seinen eigenen Abbruchgriff
 * unter seiner Konversation (so macht es jeder Sendeweg, `run-slot.ts`).
 * Ein Vordergrund-Sub-Agent mit eigenem lokalem `model` legt dabei KEINEN
 * gueltigen `heldLocalLane`-Beweis vor (der Elternzug ist Cloud, haelt also
 * nichts), faellt auf normales Buchen zurueck, und bucht bis hierher unter
 * `run?.conversationId` -- also derselben Kennung wie der Elternzug.
 * `run-slot.ts`s normaler Buchungszweig registriert dabei rueckhaltlos einen
 * NEUEN Abbruchgriff unter dieser Kennung und LOESCHT ihn am Ende wieder,
 * ohne den vorgefundenen wiederherzustellen: der Elternzug verliert seinen
 * Griff, `stopAllBackgroundWork` (Abmelden, Fenster schliessen, App beenden)
 * erreicht ihn danach nicht mehr.
 *
 * Fix: der Vordergrund-Sub-Agent bucht seine eigene, normale (nicht
 * mitfahrende) Buchung unter einer PRIVATEN, eigenen Kennung, nie unter
 * `run?.conversationId` (sub-agent.ts, `buildDelegateExecutor`). Der
 * gehaltene Weg braucht den Wert ohnehin nicht (er schlaegt unter
 * `runsInHeldLane.conversationId` nach).
 *
 * Lauf: npx vitest run src/api/agents/__tests__/vordergrund-sub-agent-loescht-eltern-griff-nicht.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { buildDelegateExecutor, _setDepth, type SubAgentRunner } from '../sub-agent'
import { runInLane } from '../../../lib/run-slot'
import { useModelStore } from '../../../stores/modelStore'
import { useGenerationStore } from '../../../stores/generationStore'
import { localLaneHolder, __resetRunLanesForTests } from '../../../lib/run-lanes'
import type { AgentRunContext } from '../../agent-context'

/** No prefix means Ollama (model-name.ts), and Ollama defaults to this
 *  machine in tests (`isOllamaLocal()` with no configured base), so this
 *  model name resolves to the LOCAL lane via `laneOf`. */
const LOCAL_MODEL = 'qwen3:8b'

function makeRun(conversationId: string, heldLocalLane: AgentRunContext['heldLocalLane'] = null): AgentRunContext {
  return {
    token: 'run', chatId: null, conversationId, workspace: null,
    artifactMode: false, readOnlyShellTurn: false, mode: null, artifacts: [], heldLocalLane,
  }
}

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ activeModel: LOCAL_MODEL })
  _setDepth(0)
})

describe('ein Vordergrund-Sub-Agent unter einem Cloud-Elternzug mit eigenem lokalem Modell', () => {
  it('laesst den Abbruchgriff des Elternzugs unberuehrt, stopAllBackgroundWork erreicht ihn danach noch', async () => {
    let elternAbortCalled = false
    const runner: SubAgentRunner = async () => 'sub-agent fertig'
    const exec = buildDelegateExecutor(runner)

    await runInLane(
      { conversationId: 'eltern-conv', lane: 'cloud', abort: () => { elternAbortCalled = true } },
      async (held) => {
        // Cloud-Elternzug: `held` ist null, der Sub-Agent unten legt also
        // keinen gueltigen Beweis vor und muss normal buchen.
        expect(held).toBeNull()
        const antwort = await exec(
          { goal: 'x' },
          makeRun('eltern-conv', held),
        )
        expect(antwort).toBe('sub-agent fertig')

        // Der Sub-Agent ist fertig und hat seine eigene Buchung laengst
        // zurueckgegeben. Der Griff unter 'eltern-conv' MUSS trotzdem noch
        // der des Elternzugs sein, nicht geloescht und nicht durch einen
        // fremden ersetzt.
        expect(useGenerationStore.getState().aborters['eltern-conv']).toBeDefined()
        useGenerationStore.getState().aborters['eltern-conv']?.()
        expect(elternAbortCalled).toBe(true)
      },
    )

    // Nach Ende des Elternzugs selbst raeumt sein eigenes `finally` auf.
    expect(localLaneHolder()).toBeNull()
  })

  it('der Sub-Agent bucht dabei unter einer EIGENEN Kennung, nicht unter der des Elternzugs', async () => {
    let gesehenerHalterWaehrendDesSubAgenten: string | null = 'ungesehen'
    const runner: SubAgentRunner = async () => {
      gesehenerHalterWaehrendDesSubAgenten = localLaneHolder()
      return 'ok'
    }
    const exec = buildDelegateExecutor(runner)

    await runInLane({ conversationId: 'eltern-conv', lane: 'cloud' }, async (held) => {
      await exec({ goal: 'x' }, makeRun('eltern-conv', held))
    })

    // Die lokale Spur wurde waehrend des Sub-Agenten von IHM gehalten, nicht
    // von der (Cloud-)Kennung des Elternzugs, denn die haelt lokal ohnehin
    // nichts.
    expect(gesehenerHalterWaehrendDesSubAgenten).not.toBeNull()
    expect(gesehenerHalterWaehrendDesSubAgenten).not.toBe('eltern-conv')
  })
})

describe('GEGENPROBE: eine Buchung unter der fremden Kennung des Elternzugs loescht dessen Griff wirklich', () => {
  it('nachgebaut direkt gegen run-slot.ts: der Griff des Halters ist nach dem verschachtelten Lauf weg', async () => {
    // Derselbe Fehler wie vor dem Fix, direkt am Modul nachgemessen statt im
    // Sub-Agenten: ein Lauf, der KEINEN gueltigen Beweis vorlegt, bucht
    // trotzdem unter der Kennung eines fremden, noch laufenden Halters.
    let elternAbortCalled = false
    await runInLane(
      { conversationId: 'eltern-conv', lane: 'cloud', abort: () => { elternAbortCalled = true } },
      async () => {
        await runInLane({ conversationId: 'eltern-conv', lane: 'local' }, async () => {})
        // Der verschachtelte Lauf hat seinen eigenen Griff unter derselben
        // Kennung registriert und in seinem `finally` wieder geloescht, ohne
        // zu wissen, dass vorher der Griff des Elternzugs dort stand.
        expect(useGenerationStore.getState().aborters['eltern-conv']).toBeUndefined()
        // Ein Stop auf den Elternzug JETZT erreicht ihn nicht mehr:
        useGenerationStore.getState().aborters['eltern-conv']?.()
        expect(elternAbortCalled).toBe(false)
      },
    )
  })
})
