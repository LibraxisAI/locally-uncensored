import { test, expect, type Page } from '@playwright/test'
import {
  bootCloudCreate, bucket, createButton, dismissRetentionNotice, promptField, renderOneCloudImage,
  routeQuota, routeUniqueJobs,
} from './support/journeys/create'

/**
 * QA sweep, area `create`, journey 1: make an image and live with the result.
 *
 * One user, one sitting: dismiss the retention notice, pick a lane, take a
 * suggested prompt, turn the negative field on, submit, then work the result
 * (fullscreen, lightbox, download, delete) and the gallery panel around it.
 *
 * Every assertion here is about what CHANGED after the click. A control that
 * is merely on screen proves nothing about whether it is wired up, which is
 * exactly the class of dead UI this sweep exists to find.
 */

/** Wait until the composer's Create button is enabled (canGenerate). */
async function waitCanGenerate(page: Page) {
  await expect(createButton(page)).toBeEnabled({ timeout: 20_000 })
}

test('cloud image: retention notice, lane pick, prompt example, negative field', async ({ page }) => {
  await bootCloudCreate(page)

  // ── create.retention-notice.dismiss-forever ──
  // Cloud mode opens with the 7-day storage notice. The ONLY way out is this
  // button, and it must stick, because there is no X and no auto-hide.
  const notice = page.getByText(/Cloud results are stored for 7 days/i)
  await expect(notice).toBeVisible({ timeout: 15_000 })
  await dismissRetentionNotice(page)
  await expect(notice).toHaveCount(0)
  // Persisted, not just hidden in this render.
  const seen = await page.evaluate(() => window.localStorage.getItem('lu_cloud_notice'))
  expect(seen).toContain('"retentionNoticeSeen":true')

  // ── create.prompt-example.apply ──
  // The empty stage offers three starter prompts; a click has to write into
  // the prompt store, not just look clickable.
  await expect(promptField(page)).toHaveValue('')
  const example = page.getByTestId('create.prompt-example.apply').first()
  const exampleText = (await example.innerText()).trim()
  await example.click()
  await expect(promptField(page)).toHaveValue(exampleText)

  // ── create.intent-pill.select ──
  // The pill is the lane axis. Clicking Video must move the checked radio AND
  // swap the composer's placeholder to the video lane's copy.
  await expect(promptField(page)).toHaveAttribute('placeholder', /Describe your image/i)
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Video', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Image', exact: true })).not.toBeChecked()
  await expect(promptField(page)).toHaveAttribute('placeholder', /Describe the motion/i)
  await page.getByRole('radio', { name: 'Image', exact: true }).click()
  await expect(promptField(page)).toHaveAttribute('placeholder', /Describe your image/i)

  // ── create.negative-prompt.click ──
  // Neg is a toggle over a collapsed second prompt field. Cloud only offers it
  // where the model honours negative_prompt, so switch to a video model first
  // (wan-2.2-720p carries negative_prompt: true in the catalog).
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByPlaceholder('What to avoid…')).toHaveCount(0)
  await page.getByTestId('create.negative-prompt.click').click()
  await expect(page.getByPlaceholder('What to avoid…')).toBeVisible()
  await page.getByTestId('create.negative-prompt.click').click()
  await expect(page.getByPlaceholder('What to avoid…')).toHaveCount(0)
})

test('cloud image: Create submits the job, Cmd+Enter submits the same run', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)

  // ── create.generation.start ──
  const posts: string[] = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/jobs')) posts.push(r.url()) })

  await promptField(page).fill('a lighthouse at dusk, cinematic')
  await waitCanGenerate(page)
  await createButton(page).click()
  await expect(page.locator('img[src*="/e2e/result.png"]').first()).toBeVisible({ timeout: 30_000 })
  expect(posts.length).toBe(1)

  // ── create.prompt-field.submit ──
  // The textarea submits on Cmd/Ctrl+Enter. Proof is a SECOND job POST, from
  // the keyboard alone, and nothing else was clicked.
  await page.getByRole('radio', { name: 'Image', exact: true }).click()
  await promptField(page).fill('a second lighthouse, at dawn')
  await waitCanGenerate(page)
  await promptField(page).press('ControlOrMeta+Enter')
  await expect.poll(() => posts.length, { timeout: 30_000 }).toBe(2)
})

