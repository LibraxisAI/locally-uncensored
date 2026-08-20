import { test, expect } from '@playwright/test'
import {
  openSettings,
  gotoTab,
  openSection,
  readStore,
  readSettings,
  lastCall,
  invokeCount,
} from './support/journeys/settings'

/**
 * QA sweep, area `settings`: the AI Backends tab.
 *
 * This is where a user points LU at the thing that answers. A provider row
 * that looks configured but is not, or a key box that swallows what was typed,
 * costs the user a whole broken evening, so every control here is read back
 * out of the persisted provider store, the copy the send path consults.
 */

const providers = async (page: import('@playwright/test').Page) =>
  (await readStore(page, 'lu-providers'))?.state?.providers ?? {}

async function openBackends(page: import('@playwright/test').Page) {
  await openSettings(page)
  await gotoTab(page, 'AI Backends')
  await openSection(page, 'Providers', 'settings.provider-dropdown.open')
}

/** The collapsed header row of one provider, addressed by its visible name. */
const providerRow = (page: import('@playwright/test').Page, name: string) =>
  page.getByTestId('settings.provider.expand').filter({ hasText: name })

/** Open the Add-Provider list. A cancelled cloud pick leaves it standing, so
 *  a blind click there would close it again. */
async function openProviderDropdown(page: import('@playwright/test').Page) {
  const list = page.getByTestId('settings.local-preset.select').first()
  if (await list.isVisible().catch(() => false)) return
  await page.getByTestId('settings.provider-dropdown.open').click()
  await expect(list).toBeVisible()
}

/** Only one row is expanded at a time, so the fields inside are unambiguous. */
const endpointBox = (page: import('@playwright/test').Page) =>
  page.locator('input[placeholder="http://localhost:..."]')

test('providers: a row expands, powers off and comes back, all through the store', async ({ page }) => {
  await openBackends(page)

  // A fresh box boots with the app's own engine plus the Ollama slot the
  // backend detector switched on.
  await expect(providerRow(page, 'Built-in Engine')).toBeVisible()
  await expect(page.getByText('DEFAULT', { exact: true })).toBeVisible()

  // ── Expand ───────────────────────────────────────────────────
  // Collapsed, the row shows nothing you can change; expanding is what
  // reveals Test / Disable and the honest "nothing to configure" note.
  await expect(page.getByTestId('settings.provider.test')).toHaveCount(0)
  await providerRow(page, 'Built-in Engine').click()
  await expect(page.getByTestId('settings.provider.test')).toBeVisible()
  await expect(page.getByText('Built-in engine, runs locally, nothing to configure.')).toBeVisible()
  // The app pins this slot's address, so there is no endpoint box to lie with.
  await expect(endpointBox(page)).toHaveCount(0)

  // A second click folds it away again, because the panel is a disclosure, not a
  // one-way door.
  await providerRow(page, 'Built-in Engine').click()
  await expect(page.getByTestId('settings.provider.test')).toHaveCount(0)

  // ── Disable from inside the row ──────────────────────────────
  await providerRow(page, 'Built-in Engine').click()
  await page.getByTestId('settings.provider.disable').click()
  await expect.poll(async () => (await providers(page)).openai?.enabled).toBe(false)
  await expect(providerRow(page, 'Built-in Engine')).toHaveCount(0)

  // ── Bring it back through a preset, then the power switch ────
  await openProviderDropdown(page)
  await page.getByTestId('settings.local-preset.select').filter({ hasText: 'Built-in Engine' }).click()
  await expect.poll(async () => (await providers(page)).openai?.enabled).toBe(true)
  await expect(providerRow(page, 'Built-in Engine')).toBeVisible()

  // The power icon on the header is the same switch, one click away.
  await providerRow(page, 'Built-in Engine')
    .locator('xpath=preceding-sibling::button[@data-testid="settings.provider.power-toggle"]')
    .click()
  await expect.poll(async () => (await providers(page)).openai?.enabled).toBe(false)
  await expect(providerRow(page, 'Built-in Engine')).toHaveCount(0)
})

