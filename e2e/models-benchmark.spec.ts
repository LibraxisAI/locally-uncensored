import { test, expect } from '@playwright/test'
import {
  bootApp, openModels, openInstalled, openBenchmark, benchResult, BUILTIN_MODEL,
} from './support/journeys/models'

/**
 * QA sweep, area `models` — the Benchmark surface: running a measurement,
 * stopping one mid-flight, measuring everything that has no result yet, and
 * the housekeeping over the recorded table (prune, export, clear).
 *
 * A measurement is only real if it MOVED the record, so every verdict here
 * reads the table afterwards: the row's own t/s, the leaderboard's run count,
 * the exported file's bytes. The stop button is proven the only way it can
 * be: the run has three prompts, and after a stop the table must be short of
 * three, i.e. the loop really broke instead of finishing quietly.
 *
 * The three prompts stream slowly on purpose in the live tests (the mock
 * would otherwise answer inside one frame, leaving nothing to stop).
 */

const SLOW = { mock: { replyChunks: 8, replyChunkDelayMs: 150 } }

/** "N total runs across M models" — the leaderboard's own tally. */
async function totalRuns(page: import('@playwright/test').Page): Promise<number> {
  const line = page.getByText(/total runs across/)
  if (!(await line.count())) return 0
  const text = await line.innerText()
  return Number(text.match(/(\d+) total runs/)?.[1] ?? 0)
}

