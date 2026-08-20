import { test, expect } from '@playwright/test'
import {
  bootCloudCreate, bootLocalCreate, bucket, dismissRetentionNotice, seedGallery, TEST_PNG_256, TEST_WEBM, WIN_OPTS,
} from './support/journeys/create'

/**
 * QA sweep, area `create`, journey 6: the specialized lanes' own composer
 * surfaces.
 *
 * Music, Character Studio and Talking Character each mount controls nothing
 * else shares, and they are only reachable once their lane is picked. That
 * makes them the easiest part of Create to break without anyone noticing, so
 * this journey walks each one and reads back what the click changed: an open
 * lyrics box, a photo in the training set, an install command on the wire.
 */

const IMAGE_FILE = { name: 'portrait.png', mimeType: 'image/png', buffer: TEST_PNG_256 }

test('music lane: the lyrics box and the how-to panel open on demand', async ({ page }) => {
  // Local: every local music checkpoint runs the ACE encoder, so the lyrics
  // box is offered here (on cloud only ACE-Step 1.5 takes lyrics).
  await bootLocalCreate(page)
  await page.getByRole('radio', { name: 'Music', exact: true }).click()

  // ── create.music-lyrics.toggle ──
  const lyrics = page.getByTestId('create.music-lyrics.toggle')
  await expect(lyrics).toBeVisible({ timeout: 15_000 })
  await expect(page.getByPlaceholder(/lyric/i)).toHaveCount(0)
  await lyrics.click()
  await expect(page.getByPlaceholder(/lyric/i)).toBeVisible()
  await lyrics.click()
  await expect(page.getByPlaceholder(/lyric/i)).toHaveCount(0)

  // ── create.music-howto.toggle ──
  // It unfolds the explainer AND marks it read, which is the half that has to
  // survive a restart, so the flag is read back out of the persisted store.
  const howto = page.getByTestId('create.music-howto.toggle')
  const seen = () => page.evaluate(() => window.localStorage.getItem('create-store') ?? '')
  expect(await seen()).not.toContain('"musicHowtoSeen":true')
  await howto.click()
  await expect(page.getByText(/ACE|prompt|style/i).first()).toBeVisible()
  await expect(howto).toHaveClass(/bg-white\/\[0\.06\]/)
  await expect.poll(seen, { timeout: 10_000 }).toContain('"musicHowtoSeen":true')
  await howto.click()
  await expect(howto).not.toHaveClass(/bg-white\/\[0\.06\]/)
})

test('character studio: photos go into the training set and come back out', async ({ page }) => {
  // Trainer env + bases ready (the mock default), so the board is reachable.
  await bootLocalCreate(page)
  await page.getByRole('radio', { name: 'Character Studio', exact: true }).click()

  // ── create.train-set-empty.add-photos ──
  // The empty board IS the button. It opens the multi-select picker, and the
  // proof is the board flipping to the grid with the counter underneath.
  const empty = page.getByTestId('create.train-set-empty.add-photos')
  await expect(empty).toBeVisible({ timeout: 15_000 })
  const firstPick = page.waitForEvent('filechooser', { timeout: 15_000 })
  await empty.click()
  const fc1 = await firstPick
  expect(fc1.isMultiple()).toBe(true)
  await fc1.setFiles([{ ...IMAGE_FILE, name: 'shot-a.png' }, { ...IMAGE_FILE, name: 'shot-b.png' }])
  await expect(page.getByTestId('create.train-set-empty.add-photos')).toHaveCount(0)
  await expect(page.getByText('2/30 photos', { exact: false }).first()).toBeVisible()

  // ── create.add-photos.click ──
  // The tile at the end of the grid adds to the set rather than replacing it.
  const secondPick = page.waitForEvent('filechooser', { timeout: 15_000 })
  await page.getByTestId('create.add-photos.click').click()
  await (await secondPick).setFiles([{ ...IMAGE_FILE, name: 'shot-c.png' }])
  await expect(page.getByText('3/30 photos', { exact: false }).first()).toBeVisible()

  // ── create.remove.click-2 ──
  // Each tile's X drops exactly that photo, and the counter follows.
  const tiles = page.getByTestId('create.remove.click-2')
  await expect(tiles).toHaveCount(3)
  await tiles.first().click()
  await expect(tiles).toHaveCount(2)
  await expect(page.getByText('2/30 photos', { exact: false }).first()).toBeVisible()
})

