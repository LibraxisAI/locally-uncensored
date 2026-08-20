import { test, expect } from '@playwright/test'
import {
  backendProbeCount,
  bootOnboarding,
  openAnotherEngine,
  readProviders,
  reachBackendStep,
} from './support/journeys/onboarding'

/**
 * Journey: the backend step, the one fork where a user leaves the built-in
 * engine behind.
 *
 * The mock's default world answers the Ollama probe (proxy_localhost to :11434
 * returns a tag list), so a fresh box here looks like "built-in engine, plus an
 * Ollama that happens to be running", which is precisely the case the
 * "Use another engine" disclosure exists for.
 *
 * Selection is proved through what Continue COMMITS, never through a border
 * colour: an Ollama pick disables the managed openai slot, a built-in pick
 * re-asserts it. If a select button did nothing, the committed provider config
 * would be the other one.
 */

test('detected Ollama: picking it and continuing hands the primary slot to Ollama', async ({ page }) => {
  await bootOnboarding(page)
  await reachBackendStep(page)
  await openAnotherEngine(page)
  await expect(page.getByText(/1 backend detected/i)).toBeVisible()

  // backends.select-detected: the Ollama row becomes the pick.
  await page.getByTestId('onboarding.backends.select-detected').click()

  // backends.continue-detected: commits it, so ollama goes on and the managed
  // built-in goes off.
  await page.getByTestId('onboarding.backends.continue-detected').click()
  await expect(page.getByRole('heading', { name: /Image & Video Generation/i })).toBeVisible()

  const providers = await readProviders(page)
  expect(providers.ollama.enabled).toBe(true)
  expect(providers.openai.enabled).toBe(false)
  expect(providers.openai.managed).toBe(false)
})

test('built-in engine: re-picking it after Ollama wins, and Continue commits the managed slot', async ({ page }) => {
  await bootOnboarding(page)
  await reachBackendStep(page)
  await openAnotherEngine(page)

  // Move the selection away first, so the built-in click has something to undo.
  await page.getByTestId('onboarding.backends.select-detected').click()
  // backends.select-builtin: takes the selection back.
  await page.getByTestId('onboarding.backends.select-builtin').click()

  // backends.continue: commits whatever is selected. Ollama would have left
  // openai disabled; the built-in engine re-asserts the managed config.
  await page.getByTestId('onboarding.backends.continue').click()
  await expect(page.getByRole('heading', { name: /Image & Video Generation/i })).toBeVisible()

  const providers = await readProviders(page)
  expect(providers.openai.enabled).toBe(true)
  expect(providers.openai.managed).toBe(true)
  expect(providers.openai.baseUrl).toBe('http://127.0.0.1:8127/v1')
  expect(providers.openai.name).toBe('Built-in Engine')
})

test('Re-Scan runs the port scan again instead of repainting the old result', async ({ page }) => {
  await bootOnboarding(page)
  await reachBackendStep(page)
  await openAnotherEngine(page)

  // Only detectLocalBackends ever asks for :1234/v1/models, so a growing count
  // is the scan itself, not a re-render.
  const before = await backendProbeCount(page)
  await page.getByTestId('onboarding.scan-again.click').click()
  await expect.poll(() => backendProbeCount(page)).toBeGreaterThan(before)

  // …and the step comes back with a usable result rather than a dead spinner.
  await expect(page.getByTestId('onboarding.backends.continue')).toBeVisible()
  await openAnotherEngine(page)
  await expect(page.getByText(/1 backend detected/i)).toBeVisible()
})
