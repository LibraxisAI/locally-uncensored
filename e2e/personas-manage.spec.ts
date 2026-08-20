import { test, expect, type Page } from '@playwright/test'
import { bootApp, openSettings, openSection, readSettingsState } from './support/journeys/misc'

/**
 * QA sweep, area "personas": the whole persona management journey a user walks in
 * Settings → Agent → Personas. Master switch, picking an active persona,
 * creating a custom one, editing it, cancelling an edit, deleting it.
 *
 * Every step is proved by EFFECT, and the effect that counts is the persisted
 * settingsStore slice (localStorage `chat-settings`): that is what a new chat
 * later reads its system prompt from. A card that merely looks selected proves
 * nothing.
 */

const CARD = 'personas.persona-card.activate'

async function openPersonas(page: Page) {
  await bootApp(page, { settingsTab: 'agent' })
  await openSettings(page)
  await openSection(page, 'Personas')
  await expect(page.getByText('Use personas')).toBeVisible({ timeout: 15_000 })
}

function card(page: Page, name: string) {
  return page.getByTestId(CARD).filter({ hasText: name })
}

function grid(page: Page) {
  return page.getByTestId('personas.panel.new-persona').locator('..')
}

test('the master switch arms and disarms the whole persona layer', async ({ page }) => {
  await openPersonas(page)

  // Default is on: the picker is live and the subtitle says the prompt applies.
  await expect(page.getByText('Active persona is applied to new chats.')).toBeVisible()
  await expect(grid(page)).toHaveCSS('pointer-events', 'auto')

  await page.getByTestId('personas.panel.toggle-personas').click()

  // Effect 1: the copy flips.
  await expect(page.getByText('Off: raw model, no persona prompt.')).toBeVisible()
  // Effect 2: the grid really is inert, not just faded.
  await expect(grid(page)).toHaveCSS('pointer-events', 'none')
  // Effect 3: the switch reports its new state to assistive tech.
  await expect(page.getByTestId('personas.panel.toggle-personas')).toHaveAttribute('aria-pressed', 'false')
  // Effect 4: and it is persisted, so the next boot runs raw models.
  expect((await readSettingsState(page)).settings.personasEnabled).toBe(false)

  // Flipping back restores every one of those.
  await page.getByTestId('personas.panel.toggle-personas').click()
  await expect(page.getByText('Active persona is applied to new chats.')).toBeVisible()
  await expect(grid(page)).toHaveCSS('pointer-events', 'auto')
  expect((await readSettingsState(page)).settings.personasEnabled).toBe(true)
})

test('picking a card makes that persona the active one', async ({ page }) => {
  await openPersonas(page)

  // The shipped default.
  expect((await readSettingsState(page)).activePersonaId).toBe('unrestricted')

  await card(page, 'Code Expert').click()

  // Effect: the store's active persona id moved to the clicked card, which is
  // the id getActivePersona() resolves the system prompt from.
  await expect.poll(async () => (await readSettingsState(page)).activePersonaId).toBe('coder')

  await card(page, 'Writing Coach').click()
  await expect.poll(async () => (await readSettingsState(page)).activePersonaId).toBe('writer')
})

