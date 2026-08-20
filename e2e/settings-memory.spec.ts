import { test, expect } from '@playwright/test'
import {
  openSettings,
  gotoTab,
  openSection,
  readIdbStore,
  seedIdbStore,
  bootApp,
  MEMORY_STORE_KEY,
} from './support/journeys/settings'

/**
 * QA sweep, area `settings`: the Memory panel on the Agent tab.
 *
 * Memory is user content, so the bar here is higher than "the row vanished":
 * every add, edit and delete has to land in the persisted memory store,
 * because that store is what the next chat injects into the prompt.
 */

async function memories(page: import('@playwright/test').Page) {
  const store = await readIdbStore(page, MEMORY_STORE_KEY)
  return (store?.state?.entries ?? []) as Array<Record<string, any>>
}

async function openMemory(page: import('@playwright/test').Page) {
  await openSettings(page)
  await gotoTab(page, 'Agent')
  await openSection(page, 'Memory', 'settings.memory.add')
}

test('memory: add, edit and delete all move the persisted store', async ({ page }) => {
  await openMemory(page)
  await expect(page.getByText('No memories yet. The AI will learn about you over time.')).toBeVisible()

  // ── Add ──────────────────────────────────────────────────────
  // The form guards both fields: Save stays disabled until title AND detail
  // are there, so an empty memory can never reach the store.
  await page.getByTestId('settings.memory.add').click()
  await expect(page.getByTestId('settings.memory-new.save')).toBeDisabled()
  await page.getByPlaceholder('What should I remember?').fill('Prefers metric units')
  await expect(page.getByTestId('settings.memory-new.save')).toBeDisabled()
  await page.getByPlaceholder('Details… (required)').fill('Always answer in kilograms and centimetres.')
  await page.getByTestId('settings.memory-new.save').click()

  await expect.poll(async () => (await memories(page)).length).toBe(1)
  expect((await memories(page))[0]).toMatchObject({
    title: 'Prefers metric units',
    content: 'Always answer in kilograms and centimetres.',
    source: 'manual',
    type: 'user',
  })
  await expect(page.getByText('1 memory')).toBeVisible()

  // ── Edit ─────────────────────────────────────────────────────
  const row = page.getByText('Prefers metric units')
  await row.hover()
  await page.getByTestId('settings.edit-entry.click').click()
  const editContent = page.locator('textarea').first()
  await editContent.fill('Always answer in kilograms, centimetres and Celsius.')
  await page.getByTestId('settings.memory-edit.save').click()
  await expect.poll(async () => (await memories(page))[0]?.content).toBe(
    'Always answer in kilograms, centimetres and Celsius.',
  )
  // The description that rides into the prompt is re-derived, not left stale.
  expect((await memories(page))[0].description).toContain('Celsius')

  // ── Delete ───────────────────────────────────────────────────
  await page.getByText('Prefers metric units').hover()
  await page.getByTestId('settings.delete-entry.click').click()
  await expect.poll(async () => (await memories(page)).length).toBe(0)
  await expect(page.getByText('No memories yet. The AI will learn about you over time.')).toBeVisible()
})

test('memory: both cancels back out without writing anything', async ({ page }) => {
  await openMemory(page)

  // ── Cancel the new-memory form ───────────────────────────────
  await page.getByTestId('settings.memory.add').click()
  await page.getByPlaceholder('What should I remember?').fill('Throwaway')
  await page.getByPlaceholder('Details… (required)').fill('Should never be stored.')
  await page.getByTestId('settings.memory-new.cancel').click()
  await expect(page.getByTestId('settings.memory.add')).toBeVisible()
  expect(await memories(page)).toEqual([])
  // The draft is dropped too: reopening starts empty rather than resurrecting.
  await page.getByTestId('settings.memory.add').click()
  await expect(page.getByPlaceholder('What should I remember?')).toHaveValue('')
  await page.getByTestId('settings.memory-new.cancel').click()

  // ── Cancel an edit ───────────────────────────────────────────
  await page.getByTestId('settings.memory.add').click()
  await page.getByPlaceholder('What should I remember?').fill('Keep me')
  await page.getByPlaceholder('Details… (required)').fill('Original detail.')
  await page.getByTestId('settings.memory-new.save').click()
  await expect.poll(async () => (await memories(page)).length).toBe(1)

  await page.getByText('Keep me').hover()
  await page.getByTestId('settings.edit-entry.click').click()
  await page.locator('textarea').first().fill('Vandalised detail.')
  await page.getByTestId('settings.memory-edit.cancel').click()
  await expect(page.getByText('Original detail.')).toBeVisible()
  expect((await memories(page))[0].content).toBe('Original detail.')
})

test('memory: the extraction toggles persist and the nested one follows its parent', async ({ page }) => {
  await openMemory(page)
  const memSettings = async () => (await readIdbStore(page, MEMORY_STORE_KEY))?.state?.settings ?? {}

  // Auto-extraction ships on, and the all-modes switch is its child: it only
  // exists while extraction is on, because "also outside Agent Mode" is
  // meaningless once extraction is off.
  const autoExtract = page.getByTestId('settings.memory-auto-extract.toggle')
  await expect(page.getByTestId('settings.memory-extract-all-modes.toggle')).toBeVisible()

  // ── Parent off ───────────────────────────────────────────────
  await autoExtract.click()
  await expect.poll(async () => (await memSettings()).autoExtractEnabled).toBe(false)
  await expect(page.getByTestId('settings.memory-extract-all-modes.toggle')).toHaveCount(0)

  // ── Parent back on, then the child off ───────────────────────
  await autoExtract.click()
  await expect.poll(async () => (await memSettings()).autoExtractEnabled).toBe(true)
  const allModes = page.getByTestId('settings.memory-extract-all-modes.toggle')
  await expect(allModes).toBeVisible()
  await allModes.click()
  await expect.poll(async () => (await memSettings()).autoExtractInAllModes).toBe(false)
  // The parent is untouched by the child's flip.
  expect((await memSettings()).autoExtractEnabled).toBe(true)
})

