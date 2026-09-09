import { expect, test } from '@playwright/test'
import { tauriMockInit, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'
import { openNewChat } from './support/ui'
import { isRecord } from './support/recorded'
import type { MemoryFile } from '../src/types/agent-mode'

for (const mode of ['Chat', 'Agent', 'Code'] as const) {
  test(`${mode} sends selected memory and records matching answer sources`, async ({ page }, testInfo) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.route('**/*', route => {
      const hostname = new URL(route.request().url()).hostname
      return hostname === 'localhost' || hostname === '127.0.0.1' ? route.continue() : route.abort()
    })
    await page.addInitScript(tauriMockInit, {
      assistantReply: 'SOURCEPROOF answer from the transport fixture.',
      modelName: DEFAULT_MODEL_NAME,
    })
    await seedOnboardingDone(page)
    await page.goto('/')
    if (mode === 'Code') await page.getByRole('button', { name: 'Code', exact: true }).click()
    await openNewChat(page)
    if (mode === 'Agent') {
      const toggle = page.getByRole('main').getByRole('button', { name: 'Agent', exact: true })
      await toggle.click()
      await page.getByRole('button', { name: /^Sandbox/ }).click()
      await expect(toggle).toHaveAttribute('title', /Agent Mode is on/i)
    }
    // Seed only input state. Retrieval, hooks, provider serialization, answer
    // mutation and rendering all remain production code.
    await page.evaluate(async () => {
      const memoryPath = '/src/stores/memoryStore.ts'
      const chatPath = '/src/stores/chatStore.ts'
      const memory = await import(/* @vite-ignore */ memoryPath) as typeof import('../src/stores/memoryStore')
      const chat = await import(/* @vite-ignore */ chatPath) as typeof import('../src/stores/chatStore')
      await memory.useMemoryStore.persist.rehydrate()
      memory.__setMemoryEmbedFn(async () => [])
      const entry = (id: string, extra: Partial<MemoryFile> = {}): MemoryFile => ({
        id, title: `Sourceproof ${id}`, content: `SOURCEPROOF_${id}`, description: '', type: 'user',
        tags: [], source: 'manual', createdAt: Date.now(), updatedAt: Date.now(), ...extra,
      })
      memory.useMemoryStore.setState({ entries: [entry('global'), entry('project', { scope: 'proof' }),
        entry('private', { sensitive: true }), entry('foreign', { scope: 'other' }), entry('stale', { stale: true })] })
      const active = chat.useChatStore.getState().activeConversationId
      if (!active) throw new Error('No active proof conversation')
      chat.useChatStore.getState().setConversationMemoryScope(active, 'proof')
    })
    const composer = page.locator('textarea').first()
    await expect(composer).toBeEnabled()
    await composer.fill('sourceproof preferences please')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByRole('main').getByText('SOURCEPROOF answer from the transport fixture.', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible({ timeout: 30_000 })
    const result = await page.evaluate(async () => {
      const chatPath = '/src/stores/chatStore.ts'
      const chat = await import(/* @vite-ignore */ chatPath) as typeof import('../src/stores/chatStore')
      await chat.flushChatPersist()
      const active = chat.useChatStore.getState().getActiveConversation()
      const answer = active?.messages.find(message => message.role === 'assistant')
      const bodies: unknown = Reflect.get(window, '__E2E_CHAT_BODIES__')
      if (!Array.isArray(bodies) || !bodies.every(body => typeof body === 'string')) throw new Error('Missing transport bodies')
      return { sources: answer?.memorySources, bodies: bodies as string[] }
    })
    expect(result.sources).toEqual({ ids: ['global', 'project'], scope: 'proof' })
    const body = result.bodies.find(value => value.includes('sourceproof preferences please'))
    expect(body).toBeDefined()
    const payload: unknown = JSON.parse(body!)
    if (!isRecord(payload) || !Array.isArray(payload.messages)) throw new Error('Missing provider messages')
    const system = payload.messages.filter(isRecord).filter(message => message.role === 'system').map(message => message.content).join('\n')
    expect(system).toContain('<remembered_context>')
    expect(system).toContain('SOURCEPROOF_global')
    expect(system).toContain('SOURCEPROOF_project')
    for (const excluded of ['private', 'foreign', 'stale']) expect(body).not.toContain(`SOURCEPROOF_${excluded}`)
    await page.getByText('Memory sources (2)', { exact: true }).click()
    await expect(page.getByText('Sourceproof project', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('memory-hook-sources.png') })
    await page.reload()
    await page.getByText('Memory sources (2)', { exact: true }).click()
    await expect(page.getByText('Sourceproof project', { exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  })
}
