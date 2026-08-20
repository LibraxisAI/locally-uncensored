import { test, expect, type Page } from '@playwright/test'
import { cloudSwitch } from './support/cloud-mock'
import { bootApp, readSettingsState, openedUrls, signInViaGateStable as signInViaGate } from './support/journeys/misc'

/**
 * QA sweep, area "cloud": the gate in front of Cloud mode, walked through
 * every state a real account can be in.
 *
 * The effect that decides a gate button is never "a screen appeared": it is
 * whether the global appMode really moved (persisted in `chat-settings`),
 * whether the header switch flipped, and: for the pricing/account links 
 * which URL the mocked system browser was handed.
 *
 * The per-state overrides below sit ON TOP of routeCloud (Playwright matches
 * the newest route first), so one test can change what the server says between
 * two clicks of "Check again": which is the whole point of those buttons.
 */

interface Account {
  license: 'active' | 'none'
  access: boolean
  /** Monthly credit budget the quota endpoint reports. */
  credits: number
  /** Make /api/jobs/quota reject with 403, the "usage couldn't be loaded" case. */
  quotaDown?: boolean
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
}

/** Serve /api/me and /api/jobs/quota from a box the test can change mid-run. */
async function routeAccount(page: Page, box: { state: Account }) {
  const json = (status: number, body: unknown) => ({
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  await page.route('https://lu-labs.ai/api/me', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const s = box.state
    return route.fulfill(
      json(200, {
        user: { id: 'e2e-user-1', email: 'qa@lu-labs.ai' },
        license: s.license === 'active'
          ? { status: 'active', tier: 'hosted-pro', access: s.access }
          : { status: 'none' },
        profile: null,
      }),
    )
  })

  await page.route('https://lu-labs.ai/api/jobs/quota', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const s = box.state
    if (s.quotaDown) return route.fulfill(json(403, { error: 'quota unavailable' }))
    return route.fulfill(
      json(200, {
        tier: 'hosted-pro',
        period: '2026-08',
        limits: { credits: s.credits },
        costs: { image: 1200, video: 40000 },
        used: { credits_used: 0 },
        remaining: { credits: s.credits },
        topup: { credits: 0 },
        video: { limit: 300_000, used: 0, remaining: 300_000 },
        trainings: { limit: 2, used: 0, remaining: 2 },
      }),
    )
  })
}

async function bootWithAccount(page: Page, state: Account) {
  const box = { state }
  await bootApp(page, { scenario: { license: state.license } })
  await routeAccount(page, box)
  return box
}

async function appMode(page: Page): Promise<string> {
  return (await readSettingsState(page)).settings.appMode
}

/**
 * Press one of the gate's "Check again" buttons and wait for the probe it
 * starts to actually come back.
 *
 * Without this barrier the next line of the test can change what the server
 * says while the previous probe is still between its /api/me and
 * /api/jobs/quota calls: the probe then mixes an old license with a fresh
 * quota, the gate closes underneath the button, and the following click hits a
 * detached node. This synchronises with the network the button triggers; it
 * does not soften a single assertion.
 */
async function recheck(page: Page, testId: string, opts: { quota: boolean }) {
  const me = page.waitForResponse((r) => r.url().includes('/api/me'))
  const quota = opts.quota
    ? page.waitForResponse((r) => r.url().includes('/api/jobs/quota'))
    : Promise.resolve(null)
  await page.getByTestId(testId).click()
  await me
  await quota
  // The responses are back; give probeAccount the tick it needs to write the
  // store. Without it the probe is still "in flight" when the next line changes
  // what the server says, and the two probes interleave.
  await page.waitForTimeout(250)
}

const gateHero = (page: Page) => page.getByRole('heading', { name: 'LU Cloud' })

