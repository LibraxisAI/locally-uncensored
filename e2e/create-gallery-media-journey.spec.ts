import { test, expect, type Page } from '@playwright/test'
import { bootCloudCreate, bootLocalCreate, dismissRetentionNotice, seedGallery } from './support/journeys/create'

/**
 * QA sweep, area `create`, journey 7: the surfaces that only exist once the
 * gallery already holds a clip or a track.
 *
 * Extend picks from previous videos, Enhance upscales a finished cloud render,
 * and the Lightbox branches per media type. None of that is reachable from a
 * cold start, and the shared cloud mock has no video job to render one with,
 * so this journey boots a returning user whose gallery is already populated:
 * a real state, persisted the same way the app itself writes it.
 */

// The id is the one the shared cloud mock answers a job lookup for. Enhance
// re-signs the source clip before it submits, and an unknown id 404s there.
const CLIP = { id: 'job-e2e-1', type: 'video' as const, prompt: 'a wave breaking on rocks', jobId: 'job-e2e-1' }
const TRACK = { id: 'audio-1', type: 'audio' as const, prompt: 'a slow synth ballad' }

/** Open a gallery tile while an op lane owns the stage, because that route sends the
 *  item to the Lightbox instead of the stage viewer, which cannot show it. */
async function openTileInLightbox(page: Page) {
  await page.getByRole('radio', { name: 'Edit / Image to Image', exact: true }).click()
  await page.getByTestId('create.expand-gallery.click').click()
  await page.getByTestId('create.gallery-item.open').first().click()
}

test('lightbox: a cloud clip offers Enhance, and Enhance submits an upscale job', async ({ page }) => {
  await seedGallery(page, [CLIP])
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)

  const posts: string[] = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/jobs')) posts.push(r.url()) })

  await openTileInLightbox(page)

  // ── create.lightbox.enhance-video ──
  // Only a finished CLOUD clip can be enhanced (the op reads it out of the
  // user's render storage by job id). The click has to close the lightbox and
  // put a real job on the wire. Before the credits gate existed, the only
  // feedback for a refused enhance was a 429 after the progress bar started.
  const enhance = page.getByTestId('create.lightbox.enhance-video')
  await expect(enhance).toBeVisible({ timeout: 15_000 })
  await expect(enhance).toBeEnabled()
  await enhance.click()
  await expect(enhance).toHaveCount(0)
  await expect.poll(() => posts.length, { timeout: 20_000 }).toBe(1)
})

test('lightbox: an audio track opens its own panel, and clicking it keeps it open', async ({ page }) => {
  await seedGallery(page, [TRACK])
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await openTileInLightbox(page)

  // ── create.lightbox-audio.keep-open ──
  // The backdrop closes on click; the audio card must swallow that click, or
  // reaching for the play button would dismiss the whole thing.
  const card = page.getByTestId('create.lightbox-audio.keep-open')
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.click({ position: { x: 10, y: 10 } })
  await expect(card).toBeVisible()
  // The backdrop still closes, so the card is swallowing the click rather
  // than the handler being dead.
  await page.getByTestId('create.lightbox-backdrop.close').click({ position: { x: 8, y: 8 } })
  await expect(card).toHaveCount(0)
})

test('extend lane: the cloud picker lists finished clips, picks one and clears it', async ({ page }) => {
  await seedGallery(page, [CLIP])
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await page.getByRole('radio', { name: 'Extend Video', exact: true }).click()

  // ── create.extend-cloud-picker.open ──
  const picker = page.getByTestId('create.extend-cloud-picker.open')
  await expect(picker).toContainText('Pick one of your cloud videos', { timeout: 15_000 })
  await expect(page.getByTestId('create.extend-cloud-clip.select')).toHaveCount(0)
  await picker.click()
  await expect(page.getByTestId('create.extend-cloud-clip.select')).toHaveCount(1)

  // ── create.extend-cloud-clip.select ──
  // Picking writes the extend source: the chip takes the clip's label and the
  // menu shuts behind it.
  await page.getByTestId('create.extend-cloud-clip.select').click()
  await expect(page.getByTestId('create.extend-cloud-clip.select')).toHaveCount(0)
  await expect(picker).toContainText('a wave breaking on rocks')

  // ── create.clear.click-3 ──
  // The X only exists while a clip is picked, and it has to empty the slot.
  const clear = page.getByTestId('create.clear.click-3')
  await expect(clear).toBeVisible()
  await clear.click()
  await expect(picker).toContainText('Pick one of your cloud videos')
  await expect(page.getByTestId('create.clear.click-3')).toHaveCount(0)
})

test('extend lane: the local picker opens its menu with the upload route', async ({ page }) => {
  await bootLocalCreate(page)
  await page.getByRole('radio', { name: 'Extend Video', exact: true }).click()

  // ── create.extend-local-picker.open ──
  // The local lane continues from a file or an earlier local render, so the
  // chip is a menu, not a plain file button. Opening it must mount that menu.
  const picker = page.getByTestId('create.extend-local-picker.open')
  await expect(picker).toContainText('Pick the clip to extend', { timeout: 15_000 })
  await expect(page.getByTestId('create.extend-local.upload-clip')).toHaveCount(0)
  await picker.click()
  await expect(page.getByTestId('create.extend-local.upload-clip')).toBeVisible()
  await picker.click()
  await expect(page.getByTestId('create.extend-local.upload-clip')).toHaveCount(0)
})
