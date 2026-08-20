/* eslint-disable @typescript-eslint/no-explicit-any -- these specs reach into
   the app's own zustand singletons and into the untyped Tauri bridge to build
   preconditions the mocked backend cannot produce; both are `any` by nature,
   same as in tauri-mock.ts. */
import { test, expect, type Page } from '@playwright/test'
import { bootLayout, bridgeCalls, bridgeCommands } from './support/journeys/layout'

/**
 * The download tray in the header, driven as a user drives it: open it, pause
 * a running model pull, resume it, sweep the finished rows away, and cancel
 * or retry the multi-file ComfyUI bundles.
 *
 * The two worlds behind the tray cannot be produced by clicking inside the
 * layout, a text pull starts on the Models page, a bundle starts on
 * Discover. So the preconditions are built through the app's OWN store
 * actions (the same calls those pages make) and every assertion afterwards is
 * about what the tray's buttons then do, including which command they put on
 * the Tauri bridge.
 *
 * Run: npx playwright test e2e/layout-downloads.spec.ts
 */

/** The action cluster of a tray row, found by the row's own name. */
const rowActions = (page: Page, name: string) =>
  page.getByText(name, { exact: true }).locator('xpath=..')

/** The whole tray row. */
const row = (page: Page, name: string) =>
  page.getByText(name, { exact: true }).locator('xpath=../..')

/** Start a model pull the way the Models page does. */
async function seedTextPull(page: Page, name: string) {
  await page.evaluate(async (model) => {
    const mod: any = await import('/src/stores/modelStore.ts')
    const w = window as any
    w.__E2E_PULL_AC = w.__E2E_PULL_AC || {}
    const controller = new AbortController()
    w.__E2E_PULL_AC[model] = controller
    mod.useModelStore.getState().startPull(model, controller)
  }, name)
}

test('the tray opens empty and closes again', async ({ page }) => {
  await bootLayout(page)

  // layout.downloads.toggle-tray: the icon is permanent, the panel is not.
  await expect(page.getByText('No active downloads')).toHaveCount(0)
  await page.getByTestId('layout.downloads.toggle-tray').click()
  await expect(page.getByText('No active downloads')).toBeVisible()
  await page.getByTestId('layout.downloads.toggle-tray').click()
  await expect(page.getByText('No active downloads')).toHaveCount(0)
})

test('a model pull can be paused, resumed, cleared and cancelled from the tray', async ({ page }) => {
  await bootLayout(page)
  await seedTextPull(page, 'demo-alpha:7b')
  await seedTextPull(page, 'demo-beta:7b')
  // A starting pull opens the tray by itself.
  await expect(row(page, 'demo-alpha:7b')).toBeVisible()

  // layout.pause.click: the row flips to Paused, the pause button hands
  // over to resume, and the fetch behind it is actually aborted.
  await rowActions(page, 'demo-alpha:7b').getByTestId('layout.pause.click').click()
  await expect(row(page, 'demo-alpha:7b')).toContainText('Paused')
  await expect(rowActions(page, 'demo-alpha:7b').getByTestId('layout.pause.click')).toHaveCount(0)
  await expect(rowActions(page, 'demo-alpha:7b').getByTestId('layout.resume.click')).toBeVisible()
  expect(
    await page.evaluate(() => (window as any).__E2E_PULL_AC['demo-alpha:7b'].signal.aborted),
  ).toBe(true)
  // The other row is untouched.
  await expect(rowActions(page, 'demo-beta:7b').getByTestId('layout.pause.click')).toBeVisible()

  // layout.resume.click: a real pull goes back out over the bridge and the
  // row runs to completion.
  await rowActions(page, 'demo-alpha:7b').getByTestId('layout.resume.click').click()
  await expect(row(page, 'demo-alpha:7b')).toContainText('Complete', { timeout: 20_000 })
  const pulls = (await bridgeCalls(page)).filter((c) => c.cmd === 'pull_model_stream')
  expect(pulls.map((c) => c.args?.name)).toContain('demo-alpha:7b')

  // layout.downloads.clear-completed: finished rows go, unfinished stay.
  await page.getByTestId('layout.downloads.clear-completed').click()
  await expect(page.getByText('demo-alpha:7b', { exact: true })).toHaveCount(0)
  await expect(row(page, 'demo-beta:7b')).toBeVisible()

  // layout.dismiss.click: Bug #5: the X must stop the Rust-side pull too,
  // or the pull-progress events re-create the row within 100 ms.
  await rowActions(page, 'demo-beta:7b').getByTestId('layout.dismiss.click').click()
  await expect(page.getByText('demo-beta:7b', { exact: true })).toHaveCount(0)
  await expect
    .poll(async () => (await bridgeCalls(page))
      .filter((c) => c.cmd === 'cancel_model_pull')
      .map((c) => c.args?.name))
    .toContain('demo-beta:7b')
  await page.waitForTimeout(800)
  await expect(page.getByText('demo-beta:7b', { exact: true })).toHaveCount(0)
})

