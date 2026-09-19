/**
 * `runsInHeldLane`, die explizite Weitergabe des Elternlauf-Tokens
 * (Folgeauftrag 3, review-lanes.md; Punkt b/c der Runde-3-Nachbesserung,
 * bau/review-lanes.md "Runde 3 der Pruefung").
 *
 * Zwei echte verschachtelte Aufrufer sind inzwischen da: `run_workflow`
 * (verschachtelt in einen schon laufenden Werkzeugaufruf) und der
 * VORDERGRUND-Sub-Agent (`sub-agent.ts`, `return await runner(...)`). Beide
 * werden von ihrem Elternlauf ABGEWARTET, laufen also im selben
 * Aufrufrahmen. Ein zweites `admit` fuer dieselbe `conversationId` waere hier
 * KEINE zweite Buchung, sondern eine Verklemmung: der innere Aufruf stellt
 * sich hinter den aeusseren, der aeussere wartet aber auf den inneren, bevor
 * er selbst freigibt. Beide fuer immer.
 *
 * Lauf: npx vitest run src/lib/__tests__/run-slot-nested-in-held-lane.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { localLaneHolder, queuedRunIds, __resetRunLanesForTests } from '../run-lanes'
import { runInLane } from '../run-slot'
import { useGenerationStore } from '../../stores/generationStore'

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
})

async function takte(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('mit dem Marker: der verschachtelte Aufruf laeuft sofort im gehaltenen Platz mit', () => {
  it('ein abgewarteter innerer Aufruf mit runsInHeldLane laeuft durch, statt sich anzustellen', async () => {
    let innerRan = false
    let innerOutcome: string | undefined
    const outerOutcome = await runInLane({ conversationId: 'a', lane: 'local' }, async () => {
      innerOutcome = await runInLane(
        { conversationId: 'a', lane: 'local', runsInHeldLane: true },
        async () => { innerRan = true },
      )
    })

    expect(innerRan).toBe(true)
    expect(innerOutcome).toBe('ran')
    expect(outerOutcome).toBe('ran')
    // Ganz am Ende gibt der AEUSSERE Lauf frei, kein doppeltes release.
    expect(localLaneHolder()).toBeNull()
  })

  it('der innere Lauf taucht dabei nirgends in der Warteschlange auf', async () => {
    let sahSchlange: string[] = ['ungesehen']
    let sahHalter: string | null = 'ungesehen'
    await runInLane({ conversationId: 'a', lane: 'local' }, async () => {
      await runInLane({ conversationId: 'a', lane: 'local', runsInHeldLane: true }, async () => {
        sahSchlange = queuedRunIds()
        sahHalter = localLaneHolder()
      })
    })
    expect(sahSchlange).toEqual([])
    expect(sahHalter).toBe('a')
  })

  it('ein DRITTER, echt wartender Lauf stellt sich hinter dem AEUSSEREN an, nicht hinter dem Marker-Lauf', async () => {
    // Der Marker-Lauf nimmt in der Schlange keinen Platz weg, also darf ein
    // echter dritter Aufrufer nicht auf ihn warten muessen.
    let dritterLief = false
    const aeussererLauf = runInLane({ conversationId: 'a', lane: 'local' }, async () => {
      await runInLane({ conversationId: 'a', lane: 'local', runsInHeldLane: true }, async () => {})
    })
    const dritterLauf = runInLane({ conversationId: 'c', lane: 'local' }, async () => { dritterLief = true })

    await aeussererLauf
    await dritterLauf
    expect(dritterLief).toBe(true)
  })

  it('Fehler aus dem inneren Lauf kommen aus dem aeusseren `runInLane` unveraendert heraus', async () => {
    await expect(
      runInLane({ conversationId: 'a', lane: 'local' }, async () => {
        await runInLane({ conversationId: 'a', lane: 'local', runsInHeldLane: true }, async () => {
          throw new Error('innen kaputt')
        })
      }),
    ).rejects.toThrow('innen kaputt')
    expect(localLaneHolder()).toBeNull()
  })
})

describe('GEGENPROBE: ohne den Marker haengt genau der Fall, den der Dateikopf beschreibt', () => {
  it('ein abgewarteter innerer Aufruf OHNE runsInHeldLane laeuft nie an', async () => {
    let innerRan = false
    let aeussererFertig = false
    // Absichtlich NICHT awaited: mit der alten, geratenen Zuordnung
    // ("dieselbe conversationId ist derselbe Lauf") wuerde das hier haengen.
    // Ohne den expliziten Marker gilt seit Blocker A "jeder Aufruf ist ein
    // eigener Lauf" (run-lanes.ts), also stellt sich der innere Aufruf mit
    // einer NEUEN Identitaet hinter den aeusseren an, waehrend der aeussere
    // Rumpf auf genau diesen inneren Aufruf wartet. Ein `await` auf das
    // Ergebnis wuerde den Test selbst haengen lassen, das IST die Verklemmung.
    void runInLane({ conversationId: 'a', lane: 'local' }, async () => {
      await runInLane({ conversationId: 'a', lane: 'local' }, async () => { innerRan = true })
    }).then(() => { aeussererFertig = true })

    await takte()

    expect(innerRan).toBe(false)
    expect(aeussererFertig).toBe(false)
    // Die Unterhaltung steht hinter sich selbst in ihrer eigenen Schlange:
    // genau der Befund, den `runsInHeldLane` vermeidet.
    expect(localLaneHolder()).toBe('a')
    expect(queuedRunIds()).toEqual(['a'])
  })
})