test('the header switch opens the gate, and the gate walks intro → plans → sign-in', async ({ page }) => {
  await bootWithAccount(page, { license: 'none', access: true, credits: 0 })

  // ── The switch ────────────────────────────────────────────────────────
  expect(await appMode(page)).toBe('local')
  // Addressed by its inventory id, not by role: a rename of the visible label
  // must not silently orphan the proof for cloud.cloud.click.
  await page.getByTestId('cloud.cloud.click').click()
  // Effect: an account that cannot use Cloud gets the gate, and the mode is
  // NOT flipped behind it.
  await expect(gateHero(page)).toBeVisible({ timeout: 20_000 })
  await expect(cloudSwitch(page)).not.toBeChecked()
  expect(await appMode(page)).toBe('local')

  // ── intro → plans ─────────────────────────────────────────────────────
  await page.getByTestId('cloud.gate.goto-plans').click()
  // Effect: the step really changed: the three priced plans replaced the hero
  // call to action.
  await expect(page.getByTestId('cloud.gate.open-plan-pricing')).toHaveCount(3)
  await expect(page.getByTestId('cloud.gate.goto-plans')).toHaveCount(0)

  // ── a plan opens the browser, and the gate stays put ───────────────────
  await page.getByTestId('cloud.gate.open-plan-pricing').first().click()
  expect(await openedUrls(page)).toContain('https://lu-labs.ai/pricing#hosted')
  await expect(page.getByTestId('cloud.gate.open-plan-pricing')).toHaveCount(3)
  expect(await appMode(page)).toBe('local')

  // ── plans → sign-in ───────────────────────────────────────────────────
  await page.getByTestId('cloud.gate.goto-login-from-plans').click()
  // Effect: the embedded account panel took over the dialog.
  await expect(page.getByPlaceholder('Email')).toBeVisible()
  await expect(page.getByTestId('cloud.gate.open-plan-pricing')).toHaveCount(0)

  // ── sign-in → plans ───────────────────────────────────────────────────
  await page.getByTestId('cloud.gate.back-to-plans').click()
  // Effect: back on the plans step, sign-in gone.
  await expect(page.getByTestId('cloud.gate.open-plan-pricing')).toHaveCount(3)
  await expect(page.getByPlaceholder('Email')).toHaveCount(0)

  // ── Stay on Local ─────────────────────────────────────────────────────
  await page.getByTestId('cloud.gate.stay-local').click()
  // Effect: the dialog is gone and the app is pinned to Local (persisted).
  await expect(gateHero(page)).toHaveCount(0)
  await expect(cloudSwitch(page)).not.toBeChecked()
  expect(await appMode(page)).toBe('local')

  // ── intro → sign-in (the second entrance) ─────────────────────────────
  await cloudSwitch(page).click()
  await expect(page.getByTestId('cloud.gate.goto-plans')).toBeVisible()
  await page.getByTestId('cloud.gate.goto-login-from-intro').click()
  // Effect: the same sign-in step, reached without passing the plans.
  await expect(page.getByPlaceholder('Email')).toBeVisible()
  await expect(page.getByTestId('cloud.gate.goto-plans')).toHaveCount(0)
})

test('signed in without a plan: Check again flips the app the moment the plan lands', async ({ page }) => {
  const box = await bootWithAccount(page, { license: 'none', access: true, credits: 0 })
  await signInViaGate(page)

  await expect(page.getByText(/no active plan/i)).toBeVisible({ timeout: 20_000 })

  // A re-check while the server still says "no plan" must NOT let anyone in.
  await recheck(page, 'cloud.gate.recheck-after-subscribe', { quota: false })
  await expect(page.getByText(/no active plan/i)).toBeVisible()
  expect(await appMode(page)).toBe('local')

  // The plan lands on lu-labs.ai...
  box.state = { license: 'active', access: true, credits: 2_550_000 }
  await recheck(page, 'cloud.gate.recheck-after-subscribe', { quota: true })

  // Effect: the gate closed itself and the whole app moved to Cloud.
  await expect(gateHero(page)).toHaveCount(0, { timeout: 20_000 })
  await expect(cloudSwitch(page)).toBeChecked()
  await expect.poll(() => appMode(page)).toBe('cloud')

  // And the same switch takes it straight back out again.
  await cloudSwitch(page).click()
  await expect(cloudSwitch(page)).not.toBeChecked()
  await expect.poll(() => appMode(page)).toBe('local')
  await expect(gateHero(page)).toHaveCount(0)
})

