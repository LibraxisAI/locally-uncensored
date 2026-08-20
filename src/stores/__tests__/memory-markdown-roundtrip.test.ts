import { describe, it, expect, beforeEach } from 'vitest'
import { useMemoryStore } from '../memoryStore'

/**
 * Der Markdown-Rundlauf muss halten, was die zwei Knoepfe versprechen:
 * exportieren, importieren, derselbe Eintrag. Vorher schrieb der Export
 * ein Komma zwischen Titel und Inhalt und der Import erwartete einen
 * Gedankenstrich, also wurde der Titel zur ganzen Zeile und der Inhalt
 * war weg.
 */
describe('memory markdown roundtrip', () => {
  beforeEach(() => {
    useMemoryStore.setState({ entries: [] })
  })

  it('traegt Titel, Inhalt, Tags und Quelle durch Export und Import', () => {
    const s = useMemoryStore.getState()
    s.addMemory({
      type: 'project',
      title: 'Ships on Fridays',
      description: 'release cadence',
      content: 'The team ships on Fridays, never on Mondays.',
      tags: ['release', 'cadence'],
      source: 'chat',
    })

    const md = useMemoryStore.getState().exportAsMarkdown()
    useMemoryStore.setState({ entries: [] })
    const zahl = useMemoryStore.getState().importFromMarkdown(md)

    expect(zahl).toBe(1)
    const [zurueck] = useMemoryStore.getState().entries
    expect(zurueck.title).toBe('Ships on Fridays')
    expect(zurueck.content).toBe('The team ships on Fridays, never on Mondays.')
    expect(zurueck.tags).toEqual(['release', 'cadence'])
    expect(zurueck.source).toBe('chat')
    expect(zurueck.type).toBe('project')
  })

  it('nimmt auch das alte Format mit Gedankenstrich als Trenner an', () => {
    const zahl = useMemoryStore.getState().importFromMarkdown(
      '# Memory\n\n## Project\n\n- **Old title** — old content *(chat)*, 1/1/2026\n'
    )
    expect(zahl).toBe(1)
    const [zurueck] = useMemoryStore.getState().entries
    expect(zurueck.title).toBe('Old title')
    expect(zurueck.content).toBe('old content')
  })
})
