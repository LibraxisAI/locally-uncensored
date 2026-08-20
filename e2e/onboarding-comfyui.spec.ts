import { test, expect } from '@playwright/test'
import { bootOnboarding, comfyCalls, reachComfyStep, sysCalls } from './support/journeys/onboarding'

/**
 * Journey: the ComfyUI step, the heaviest fork of the wizard (Windows/Linux
 * only; macOS routes past it, hard rule "Mac local media is MLX").
 *
 * Four worlds, one per real user situation:
 *   - two installs on the box   → the disambiguation picker (Bug #3)
 *   - one half-finished install → the carcass, repaired by hand or by re-scan
 *   - nothing at all, no Python → the Python pre-flight then the install (P14)
 *   - an install the user aborts → cancel (Bug #1)
 *
 * Proof is always the invoke the click produced plus the state the step landed
 * in, never the button itself.
 */

const TWO_INSTALLS = {
  comfy: {
    installs: [
      { path: 'C:\\ComfyUI', complete: true, has_embedded_python: false, source: 'default path' },
      { path: 'D:\\AI\\ComfyUI', complete: false, has_embedded_python: true, source: 'registry' },
    ],
  },
}

const ONE_CARCASS = {
  comfy: {
    installs: [{ path: 'D:\\AI\\ComfyUI', complete: false, has_embedded_python: false, source: 'default path' }],
  },
}

test('two installs: picking one persists that path and drops the picker', async ({ page }) => {
  await bootOnboarding(page, TWO_INSTALLS)
  await reachComfyStep(page)

  await expect(page.getByText(/Multiple ComfyUI installs detected/i)).toBeVisible()
  await expect(page.getByTestId('onboarding.comfyui.pick-install')).toHaveCount(2)

  // comfyui.pick-install: the SECOND entry, so a silent "first hit wins"
  // would fail the path assertion below.
  await page.getByTestId('onboarding.comfyui.pick-install').nth(1).click()

  await expect(page.getByTestId('onboarding.comfyui.pick-install')).toHaveCount(0)
  const calls = await comfyCalls(page)
  expect(calls.some((c) => c.cmd === 'set_comfyui_path' && c.path === 'D:\\AI\\ComfyUI')).toBe(true)
  // The pick was the incomplete one, so the step must offer to finish it
  // rather than declare it ready.
  await expect(page.getByText(/Found a previous ComfyUI install at/i)).toBeVisible()
  await expect(page.getByText(/D:\\AI\\ComfyUI/)).toBeVisible()
})

test('two installs: "None of these" drops the picker without persisting a path', async ({ page }) => {
  await bootOnboarding(page, TWO_INSTALLS)
  await reachComfyStep(page)
  await expect(page.getByTestId('onboarding.comfyui.pick-install')).toHaveCount(2)

  // comfyui.reject-all-installs: no path is remembered, the fresh-install
  // options take over.
  await page.getByTestId('onboarding.comfyui.reject-all-installs').click()

  await expect(page.getByTestId('onboarding.comfyui.pick-install')).toHaveCount(0)
  await expect(page.getByTestId('onboarding.comfyui.install')).toBeVisible()
  const calls = await comfyCalls(page)
  expect(calls.some((c) => c.cmd === 'set_comfyui_path')).toBe(false)
})

