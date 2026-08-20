import { test, expect, type Page } from '@playwright/test'
import { bootLocalCreate, numberOf, sizeFields } from './support/journeys/create'

/**
 * QA sweep, area `create`, journey 2: the Advanced settings drawer.
 *
 * The drawer is where every render knob lives, and almost all of them are
 * plain buttons that write two numbers. That makes them easy to leave dead: a
 * chip that looks pressed but never touches width/height would be invisible in
 * a screenshot review. So each step here reads the Width / Height / Seed
 * inputs back out of the DOM after the click.
 *
 * Pinned to the Windows platform on purpose, because the whole Expert section is
 * hidden on a local Mac (the MLX pipeline drops those knobs), so an unpinned
 * spec would prove nothing on half the machines that run it.
 */

/**
 * Open the drawer, tolerating the composer's boot churn.
 *
 * Right after Create mounts, the action bar re-renders as the model lists and
 * the ComfyUI probe land, which detaches and re-creates the icon buttons. A
 * real user just clicks again; this mirrors that instead of racing the boot.
 */
async function openDrawer(page: Page) {
  await expect(async () => {
    await page.getByTestId('create.advanced-settings.click').click({ timeout: 3_000 })
    await expect(page.getByText('Advanced settings', { exact: true })).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  // The panel slides in on a spring, so its contents keep micro-moving for a
  // few frames after they are visible. Let it settle before pressing anything
  // inside it, because a click on a moving chip is retried and can be swapped out.
  await page.waitForTimeout(400)
}

test('advanced drawer: opens from the composer, closes by X and by the scrim', async ({ page }) => {
  await bootLocalCreate(page)

  // ── create.advanced-settings.click ──
  await expect(page.getByText('Advanced settings', { exact: true })).toHaveCount(0)
  await openDrawer(page)
  await expect(page.getByRole('button', { name: 'Output', exact: true })).toBeVisible()

  // ── create.close.click ──
  await page.getByTestId('create.close.click').click()
  await expect(page.getByText('Advanced settings', { exact: true })).toHaveCount(0)

  // ── create.drawer-scrim.close ──
  await openDrawer(page)
  await page.getByTestId('create.drawer-scrim.close').click({ position: { x: 10, y: 10 } })
  await expect(page.getByText('Advanced settings', { exact: true })).toHaveCount(0)
})

test('advanced drawer: aspect chips and the orientation flip rewrite width and height', async ({ page }) => {
  await bootLocalCreate(page)
  await openDrawer(page)

  const { width, height } = sizeFields(page)
  await expect(width).toBeVisible()
  const startArea = (await numberOf(width)) * (await numberOf(height))

  // ── create.aspect-ratio.apply ──
  // The chip respends the SAME pixel budget in a new ratio, so it must not
  // silently double the render cost, and it must actually move both fields.
  await page.getByTestId('create.aspect-ratio.apply').filter({ hasText: '16:9' }).click()
  const w169 = await numberOf(width)
  const h169 = await numberOf(height)
  expect(w169).toBeGreaterThan(h169)
  expect(w169 / h169).toBeGreaterThan(1.6)
  expect(w169 / h169).toBeLessThan(1.9)
  expect(w169 * h169).toBeGreaterThan(startArea * 0.8)
  expect(w169 * h169).toBeLessThan(startArea * 1.2)

  // ── create.swap-orientation.click ──
  await page.getByTestId('create.swap-orientation.click').click()
  await expect(width).toHaveValue(String(h169))
  await expect(height).toHaveValue(String(w169))

  // A second ratio to prove the chips are not all wired to one value.
  await page.getByTestId('create.aspect-ratio.apply').filter({ hasText: '1:1' }).click()
  await expect.poll(async () => (await numberOf(width)) === (await numberOf(height))).toBe(true)
})

test('advanced drawer: the video resolution presets land the native Wan sizes', async ({ page }) => {
  await bootLocalCreate(page)
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await openDrawer(page)

  const { width, height } = sizeFields(page)
  await expect(width).toBeVisible()

  // ── create.video-res-preset.apply ──
  // 720p is 1280x720 on a landscape canvas; the chip also lights up once the
  // canvas matches, which is what tells the user where they are.
  const preset720 = page.getByTestId('create.video-res-preset.apply').filter({ hasText: '720p' })
  await preset720.click()
  await expect(width).toHaveValue('1280')
  await expect(height).toHaveValue('720')
  await expect(preset720).toHaveClass(/bg-white\/\[0\.08\]/)

  // Flipped to portrait, the preset keeps the user's orientation instead of
  // snapping the canvas back to landscape.
  await page.getByTestId('create.swap-orientation.click').click()
  await page.getByTestId('create.video-res-preset.apply').filter({ hasText: /^480p$/ }).click()
  await expect(width).toHaveValue('480')
  await expect(height).toHaveValue('832')
})

test('advanced drawer: seed randomize and reset to model defaults', async ({ page }) => {
  await bootLocalCreate(page)
  await openDrawer(page)

  const seed = page.getByLabel('Seed (−1 = random)').or(page.locator('input[type="number"]').nth(2))
  const seedInput = page.locator('input[type="number"]').nth(2)
  await expect(seedInput).toBeVisible()
  void seed

  // ── create.randomize.click ──
  // The dice put the seed back to −1, which is what the generator reads as
  // "pick a fresh one". Type a fixed seed first so the change is unambiguous.
  await seedInput.fill('4242')
  await expect(seedInput).toHaveValue('4242')
  await page.getByTestId('create.randomize.click').click()
  await expect(seedInput).toHaveValue('-1')

  // ── create.reset-to-model-defaults.click ──
  // Move the canvas away from the model's defaults, then prove the reset
  // really pulls width/height back to the SDXL pair.
  const { width, height } = sizeFields(page)
  await page.getByTestId('create.aspect-ratio.apply').filter({ hasText: '9:16' }).click()
  expect(await numberOf(width)).toBeLessThan(await numberOf(height))
  await page.getByTestId('create.reset-to-model-defaults.click').click()
  await expect(width).toHaveValue('1024')
  await expect(height).toHaveValue('1024')
})

test('advanced drawer: sections collapse, HiRes unfolds, and a Select really picks', async ({ page }) => {
  await bootLocalCreate(page)
  await openDrawer(page)

  // ── create.settings-section.toggle ──
  // Expert starts closed; its header is the only way in, and the Sampler
  // field below is what proves the body actually mounted.
  const expert = page.getByTestId('create.settings-section.toggle').filter({ hasText: 'Expert' })
  await expect(page.getByText('Sampler', { exact: true })).toHaveCount(0)
  await expert.click()
  await expect(page.getByText('Sampler', { exact: true })).toBeVisible()
  await expert.click()
  await expect(page.getByText('Sampler', { exact: true })).toHaveCount(0)

  // ── create.hires-fix.toggle ──
  // Off it is a single row; on it unfolds the Upscale / HiRes steps / denoise
  // stack and prints the resulting output size.
  const hires = page.getByTestId('create.hires-fix.toggle')
  await expect(hires).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('HiRes steps', { exact: true })).toHaveCount(0)
  await hires.click()
  await expect(hires).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('HiRes steps', { exact: true })).toBeVisible()
  await expect(page.getByText('1024×1024').first()).toBeVisible()

  // ── create.select.open ── and ── create.select-option.choose ──
  // The latent upscale method picker only exists while HiRes is on. Opening
  // it must mount the listbox; choosing must write the trigger's label.
  const method = page.getByTestId('create.select.open').filter({ hasText: 'nearest-exact' })
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await method.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.getByTestId('create.select-option.choose').filter({ hasText: 'bicubic' }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(page.getByTestId('create.select.open').filter({ hasText: 'bicubic' })).toBeVisible()

  // Turning HiRes back off folds the whole stack away again.
  await hires.click()
  await expect(page.getByText('HiRes steps', { exact: true })).toHaveCount(0)
})

test('advanced drawer: the Quality and Aspect segments move the render params', async ({ page }) => {
  await bootLocalCreate(page)

  // ── create.segmented-option.select ──
  // The composer's Aspect segment is a Segmented option; its effect is the
  // same width/height pair the drawer shows, so the two surfaces agree.
  await page.getByRole('radio', { name: '16:9', exact: true }).click()
  await openDrawer(page)
  const { width, height } = sizeFields(page)
  await expect(width).toHaveValue('1024')
  await expect(height).toHaveValue('576')
  await page.getByTestId('create.close.click').click()

  await page.getByRole('radio', { name: '3:4', exact: true }).click()
  await openDrawer(page)
  expect(await numberOf(width)).toBeLessThan(await numberOf(height))
})