test('character studio: a fresh box installs the trainer from the composer', async ({ page }) => {
  await bootLocalCreate(page, { ...WIN_OPTS, trainer: { envReady: false, basesReady: false } })
  await page.getByRole('radio', { name: 'Character Studio', exact: true }).click()

  // ── create.trainer-setup.start ──
  // Without the trainer venv the lane offers nothing but this button, and it
  // has to reach Rust, because the label alone would be theatre.
  const setup = page.getByTestId('create.trainer-setup.start')
  await expect(setup).toBeVisible({ timeout: 15_000 })
  await setup.click()
  await expect
    .poll(async () => ((await bucket(page, '__E2E_TRAINER_CALLS__')) as Array<{ cmd: string }>)
      .filter((c) => c.cmd === 'install_character_trainer').length, { timeout: 15_000 })
    .toBeGreaterThan(0)
  await expect(page.getByText('Setting up the trainer', { exact: false })).toBeVisible()
})

test('character studio: the base models download, and the trainer can be reinstalled', async ({ page }) => {
  await bootLocalCreate(page, { ...WIN_OPTS, trainer: { envReady: true, basesReady: false } })
  await page.getByRole('radio', { name: 'Character Studio', exact: true }).click()

  // ── create.trainer-bases.download ──
  // The second gate. One click has to start every missing base file in Rust,
  // which is what the recorded download calls prove.
  const bases = page.getByTestId('create.trainer-bases.download')
  await expect(bases).toBeVisible({ timeout: 15_000 })
  await bases.click()
  await expect
    .poll(
      async () => ((await bucket(page, '__E2E_MODEL_CALLS__')) as Array<{ cmd: string; subfolder: string }>)
        .filter((c) => c.cmd === 'download_model').length,
      { timeout: 20_000 },
    )
    .toBe(3)
  const started = ((await bucket(page, '__E2E_MODEL_CALLS__')) as Array<{ subfolder: string }>).map((c) => c.subfolder)
  expect(started).toEqual(expect.arrayContaining(['diffusion_models', 'text_encoders', 'vae']))

  // Once every base is on its way the gate clears on its own and the real
  // training controls appear, which is where the repair link lives.
  const reinstall = page.getByTestId('create.trainer.reinstall')
  await expect(reinstall).toBeVisible({ timeout: 20_000 })

  // ── create.trainer.reinstall ──
  const before = ((await bucket(page, '__E2E_TRAINER_CALLS__')) as Array<{ cmd: string }>)
    .filter((c) => c.cmd === 'install_character_trainer').length
  await reinstall.click()
  await expect
    .poll(async () => ((await bucket(page, '__E2E_TRAINER_CALLS__')) as Array<{ cmd: string }>)
      .filter((c) => c.cmd === 'install_character_trainer').length, { timeout: 15_000 })
    .toBeGreaterThan(before)
  await expect(reinstall).toBeDisabled()
})

test('talking character: the portrait chip loads a file and clears it again', async ({ page }) => {
  // Cloud, because the local chip stages the image through ComfyUI and there
  // is none here; on cloud the picked file lives as a data URL.
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await page.getByRole('radio', { name: 'Talking Character', exact: true }).click()

  // ── create.file-chip.open-picker ──
  const chip = page.getByTestId('create.file-chip.open-picker').first()
  await expect(chip).toContainText('Add portrait', { timeout: 15_000 })
  await expect(page.getByTestId('create.remove.click')).toHaveCount(0)
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 })
  await chip.click()
  await (await chooser).setFiles(IMAGE_FILE)
  await expect(chip).toContainText('Image ready', { timeout: 15_000 })

  // ── create.remove.click ──
  // The X only exists once something is loaded, and it has to empty the slot.
  const remove = page.getByTestId('create.remove.click')
  await expect(remove).toBeVisible()
  await remove.click()
  await expect(chip).toContainText('Add portrait')
  await expect(page.getByTestId('create.remove.click')).toHaveCount(0)
})