test('providers: adding Ollama writes its endpoint, and Test asks the backend', async ({ page }) => {
  await openBackends(page)

  // Start from a box where Ollama is off, so selecting the preset is what
  // turns it on rather than a no-op on an already-live row.
  await providerRow(page, 'Ollama').click()
  await page.getByTestId('settings.provider.disable').click()
  await expect.poll(async () => (await providers(page)).ollama?.enabled).toBe(false)

  // ── Local preset ─────────────────────────────────────────────
  // A local preset needs no warning: nothing leaves the machine.
  await openProviderDropdown(page)
  await page.getByTestId('settings.local-preset.select').filter({ hasText: 'Ollama' }).click()
  await expect(page.getByTestId('settings.cloud-warning.continue')).toHaveCount(0)
  await expect.poll(async () => (await providers(page)).ollama?.enabled).toBe(true)
  expect((await providers(page)).ollama.baseUrl).toBe('http://localhost:11434')

  // ── Test ─────────────────────────────────────────────────────
  // The verdict has to come from a real probe of the configured address, not
  // from the fact that a row exists.
  const before = await invokeCount(page, 'proxy_localhost')
  await page.getByTestId('settings.provider.test').click()
  await expect(page.getByText('Connected', { exact: true })).toBeVisible()
  expect(await invokeCount(page, 'proxy_localhost')).toBeGreaterThan(before)

  // ── Endpoint ─────────────────────────────────────────────────
  // The row carries an editable endpoint, because this address really is the
  // user's to change, and what is typed has to reach the store. That copy is
  // what the send path dials, not the text in the box.
  await expect(endpointBox(page)).toBeVisible()
  await endpointBox(page).fill('http://192.168.0.9:11434')
  await expect.poll(async () => (await providers(page)).ollama?.baseUrl).toBe('http://192.168.0.9:11434')
})

test('providers: a cloud preset is gated by the privacy warning, and Cancel means cancel', async ({ page }) => {
  await openBackends(page)

  // ── Cancel ───────────────────────────────────────────────────
  // Adding a cloud backend ends the offline promise, so it asks first, and
  // backing out must leave the store exactly as it was.
  await openProviderDropdown(page)
  await page.getByTestId('settings.cloud-preset.select').filter({ hasText: 'Anthropic' }).click()
  await expect(page.getByText(/Cloud providers send your data to external servers/)).toBeVisible()
  await page.getByTestId('settings.cloud-warning.cancel').click()
  await expect(page.getByText(/Cloud providers send your data to external servers/)).toHaveCount(0)
  expect((await providers(page)).anthropic?.enabled).toBe(false)
  await expect(providerRow(page, 'Anthropic')).toHaveCount(0)

  // ── Continue ─────────────────────────────────────────────────
  await openProviderDropdown(page)
  await page.getByTestId('settings.cloud-preset.select').filter({ hasText: 'Anthropic' }).click()
  await page.getByTestId('settings.cloud-warning.continue').click()
  await expect.poll(async () => (await providers(page)).anthropic?.enabled).toBe(true)
  expect((await providers(page)).anthropic.isLocal).toBe(false)
  await expect(providerRow(page, 'Anthropic')).toBeVisible()

  // ── The key box, and its reveal ──────────────────────────────
  // A cloud row is the only kind that asks for a key. It is masked by
  // default and the eye is what shows it. A key visible by default on a
  // shared screen is a leak.
  const keyBox = page.locator('input[placeholder="sk-ant-..."]')
  await expect(keyBox).toHaveAttribute('type', 'password')
  await keyBox.fill('sk-ant-e2e-probe')

  // On a desktop with a working credential vault the key goes THERE, and
  // partialize keeps it out of localStorage entirely (H5). Both halves matter:
  // arriving in the vault, and never being written beside it.
  await expect
    .poll(() => page.evaluate(() => ((window as any).__E2E_SECRETS__ ?? {})['anthropic']))
    .toBe('sk-ant-e2e-probe')
  expect((await providers(page)).anthropic.apiKey).toBe('')
  await expect(page.getByText(/Keys are stored locally with basic obfuscation/)).toBeVisible()

  await page.getByTestId('settings.provider-key.reveal').click()
  await expect(keyBox).toHaveAttribute('type', 'text')
  await expect(keyBox).toHaveValue('sk-ant-e2e-probe')
  await page.getByTestId('settings.provider-key.reveal').click()
  await expect(keyBox).toHaveAttribute('type', 'password')
})

