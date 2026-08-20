import { test, expect, type Page } from '@playwright/test'
import { bootApp, openSettings, openSection, readWorkflowState, workflowRows } from './support/journeys/misc'

/**
 * QA sweep, area "agents": the Agent Workflows journey in Settings → Agent.
 *
 * The list (run / edit / duplicate / delete / create) and the builder (add,
 * reorder, remove, expand steps, save, cancel, back). The proof of record is
 * the persisted agentWorkflowStore (localStorage
 * `locally-uncensored-agent-workflows`) plus the step order the builder really
 * holds: a button that only looks pressed proves nothing.
 */

const STEP_ROW = 'agents.workflow-builder.toggle-step-editor'

async function openWorkflows(page: Page) {
  await bootApp(page, { settingsTab: 'agent' })
  await openSettings(page)
  await openSection(page, 'Agent Workflows')
  await expect(page.getByRole('button', { name: /Create Workflow/ })).toBeVisible({ timeout: 15_000 })
}

/** The workflow row carrying this name (the whole hoverable line). */
function row(page: Page, name: string) {
  return page.getByTestId('agents.workflow-list.create-workflow').locator('..').locator('div').filter({ hasText: name }).last()
}

function addStep(page: Page, label: string) {
  return page.getByTestId('agents.workflow-builder.add-step').filter({ hasText: label })
}

/** Type badges of the builder's step rows, top to bottom. */
async function stepOrder(page: Page): Promise<string[]> {
  return page.getByTestId(STEP_ROW).evaluateAll((rows) =>
    rows.map((r) => (r.querySelectorAll('span')[1]?.textContent ?? '').trim()),
  )
}

