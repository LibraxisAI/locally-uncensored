import { test, expect, type Page } from '@playwright/test'
import { bootLocalCreate, bucket } from './support/journeys/create'

/**
 * QA sweep, area `create`, journey 3: the Workflows and tags window.
 *
 * Local-only surface (custom ComfyUI graphs never run on the hosted fleet), so
 * this whole spec boots on the local backend. The window is almost entirely
 * store writes, which means every button here is provable by what the list
 * looks like afterwards: an installed workflow, a renamed tag, an emptied
 * shelf. Two-step deletes are proven by both steps: arming, then removing.
 */

const API_WORKFLOW = JSON.stringify({
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
  '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a prompt', clip: ['1', 1] } },
  '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7, model: ['1', 0] } },
  '4': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
})

/** Open the window, tolerating the composer's boot churn (the action bar
 *  re-renders as the model lists land, which detaches its icon buttons). */
async function openWorkflows(page: Page) {
  await expect(async () => {
    await page.getByTestId('create.workflows-and-tags.click').click({ timeout: 3_000 })
    await expect(page.getByText('Workflows & tags')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
}

async function openTagsTab(page: Page) {
  await page.getByRole('radio', { name: 'Tags', exact: true }).click()
  await expect(page.getByPlaceholder(/New tag/i)).toBeVisible()
}

test('workflows: the composer opens the window and the help page turns back', async ({ page }) => {
  await bootLocalCreate(page)

  // ── create.workflows-and-tags.click ──
  await expect(page.getByText('Workflows & tags')).toHaveCount(0)
  await openWorkflows(page)

  // ── create.how-it-works.click ──
  // The help page REPLACES the tabbed body, it does not sit beside it.
  await expect(page.getByRole('radio', { name: 'Workflows', exact: true })).toBeVisible()
  await page.getByTestId('create.how-it-works.click').click()
  await expect(page.getByText('How it works')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Workflows', exact: true })).toHaveCount(0)

  // ── create.workflows-help.back ──
  await page.getByTestId('create.workflows-help.back').click()
  await expect(page.getByRole('radio', { name: 'Workflows', exact: true })).toBeVisible()
  await expect(page.getByText('How it works')).toHaveCount(0)
})

test('workflows: a pasted graph installs, and the two-step delete removes it', async ({ page }) => {
  await bootLocalCreate(page)
  await openWorkflows(page)

  // ── create.workflow-import.install-pasted ──
  // The button is dead until the textarea holds something, then it has to
  // parse the graph and put a real card on the Installed shelf.
  await expect(page.getByText('No workflows installed')).toBeVisible()
  await expect(page.getByTestId('create.workflow-import.install-pasted')).toBeDisabled()
  await page.getByPlaceholder(/paste the API JSON/i).fill(API_WORKFLOW)
  await page.getByPlaceholder('Workflow name (optional)').fill('QA Sweep Graph')
  await expect(page.getByTestId('create.workflow-import.install-pasted')).toBeEnabled()
  await page.getByTestId('create.workflow-import.install-pasted').click()
  await expect(page.getByText('Installed "QA Sweep Graph".')).toBeVisible()
  await expect(page.getByText('QA Sweep Graph', { exact: true })).toBeVisible()
  await expect(page.getByText('No workflows installed')).toHaveCount(0)

  // ── create.workflow.delete ──
  // Two steps on purpose: the first click only arms (the label changes and
  // the card survives), the second is what actually removes it.
  const del = page.getByTestId('create.workflow.delete')
  await del.click()
  await expect(page.getByText('QA Sweep Graph', { exact: true })).toBeVisible()
  await expect(del).toHaveAttribute('title', /click again to remove/i)
  await del.click()
  await expect(page.getByText('QA Sweep Graph', { exact: true })).toHaveCount(0)
  await expect(page.getByText('No workflows installed')).toBeVisible()
})

test('workflows: Choose file imports the same graph from disk', async ({ page }) => {
  await bootLocalCreate(page)
  await openWorkflows(page)

  // ── create.workflow-import.choose-file ──
  // The visible button drives a hidden <input type=file>; proof is the picker
  // opening AND the chosen file landing on the shelf under its own filename.
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 })
  await page.getByTestId('create.workflow-import.choose-file').click()
  const fc = await chooser
  await fc.setFiles({ name: 'sweep-from-disk.json', mimeType: 'application/json', buffer: Buffer.from(API_WORKFLOW) })
  await expect(page.getByText('Installed "sweep-from-disk".')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('sweep-from-disk', { exact: true })).toBeVisible()
})

test('workflows: tags can be created, renamed, cancelled and deleted', async ({ page }) => {
  await bootLocalCreate(page)
  await openWorkflows(page)
  await openTagsTab(page)

  // ── create.tag.create ──
  await expect(page.getByText('No tags yet')).toBeVisible()
  await expect(page.getByTestId('create.tag.create')).toBeDisabled()
  await page.getByPlaceholder(/New tag/i).fill('Wan 2.2')
  await page.getByTestId('create.tag.create').click()
  await expect(page.getByText('Wan 2.2', { exact: true })).toBeVisible()
  await expect(page.getByPlaceholder(/New tag/i)).toHaveValue('')

  // ── create.rename.click ──
  // The pencil swaps the row's label for an input pre-filled with the name.
  await page.getByTestId('create.rename.click').click()
  const editor = page.locator('input[value="Wan 2.2"]')
  await expect(editor).toBeVisible()
  await expect(page.getByTestId('create.rename.click')).toHaveCount(0)

  // ── create.cancel.click ──
  // Cancel throws the edit away: the OLD name is back, untouched.
  await editor.fill('Discarded name')
  await page.getByTestId('create.cancel.click').click()
  await expect(page.getByText('Wan 2.2', { exact: true })).toBeVisible()
  await expect(page.getByText('Discarded name')).toHaveCount(0)

  // ── create.save.click ──
  await page.getByTestId('create.rename.click').click()
  await page.locator('input[value="Wan 2.2"]').fill('Wan 2.2 GGUF')
  await page.getByTestId('create.save.click').click()
  await expect(page.getByText('Wan 2.2 GGUF', { exact: true })).toBeVisible()
  await expect(page.getByText('Wan 2.2', { exact: true })).toHaveCount(0)

  // ── create.tag.delete ──
  const del = page.getByTestId('create.tag.delete')
  await del.click()
  await expect(page.getByText('Wan 2.2 GGUF', { exact: true })).toBeVisible()
  await del.click()
  await expect(page.getByText('Wan 2.2 GGUF', { exact: true })).toHaveCount(0)
  await expect(page.getByText('No tags yet')).toBeVisible()
})

test('workflows: Refresh really re-asks ComfyUI for its model list', async ({ page }) => {
  await bootLocalCreate(page)
  await openWorkflows(page)
  await page.getByRole('radio', { name: 'Models', exact: true }).click()
  await expect(page.getByText('No ComfyUI models found')).toBeVisible()

  // ── create.refresh-the-model-list.click ──
  // The button's only job is a fresh round trip. Every ComfyUI call goes out
  // through the Rust localhost proxy, so the recorded proxy URLs are the
  // proof that a NEW scan left the app, not a cached list being re-rendered.
  const probes = async () =>
    ((await bucket(page, '__E2E_PROXY_URLS__')) as string[]).filter((u) => u.includes('/system_stats')).length
  const before = await probes()
  await page.getByTestId('create.refresh-the-model-list.click').click()
  await expect.poll(probes, { timeout: 15_000 }).toBeGreaterThan(before)
})
