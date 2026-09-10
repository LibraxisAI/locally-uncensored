import { expect, test, type Page } from '@playwright/test'
import type { SyncedMemoryRecord } from '../src/api/cloud/memory-sync'
import { isRecord } from './support/recorded'

async function accountFixture(page: Page) {
  await page.evaluate(async () => {
    const authPath = '/src/stores/cloudAuthStore.ts'
    const sdkPath = '/src/api/cloud/supabase.ts'
    const { useCloudAuthStore } = await import(authPath) as typeof import('../src/stores/cloudAuthStore')
    const { supabaseCloud } = await import(sdkPath) as typeof import('../src/api/cloud/supabase')
    const auth = supabaseCloud().auth
    Reflect.set(auth, 'getSession', async () => ({ data: { session: { access_token: 'synthetic-proof-token', user: { id: 'owner-a' } } } }))
    Reflect.set(auth, 'getUser', async () => ({ data: { user: { id: 'owner-a' } }, error: null }))
    Reflect.set(auth, 'onAuthStateChange', () => ({ data: { subscription: { unsubscribe() {} } } }))
    useCloudAuthStore.getState().setSignedIn({ id: 'owner-a' }, { licenseActive: false, tier: null, access: true, quota: null })
  })
  await page.getByRole('button', { name: 'Use account memories', exact: true }).click()
}

test('explicit UI sync uploads, downloads, preserves conflicts and persists shared deletion', async ({ page }, testInfo) => {
  let records: SyncedMemoryRecord[] = []
  let writes = 0
  await page.route('**/*', route => new URL(route.request().url()).port === '5273' ? route.continue() : route.abort())
  await page.route('**/api/memory/sync**', async route => {
    expect(route.request().headers().authorization).toBe('Bearer synthetic-proof-token')
    if (route.request().method() === 'POST') {
      const body: unknown = route.request().postDataJSON()
      if (!isRecord(body) || typeof body.memoryId !== 'string' || typeof body.expectedRevision !== 'number') throw new Error('Malformed fixture request')
      const previous = records.find(record => record.memory_id === body.memoryId)
      if (body.expectedRevision !== (previous?.revision ?? 0)) return route.fulfill({ status: 409, json: {} })
      if (body.payload !== null && !isRecord(body.payload)) throw new Error('Malformed fixture payload')
      const record = { memory_id: body.memoryId, revision: body.expectedRevision + 1, deleted: body.deleted === true,
        payload: body.payload, updated_at: '2026-09-09T00:00:00Z' }
      records = [record]
      writes++
      return route.fulfill({ json: { ownerId: 'owner-a', record } })
    }
    return route.fulfill({ json: { ownerId: 'owner-a', records, next: null } })
  })
  await page.goto('/e2e/memory-sensitive-proof.html')
  await accountFixture(page)
  const sync = page.getByRole('button', { name: 'Sync account memories', exact: true })
  await expect(sync).toBeDisabled()
  await page.getByRole('button', { name: 'Add Memory', exact: true }).click()
  await page.getByPlaceholder('What should I remember?').fill('Account preference')
  await page.getByPlaceholder('Details… (required)').fill('Synthetic preference')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect(writes).toBe(0)
  await page.getByLabel('Allow cloud storage for this account collection', { exact: true }).check()
  await sync.click()
  await expect(page.getByRole('status')).toHaveText('Synced 1 uploads and 0 downloads. 0 conflicting memories left unchanged.')
  expect(writes).toBe(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('memory-sync.png'), fullPage: true })
  records = records.map(record => ({ ...record, revision: 2, payload: { ...record.payload, title: 'Cloud revision', content: 'Cloud correction', updatedAt: 2 } }))
  await sync.click()
  await expect(page.getByRole('status')).toHaveText('Synced 0 uploads and 1 downloads. 0 conflicting memories left unchanged.')
  await expect(page.getByText('Cloud revision', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const path = '/src/stores/memoryStore.ts'
    const { useMemoryStore } = await import(path) as typeof import('../src/stores/memoryStore')
    useMemoryStore.getState().updateMemory(useMemoryStore.getState().entries[0].id, { content: 'Local correction' })
  })
  records = records.map(record => ({ ...record, revision: 3, payload: { ...record.payload, content: 'Concurrent cloud correction', updatedAt: 3 } }))
  await sync.click()
  await expect(page.getByRole('status')).toHaveText('Synced 0 uploads and 0 downloads. 1 conflicting memories left unchanged.')
  expect(writes).toBe(1)
  await page.getByRole('button', { name: 'Delete entry', exact: true }).click()
  await sync.click()
  await expect(page.getByRole('status')).toHaveText('Synced 1 uploads and 0 downloads. 0 conflicting memories left unchanged.')
  expect(records[0]).toMatchObject({ deleted: true, payload: null, revision: 4 })
  await page.reload()
  await accountFixture(page)
  await expect(page.getByRole('button', { name: 'Delete entry', exact: true })).toHaveCount(0)
  const baseline = await page.evaluate(async () => {
    const path = '/src/stores/memoryStore.ts'
    const { useMemoryStore } = await import(path) as typeof import('../src/stores/memoryStore')
    return Object.values(useMemoryStore.getState().memorySyncBaselines['owner-a'])
  })
  expect(baseline).toEqual([{ revision: 4, hash: null }])
})

