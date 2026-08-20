import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, type CloudScenario } from './support/cloud-mock'
import { muteHmr, openedUrls } from './support/journeys/onboarding'

/**
 * Journey: the LU Cloud account panel in Settings → General.
 *
 * This is the other half of "getting set up": onboarding wires the local
 * engine, this panel wires the account. Everything is proved through the state
 * the click produces: the signed-in block with the real email, the form coming
 * back after a sign out, the exact URL handed to the system browser.
 *
 * The provider buttons are driven against the mock's default OAuth world: the
 * loopback callback answers with a denial, so the round trip is complete and
 * observable (browser opened, error surfaced) without a real Google session.
 */

async function bootAccountPanel(page: Page, scenario: CloudScenario): Promise<void> {
  await muteHmr(page)
  await page.addInitScript(tauriMockInit, {
    assistantReply: DEFAULT_ASSISTANT_REPLY,
    modelName: DEFAULT_MODEL_NAME,
    platform: 'windows',
  })
  await seedOnboardingDone(page)
  await routeCloud(page, scenario)
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByText('LU Cloud Account')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('auth.account-panel.submit-credentials')).toBeVisible({ timeout: 20_000 })
}

test('signed out: sign in, then sign out, brings the form back', async ({ page }) => {
  await bootAccountPanel(page, { license: 'active', tier: 'hosted-pro' })

  // auth.account-panel.submit-credentials: the form trades the credentials
  // for a session; the panel replaces itself with the account block.
  await page.getByPlaceholder('Email').fill('qa@lu-labs.ai')
  await page.getByPlaceholder('Password').fill('e2e-password')
  await page.getByRole('button', { name: /^Sign in$/ }).click()

  await expect(page.getByText('qa@lu-labs.ai')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Plan: hosted-pro/i)).toBeVisible()
  await expect(page.getByTestId('auth.account-panel.submit-credentials')).toHaveCount(0)

  // auth.account-panel.sign-out: the session ends and the signed-out form
  // (email, password, provider buttons) is what is left.
  await page.getByTestId('auth.account-panel.sign-out').click()
  await expect(page.getByTestId('auth.account-panel.submit-credentials')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('auth.oauth.sign-in-google')).toBeVisible()
  await expect(page.getByText('qa@lu-labs.ai')).toHaveCount(0)
})

test('an active plan sends Manage subscription to lu-labs.ai/account', async ({ page }) => {
  await bootAccountPanel(page, { license: 'active', tier: 'hosted-max' })
  await page.getByPlaceholder('Email').fill('qa@lu-labs.ai')
  await page.getByPlaceholder('Password').fill('e2e-password')
  await page.getByRole('button', { name: /^Sign in$/ }).click()
  await expect(page.getByTestId('auth.account-panel.open-billing')).toHaveText(/Manage subscription/i, { timeout: 20_000 })

  // auth.account-panel.open-billing
  await page.getByTestId('auth.account-panel.open-billing').click()
  await expect.poll(() => openedUrls(page)).toContain('https://lu-labs.ai/account')
})

test('no plan sends View plans to lu-labs.ai/pricing', async ({ page }) => {
  await bootAccountPanel(page, { license: 'none' })
  await page.getByPlaceholder('Email').fill('qa@lu-labs.ai')
  await page.getByPlaceholder('Password').fill('e2e-password')
  await page.getByRole('button', { name: /^Sign in$/ }).click()
  await expect(page.getByTestId('auth.account-panel.open-billing')).toHaveText(/View plans/i, { timeout: 20_000 })
  await expect(page.getByText(/Pick a plan to unlock/i)).toBeVisible()

  // auth.account-panel.open-billing: same button, other destination.
  await page.getByTestId('auth.account-panel.open-billing').click()
  await expect.poll(() => openedUrls(page)).toContain('https://lu-labs.ai/pricing')
})

test('Google opens the provider login in the system browser and surfaces the outcome', async ({ page }) => {
  await bootAccountPanel(page, { license: 'none' })

  // auth.oauth.sign-in-google: the authorize URL goes to the SYSTEM browser
  // (never an in-app webview), and the callback's verdict lands in the form.
  await page.getByTestId('auth.oauth.sign-in-google').click()

  await expect
    .poll(() => openedUrls(page).then((u) => u.some((x) => x.includes('/auth/v1/authorize') && x.includes('provider=google'))))
    .toBe(true)
  await expect(page.getByText(/oauth disabled in e2e/i)).toBeVisible({ timeout: 20_000 })

  // auth.account-panel.toggle-signin-signup: flips the primary action AND
  // clears the standing error the provider round trip just left behind.
  await expect(page.getByRole('button', { name: /^Sign in$/ })).toBeVisible()
  await page.getByTestId('auth.account-panel.toggle-signin-signup').click()
  await expect(page.getByRole('button', { name: /^Create account$/ })).toBeVisible()
  await expect(page.getByTestId('auth.account-panel.toggle-signin-signup')).toHaveText(/Have an account\? Sign in/i)
  await expect(page.getByText(/oauth disabled in e2e/i)).toHaveCount(0)

  // …and back again.
  await page.getByTestId('auth.account-panel.toggle-signin-signup').click()
  await expect(page.getByRole('button', { name: /^Sign in$/ })).toBeVisible()
})

test('GitHub opens its own provider login in the system browser', async ({ page }) => {
  await bootAccountPanel(page, { license: 'none' })

  // auth.oauth.sign-in-github
  await page.getByTestId('auth.oauth.sign-in-github').click()

  await expect
    .poll(() => openedUrls(page).then((u) => u.some((x) => x.includes('/auth/v1/authorize') && x.includes('provider=github'))))
    .toBe(true)
  await expect(page.getByText(/oauth disabled in e2e/i)).toBeVisible({ timeout: 20_000 })
  // The failed attempt releases both buttons instead of latching them.
  await expect(page.getByTestId('auth.oauth.sign-in-github')).toBeEnabled()
  await expect(page.getByTestId('auth.oauth.sign-in-google')).toBeEnabled()
})