test('memory: outdated entries stay hidden until asked for, and Clear needs two clicks', async ({ page }) => {
  // A store that already carries one live and one superseded memory, which is the
  // state a long-running install actually reaches.
  const now = Date.now()
  await seedIdbStore(
    page,
    MEMORY_STORE_KEY,
    {
      entries: [
        { id: 'm-live', type: 'user', title: 'Lives in Berlin', description: 'Berlin', content: 'Based in Berlin.', tags: [], source: 'manual', createdAt: now, updatedAt: now },
        { id: 'm-old', type: 'user', title: 'Lived in Hamburg', description: 'Hamburg', content: 'Was based in Hamburg.', tags: [], source: 'manual', createdAt: now, updatedAt: now, stale: true, supersededBy: 'm-live' },
      ],
      settings: { autoExtractEnabled: false, autoExtractInAllModes: false },
    },
    3,
  )
  await bootApp(page)
  await page.getByRole('button', { name: /^Settings$/ }).first().click()
  await gotoTab(page, 'Agent')
  await openSection(page, 'Memory', 'settings.memory.add')

  // ── Show outdated ────────────────────────────────────────────
  // The superseded entry is kept but never injected, so it is out of sight
  // until the toggle asks for it.
  await expect(page.getByText('Lives in Berlin')).toBeVisible()
  await expect(page.getByText('Lived in Hamburg')).toHaveCount(0)
  await page.getByTestId('settings.toggle-outdated-memories.click').click()
  await expect(page.getByText('Lived in Hamburg')).toBeVisible()
  // It stays read-only: no edit affordance on an outdated entry.
  await page.getByText('Lived in Hamburg').hover()
  await expect(page.getByTestId('settings.edit-entry.click')).toHaveCount(1)
  await page.getByTestId('settings.toggle-outdated-memories.click').click()
  await expect(page.getByText('Lived in Hamburg')).toHaveCount(0)

  // ── Re-embed ─────────────────────────────────────────────────
  // Only offered when there is something to embed; it must return to rest
  // rather than spin forever when the embedding backend is down.
  const reembed = page.getByTestId('settings.memory-embeddings.rebuild')
  await expect(reembed).toHaveText(/Re-embed all/)
  await reembed.click()
  await expect(reembed).toHaveText(/Embeddings updated|Re-embed all/, { timeout: 20_000 })
  expect((await memories(page)).length).toBe(2)

  // ── Clear all ────────────────────────────────────────────────
  // One click only arms it; the store is untouched until the confirm.
  const clear = page.getByTestId('settings.memory.clear-all')
  await clear.click()
  await expect(clear).toHaveText(/Sure\?/)
  expect((await memories(page)).length).toBe(2)
  await clear.click()
  await expect.poll(async () => (await memories(page)).length).toBe(0)
  await expect(page.getByText('No memories yet. The AI will learn about you over time.')).toBeVisible()
})

test('memory: the exports carry the real entries and Import brings them back', async ({ page }) => {
  await openMemory(page)
  await page.getByTestId('settings.memory.add').click()
  await page.getByPlaceholder('What should I remember?').fill('Ships on Fridays')
  await page.getByPlaceholder('Details… (required)').fill('Release day is Friday afternoon.')
  await page.getByTestId('settings.memory-new.save').click()
  await expect.poll(async () => (await memories(page)).length).toBe(1)

  // ── Export .md ───────────────────────────────────────────────
  // The file is the deliverable, so the proof is its bytes, not the click.
  const mdWait = page.waitForEvent('download')
  await page.getByTestId('settings.memory.export-md').click()
  const md = await mdWait
  expect(md.suggestedFilename()).toBe('memory.md')
  const mdBody = Buffer.concat(await (await md.createReadStream()).toArray()).toString('utf8')
  expect(mdBody).toContain('**Ships on Fridays**')
  expect(mdBody).toContain('Release day is Friday afternoon.')

  // ── Export .json ─────────────────────────────────────────────
  const jsonWait = page.waitForEvent('download')
  await page.getByTestId('settings.memory.export-json').click()
  const json = await jsonWait
  expect(json.suggestedFilename()).toBe('memory.json')
  const jsonBody = Buffer.concat(await (await json.createReadStream()).toArray()).toString('utf8')
  const parsed = JSON.parse(jsonBody)
  const exported = parsed.entries ?? parsed.memories ?? parsed
  expect(exported).toHaveLength(1)
  expect(exported[0]).toMatchObject({
    title: 'Ships on Fridays',
    content: 'Release day is Friday afternoon.',
  })

  // ── Import ───────────────────────────────────────────────────
  // Wipe the store, then feed the JSON export back in. The entry has to come
  // back whole, and the panel has to say how many it took. The import used
  // to fail silently (konata 2026-06-07).
  await page.getByTestId('settings.memory.clear-all').click()
  await page.getByTestId('settings.memory.clear-all').click()
  await expect.poll(async () => (await memories(page)).length).toBe(0)

  await page.getByTestId('settings.memory.import').click()
  await page.locator('input[type="file"][accept=".md,.txt,.json"]').setInputFiles({
    name: 'memory.json',
    mimeType: 'application/json',
    buffer: Buffer.from(jsonBody, 'utf8'),
  })
  await expect(page.getByText(/Imported 1 memory\./)).toBeVisible()
  await expect.poll(async () => (await memories(page))[0]?.title).toBe('Ships on Fridays')
  expect((await memories(page))[0].content).toBe('Release day is Friday afternoon.')
})