/** Put a ComfyUI bundle into the tray the way the Discover page does. */
async function seedBundle(
  page: Page,
  bundle: string,
  files: Array<{ id: string; status: string }>,
) {
  await page.evaluate(async ([bundleName, spec]: [string, Array<{ id: string; status: string }>]) => {
    const mod: any = await import('/src/stores/downloadStore.ts')
    const store = mod.useDownloadStore
    // The Rust-side progress map is empty in the mock, so a poll would wipe
    // the seeded bundle a second later. Downloads that are paused or failed
    // do not start the poller anyway; this only guards against a poller left
    // running by a previous retry in the same test.
    store.getState().stopPolling()
    const downloads: Record<string, unknown> = {}
    for (const f of spec) {
      downloads[f.id] = {
        progress: f.status === 'complete' ? 100 : 40,
        total: 100,
        speed: 0,
        filename: f.id,
        status: f.status,
        error: f.status === 'error' ? 'connection reset' : undefined,
      }
      store.getState().setMeta(f.id, `https://example.invalid/${f.id}`, 'checkpoints')
    }
    store.setState({ downloads })
    store.getState().setBundleGroup(bundleName, spec.map((f) => f.id))
  }, [bundle, files] as [string, Array<{ id: string; status: string }>])
  await expect(async () => {
    if (!(await page.getByText(bundle, { exact: true }).isVisible())) {
      await page.getByTestId('layout.downloads.toggle-tray').click()
    }
    await expect(page.getByText(bundle, { exact: true })).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })
}

test('a half-failed bundle retries the broken files, one by one or all at once', async ({ page }) => {
  await bootLayout(page)
  await seedBundle(page, 'Flux Bundle', [
    { id: 'flux-unet.safetensors', status: 'error' },
    { id: 'flux-clip.safetensors', status: 'paused' },
  ])

  // layout.downloads.retry-file: the per-file Retry inside a bundle sends
  // that one file back out to the downloader.
  await page.getByTestId('layout.downloads.retry-file').click()
  await expect
    .poll(async () => (await bridgeCalls(page))
      .filter((c) => c.cmd === 'download_model')
      .map((c) => c.args?.filename))
    .toContain('flux-unet.safetensors')
  // Retry cleared the failed entry on both sides, so that file stops
  // offering a Retry of its own.
  await expect(page.getByTestId('layout.downloads.retry-file')).toHaveCount(0)

  // layout.retry-failed.click: the bundle-level RotateCcw retries every
  // failed file of the bundle.
  await seedBundle(page, 'Wan Bundle', [
    { id: 'wan-a.safetensors', status: 'error' },
    { id: 'wan-b.safetensors', status: 'error' },
    { id: 'wan-c.safetensors', status: 'paused' },
  ])
  await page.getByTestId('layout.retry-failed.click').click()
  await expect
    .poll(async () => (await bridgeCalls(page))
      .filter((c) => c.cmd === 'download_model')
      .map((c) => c.args?.filename))
    .toEqual(expect.arrayContaining(['wan-a.safetensors', 'wan-b.safetensors']))

  // layout.retry-failed-downloads.click: the written-out "Retry failed"
  // under the progress bar is the same promise, and has to keep it.
  await seedBundle(page, 'Hunyuan Bundle', [
    { id: 'hy-a.safetensors', status: 'error' },
    { id: 'hy-b.safetensors', status: 'error' },
    { id: 'hy-c.safetensors', status: 'paused' },
  ])
  await page.getByTestId('layout.retry-failed-downloads.click').click()
  await expect
    .poll(async () => (await bridgeCalls(page))
      .filter((c) => c.cmd === 'download_model')
      .map((c) => c.args?.filename))
    .toEqual(expect.arrayContaining(['hy-a.safetensors', 'hy-b.safetensors']))
})

