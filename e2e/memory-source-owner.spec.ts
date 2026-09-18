import { expect, test } from '@playwright/test'

test('colliding IDs across local and account collections cannot relabel an answer source', async ({ page }) => {
  await page.goto('/e2e/memory-sources-proof.html')
  await page.getByRole('button', { name: 'Create sourced answer', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Answer save completed')
  await page.evaluate(async () => {
    const memoryPath = '/src/stores/memoryStore.ts'
    const authPath = '/src/stores/cloudAuthStore.ts'
    const { useMemoryStore } = await import(memoryPath) as typeof import('../src/stores/memoryStore')
    const { useCloudAuthStore } = await import(authPath) as typeof import('../src/stores/cloudAuthStore')
    const original = useMemoryStore.getState().entries[0]
    useCloudAuthStore.getState().setSignedIn({ id: 'owner-a' }, { licenseActive: false, tier: null, access: true, quota: null })
    useMemoryStore.getState().selectMemoryCollection('owner-a')
    useMemoryStore.setState({ entries: [{ ...original, title: 'Account A source' }] })
  })
  // Legacy local source IDs must not bind to account records with the same ID.
  await expect(page.getByText('Memory sources (1)', { exact: true })).toHaveCount(0)
  await page.evaluate(async () => {
    const path = '/src/stores/chatStore.ts'
    const { useChatStore, flushChatPersist } = await import(path) as typeof import('../src/stores/chatStore')
    const conversation = useChatStore.getState().getActiveConversation()!
    const message = conversation.messages.find(item => item.role === 'assistant')!
    useChatStore.getState().updateMessageMemorySources(conversation.id, message.id, { ...message.memorySources!, owner: 'owner-a' })
    await flushChatPersist()
  })
  await page.getByText('Memory sources (1)', { exact: true }).click()
  await expect(page.getByText('Account A source', { exact: true })).toBeVisible()
  await expect(page.getByText('Chat: Original proof conversation', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Original source unavailable', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const memoryPath = '/src/stores/memoryStore.ts'
    const authPath = '/src/stores/cloudAuthStore.ts'
    const { useMemoryStore } = await import(memoryPath) as typeof import('../src/stores/memoryStore')
    const { useCloudAuthStore } = await import(authPath) as typeof import('../src/stores/cloudAuthStore')
    const original = useMemoryStore.getState().entries[0]
    useCloudAuthStore.getState().setSignedIn({ id: 'owner-b' }, { licenseActive: false, tier: null, access: true, quota: null })
    useMemoryStore.getState().selectMemoryCollection('owner-b')
    useMemoryStore.setState({ entries: [{ ...original, title: 'Account B source' }] })
  })
  await expect(page.getByText('Memory sources (1)', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Account B source', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Synthetic answer', { exact: true })).toBeVisible()
})