test('carcass: "I already have ComfyUI" opens the path row, Connect wires it up', async ({ page }) => {
  await bootOnboarding(page, ONE_CARCASS)
  await reachComfyStep(page)
  await expect(page.getByText(/Found a previous ComfyUI install at/i)).toBeVisible()

  // The path row is NOT on screen before the button that owns it is pressed.
  // (It used to be rendered under an always-true condition, so the button had
  // no observable effect at all. Fixed in Onboarding.tsx in this wave.)
  await expect(page.getByTestId('onboarding.comfyui.connect-path')).toHaveCount(0)

  // comfyui.use-existing-install: reveals the path row and forgets the
  // detected carcass so the hint about it disappears.
  await page.getByTestId('onboarding.comfyui.use-existing-install').click()
  await expect(page.getByTestId('onboarding.comfyui.connect-path')).toBeVisible()
  await expect(page.getByText(/Found a previous ComfyUI install at/i)).toHaveCount(0)

  // comfyui.connect-path: saves the typed path and starts ComfyUI on it.
  await page.getByPlaceholder('C:\\ComfyUI').fill('E:\\MyComfy')
  await page.getByTestId('onboarding.comfyui.connect-path').click()
  await expect(page.getByText(/ComfyUI is ready/i)).toBeVisible()

  const calls = await comfyCalls(page)
  expect(calls.some((c) => c.cmd === 'set_comfyui_path' && c.path === 'E:\\MyComfy')).toBe(true)
  expect(calls.some((c) => c.cmd === 'start_comfyui')).toBe(true)

  // comfyui.continue: only offered for a usable install, and it moves on.
  await page.getByTestId('onboarding.comfyui.continue').click()
  await expect(page.getByRole('heading', { name: /Pick a starter model/i })).toBeVisible()
})

test('carcass: Re-Scan picks up the repaired install and flips the step to ready', async ({ page }) => {
  await bootOnboarding(page, ONE_CARCASS)
  await reachComfyStep(page)
  await expect(page.getByText(/Found a previous ComfyUI install at/i)).toBeVisible()
  await expect(page.getByTestId('onboarding.comfyui.continue')).toHaveCount(0)

  // comfyui.rescan: the auto-pick already persisted the path, so the second
  // look reports a working install where the first reported a carcass.
  await page.getByTestId('onboarding.comfyui.rescan').click()

  await expect(page.getByText('ComfyUI detected')).toBeVisible()
  await expect(page.getByText('ComfyUI is ready')).toBeVisible()
  await expect(page.getByText(/Found a previous ComfyUI install at/i)).toHaveCount(0)
  await expect(page.getByTestId('onboarding.comfyui.continue')).toBeVisible()
})

test('empty box without Python: Install runs the Python pre-flight, then ComfyUI', async ({ page }) => {
  await bootOnboarding(page, { sys: { pythonAvailable: false } })
  await reachComfyStep(page)
  await expect(page.getByTestId('onboarding.comfyui.install')).toBeVisible()

  // comfyui.install: one click, two installers, no interaction in between.
  await page.getByTestId('onboarding.comfyui.install').click()
  await expect(page.getByText('Installing Python 3.12...')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/ComfyUI is ready/i)).toBeVisible({ timeout: 40_000 })

  expect((await sysCalls(page)).some((c) => c.cmd === 'install_python')).toBe(true)
  const calls = await comfyCalls(page)
  expect(calls.some((c) => c.cmd === 'install_comfyui')).toBe(true)
  expect(calls.some((c) => c.cmd === 'start_comfyui')).toBe(true)
  await expect(page.getByTestId('onboarding.comfyui.continue')).toBeVisible()
})

test('Cancel stops a running ComfyUI install and hands the options back', async ({ page }) => {
  await bootOnboarding(page)
  await reachComfyStep(page)
  await page.getByTestId('onboarding.comfyui.install').click()
  await expect(page.getByTestId('onboarding.comfyui.cancel-install')).toBeVisible({ timeout: 20_000 })

  // comfyui.cancel-install: the worker is told to stop, the card closes and
  // the step is usable again instead of spinning forever.
  await page.getByTestId('onboarding.comfyui.cancel-install').click()

  await expect(page.getByText(/Install cancelled\./i)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('onboarding.comfyui.cancel-install')).toHaveCount(0)
  await expect(page.getByTestId('onboarding.comfyui.install')).toBeVisible()
  expect((await comfyCalls(page)).some((c) => c.cmd === 'cancel_comfyui_install')).toBe(true)
})
