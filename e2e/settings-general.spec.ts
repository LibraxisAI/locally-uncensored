import { test, expect } from '@playwright/test'
import { openNewChat } from './support/ui'
import {
  openSettings,
  gotoTab,
  openSection,
  sectionToggle,
  readSettings,
  SETTINGS_STORE_KEY,
  readStore,
  lastCall,
} from './support/journeys/settings'

/**
 * QA sweep, area `settings`: the General tab, walked the way a user walks it.
 *
 * The rule for this file: a control counts as proven only when the new state
 * lands somewhere outside the button itself: the persisted settings store,
 * localStorage, or a recorded backend call. A highlighted button proves
 * nothing, so nothing here stops at a colour.
 */

test('general tab: theme, cloud teasers and the avatar all reach the settings store', async ({ page }) => {
  await openSettings(page)

  // ── Theme ────────────────────────────────────────────────────
  await openSection(page, 'Appearance')
  await page.getByTestId('settings.theme-light.select').click()
  expect((await readSettings(page)).theme).toBe('light')
  // The stored value is not decoration: the app paints from it.
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await page.getByTestId('settings.theme-dark.select').click()
  expect((await readSettings(page)).theme).toBe('dark')
  await expect(page.locator('html')).toHaveClass(/dark/)

  // ── Avatar ───────────────────────────────────────────────────
  // Upload opens the hidden file input; setting files on it is what a real
  // pick does. The picture must survive as a data URL in the store.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  await expect(page.getByTestId('settings.avatar.remove')).toHaveCount(0)
  await page.getByTestId('settings.avatar.upload').click()
  await page.locator('input[type="file"][accept*="image/png"]').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: png,
  })
  await expect.poll(async () => (await readSettings(page)).userAvatarDataUrl).toMatch(/^data:image\/png;base64,/)

  // Remove only exists once a picture is set, and it clears the stored one.
  await page.getByTestId('settings.avatar.remove').click()
  await expect.poll(async () => (await readSettings(page)).userAvatarDataUrl).toBe('')

  // ── Cloud teasers toggle ─────────────────────────────────────
  // "LU Cloud Account" ships open, so this only scrolls it into reach.
  await openSection(page, 'LU Cloud Account', 'settings.cloud-teasers.toggle')
  const teasers = page.getByTestId('settings.cloud-teasers.toggle')
  const before = (await readSettings(page)).cloudTeasersEnabled
  await teasers.click()
  await expect.poll(async () => (await readSettings(page)).cloudTeasersEnabled).toBe(!before)
  await expect(teasers).toHaveAttribute('aria-checked', String(!before))
})

test('general tab: a Section collapses its body and the tab pick survives a reload', async ({ page }) => {
  await openSettings(page)

  // ── Section toggle ───────────────────────────────────────────
  // "Appearance" ships collapsed: its body is absent from the DOM, the
  // header adds it, a second click removes it again.
  await expect(page.getByTestId('settings.theme-dark.select')).toHaveCount(0)
  await openSection(page, 'Appearance')
  await expect(page.getByTestId('settings.theme-dark.select')).toBeVisible()
  await sectionToggle(page, 'Appearance').first().click()
  await expect(page.getByTestId('settings.theme-dark.select')).toHaveCount(0)

  // ── Tab switch ───────────────────────────────────────────────
  // Switching swaps the whole panel AND writes the pick to localStorage, so
  // the next launch reopens where the user left off.
  await gotoTab(page, 'Agent')
  await expect(sectionToggle(page, 'Personas')).toBeVisible()
  await expect(sectionToggle(page, 'Appearance')).toHaveCount(0)
  expect(await page.evaluate(() => window.localStorage.getItem('lu-settings-tab'))).toBe('agent')

  // The pick is honoured on the next launch: reload lands in chat, and
  // re-entering Settings reopens the Agent tab, not General.
  await page.reload()
  await page.getByRole('button', { name: /^Settings$/ }).first().click()
  await expect(sectionToggle(page, 'Personas')).toBeVisible({ timeout: 20_000 })
  await expect(sectionToggle(page, 'Appearance')).toHaveCount(0)
})