test('a lost first-upload response cannot revive a locally deleted memory after reload', async ({ page }) => {
  let records: SyncedMemoryRecord[] = []
  let lostResponse = false
  await page.route('**/*', route => new URL(route.request().url()).port === '5273' ? route.continue() : route.abort())
  await page.route('**/api/memory/sync**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ownerId: 'owner-a', records, next: null } })
    const body: unknown = route.request().postDataJSON()
    if (!isRecord(body) || typeof body.memoryId !== 'string' || typeof body.expectedRevision !== 'number' ||
      (body.payload !== null && !isRecord(body.payload))) throw new Error('Malformed fixture request')
    expect(body.expectedRevision).toBe(records[0]?.revision ?? 0)
    const record = { memory_id: body.memoryId, revision: body.expectedRevision + 1, payload: body.payload,
      deleted: body.deleted === true, updated_at: '2026-09-09T00:00:00Z' }
    records = [record]
    if (!lostResponse) { lostResponse = true; return route.abort('failed') }
    return route.fulfill({ json: { ownerId: 'owner-a', record } })
  })
  await page.goto('/e2e/memory-sensitive-proof.html')
  await accountFixture(page)
  await page.getByRole('button', { name: 'Add Memory', exact: true }).click()
  await page.getByPlaceholder('What should I remember?').fill('Uncertain upload')
  await page.getByPlaceholder('Details… (required)').fill('Synthetic private content')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByLabel('Allow cloud storage for this account collection', { exact: true }).check()
  await page.getByRole('button', { name: 'Sync account memories', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Some changes may already be saved')
  expect(records[0].deleted).toBe(false)
  await page.getByRole('button', { name: 'Delete entry', exact: true }).click()
  await page.evaluate(async () => {
    const path = '/src/lib/memory-persistence.ts'
    await (await import(path) as typeof import('../src/lib/memory-persistence')).flushMemoryPersist()
  })
  await page.reload()
  await accountFixture(page)
  const pending = await page.evaluate(async () => {
    const path = '/src/stores/memoryStore.ts'
    const { useMemoryStore } = await import(path) as typeof import('../src/stores/memoryStore')
    return { entries: useMemoryStore.getState().entries.length, pending: Object.keys(useMemoryStore.getState().memorySyncPending['owner-a']).length }
  })
  expect(pending).toEqual({ entries: 0, pending: 1 })
  await page.getByLabel('Allow cloud storage for this account collection', { exact: true }).check()
  await page.getByRole('button', { name: 'Sync account memories', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Synced 1 uploads and 0 downloads. 0 conflicting memories left unchanged.')
  expect(records[0]).toMatchObject({ revision: 2, payload: null, deleted: true })
  await expect(page.getByRole('button', { name: 'Delete entry', exact: true })).toHaveCount(0)
})