test('create, edit, cancel and delete a custom persona', async ({ page }) => {
  await openPersonas(page)

  const builtInCount = (await readSettingsState(page)).personas.length

  // ── Create ────────────────────────────────────────────────────────────
  await page.getByTestId('personas.panel.new-persona').click()
  await expect(page.getByPlaceholder('Persona name...')).toBeVisible()
  // A second click closes the same editor again.
  await page.getByTestId('personas.panel.new-persona').click()
  await expect(page.getByPlaceholder('Persona name...')).toHaveCount(0)
  await page.getByTestId('personas.panel.new-persona').click()
  await expect(page.getByTestId('personas.prompt-editor.save')).toHaveText(/Save Persona/)

  await page.getByPlaceholder('Persona name...').fill('QA Sweep Persona')
  await page.getByPlaceholder('System prompt...').fill('You answer only with the word PONG.')
  await page.getByTestId('personas.prompt-editor.save').click()

  // Effect: a real persona was added to the store with the typed prompt, and
  // the editor closed behind it.
  await expect(card(page, 'QA Sweep Persona')).toHaveCount(1)
  await expect(page.getByPlaceholder('Persona name...')).toHaveCount(0)
  const afterCreate = await readSettingsState(page)
  expect(afterCreate.personas).toHaveLength(builtInCount + 1)
  const created = afterCreate.personas.find((p: any) => p.name === 'QA Sweep Persona')
  expect(created.systemPrompt).toBe('You answer only with the word PONG.')
  expect(created.isBuiltIn).toBe(false)

  // ── Cancel an edit ────────────────────────────────────────────────────
  await card(page, 'QA Sweep Persona').hover()
  await page.getByTestId('personas.edit-persona.click').click()
  // Effect: the editor opened seeded with THIS persona and in update mode.
  await expect(page.getByPlaceholder('Persona name...')).toHaveValue('QA Sweep Persona')
  await expect(page.getByPlaceholder('System prompt...')).toHaveValue('You answer only with the word PONG.')
  await expect(page.getByTestId('personas.prompt-editor.save')).toHaveText(/Update Persona/)

  await page.getByPlaceholder('Persona name...').fill('Thrown Away')
  await page.getByTestId('personas.prompt-editor.cancel').click()
  // Effect: the editor is gone AND the typed change never reached the store.
  await expect(page.getByPlaceholder('Persona name...')).toHaveCount(0)
  expect((await readSettingsState(page)).personas.find((p: any) => p.id === created.id).name)
    .toBe('QA Sweep Persona')
  await expect(card(page, 'Thrown Away')).toHaveCount(0)

  // ── Save an edit ──────────────────────────────────────────────────────
  await card(page, 'QA Sweep Persona').hover()
  await page.getByTestId('personas.edit-persona.click').click()
  await page.getByPlaceholder('Persona name...').fill('QA Sweep Renamed')
  await page.getByPlaceholder('System prompt...').fill('You answer only with the word PING.')
  await page.getByTestId('personas.prompt-editor.save').click()

  // Effect: the SAME persona changed in place (id kept, no second card).
  await expect(card(page, 'QA Sweep Renamed')).toHaveCount(1)
  const afterEdit = await readSettingsState(page)
  expect(afterEdit.personas).toHaveLength(builtInCount + 1)
  const edited = afterEdit.personas.find((p: any) => p.id === created.id)
  expect(edited.name).toBe('QA Sweep Renamed')
  expect(edited.systemPrompt).toBe('You answer only with the word PING.')

  // ── Delete ────────────────────────────────────────────────────────────
  await card(page, 'QA Sweep Renamed').hover()
  await page.getByTestId('personas.delete-persona.click').click()

  // Effect: the card is gone from the grid and the persona is gone from the
  // store, back to the shipped set.
  await expect(card(page, 'QA Sweep Renamed')).toHaveCount(0)
  const afterDelete = await readSettingsState(page)
  expect(afterDelete.personas).toHaveLength(builtInCount)
  expect(afterDelete.personas.some((p: any) => p.id === created.id)).toBe(false)
})

test('deleting the active persona hands the chat back to the default', async ({ page }) => {
  await openPersonas(page)

  await page.getByTestId('personas.panel.new-persona').click()
  await page.getByPlaceholder('Persona name...').fill('Doomed Persona')
  await page.getByPlaceholder('System prompt...').fill('Temporary.')
  await page.getByTestId('personas.prompt-editor.save').click()

  await card(page, 'Doomed Persona').click()
  await expect.poll(async () => (await readSettingsState(page)).activePersonaId).not.toBe('unrestricted')

  await card(page, 'Doomed Persona').hover()
  await page.getByTestId('personas.delete-persona.click').click()

  // Effect: removePersona also repairs the dangling active id, so no chat can
  // start against a persona that no longer exists.
  await expect.poll(async () => (await readSettingsState(page)).activePersonaId).toBe('unrestricted')
})
