import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMemoryStore, __setMemoryEmbedFn } from '../memoryStore'

const embed = vi.fn(async () => [[1, 0]])
beforeEach(() => {
  useMemoryStore.setState({ entries: [] })
  embed.mockClear()
  __setMemoryEmbedFn(embed)
})
afterEach(() => __setMemoryEmbedFn())
const add = () => useMemoryStore.getState().addMemory({
  type: 'user', title: 'Private preference', description: 'Synthetic only',
  content: 'Synthetic private preference', tags: [], source: 'manual', sensitive: true,
})

it('excludes marked entries from sync, async and embedding backfill', async () => {
  add()
  expect(useMemoryStore.getState().getMemoriesForPrompt('private', 8192)).toBe('')
  expect(await useMemoryStore.getState().getMemoriesForPromptAsync('private', 8192)).toBe('')
  await useMemoryStore.getState().ensureMemoryEmbeddings()
  expect(embed).not.toHaveBeenCalled()
})
it('preserves sensitivity through JSON export/import and omits it from Markdown', () => {
  add()
  const json = useMemoryStore.getState().exportAsJSON()
  expect(useMemoryStore.getState().exportAsMarkdown()).not.toContain('Synthetic private')
  useMemoryStore.getState().clearAll()
  expect(useMemoryStore.getState().importFromJSON(json).added).toBe(1)
  expect(useMemoryStore.getState().entries[0].sensitive).toBe(true)
  expect(useMemoryStore.getState().getMemoriesForPrompt('private', 8192)).toBe('')
})
it('lets an explicit user unmark restore eligibility', () => {
  const id = add()
  useMemoryStore.getState().updateMemory(id, { sensitive: false })
  expect(useMemoryStore.getState().getMemoriesForPrompt('private', 8192)).toContain('Synthetic private')
})
it('does not let an automatic resolution modify a protected target', () => {
  const id = add()
  useMemoryStore.getState().applyWriteDecision({ action: 'UPDATE', targetId: id, mergedContent: 'Changed' })
  expect(useMemoryStore.getState().entries[0].content).toBe('Synthetic private preference')
})