test('the builder builds a workflow: add, expand, reorder, remove, save', async ({ page }) => {
  await openWorkflows(page)

  const before = await workflowRows(page).count()
  // Nothing has written the workflow store yet: the built-ins come from code.
  expect(await readWorkflowState(page)).toBeNull()

  // ── Create ────────────────────────────────────────────────────────────
  await page.getByTestId('agents.workflow-list.create-workflow').click()
  // Effect: the list gave way to an EMPTY builder in create mode.
  await expect(page.getByRole('heading', { name: 'New Workflow' })).toBeVisible()
  await expect(page.getByTestId('agents.workflow-list.create-workflow')).toHaveCount(0)
  await expect(page.getByPlaceholder('Workflow name')).toHaveValue('')

  // Save is barred while the workflow has no name.
  await expect(page.getByTestId('agents.workflow-builder.save')).toBeDisabled()

  // ── Add steps ─────────────────────────────────────────────────────────
  await addStep(page, 'Prompt').click()
  // Effect: a step of that type exists AND its editor came up open, which is
  // what the type-specific field proves.
  expect(await stepOrder(page)).toEqual(['Prompt'])
  await expect(page.getByPlaceholder(/Prompt text/)).toBeVisible()

  await addStep(page, 'Tool').click()
  // Effect: the new step is appended at the END and takes the open editor
  // over from the previous one (the tool picker is up, the prompt box is gone).
  expect(await stepOrder(page)).toEqual(['Prompt', 'Tool'])
  await expect(page.getByPlaceholder(/Args JSON/)).toBeVisible()
  await expect(page.getByPlaceholder(/Prompt text/)).toHaveCount(0)

  await addStep(page, 'User Input').click()
  expect(await stepOrder(page)).toEqual(['Prompt', 'Tool', 'User Input'])
  await expect(page.getByPlaceholder('Prompt shown to user')).toBeVisible()

  // ── Expand / collapse a step ──────────────────────────────────────────
  await page.getByTestId(STEP_ROW).nth(2).click()
  // Effect: clicking the open step's own head closes its editor.
  await expect(page.getByPlaceholder('Prompt shown to user')).toHaveCount(0)
  await page.getByTestId(STEP_ROW).nth(0).click()
  // Effect: clicking another head opens THAT editor.
  await expect(page.getByPlaceholder(/Prompt text/)).toBeVisible()
  await page.getByTestId(STEP_ROW).nth(1).click()
  // Effect: and the previously open one closed with it.
  await expect(page.getByPlaceholder(/Args JSON/)).toBeVisible()
  await expect(page.getByPlaceholder(/Prompt text/)).toHaveCount(0)

  // ── Reorder ───────────────────────────────────────────────────────────
  // The ends are barred: nothing above the first, nothing below the last.
  await expect(page.getByTestId('agents.workflow-builder.move-step-up').nth(0)).toBeDisabled()
  await expect(page.getByTestId('agents.workflow-builder.move-step-down').nth(2)).toBeDisabled()

  await page.getByTestId('agents.workflow-builder.move-step-down').nth(0).click()
  // Effect: step 1 and step 2 swapped places.
  expect(await stepOrder(page)).toEqual(['Tool', 'Prompt', 'User Input'])

  await page.getByTestId('agents.workflow-builder.move-step-up').nth(2).click()
  // Effect: the last step climbed one row.
  expect(await stepOrder(page)).toEqual(['Tool', 'User Input', 'Prompt'])

  // ── Remove ────────────────────────────────────────────────────────────
  await page.getByTestId('agents.workflow-builder.remove-step').nth(1).click()
  // Effect: that one step is gone and the rest close ranks.
  expect(await stepOrder(page)).toEqual(['Tool', 'Prompt'])

  // ── Save ──────────────────────────────────────────────────────────────
  await page.getByPlaceholder('Workflow name').fill('QA Sweep Flow')
  await page.getByPlaceholder('Description').fill('built by the sweep')
  await page.getByTestId('agents.workflow-builder.save').click()

  // Effect: the builder handed back to the list and the workflow is really in
  // the store, with the two steps in the order the builder showed.
  await expect(page.getByTestId('agents.workflow-list.create-workflow')).toBeVisible()
  await expect(page.getByText('QA Sweep Flow')).toBeVisible()
  expect(await workflowRows(page).count()).toBe(before + 1)
  const after = await readWorkflowState(page)
  expect(after.workflows).toHaveLength(before + 1)
  const saved = after.workflows.find((w: any) => w.name === 'QA Sweep Flow')
  expect(saved.description).toBe('built by the sweep')
  expect(saved.isBuiltIn).toBe(false)
  expect(saved.steps.map((s: any) => s.type)).toEqual(['tool', 'prompt'])
})

test('cancel and back both drop the builder without writing anything', async ({ page }) => {
  await openWorkflows(page)
  const before = await workflowRows(page).count()

  // ── Cancel ────────────────────────────────────────────────────────────
  await page.getByTestId('agents.workflow-list.create-workflow').click()
  await page.getByPlaceholder('Workflow name').fill('Never Saved (cancel)')
  await addStep(page, 'Prompt').click()
  await page.getByTestId('agents.workflow-builder.cancel').click()

  // Effect: back on the list, and nothing of that draft survived.
  await expect(page.getByTestId('agents.workflow-list.create-workflow')).toBeVisible()
  await expect(page.getByText('Never Saved (cancel)')).toHaveCount(0)
  expect(await workflowRows(page).count()).toBe(before)
  expect(await readWorkflowState(page)).toBeNull()

  // ── Back arrow ────────────────────────────────────────────────────────
  await page.getByTestId('agents.workflow-list.create-workflow').click()
  await page.getByPlaceholder('Workflow name').fill('Never Saved (back)')
  await page.getByTestId('agents.workflow-builder.back').click()

  // Effect: same exit, same clean store.
  await expect(page.getByTestId('agents.workflow-list.create-workflow')).toBeVisible()
  await expect(page.getByText('Never Saved (back)')).toHaveCount(0)
  expect(await workflowRows(page).count()).toBe(before)
  expect(await readWorkflowState(page)).toBeNull()

  // And the next open is a fresh builder, not the abandoned draft.
  await page.getByTestId('agents.workflow-list.create-workflow').click()
  await expect(page.getByPlaceholder('Workflow name')).toHaveValue('')
})