test('an unfinished bundle is cancelled whole, a finished one is only dismissed', async ({ page }) => {
  await bootLayout(page)
  await seedBundle(page, 'Cancel Bundle', [
    { id: 'cancel-a.safetensors', status: 'paused' },
    { id: 'cancel-b.safetensors', status: 'paused' },
  ])

  // layout.cancel-all.click: every file of the bundle is cancelled in Rust
  // and the bundle leaves the list.
  await page.getByTestId('layout.cancel-all.click').click()
  await expect(page.getByText('Cancel Bundle', { exact: true })).toHaveCount(0)
  const cancelled = (await bridgeCalls(page))
    .filter((c) => c.cmd === 'cancel_download')
    .map((c) => c.args?.id)
  expect(cancelled).toEqual(expect.arrayContaining(['cancel-a.safetensors', 'cancel-b.safetensors']))

  // layout.dismiss.click-2: a finished bundle offers dismiss instead, and
  // dismiss must NOT cancel: the files are on disk and stay there.
  await seedBundle(page, 'Done Bundle', [
    { id: 'done-a.safetensors', status: 'complete' },
    { id: 'done-b.safetensors', status: 'complete' },
  ])
  await expect(page.getByTestId('layout.cancel-all.click')).toHaveCount(0)
  const before = await bridgeCommands(page)
  await page.getByTestId('layout.dismiss.click-2').click()
  await expect(page.getByText('Done Bundle', { exact: true })).toHaveCount(0)
  const after = await bridgeCommands(page)
  expect(after.slice(before.length).filter((c) => c === 'cancel_download')).toHaveLength(0)
})

test('a finished MLX install can be dismissed from the tray', async ({ page }) => {
  await bootLayout(page, { platform: 'mac' })

  // The real path: kick off an MLX image-model install through the api the
  // Create page uses, then let the tray's own store follow that Rust slot.
  await page.evaluate(async () => {
    const api: any = await import('/src/api/mlx-image.ts')
    const store: any = await import('/src/stores/mlxInstallStore.ts')
    await api.installMlxImageModel('sd-turbo')
    store.useMlxInstallStore.getState().watch('image-model', 'Image model')
  })
  await expect(async () => {
    if (!(await page.getByText('Image model', { exact: true }).isVisible())) {
      await page.getByTestId('layout.downloads.toggle-tray').click()
    }
    await expect(page.getByText('Image model', { exact: true })).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })

  // While it installs there is deliberately no X, you do not dismiss a
  // running install.
  await expect(page.getByTestId('layout.dismiss.click-3')).toHaveCount(0)

  // layout.dismiss.click-3: once the slot reports complete the X appears
  // and takes the row out of the list for good.
  await expect(row(page, 'Image model')).toContainText('Complete', { timeout: 20_000 })
  await page.getByTestId('layout.dismiss.click-3').click()
  await expect(page.getByText('Image model', { exact: true })).toHaveCount(0)
  await page.waitForTimeout(1_500)
  await expect(page.getByText('Image model', { exact: true })).toHaveCount(0)
})
