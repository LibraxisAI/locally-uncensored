import { test, expect, type Page } from '@playwright/test'
import {
  bootCloudCreate, createButton, dismissRetentionNotice, promptField, renderOneCloudImage, TEST_PNG_256,
} from './support/journeys/create'

/**
 * QA sweep, area `create`, journey 4: the image-to-image stage and the mask
 * editor.
 *
 * The Edit lane is the one place where the user brings their OWN pixels in,
 * paints on them, and hands the result to a render. That makes it the densest
 * cluster of buttons on the whole surface and the easiest place for a control
 * to rot unnoticed, because none of it is reachable until an image is loaded.
 *
 * Cloud backend on purpose: applying a mask stages through ComfyUI on local,
 * and there is no ComfyUI here. On cloud the mask round-trips as a data URL,
 * which is the path this journey verifies.
 */

const IMAGE_FILE = { name: 'sweep-source.png', mimeType: 'image/png', buffer: TEST_PNG_256 }

async function dropAnImage(page: Page, testId: string) {
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 })
  await page.getByTestId(testId).click()
  await (await chooser).setFiles(IMAGE_FILE)
}

/** Go to Edit / Image to Image with the stage empty. */
async function openEditLane(page: Page) {
  await page.getByRole('radio', { name: 'Edit / Image to Image', exact: true }).click()
  await expect(page.getByText(/Drop an image to edit/i)).toBeVisible({ timeout: 15_000 })
}

async function openMaskEditor(page: Page) {
  await page.getByTestId('create.mask-editor.open').click()
  await expect(page.getByRole('dialog', { name: 'Mask editor' })).toBeVisible({ timeout: 15_000 })
}

test('edit lane: the dropzone loads a file, and Remove image empties the stage again', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await openEditLane(page)

  // ── create.dropzone.open-file-picker ──
  // The whole dashed panel is the trigger for a hidden file input, and the
  // proof is the stage swapping from the dropzone to the source preview.
  await dropAnImage(page, 'create.dropzone.open-file-picker')
  await expect(page.locator('img[alt="source"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Drop an image to edit/i)).toHaveCount(0)

  // ── create.remove-image.click ──
  await page.getByTestId('create.remove-image.click').click()
  await expect(page.locator('img[alt="source"]')).toHaveCount(0)
  await expect(page.getByText(/Drop an image to edit/i)).toBeVisible()
})

test('edit lane: a gallery render can be adopted as the source, and swapped out', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await renderOneCloudImage(page, 'a lighthouse at dusk, cinematic')
  await openEditLane(page)

  // ── create.use-this-gallery-image-as-the-source.click ──
  // Ops never auto-adopt (David 2026-07-10). The pick strip is the explicit
  // route, and it has to turn the render into a real working source.
  await expect(page.getByText(/or pick from your gallery/i)).toBeVisible()
  await page.getByTestId('create.use-this-gallery-image-as-the-source.click').first().click()
  await expect(page.locator('img[alt="source"]')).toBeVisible({ timeout: 15_000 })

  // ── create.source-preview.change-image ──
  // Replacing the source in place: same slot, different pixels.
  const before = await page.locator('img[alt="source"]').getAttribute('src')
  await dropAnImage(page, 'create.source-preview.change-image')
  await expect
    .poll(async () => page.locator('img[alt="source"]').getAttribute('src'), { timeout: 15_000 })
    .not.toBe(before)
})

test('mask editor: opens, zooms, fits, and cancels without touching the mask', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await openEditLane(page)
  await dropAnImage(page, 'create.dropzone.open-file-picker')
  await expect(page.locator('img[alt="source"]')).toBeVisible({ timeout: 15_000 })

  // ── create.mask-editor.open ──
  await expect(page.getByRole('dialog', { name: 'Mask editor' })).toHaveCount(0)
  await openMaskEditor(page)

  // The editor prints its zoom as a percentage, which is what makes the view
  // buttons provable at all.
  const zoom = page.locator('span.t-mono', { hasText: /^\d+%$/ })
  const readZoom = async () => Number((await zoom.innerText()).replace('%', ''))
  const fitted = await readZoom()

  // ── create.zoom-in.click ──
  await page.getByTestId('create.zoom-in.click').click()
  const zoomedIn = await readZoom()
  expect(zoomedIn).toBeGreaterThan(fitted)

  // ── create.zoom-out.click ──
  await page.getByTestId('create.zoom-out.click').click()
  await page.getByTestId('create.zoom-out.click').click()
  expect(await readZoom()).toBeLessThan(zoomedIn)

  // ── create.fit.click ──
  await page.getByTestId('create.fit.click').click()
  expect(await readZoom()).toBe(fitted)

  // ── create.mask-editor.cancel ──
  // Cancel leaves the source untouched and paints no mask badge.
  await page.getByTestId('create.mask-editor.cancel').click()
  await expect(page.getByRole('dialog', { name: 'Mask editor' })).toHaveCount(0)
  await expect(page.locator('img[alt="source"]')).toBeVisible()
  await expect(page.getByText('mask painted')).toHaveCount(0)
})