test('talking character: the voice menu uploads, clears, and offers past audio', async ({ page }) => {
  // A past hosted voice run is what puts the "Your generated audio" section in
  // the menu, so this journey boots a user who already has one.
  await seedGallery(page, [
    { id: 'job-e2e-1', type: 'audio', prompt: 'a warm narrator line', jobId: 'job-e2e-1' },
  ])
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await page.getByRole('radio', { name: 'Talking Character', exact: true }).click()

  // ── create.voice-chip.open-menu ──
  const voice = page.getByTestId('create.voice-chip.open-menu')
  await expect(voice).toContainText('Add voice', { timeout: 15_000 })
  await expect(page.getByTestId('create.voice-chip.upload-audio')).toHaveCount(0)
  await voice.click()
  await expect(page.getByTestId('create.voice-chip.upload-audio')).toBeVisible()

  // ── create.voice-from-gallery.select ──
  // Reusing an earlier hosted voice: the chip takes its label and the menu
  // closes behind the pick.
  await page.getByTestId('create.voice-from-gallery.select').click()
  await expect(voice).toContainText('a warm narrator line')
  await expect(page.getByTestId('create.voice-chip.upload-audio')).toHaveCount(0)

  // ── create.remove-voice.click ──
  await page.getByTestId('create.remove-voice.click').click()
  await expect(voice).toContainText('Add voice')
  await expect(page.getByTestId('create.remove-voice.click')).toHaveCount(0)

  // ── create.voice-chip.upload-audio ──
  // The upload route drives the hidden audio input; the chip has to take the
  // file's own name, which is what tells the user which take is loaded.
  await voice.click()
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 })
  await page.getByTestId('create.voice-chip.upload-audio').click()
  await (await chooser).setFiles({ name: 'take-one.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF0000WAVEfmt ') })
  await expect(voice).toContainText('take-one.wav')
})

test('talking character: the AI voice maker submits a hosted TTS run', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)
  await page.getByRole('radio', { name: 'Talking Character', exact: true }).click()
  await page.getByTestId('create.voice-chip.open-menu').click()

  // ── create.voice-maker.open ──
  // The maker REPLACES the menu's routes with its own form.
  await expect(page.getByPlaceholder(/What should the character say/i)).toHaveCount(0)
  await page.getByTestId('create.voice-maker.open').click()
  await expect(page.getByPlaceholder(/What should the character say/i)).toBeVisible()
  await expect(page.getByTestId('create.voice-chip.upload-audio')).toHaveCount(0)

  // ── create.voice-maker.submit ──
  // Dead without text, then it has to put a real job on the wire and adopt
  // the finished take as the lane's voice.
  const posts: string[] = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/jobs')) posts.push(r.url()) })
  await expect(page.getByTestId('create.voice-maker.submit')).toBeDisabled()
  await page.getByPlaceholder(/What should the character say/i).fill('Welcome back to the lighthouse.')
  await expect(page.getByTestId('create.voice-maker.submit')).toBeEnabled()
  await page.getByTestId('create.voice-maker.submit').click()
  await expect.poll(() => posts.length, { timeout: 20_000 }).toBe(1)
  await expect(page.getByTestId('create.voice-chip.open-menu'))
    .toContainText('Welcome back to the lighthouse.', { timeout: 30_000 })
})

