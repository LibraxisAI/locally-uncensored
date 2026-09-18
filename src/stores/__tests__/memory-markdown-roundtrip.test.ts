/**
 * R2-25 (Logikkontrolle) / J (3.0.1-Liste): the Markdown export/import round
 * trip lost everything past a memory's first line — the rest of a multi-line
 * content, the source and the date — because the importer reads the export
 * one physical line at a time and a real line break inside `entry.content`
 * split ONE list item across several lines. See the comment on
 * `escapeMdContent` in `../memoryStore.ts` for the full mechanism.
 *
 * Run: npx vitest run src/stores/__tests__/memory-markdown-roundtrip.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useMemoryStore } from '../memoryStore'

function reset() {
  useMemoryStore.setState({
    entries: [], localEntries: [], accountCollections: {},
    memorySyncBaselines: {}, memorySyncPending: {}, activeMemoryOwner: null,
    memoryCollectionRevision: 0, lastSynced: 0,
  })
}

describe('memory markdown round trip — multi-line content', () => {
  beforeEach(reset)

  it('a multi-line content survives export + import unchanged, with source and date', () => {
    const multiline = 'Erste Zeile.\nZweite Zeile mit Details.\nDritte Zeile, Abschluss.'
    useMemoryStore.getState().addMemory({
      type: 'project',
      title: 'Mehrzeiliger Eintrag',
      description: multiline.slice(0, 120),
      content: multiline,
      tags: ['t1'],
      source: 'unit-test',
    })

    const md = useMemoryStore.getState().exportAsMarkdown()
    reset()
    const result = useMemoryStore.getState().importFromMarkdown(md)

    expect(result.added).toBe(1)
    const back = useMemoryStore.getState().entries[0]
    expect(back.content).toBe(multiline)
    expect(back.title).toBe('Mehrzeiliger Eintrag')
    expect(back.source).toBe('unit-test')
    // The date round-trips too — a lost date falls back to "now" (today),
    // which a same-day test cannot tell apart from a real bug. Assert the
    // export actually carries a source/date suffix on the item's own line
    // instead, which is the thing that was silently dropped before the fix.
    expect(md).toMatch(/\*\(unit-test\)\*, \d{4}-\d{2}-\d{2}/)
  })

  it('a content with a literal backslash-n survives too, not mistaken for a line break', () => {
    const literal = 'the path is C:\\nope\\here'
    useMemoryStore.getState().addMemory({
      type: 'project', title: 'Backslash', description: literal, content: literal,
      tags: [], source: 'unit-test',
    })
    const md = useMemoryStore.getState().exportAsMarkdown()
    reset()
    useMemoryStore.getState().importFromMarkdown(md)
    expect(useMemoryStore.getState().entries[0].content).toBe(literal)
  })

  it('the export is exactly one physical line per entry, even for multi-line content', () => {
    const multiline = 'a\nb\nc'
    useMemoryStore.getState().addMemory({
      type: 'user', title: 'Line count', description: multiline, content: multiline,
      tags: [], source: 'unit-test',
    })
    const md = useMemoryStore.getState().exportAsMarkdown()
    const itemLines = md.split('\n').filter((l) => l.startsWith('- '))
    expect(itemLines).toHaveLength(1)
  })
})