test('model storage: Browse writes the picked folder and Reset clears it', async ({ page }) => {
  await openSettings(page)
  await gotoTab(page, 'AI Backends')
  await openSection(page, 'Model Storage', 'settings.model-path.browse')

  // Reset only exists once there is an override to undo.
  await expect(page.getByTestId('settings.model-path.reset')).toHaveCount(0)

  // ── Browse ───────────────────────────────────────────────────
  // The native folder picker's answer has to reach the store, otherwise the
  // next GGUF download still lands in the auto-detected folder.
  await page.getByTestId('settings.model-path.browse').click()
  await expect.poll(async () => (await readSettings(page)).hfDownloadPathOverride).toBeTruthy()
  const picked = (await readSettings(page)).hfDownloadPathOverride
  await expect(page.getByPlaceholder('(auto-detect)')).toHaveValue(picked)

  // ── Reset ────────────────────────────────────────────────────
  await page.getByTestId('settings.model-path.reset').click()
  await expect.poll(async () => (await readSettings(page)).hfDownloadPathOverride).toBe('')
  await expect(page.getByPlaceholder('(auto-detect)')).toHaveValue('')
  await expect(page.getByTestId('settings.model-path.reset')).toHaveCount(0)
})

test('model storage: a scan finds the models already on disk and importing one hard-links it', async ({ page }) => {
  await openSettings(page, {
    importableModels: [
      { name: 'qwen2.5-7b-instruct', source: 'ollama', path: '/home/e2e/.ollama/blobs/sha256-abc', size: 4_700_000_000 },
      { name: 'mistral-7b', source: 'lmstudio', path: '/home/e2e/.lmstudio/models/mistral-7b.gguf', size: 4_100_000_000 },
    ],
  })
  await gotoTab(page, 'AI Backends')
  await openSection(page, 'Model Storage', 'settings.local-models.scan')

  // ── Scan ─────────────────────────────────────────────────────
  await page.getByTestId('settings.local-models.scan').click()
  await expect(page.getByText('qwen2.5-7b-instruct')).toBeVisible()
  await expect(page.getByText('mistral-7b')).toBeVisible()

  // ── Import ───────────────────────────────────────────────────
  // The whole point is zero copy: the backend must be handed the source path
  // it found, not a re-download URL.
  await page.getByTestId('settings.local-models.import').first().click()
  await expect
    .poll(async () => (await lastCall(page, '__E2E_MODEL_CALLS__', 'import_local_model'))?.path)
    .toBe('/home/e2e/.ollama/blobs/sha256-abc')
  await expect(page.getByText('Imported').first()).toBeVisible()
})

test('built-in engine: the expert tuning persists and Apply & Restart relaunches with it', async ({ page }) => {
  await openSettings(page)
  await gotoTab(page, 'AI Backends')
  await openSection(page, 'Built-in Engine (expert)', 'settings.builtin-engine.apply-restart')

  // The panel reads the LIVE engine, not the stored wish. The point of the
  // status line is that it can disagree with the fields above it.
  await expect(page.getByText(/Engine running/)).toBeVisible()
  await expect(page.getByText(/ctx 8,192/)).toBeVisible()

  // ── Flash attention ──────────────────────────────────────────
  // Three-way choice, and the pick has to land in settings.builtinEngine
  // because api/engine.ts injects that blob into every start and swap.
  await page.getByTestId('settings.flash-attention.select').filter({ hasText: /^on$/ }).click()
  await expect.poll(async () => (await readSettings(page)).builtinEngine?.flashAttn).toBe('on')
  await page.getByTestId('settings.flash-attention.select').filter({ hasText: /^off$/ }).click()
  await expect.poll(async () => (await readSettings(page)).builtinEngine?.flashAttn).toBe('off')

  // ── Apply & Restart ──────────────────────────────────────────
  // A running engine does not pick tuning up by itself; this is the button
  // that relaunches it, and the proof is the swap carrying the edited values.
  await page.locator('input[placeholder="8192"]').fill('16384')
  await page.getByTestId('settings.builtin-engine.apply-restart').click()

  await expect
    .poll(async () => (await lastCall(page, '__E2E_ENGINE_CALLS__', 'swap_bundled_model'))?.tuning?.ctx, {
      timeout: 20_000,
    })
    .toBe(16384)
  const swap = await lastCall(page, '__E2E_ENGINE_CALLS__', 'swap_bundled_model')
  // The whole tuning blob rides along, not just the field that was edited.
  expect(swap.tuning.flashAttn).toBe('off')
  // And the status line re-reads the engine's real ctx afterwards.
  await expect(page.getByText(/ctx 16,384/)).toBeVisible({ timeout: 20_000 })
})