test('fresh box: the stage offers the starter install, and the run can be stopped', async ({ page }) => {
  // Local Windows with nothing installed: the Image lane has no model, so the
  // stage becomes the one-click starter card.
  await bootLocalCreate(page)

  // ── create.install-card.start ──
  // Pressing it has to hand the lane over to a live run: the button is
  // replaced by the streamed status line and its Cancel.
  const start = page.getByTestId('create.install-card.start')
  await expect(start).toBeVisible({ timeout: 25_000 })
  await start.click()
  const cancel = page.getByTestId('create.install-card.cancel')
  await expect(cancel).toBeVisible({ timeout: 20_000 })
  await expect(start).toHaveCount(0)
  await expect(page.getByText(/Setting this up for you/i)).toBeVisible()

  // ── create.install-card.cancel ──
  // David 2026-07-25: a 10.5 GB transfer with no way out. Cancel aborts the
  // run and the card comes back with an honest outcome, not a dead spinner.
  await cancel.click()
  await expect(start).toBeVisible({ timeout: 20_000 })
  const cancelled = page.getByText(/Cancelled\./i)
  await expect(cancelled).toBeVisible()

  // ── create.dismiss.click-3 ──
  await page.getByTestId('create.dismiss.click-3').click()
  await expect(cancelled).toHaveCount(0)
  await expect(start).toBeVisible()
})

test('cross-origin banner: the one-click fix runs, and Dismiss puts it away', async ({ page }) => {
  // #75 (cinemazverev): a user-managed ComfyUI 0.19+ answers the WebView's
  // media requests with a Sec-Fetch 403. LU proxies the bytes so the render
  // still shows, and raises this banner because the flag is the real fix.
  // A persisted LOCAL render with no engine behind it reproduces exactly that.
  await seedGallery(page, [{ id: 'local-1', type: 'image', prompt: 'an old local render', local: true }])
  await bootLocalCreate(page)
  await page.getByTestId('create.expand-gallery.click').click()

  const banner = page.getByText(/blocks direct loads/i)
  await expect(banner).toBeVisible({ timeout: 20_000 })

  // ── create.dismiss.click-2 ──
  await page.getByTestId('create.dismiss.click-2').click()
  await expect(banner).toHaveCount(0)

  // Re-mounting the thumbnail re-runs the failed load, so the banner is back.
  await page.getByTestId('create.collapse-gallery.click').click()
  await page.getByTestId('create.expand-gallery.click').click()
  await expect(banner).toBeVisible({ timeout: 20_000 })

  // ── create.cors-banner.autofix ──
  // "Let me do it for you" restarts ComfyUI under LU's management, which
  // always passes the flag. It must reach Rust and clear the banner.
  await page.getByTestId('create.cors-banner.autofix').click()
  await expect
    .poll(async () => ((await bucket(page, '__E2E_COMFY_CALLS__')) as Array<{ cmd: string }>)
      .filter((c) => c.cmd === 'fix_comfyui_cors').length, { timeout: 20_000 })
    .toBeGreaterThan(0)
  await expect(banner).toHaveCount(0)
})