test('licensed but not switched on server-side: Check again clears the wall', async ({ page }) => {
  const box = await bootWithAccount(page, { license: 'active', access: false, credits: 2_550_000 })
  await signInViaGate(page)

  await expect(page.getByText(/hasn't switched Cloud on/i)).toBeVisible({ timeout: 20_000 })

  await recheck(page, 'cloud.gate.recheck-access', { quota: false })
  await expect(page.getByText(/hasn't switched Cloud on/i)).toBeVisible()
  expect(await appMode(page)).toBe('local')

  box.state = { license: 'active', access: true, credits: 2_550_000 }
  await recheck(page, 'cloud.gate.recheck-access', { quota: true })

  // Effect: the server flipped the gate, so the app is in Cloud mode.
  await expect(gateHero(page)).toHaveCount(0, { timeout: 20_000 })
  await expect(cloudSwitch(page)).toBeChecked()
  await expect.poll(() => appMode(page)).toBe('cloud')
})

test('usage could not be loaded: Check again lets Cloud in once the quota arrives', async ({ page }) => {
  const box = await bootWithAccount(page, { license: 'active', access: true, credits: 2_550_000, quotaDown: true })
  await signInViaGate(page)

  await expect(page.getByText(/usage couldn't be loaded/i)).toBeVisible({ timeout: 20_000 })

  await recheck(page, 'cloud.gate.recheck-quota', { quota: true })
  await expect(page.getByText(/usage couldn't be loaded/i)).toBeVisible()
  expect(await appMode(page)).toBe('local')

  box.state = { license: 'active', access: true, credits: 2_550_000 }
  await recheck(page, 'cloud.gate.recheck-quota', { quota: true })

  // Effect: the quota arrived, so the last gate fell and the app switched.
  await expect(gateHero(page)).toHaveCount(0, { timeout: 20_000 })
  await expect(cloudSwitch(page)).toBeChecked()
  await expect.poll(() => appMode(page)).toBe('cloud')
})

test('a plan without a credit budget: the account link and Check again', async ({ page }) => {
  const box = await bootWithAccount(page, { license: 'active', access: true, credits: 0 })
  await signInViaGate(page)

  await expect(page.getByText(/doesn't include a hosted compute credit/i)).toBeVisible({ timeout: 20_000 })

  // ── Open your account ─────────────────────────────────────────────────
  await page.getByTestId('cloud.gate.open-account').click()
  // Effect: the system browser was sent to the account page and the dialog
  // deliberately stayed open behind it.
  expect(await openedUrls(page)).toContain('https://lu-labs.ai/account')
  await expect(page.getByText(/doesn't include a hosted compute credit/i)).toBeVisible()
  expect(await appMode(page)).toBe('local')

  // ── Check again ───────────────────────────────────────────────────────
  await recheck(page, 'cloud.gate.recheck-credits', { quota: true })
  await expect(page.getByText(/doesn't include a hosted compute credit/i)).toBeVisible()
  expect(await appMode(page)).toBe('local')

  box.state = { license: 'active', access: true, credits: 900_000 }
  await recheck(page, 'cloud.gate.recheck-credits', { quota: true })

  // Effect: credit budget present, gate gone, Cloud on.
  await expect(gateHero(page)).toHaveCount(0, { timeout: 20_000 })
  await expect(cloudSwitch(page)).toBeChecked()
  await expect.poll(() => appMode(page)).toBe('cloud')
})

test('the dialog closes on its own X and on the dimmed area beside it', async ({ page }) => {
  await bootWithAccount(page, { license: 'none', access: true, credits: 0 })

  // ── The floating X of a header-less Modal ─────────────────────────────
  await cloudSwitch(page).click()
  await expect(gateHero(page)).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('ui.close.click').click()
  // Effect: the dialog is really unmounted, and unlike Stay on Local it says
  // nothing about the mode.
  await expect(gateHero(page)).toHaveCount(0)
  await expect(page.getByTestId('ui.close.click')).toHaveCount(0)
  expect(await appMode(page)).toBe('local')

  // ── The backdrop ──────────────────────────────────────────────────────
  await cloudSwitch(page).click()
  await expect(gateHero(page)).toBeVisible()
  // Top-left corner: the panel is centred, so this point is bare backdrop.
  await page.getByTestId('ui.modal.close-backdrop').click({ position: { x: 5, y: 5 } })
  // Effect: same close, from the dimmed surface.
  await expect(gateHero(page)).toHaveCount(0)
  await expect(page.getByTestId('ui.modal.close-backdrop')).toHaveCount(0)
})

test('a dialog WITH a header closes on the X in its title row', async ({ page }) => {
  // Same shared Modal, the other half of its chrome: with a title row the
  // close button is the one in the header, not the floating one. Keyboard
  // Shortcuts (Ctrl+/) is the cheapest instance of that shape.
  await bootWithAccount(page, { license: 'none', access: true, credits: 0 })

  await page.keyboard.press('Control+/')
  await expect(page.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible()
  await expect(page.getByText('Show keyboard shortcuts')).toBeVisible()
  // A header-less dialog's floating X does not exist on this shape.
  await expect(page.getByTestId('ui.close.click')).toHaveCount(0)

  await page.getByTestId('ui.close.click-2').click()

  // Effect: the dialog is unmounted, its content is gone with it, and the app
  // underneath takes clicks again.
  await expect(page.getByRole('heading', { name: 'Keyboard Shortcuts' })).toHaveCount(0)
  await expect(page.getByText('Show keyboard shortcuts')).toHaveCount(0)
  await expect(page.getByTestId('ui.close.click-2')).toHaveCount(0)
  await cloudSwitch(page).click()
  await expect(gateHero(page)).toBeVisible({ timeout: 20_000 })
})