test('mask editor: invert, undo, redo and clear move the actual mask buffer', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await openEditLane(page)
  await dropAnImage(page, 'create.dropzone.open-file-picker')
  await expect(page.locator('img[alt="source"]')).toBeVisible({ timeout: 15_000 })
  await openMaskEditor(page)

  const undo = page.getByTestId('create.undo-z.click')
  const redo = page.getByTestId('create.redo-z.click')

  // A fresh editor has no history at all, so both buttons are dead by design.
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()

  // ── create.invert-i.click ──
  // Invert on an empty mask fills the whole canvas, which is a real buffer
  // write: it lands on the undo stack.
  await page.getByTestId('create.invert-i.click').click()
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()

  // ── create.undo-z.click ──
  await undo.click()
  await expect(undo).toBeDisabled()
  await expect(redo).toBeEnabled()

  // ── create.redo-z.click ──
  await redo.click()
  await expect(redo).toBeDisabled()
  await expect(undo).toBeEnabled()

  // ── create.mask-editor.apply ──
  // The inverted (fully painted) mask survives Apply: the source preview
  // carries the badge, which only shows when the store holds a mask.
  await page.getByTestId('create.mask-editor.apply').click()
  await expect(page.getByRole('dialog', { name: 'Mask editor' })).toHaveCount(0)
  await expect(page.getByText('mask painted')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /Edit mask/i })).toBeVisible()

  // ── create.clear.click ──
  // Clearing wipes the buffer, and applying an EMPTY mask drops the stored
  // one, and the badge has to go with it, or the next render silently inpaints
  // against a mask the user believes they deleted.
  await page.getByTestId('create.mask-editor.open').click()
  await expect(page.getByRole('dialog', { name: 'Mask editor' })).toBeVisible()
  await page.getByTestId('create.clear.click').click()
  await page.getByTestId('create.mask-editor.apply').click()
  await expect(page.getByText('mask painted')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Paint mask/i })).toBeVisible()
})

test('mask editor: the brush paints and the eraser does not', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await openEditLane(page)
  await dropAnImage(page, 'create.dropzone.open-file-picker')
  await expect(page.locator('img[alt="source"]')).toBeVisible({ timeout: 15_000 })
  await openMaskEditor(page)

  const stroke = async () => {
    const canvas = page.locator('canvas').first()
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 8 })
    await page.mouse.up()
  }

  // ── create.mask-tool.brush ──
  // Brush is the default; a drag has to leave paint behind, and the only
  // honest witness for that is the mask the editor hands back on Apply.
  const brush = page.getByTestId('create.mask-tool.brush')
  const eraser = page.getByTestId('create.mask-tool.eraser')
  await expect(brush).toHaveAttribute('aria-pressed', 'true')
  await stroke()
  await expect(page.getByTestId('create.undo-z.click')).toBeEnabled()
  await page.getByTestId('create.mask-editor.apply').click()
  await expect(page.getByText('mask painted')).toBeVisible({ timeout: 15_000 })

  // ── create.mask-tool.eraser ──
  // Switching tools moves the pressed state off the brush AND changes what a
  // drag does: the same gesture over a cleared canvas removes nothing, so
  // Apply drops the mask instead of storing one.
  await page.getByTestId('create.mask-editor.open').click()
  await expect(page.getByRole('dialog', { name: 'Mask editor' })).toBeVisible()
  await page.getByTestId('create.clear.click').click()
  await eraser.click()
  await expect(eraser).toHaveAttribute('aria-pressed', 'true')
  await expect(brush).toHaveAttribute('aria-pressed', 'false')
  await stroke()
  await page.getByTestId('create.mask-editor.apply').click()
  await expect(page.getByText('mask painted')).toHaveCount(0)
})

test('edit lane: a finished result goes straight into the mask editor', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await renderOneCloudImage(page, 'a lighthouse at dusk, cinematic')

  // ── create.edit-with-mask.click ──
  // One click has to do three things: switch the lane to Edit, adopt the
  // render as the source, and open the editor on it. Before this existed the
  // app demanded a download and a re-upload of its own output.
  await page.locator('img[src*="/e2e/result.png"]').first().hover()
  await page.getByTestId('create.edit-with-mask.click').click()
  await expect(page.getByRole('radio', { name: 'Edit / Image to Image', exact: true })).toBeChecked({ timeout: 15_000 })
  await expect(page.getByRole('dialog', { name: 'Mask editor' })).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('create.mask-editor.cancel').click()
  await expect(page.locator('img[alt="source"]')).toBeVisible()

  // And the adopted source is a genuine render input: the lane is ready.
  await promptField(page).fill('turn it into a watercolour painting')
  await expect(createButton(page)).toBeEnabled()
})