test('Run Benchmark measures the model, and Stop cuts the run short', async ({ page }) => {
  await bootApp(page, SLOW)
  await openBenchmark(page)

  const row = page.getByText(BUILTIN_MODEL).first()
  await expect(row).toBeVisible()
  expect(await totalRuns(page)).toBe(0)

  // ── models.benchmark-row.run ─────────────────────────────────────
  await page.getByTestId('models.benchmark-row.run').click()
  // The Run button is replaced by the live step counter for THIS row.
  await expect(page.getByTestId('models.benchmark-row.stop')).toBeVisible()
  await expect(page.getByTestId('models.benchmark-row.stop')).toContainText('/3')

  // All three prompts land, and the measurement reaches both the row and the
  // leaderboard — not just the spinner.
  await expect(page.getByTestId('models.benchmark-row.run')).toBeVisible({ timeout: 40_000 })
  await expect.poll(() => totalRuns(page), { timeout: 20_000 }).toBe(3)
  await expect(page.getByText(/t\/s useful/)).toBeVisible()
  await expect(page.getByTitle('Most recent benchmark run')).toContainText('t/s')

  // ── models.benchmark-row.stop ────────────────────────────────────
  // A second run, cut off after the first prompt: the table must gain fewer
  // than three runs, which is the only proof that the LOOP stopped and not
  // merely the request in flight.
  await page.getByTestId('models.benchmark-row.run').click()
  await expect(page.getByTestId('models.benchmark-row.stop')).toBeVisible()
  await page.getByTestId('models.benchmark-row.stop').click()
  await expect(page.getByTestId('models.benchmark-row.run')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(2_000) // long enough for a fourth prompt to finish
  expect(await totalRuns(page)).toBeLessThan(6)
})

test('the Installed card benches its own model and stops it', async ({ page }) => {
  await bootApp(page, SLOW)
  await openModels(page)
  await openInstalled(page)

  const card = page.getByTestId('models.installed-card.activate').filter({ hasText: 'qwen2.5-0.5b' })

  // ── models.installed-card-benchmark.run ──────────────────────────
  await expect(card).not.toContainText('t/s')
  await card.getByTestId('models.installed-card-benchmark.run').click()
  await expect(card.getByTestId('models.stop-benchmark.click')).toBeVisible()
  await expect(card.getByTestId('models.stop-benchmark.click')).toContainText('/3')
  // The finished run leaves its speed on the card.
  await expect(card.getByTestId('models.installed-card-benchmark.run')).toBeVisible({ timeout: 40_000 })
  await expect(card).toContainText('t/s')

  // ── models.stop-benchmark.click ──────────────────────────────────
  await card.getByTestId('models.installed-card-benchmark.run').click()
  await expect(card.getByTestId('models.stop-benchmark.click')).toBeVisible()
  await card.getByTestId('models.stop-benchmark.click').click()
  await expect(card.getByTestId('models.installed-card-benchmark.run')).toBeVisible({ timeout: 20_000 })

  // Same proof as above, read from the persisted store: a stopped run cannot
  // have recorded all three prompts of the second pass.
  await page.waitForTimeout(2_000)
  const runs = await page.evaluate(() => {
    const raw = window.localStorage.getItem('lu-benchmark-store')
    const results = raw ? JSON.parse(raw).state.results : {}
    return Object.values(results).flat().length
  })
  expect(runs).toBeGreaterThanOrEqual(3)
  expect(runs).toBeLessThan(6)
})

test('Benchmark remaining measures every model that has no result yet', async ({ page }) => {
  await bootApp(page, { mock: { ollamaModels: ['llama3:8b', 'mistral:7b'] }, providers: { ollamaEnabled: true } })
  await openBenchmark(page)

  const remaining = page.getByTestId('models.benchmark-remaining.run')
  await expect(remaining).toContainText('Benchmark 3 remaining')

  // ── models.benchmark-remaining.run ───────────────────────────────
  await remaining.click()

  // Every model ends up measured, each with its own leaderboard row, and the
  // button retires because nothing is left unmeasured.
  await expect.poll(async () => {
    const rows = await page.getByText(/t\/s useful/).count()
    return rows
  }, { timeout: 50_000 }).toBe(3)
  await expect(page.getByText(/total runs across 3 models/)).toBeVisible()
  await expect(remaining).toHaveCount(0)
})

test('the recorded table can be pruned, exported and cleared', async ({ page }) => {
  await bootApp(page, {
    benchmarkResults: {
      [BUILTIN_MODEL]: [benchResult(BUILTIN_MODEL, 'speed', 42)],
      'ghost-model:7b': [benchResult('ghost-model:7b', 'speed', 99)],
    },
  })
  await openBenchmark(page)

  // ── models.benchmark-stale-results.prune ─────────────────────────
  // One of the two measured models is not installed any more.
  const staleNote = page.getByText(/no longer installed/)
  await expect(staleNote).toContainText('ghost-model:7b')
  await expect(page.getByText(/total runs across 2 models/)).toBeVisible()
  await page.getByTestId('models.benchmark-stale-results.prune').click()
  // The note goes AND the orphaned measurement leaves the table with it.
  await expect(staleNote).toHaveCount(0)
  await expect(page.getByText('ghost-model:7b')).toHaveCount(0)
  await expect(page.getByText(/total runs across 1 models/)).toBeVisible()

  // ── models.download-the-table-as-markdown.click ──────────────────
  // The button is only honest if a file actually arrives, with the table in it.
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('models.download-the-table-as-markdown.click').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('lu-benchmark.md')
  const stream = await download.createReadStream()
  const body = (await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (c) => chunks.push(c as Buffer))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })).toString('utf8')
  expect(body).toContain(BUILTIN_MODEL)

  // ── models.delete-every-recorded-benchmark-run.click ─────────────
  const clearAll = page.getByTestId('models.delete-every-recorded-benchmark-run.click')
  // First click only arms it, and a click elsewhere disarms it again.
  await clearAll.click()
  await expect(clearAll).toContainText('Confirm')
  await page.getByRole('heading', { name: 'Benchmark', exact: true }).click()
  await expect(clearAll).toContainText('Clear all')
  await expect(page.getByText(/total runs across/)).toBeVisible()

  // Armed, then confirmed: the whole table goes, and with it the export button.
  await clearAll.click()
  await expect(clearAll).toContainText('Confirm')
  await clearAll.click()
  await expect(page.getByText(/total runs across/)).toHaveCount(0)
  await expect(page.getByTestId('models.download-the-table-as-markdown.click')).toHaveCount(0)

  // ── models.benchmark-back-to-models.click ────────────────────────
  await page.getByTestId('models.benchmark-back-to-models.click').click()
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Benchmark', exact: true })).toHaveCount(0)
})