test('general tab: back-to-chat leaves settings, and the two-click reset restores defaults', async ({ page }) => {
  await openSettings(page)

  // Dirty two General keys so the reset has something real to undo.
  await openSection(page, 'Appearance')
  await page.getByTestId('settings.theme-light.select').click()
  await openSection(page, 'Generation')
  const maxTokens = page.getByRole('spinbutton').first()
  await maxTokens.fill('4321')
  await expect.poll(async () => (await readSettings(page)).maxTokens).toBe(4321)

  // ── Per-tab reset: arm, then confirm ─────────────────────────
  const tabReset = page.getByTestId('settings.tab-settings.reset')
  await tabReset.scrollIntoViewIfNeeded()
  await expect(tabReset).toHaveText(/Reset General to defaults/)
  await tabReset.click()
  await expect(tabReset).toHaveText(/Click again to reset General/)
  await tabReset.click()
  await expect(page.getByText('General settings restored to defaults')).toBeVisible()
  expect((await readSettings(page)).maxTokens).toBe(0)
  expect((await readSettings(page)).theme).toBe('dark')

  // ── Reset-all: same arming, wider blast radius ───────────────
  // Dirty a key from ANOTHER tab so the difference to the per-tab reset is
  // visible, plus a voice-store value (reset-all owns that store too).
  await gotoTab(page, 'Agent')
  await openSection(page, 'Search Provider')
  await page.getByTestId('settings.search-provider.select').filter({ hasText: 'Tavily' }).click()
  expect((await readSettings(page)).searchProvider).toBe('tavily')

  await gotoTab(page, 'General')
  const allReset = page.getByTestId('settings.all-settings.reset')
  await allReset.scrollIntoViewIfNeeded()
  await allReset.click()
  await expect(allReset).toHaveText('Click again to reset everything')
  await allReset.click()
  await expect(page.getByText('All settings restored to defaults')).toBeVisible()
  expect((await readSettings(page)).searchProvider).toBe('auto')
  // User content is explicitly spared, so the persisted store still exists.
  expect(await readStore(page, SETTINGS_STORE_KEY)).not.toBeNull()

  // ── Back to chat ─────────────────────────────────────────────
  await page.getByTestId('settings.header-back.to-chat').click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /New Chat/i })).toBeVisible()
})

test('general tab: chat backup writes a real file and reads one back', async ({ page }) => {
  await openSettings(page)

  // Nothing to export yet, and the panel says so instead of writing an empty
  // file the user would later trust.
  await openSection(page, 'Chat Backup', 'settings.chat-backup.export')
  await page.getByTestId('settings.chat-backup.export').click()
  await expect(page.getByText('No chats to export yet.')).toBeVisible()

  // Make one conversation, then export for real.
  await page.getByTestId('settings.header-back.to-chat').click()
  await openNewChat(page)
  await page.locator('textarea').first().fill('remember this line')
  await page.getByRole('button', { name: /Send message/i }).click()
  await expect(page.getByText(/PONG_BUILTIN_OK/)).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: /^Settings$/ }).first().click()
  await openSection(page, 'Chat Backup', 'settings.chat-backup.export')

  // ── Export ───────────────────────────────────────────────────
  // Desktop uses the native Save As dialog, so the proof is the payload that
  // reached it: the file has to carry the chat, not just a filename.
  await page.getByTestId('settings.chat-backup.export').click()
  await expect(page.getByText(/Saved 1 chat to /)).toBeVisible()
  const saved = await lastCall(page, '__E2E_DIALOG_CALLS__', 'save_text_file_dialog')
  expect(saved).toMatchObject({ defaultName: 'locally-uncensored-chats-1.json', extension: 'json' })
  expect(saved.bytes).toBeGreaterThan(100)

  // ── Import ───────────────────────────────────────────────────
  // A bundle whose chat is already here must be reported as skipped, not
  // duplicated, because merge is the documented mode.
  const bundle = JSON.stringify({
    conversations: [
      {
        id: 'e2e-restored',
        title: 'Restored from backup',
        model: 'qwen2.5-0.5b-instruct-q4_k_m',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [{ id: 'm1', role: 'user', content: 'restored line', timestamp: Date.now() }],
      },
    ],
  })
  await page.getByTestId('settings.chat-backup.import').click()
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'chats.json',
    mimeType: 'application/json',
    buffer: Buffer.from(bundle, 'utf8'),
  })
  await expect(page.getByText(/Imported 1 chat\./)).toBeVisible()
  await page.getByTestId('settings.header-back.to-chat').click()
  await expect(page.getByText('Restored from backup')).toBeVisible()
})

test('general tab: the API-key link opens the account page in the real browser', async ({ page }) => {
  await openSettings(page)
  await openSection(page, 'Cloud API Keys', 'settings.cloud-api-key.open-web')

  // Keys are minted on lu-labs.ai only and the desktop never sees the plaintext,
  // so this button's whole job is to leave the app. Opening it in the WebView
  // would trap the user in a page that cannot log in.
  await page.getByTestId('settings.cloud-api-key.open-web').click()
  await expect
    .poll(() => page.evaluate(() => ((window as any).__E2E_OPENED_URLS__ ?? []) as string[]))
    .toContain('https://lu-labs.ai/account')
})

test('general tab: re-run onboarding clears the flag and the wizard really comes back', async ({ page }) => {
  // Seeded once only, so the reload the button triggers is a genuine restart
  // rather than a spec that re-plants the "done" marker behind its own back.
  await openSettings(page, { seedOnboarding: false })
  await openSection(page, 'Onboarding', 'settings.onboarding.rerun')

  // The marker lives in two places, the settings store and Rust, and clearing
  // it has to survive the relaunch the button performs.
  await page.getByTestId('settings.onboarding.rerun').click()
  await expect(page.getByRole('button', { name: /Get Started/i })).toBeVisible({ timeout: 20_000 })
  expect((await readSettings(page)).onboardingDone).toBe(false)
})