test('duplicate, edit and delete a workflow from the list', async ({ page }) => {
  await openWorkflows(page)
  const before = await workflowRows(page).count()

  // ── Duplicate ─────────────────────────────────────────────────────────
  await row(page, 'Research Topic').hover()
  await page.getByTestId('agents.duplicate.click').first().click()

  // Effect: a real copy landed in the store, renamed and stripped of its
  // built-in flag, so it shows up under Custom with its steps intact.
  await expect(page.getByText('Research Topic (copy)')).toBeVisible()
  const dup = (await readWorkflowState(page)).workflows.find((w: any) => w.name === 'Research Topic (copy)')
  expect(dup.isBuiltIn).toBe(false)
  expect(dup.steps.length).toBeGreaterThan(0)
  expect((await readWorkflowState(page)).workflows).toHaveLength(before + 1)
  expect(await workflowRows(page).count()).toBe(before + 1)

  // ── Edit ──────────────────────────────────────────────────────────────
  await row(page, 'Research Topic (copy)').hover()
  await page.getByTestId('agents.edit.click').first().click()

  // Effect: the builder opened in EDIT mode on that workflow, prefilled.
  await expect(page.getByRole('heading', { name: 'Edit Workflow' })).toBeVisible()
  await expect(page.getByPlaceholder('Workflow name')).toHaveValue('Research Topic (copy)')
  expect(await stepOrder(page)).toHaveLength(dup.steps.length)

  await page.getByPlaceholder('Workflow name').fill('Renamed By Sweep')
  await page.getByTestId('agents.workflow-builder.save').click()

  // Effect: the edit updated the SAME record instead of adding a second one.
  await expect(page.getByText('Renamed By Sweep')).toBeVisible()
  const afterEdit = await readWorkflowState(page)
  expect(afterEdit.workflows).toHaveLength(before + 1)
  expect(afterEdit.workflows.find((w: any) => w.id === dup.id).name).toBe('Renamed By Sweep')

  // ── Delete (arm, then confirm) ────────────────────────────────────────
  await row(page, 'Renamed By Sweep').hover()
  const trash = page.getByTestId('agents.workflow-list.delete-workflow').first()
  await trash.click()
  // Effect of the FIRST click: armed, not deleted.
  await expect(trash).toHaveAttribute('title', 'Confirm delete')
  expect((await readWorkflowState(page)).workflows).toHaveLength(before + 1)

  await trash.click()
  // Effect of the SECOND click: the workflow is gone from list and store.
  await expect(page.getByText('Renamed By Sweep')).toHaveCount(0)
  expect((await readWorkflowState(page)).workflows).toHaveLength(before)
  expect(await workflowRows(page).count()).toBe(before)
})

test('the run button starts the workflow it sits on', async ({ page }) => {
  await openWorkflows(page)

  // Nothing has ever run in this profile.
  expect(await readWorkflowState(page)).toBeNull()

  await row(page, 'Research Topic').hover()
  await page.getByTestId('agents.run.click').first().click()

  // Effect: an execution record for THIS workflow was created and the engine
  // is parked on the workflow's first step, which is a user_input step. That
  // record is the run: the store is where the engine keeps its state.
  await expect.poll(async () => (await readWorkflowState(page))?.executions?.length ?? 0, { timeout: 20_000 })
    .toBe(1)
  const run = (await readWorkflowState(page)).executions[0]
  expect(run.workflowId).toBe('builtin-research-topic')
  expect(run.workflowName).toBe('Research Topic')
  expect(run.status).toBe('waiting_input')

  // Effect on screen: the run strip asks the question the step defines.
  await expect(page.getByText('Waiting for your input')).toBeVisible()
  await expect(page.getByText('What topic should I research?')).toBeVisible()

  // Leave nothing running behind us.
  await page.getByRole('button', { name: /^Cancel$/ }).click()
  await expect.poll(async () => (await readWorkflowState(page)).executions[0].status).toBe('cancelled')
})
