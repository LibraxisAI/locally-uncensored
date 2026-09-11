import { afterEach, beforeEach, expect, it } from 'vitest'
import { useMemoryStore, __setMemoryEmbedFn, memoryMatchesScope } from '../memoryStore'

beforeEach(() => {
  useMemoryStore.setState({ entries: [] })
  __setMemoryEmbedFn(async () => [])
})
afterEach(() => __setMemoryEmbedFn())
const add = (scope?: string, content = 'Project fixture') => useMemoryStore.getState().addMemory({
  type: 'project', title: content, description: content, content, tags: [], source: 'manual', scope,
})

it('includes global and exact-project entries without crossing project boundaries', async () => {
  add(undefined, 'Global fixture')
  add('A', 'Alpha fixture')
  add('B', 'Beta fixture')
  const store = useMemoryStore.getState()
  expect(store.getMemoriesForPrompt('fixture', 8192)).toContain('Global fixture')
  expect(store.getMemoriesForPrompt('fixture', 8192)).not.toMatch(/Alpha|Beta/)
  expect(store.getMemoriesForPrompt('fixture', 8192, { scope: 'A' })).toContain('Alpha fixture')
  expect(await store.getMemoriesForPromptAsync('fixture', 8192, { scope: 'A' })).not.toContain('Beta fixture')
})
it('does not deduplicate the same fact across projects', () => {
  expect(add('A')).not.toBe('')
  expect(add('B')).not.toBe('')
  expect(add('A')).toBe('')
})
it('preserves JSON scope and never promotes malformed scope to global', () => {
  add('A')
  const json = useMemoryStore.getState().exportAsJSON()
  useMemoryStore.getState().clearAll()
  expect(useMemoryStore.getState().importFromJSON(json)).toBe(1)
  expect(useMemoryStore.getState().entries[0].scope).toBe('A')
  for (const scope of [null, 12, '', ' ']) {
    expect(useMemoryStore.getState().importFromJSON(JSON.stringify([{ content: 'bad scope', scope }]))).toBe(0)
  }
  expect(useMemoryStore.getState().exportAsMarkdown()).not.toContain('Project fixture')
})
it('rejects cross-project automatic merges and accepts matching scopes', () => {
  const targetId = add('A')
  const wrongId = add('B')
  const decision = { action: 'UPDATE' as const, targetId, mergedContent: 'Merged fixture' }
  useMemoryStore.getState().applyWriteDecision(decision, { newId: wrongId })
  expect(useMemoryStore.getState().entries[0].content).toBe('Project fixture')
  const newId = add('A', 'New fixture')
  useMemoryStore.getState().applyWriteDecision(decision, { newId })
  expect(useMemoryStore.getState().entries[0].content).toBe('Merged fixture')
})
it('pins the requested scope across asynchronous fallback', async () => {
  add('A', 'Alpha fixture')
  add('B', 'Beta fixture')
  let finish!: (value: number[][]) => void
  __setMemoryEmbedFn(() => new Promise(resolve => { finish = resolve }))
  const opts = { scope: 'A' }
  const pending = useMemoryStore.getState().getMemoriesForPromptAsync('fixture', 8192, opts)
  opts.scope = 'B'
  finish([])
  const result = await pending
  expect(result).toContain('Alpha fixture')
  expect(result).not.toContain('Beta fixture')
})
it('does not match absent or blank project IDs to scoped entries', () => {
  expect(memoryMatchesScope({ scope: 'A' })).toBe(false)
  expect(memoryMatchesScope({ scope: ' ' }, ' ')).toBe(false)
  expect(memoryMatchesScope({ scope: 'A' }, 'a')).toBe(false)
})