test('character studio: the cloud shelf picks a character and deletes one', async ({ page }) => {
  // The shelf is served by /api/loras, which the shared cloud mock does not
  // model, so this journey owns that one endpoint.
  const shelf = [
    { id: 'lora-1', name: 'Dave', trigger_word: 'davechar', base_family: 'z-image', created_at: '2026-08-01T00:00:00Z' },
    { id: 'lora-2', name: 'Mira', trigger_word: 'mirachar', base_family: 'flux', created_at: '2026-08-02T00:00:00Z' },
  ]
  const deleted: string[] = []
  await bootCloudCreate(page, { license: 'active', access: true, mediaLive: true }, undefined, async (p) => {
    await p.route(/https:\/\/lu-labs\.ai\/api\/loras(\/.*)?$/, async (route) => {
      const headers = {
        'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'content-type': 'application/json',
      }
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      if (req.method() === 'DELETE') {
        const id = new URL(req.url()).pathname.split('/').pop()!
        deleted.push(id)
        return route.fulfill({ status: 200, headers, body: JSON.stringify({ ok: true }) })
      }
      return route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ loras: shelf.filter((l) => !deleted.includes(l.id)) }),
      })
    })
  })
  await dismissRetentionNotice(page)
  await page.getByRole('radio', { name: 'Character Studio', exact: true }).click()
  await page.getByRole('radio', { name: 'Use character', exact: true }).click()

  // ── create.cloud-character.select ──
  // Picking arms the character for the next render; picking it again lets go.
  const picks = page.getByTestId('create.cloud-character.select')
  await expect(picks).toHaveCount(2, { timeout: 20_000 })
  const dave = picks.filter({ hasText: 'Dave' })
  await expect(dave).not.toHaveClass(/bg-white\/10/)
  await dave.click()
  await expect(dave).toHaveClass(/bg-white\/10/)
  await dave.click()
  await expect(dave).not.toHaveClass(/bg-white\/10/)

  // ── create.cloud-character.delete ──
  // The bin has to reach the server AND refresh the shelf, or a deleted
  // character keeps sitting there until the next app start.
  await dave.click()
  await page.getByTestId('create.cloud-character.delete').first().click()
  await expect.poll(() => deleted, { timeout: 20_000 }).toContain('lora-1')
  await expect(picks).toHaveCount(1, { timeout: 20_000 })
  await expect(page.getByText('Dave', { exact: true })).toHaveCount(0)
})

test('extend lane: a local clip is adopted by its last frame, and cleared again', async ({ page }) => {
  await bootLocalCreate(page)
  await page.getByRole('radio', { name: 'Extend Video', exact: true }).click()
  const picker = page.getByTestId('create.extend-local-picker.open')
  await expect(picker).toContainText('Pick the clip to extend', { timeout: 15_000 })
  await picker.click()

  // ── create.extend-local.upload-clip ──
  // The local lane continues from the clip's LAST FRAME, so a successful pick
  // is not "a file is attached". It is a decoded frame sitting in the stage
  // as the I2V start image, with the chip naming what it continues.
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 })
  await page.getByTestId('create.extend-local.upload-clip').click()
  await (await chooser).setFiles({ name: 'beach.webm', mimeType: 'video/webm', buffer: TEST_WEBM })
  // The chip only says "Continues:" once BOTH halves are done: the frame was
  // decoded and the resulting image landed in the store as the stage source
  // (`value` is gated on `source`), so this one line covers the whole chain.
  await expect(picker).toContainText('Continues: beach.webm', { timeout: 30_000 })

  // ── create.clear.click-2 ──
  await page.getByTestId('create.clear.click-2').click()
  await expect(picker).toContainText('Pick the clip to extend')
  await expect(page.getByTestId('create.clear.click-2')).toHaveCount(0)
})

test('extend lane: an earlier local render can be continued from the menu', async ({ page }) => {
  // An MLX-style local clip: it carries its own bytes, so it is readable with
  // no engine behind it, which is what makes the "Your local videos" list in
  // the picker reachable at all.
  await seedGallery(page, [{
    id: 'local-clip-1',
    type: 'video',
    prompt: 'gulls over the pier',
    dataUrl: `data:video/webm;base64,${TEST_WEBM.toString('base64')}`,
  }])
  await bootLocalCreate(page)
  await page.getByRole('radio', { name: 'Extend Video', exact: true }).click()

  const picker = page.getByTestId('create.extend-local-picker.open')
  await expect(picker).toContainText('Pick the clip to extend', { timeout: 15_000 })
  await picker.click()

  // ── create.extend-local-clip.select ──
  // Same contract as the upload route: the clip's last frame becomes the
  // stage source, which is the only reason the chip can name it.
  const clip = page.getByTestId('create.extend-local-clip.select')
  await expect(clip).toHaveCount(1)
  await clip.click()
  await expect(picker).toContainText('Continues: gulls over the pier', { timeout: 30_000 })
  await expect(page.getByTestId('create.extend-local-clip.select')).toHaveCount(0)
})