test('cloud image: the result opens fullscreen, the lightbox closes only where it should', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await renderOneCloudImage(page, 'a lighthouse at dusk, cinematic')

  const result = page.locator('img[src*="/e2e/result.png"]').first()
  await result.hover()

  // ── create.fullscreen.click ──
  await expect(page.getByTestId('create.lightbox-image.keep-open')).toHaveCount(0)
  await page.getByTestId('create.fullscreen.click').click()
  await expect(page.getByTestId('create.lightbox-image.keep-open')).toBeVisible()

  // ── create.lightbox-image.keep-open ──
  // Clicking the picture itself must NOT close the lightbox: the backdrop
  // handler is on the parent, and the image stops the propagation.
  await page.getByTestId('create.lightbox-image.keep-open').click()
  await expect(page.getByTestId('create.lightbox-image.keep-open')).toBeVisible()

  // ── create.lightbox.close ──
  await page.getByTestId('create.lightbox.close').click()
  await expect(page.getByTestId('create.lightbox-image.keep-open')).toHaveCount(0)

  // ── create.lightbox-backdrop.close ──
  await result.hover()
  await page.getByTestId('create.fullscreen.click').click()
  await expect(page.getByTestId('create.lightbox-image.keep-open')).toBeVisible()
  await page.getByTestId('create.lightbox-backdrop.close').click({ position: { x: 8, y: 8 } })
  await expect(page.getByTestId('create.lightbox-image.keep-open')).toHaveCount(0)
})

test('cloud image: the gallery panel expands, selects, downloads and deletes', async ({ page }) => {
  // Two renders have to be two DISTINCT gallery items, and the shared mock
  // hands out one job id for every submit.
  await bootCloudCreate(page, { license: 'active', access: true, mediaLive: true }, undefined, routeUniqueJobs)
  await dismissRetentionNotice(page)
  await renderOneCloudImage(page, 'a lighthouse at dusk, cinematic')

  // ── create.expand-gallery.click ──
  // Collapsed by default: the expanded panel's header does not exist yet.
  await expect(page.getByTestId('create.collapse-gallery.click')).toHaveCount(0)
  await page.getByTestId('create.expand-gallery.click').click()
  await expect(page.getByTestId('create.collapse-gallery.click')).toBeVisible()

  // ── create.collapse-gallery.click ──
  await page.getByTestId('create.collapse-gallery.click').click()
  await expect(page.getByTestId('create.collapse-gallery.click')).toHaveCount(0)
  await expect(page.getByTestId('create.expand-gallery.click')).toBeVisible()

  // ── create.gallery.click ──
  // The rail's second button (the counter badge) opens the same panel.
  await page.getByTestId('create.gallery.click').click()
  await expect(page.getByTestId('create.collapse-gallery.click')).toBeVisible()

  // Render a second image so there is something to pick BETWEEN.
  await page.getByTestId('create.collapse-gallery.click').click()
  await promptField(page).fill('a red barn in a wheat field')
  await createButton(page).click()
  await expect.poll(async () => (await page.getByTestId('create.gallery-item.open').count()) , { timeout: 30_000 }).toBe(0)
  await page.getByTestId('create.expand-gallery.click').click()
  await expect.poll(async () => page.getByTestId('create.gallery-item.open').count(), { timeout: 30_000 }).toBe(2)

  // ── create.gallery-item.open ──
  // Picking the older tile moves the white selection ring off the newest one.
  const tiles = page.getByTestId('create.gallery-item.open')
  await expect(tiles.first()).toHaveClass(/border-white\/60/)
  await tiles.nth(1).click()
  await expect(tiles.nth(1)).toHaveClass(/border-white\/60/)
  await expect(tiles.first()).not.toHaveClass(/border-white\/60/)

  // ── create.download.click ──
  // The tile's save button hands the bytes to the browser as a real download.
  const tileWrap = page.locator('div.group', { has: tiles.first() }).first()
  await tileWrap.hover()
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
  await page.getByTestId('create.download.click').first().click()
  const download = await downloadPromise
  expect(download.suggestedFilename().length).toBeGreaterThan(0)

  // ── create.delete.click ──
  await tileWrap.hover()
  await page.getByTestId('create.delete.click').first().click()
  await expect(tiles).toHaveCount(1)
})

