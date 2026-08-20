import { test, expect } from '@playwright/test'
import { bootApp } from './support/journeys/misc'

/**
 * QA sweep, area "workflows": the compatibility-tag chips in the
 * "Workflows & tags" dialog (Create → Composer → Workflows and tags).
 *
 * The chip is a toggle whose whole job is to write the workflow ↔ tag mapping,
 * so the proof is the persisted workflowStore (localStorage `workflow-store`),
 * not the chip's colour.
 */

const API_JSON = '{"1":{"class_type":"KSampler","inputs":{"steps":20}}}'

async function readWorkflowStore(page: import('@playwright/test').Page): Promise<any> {
  return page.evaluate(() => JSON.parse(window.localStorage.getItem('workflow-store') || '{}').state ?? {})
}

test('a tag chip binds and unbinds a tag on an installed workflow', async ({ page }) => {
  await bootApp(page)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await page.getByTestId('create.workflows-and-tags.click').click()
  await expect(page.getByText('Workflows & tags').first()).toBeVisible({ timeout: 20_000 })

  // ── Without a tag there is nothing to pick, and the picker says so ─────
  await page.getByRole('radio', { name: 'Tags', exact: true }).click()
  await page.getByPlaceholder('New tag, for example Wan 2.2').fill('sdxl')
  await page.getByTestId('create.tag.create').click()
  await expect.poll(async () => (await readWorkflowStore(page)).tags?.length ?? 0).toBe(1)

  // ── Install a workflow so a tag has something to attach to ────────────
  await page.getByRole('radio', { name: 'Workflows', exact: true }).click()
  await page.getByPlaceholder('Workflow name (optional)').fill('QA Sweep Graph')
  await page.getByPlaceholder(/Or paste the API JSON here/).fill(API_JSON)
  await page.getByTestId('create.workflow-import.install-pasted').click()
  await expect(page.getByText('QA Sweep Graph').first()).toBeVisible()

  const store = await readWorkflowStore(page)
  const workflowId = store.installedWorkflows.find((w: any) => w.name === 'QA Sweep Graph').id
  const tagId = store.tags[0].id
  expect(store.workflowTags[workflowId]).toBeUndefined()

  // ── Bind ──────────────────────────────────────────────────────────────
  const chip = page.getByTestId('workflows.tag-picker.toggle-tag').filter({ hasText: 'sdxl' })
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await chip.click()

  // Effect: the mapping is written through to the store, which is what the
  // model↔workflow matching later reads, and the chip reports it pressed.
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await readWorkflowStore(page)).workflowTags[workflowId]).toEqual([tagId])

  // ── Unbind ────────────────────────────────────────────────────────────
  await chip.click()

  // Effect: the same click takes it back off, and the empty entry is dropped
  // rather than left behind as an empty array.
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await readWorkflowStore(page)).workflowTags[workflowId]).toBeUndefined()
})