test('cloud image: the result download reaches the native Save dialog', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await renderOneCloudImage(page, 'a lighthouse at dusk, cinematic')

  // ── create.result.download ──
  // A cloud item has no ComfyUI filename, so the save path fetches the signed
  // URL and pushes the bytes through Rust's Save-As command. Proof is the
  // recorded dialog call, with real bytes attached.
  await page.locator('img[src*="/e2e/result.png"]').first().hover()
  await page.getByTestId('create.result.download').click()
  await expect
    .poll(async () => (await bucket(page, '__E2E_DIALOG_CALLS__')).length, { timeout: 20_000 })
    .toBeGreaterThan(0)
  const calls = (await bucket(page, '__E2E_DIALOG_CALLS__')) as Array<{ cmd: string; bytes: number }>
  const save = calls.find((c) => c.cmd === 'save_binary_file_dialog')
  expect(save).toBeTruthy()
  expect(save!.bytes).toBeGreaterThan(0)
})

test('cloud image: an out-of-credits wallet turns the meter into a working upsell', async ({ page }) => {
  // The wallet is empty before the app ever asks. A reload would be no good
  // here, the mocked keychain lives in page memory and a reload signs out.
  await bootCloudCreate(page, { license: 'active', access: true, mediaLive: true }, undefined, (p) => routeQuota(p, 0))
  await dismissRetentionNotice(page)

  // ── create.credits-upsell.open-pricing ──
  // An empty wallet replaces the meter with the top-up chip, and the chip has
  // to actually open the pricing page in the system browser.
  const upsell = page.getByTestId('create.credits-upsell.open-pricing')
  await expect(upsell).toBeVisible({ timeout: 20_000 })
  await expect(upsell).toContainText(/top up/i)
  // With no credits the Create button is gated off too.
  await promptField(page).fill('a lighthouse at dusk')
  await expect(createButton(page)).toBeDisabled()

  await upsell.click()
  await expect
    .poll(async () => (await bucket(page, '__E2E_OPENED_URLS__')) as string[], { timeout: 10_000 })
    .toContain('https://lu-labs.ai/pricing?tab=credits')
})

test('cloud image: a refused render shows the banner, and Dismiss clears it', async ({ page }) => {
  // media_live off, so the honest "coming soon" refusal writes the store error.
  await bootCloudCreate(page, { license: 'active', access: true, mediaLive: false })
  await dismissRetentionNotice(page)

  await promptField(page).fill('a lighthouse at dusk, cinematic')
  await createButton(page).click()
  const banner = page.getByText(/coming soon/i)
  await expect(banner).toBeVisible({ timeout: 20_000 })

  // ── create.dismiss.click ──
  await page.getByTestId('create.dismiss.click').click()
  await expect(banner).toHaveCount(0)
})

test('cloud image: the tooltip anchor opens on hover and hides on click', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)

  // ── create.tooltip-anchor.hide ──
  // The anchor wraps a control and owns the bubble's lifetime: hovering opens
  // it after the delay, and its own onClick closes it again so the bubble
  // never sits over the thing the user just pressed.
  const anchor = page.getByTestId('create.tooltip-anchor.hide').filter({ has: page.getByTestId('create.advanced-settings.click') })
  await anchor.hover()
  await expect(page.getByRole('tooltip')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('tooltip')).toContainText(/advanced settings/i)
  await anchor.click()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})
