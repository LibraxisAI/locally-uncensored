import { expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from '../tauri-mock'
import { routeCloud, seedOnboardingDone, cloudSwitch, type CloudScenario } from '../cloud-mock'

/**
 * Shared boot for the Create QA journeys (sweep wave, area `create`).
 *
 * Every journey needs the same three things before it can touch a single
 * control: a Tauri bridge with a PINNED platform (the Mac and Windows Create
 * surfaces differ in which lanes exist at all), the cloud API mocked, and the
 * Create view actually open. Pinning matters here more than anywhere else:
 * the Advanced drawer hides its whole Expert section on a local Mac, so an
 * unpinned spec would pass or fail depending on the laptop that ran it.
 */

export const WIN_OPTS: TauriMockOptions = {
  assistantReply: DEFAULT_ASSISTANT_REPLY,
  modelName: DEFAULT_MODEL_NAME,
  platform: 'windows',
}

/** A 256x256 PNG with real pixel content. Big enough that the mask engine
 *  gets a usable brush size (it derives one from the source dimensions) and
 *  the editor's fit-to-view maths has something to work with. */
export const TEST_PNG_256 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAHQ0lEQVR4nO3TQwIYCAIAsNq2bdu2bdu2O7Vt27Zt27Zt73n/' +
  'kPwhAQIECBA4cOBgwYKFDBkyTJgw4cOHjxQpUtSoUWPEiBE7dux48eIlTJgwSZIkyZMnT5UqVdq0aTNkyJA5c+Zs2bLlzJkz' +
  'T548+fPnL1SoUNGiRUuUKFG6dOly5cpVrFixSpUq1atXr1WrVt26dRs0aNC4ceNmzZq1bNmyTZs27du379SpU9euXXv06NG7' +
  'd+9+/foNGDBg8ODBw4YNGzly5JgxY8aPHz9p0qSpU6fOmDFj9uzZ8+bNW7hw4ZIlS5YvX75q1aq1a9du2LBh8+bN27Zt27lz' +
  '5549e/bv33/o0KGjR4+eOHHi9OnT586du3jx4pUrV65fv37r1q27d+8+ePDg8ePHz549e/ny5Zs3b96/f//p06evX7/++PHj' +
  '9+/f//79CxQoUNCgQUOECBE6dOhw4cJFjBgxSpQo0aNHjxUrVty4cRMkSJA4ceJkyZKlTJkyTZo06dOnz5QpU9asWXPkyJE7' +
  'd+58+fIVLFiwSJEixYsXL1WqVNmyZStUqFC5cuVq1arVrFmzTp069evXb9SoUdOmTVu0aNG6det27dp17NixS5cu3bt379Wr' +
  'V9++ff/7779BgwYNHTp0xIgRo0ePHjdu3MSJE6dMmTJ9+vRZs2bNnTt3wYIFixcvXrZs2cqVK9esWbN+/fpNmzZt3bp1x44d' +
  'u3fv3rdv38GDB48cOXL8+PFTp06dPXv2woULly9fvnbt2s2bN+/cuXP//v1Hjx49ffr0xYsXr1+/fvfu3cePH798+fL9+/df' +
  'v379/fs3YMCAQYIECR48eKhQocKGDRshQoTIkSNHixYtZsyYceLEiR8/fqJEiZImTZoiRYrUqVOnS5cuY8aMWbJkyZ49e65c' +
  'ufLmzVugQIHChQsXK1asZMmSZcqUKV++fKVKlapWrVqjRo3atWvXq1evYcOGTZo0ad68eatWrdq2bduhQ4fOnTt369atZ8+e' +
  'ffr06d+//8CBA4cMGTJ8+PBRo0aNHTt2woQJkydPnjZt2syZM+fMmTN//vxFixYtXbp0xYoVq1evXrdu3caNG7ds2bJ9+/Zd' +
  'u3bt3bv3wIEDhw8fPnbs2MmTJ8+cOXP+/PlLly5dvXr1xo0bt2/fvnfv3sOHD588efL8+fNXr169ffv2w4cPnz9//vbt28+f' +
  'P//8+RNAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAA' +
  'AQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEE' +
  'EEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBA' +
  'AAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAAB' +
  'BBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQ' +
  'QAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAA' +
  'AQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEE' +
  'EEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBA' +
  'AAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAAB' +
  'BBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQ' +
  'QAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAA' +
  'AQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEE' +
  'EEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBA' +
  'AAEEEEAAAQQQQAABBBBAAAEEEOD/A/wPdjaWY2EzyJcAAAAASUVORK5CYII=',
  'base64',
)

/** A 0.5 s 64x64 VP8 WebM. The extend lane grabs a clip's LAST frame through a
 *  <video> element, so it needs a container the headless browser can actually
 *  decode, so WebM, because Playwright's Chromium ships no H.264. */
export const TEST_WEBM = Buffer.from(
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJrEU2bdLpNu4tTq4QVSalmU6yBoU27i1Or' +
  'hBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggJV7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirX' +
  'sYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiEB/QAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYjt42mz' +
  'x93cSZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAX14QDgkLCBQLqBQJqBAlWwhFW5gQESVMNn/HNzoGPAgGfImkWjh0VO' +
  'Q09ERVJEh41MYXZmNjIuMTIuMTAyc3PWY8CLY8WI7eNps8fd3ElnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjI4LjEwMiBsaWJ2' +
  'cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjUwMDAwMDAwMAAfQ7Z1QKnngQCjxIEAAIDQAwCdASpAAEAAAEcIhYWIhYSI' +
  'AgICdaoD+AP6AgcaRkYBcMdIS8QA/v1u8//jmTcwxP+Obf/xYTwOKMj/8VEAo5aBAGQA0QEAARAQABgAGFgv9AAIjoAAo5aB' +
  'AMgA0QEAARAQABgAGFgv9AAIjoAAo5aBASwA0QEAARAQABgAGFgv9AAIjoAAo5aBAZAA0QEAARAQABgAGFgv9AAIjoAAHFO7' +
  'a5G7j7OBALeK94EB8YIBpvCBAw==',
  'base64',
)

/** Boot straight into Create on the LOCAL backend (no sign-in). */
export async function bootLocalCreate(page: Page, opts: TauriMockOptions = WIN_OPTS): Promise<void> {
  await page.addInitScript(tauriMockInit, opts)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByRole('radiogroup', { name: 'Create mode' })).toBeVisible({ timeout: 20_000 })
}

/** Boot into Create with the global Cloud switch ON (hosted rendering). */
export async function bootCloudCreate(
  page: Page,
  scenario: CloudScenario = { license: 'active', access: true, mediaLive: true },
  opts: TauriMockOptions = WIN_OPTS,
  /** Narrower routes registered AFTER the shared cloud mock, so a journey can
   *  own one endpoint (a different wallet, unique job ids) without editing
   *  e2e/support/cloud-mock.ts. Playwright matches the newest route first. */
  after?: (page: Page) => Promise<void>,
): Promise<void> {
  await page.addInitScript(tauriMockInit, opts)
  await seedOnboardingDone(page)
  await routeCloud(page, scenario)
  if (after) await after(page)
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await signInResilient(page)
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByRole('radiogroup', { name: 'Create mode' })).toBeVisible({ timeout: 20_000 })
}

/**
 * Walk the signed-out cloud gate to a signed-in session, re-driving whatever
 * step is currently on screen.
 *
 * The gate is a stepped sheet with a spring animation on every step, and the
 * straight-line version (`signInViaGate`) clicks into a button that is still
 * moving, and on a loaded machine that click misses and then the element is
 * swapped out from under it, which stalls the whole spec for its full timeout.
 * A real user simply clicks the button again, so this reads the sheet's state
 * each round and presses whatever is in front of it.
 */
async function signInResilient(page: Page): Promise<void> {
  const visible = (l: ReturnType<Page['getByRole']>) => l.isVisible().catch(() => false)
  await expect(async () => {
    if (await cloudSwitch(page).isChecked()) return
    const email = page.getByPlaceholder('Email')
    if (!(await visible(email))) {
      const already = page.getByRole('button', { name: /Already got an account/i })
      const getCloud = page.getByRole('button', { name: /Get LU Cloud/i })
      if (await visible(already)) await already.click({ timeout: 3_000 })
      else if (await visible(getCloud)) await getCloud.click({ timeout: 3_000 })
      else await cloudSwitch(page).click({ timeout: 3_000 })
    }
    await expect(email).toBeVisible({ timeout: 4_000 })
    await email.fill('qa@lu-labs.ai')
    await page.getByPlaceholder('Password').fill('e2e-password')
    await page.getByRole('button', { name: /^Sign in$/i }).click({ timeout: 4_000 })
    await expect(cloudSwitch(page)).toBeChecked({ timeout: 8_000 })
  }).toPass({ timeout: 60_000 })
}

/**
 * Clear the cloud retention banner before a journey starts.
 *
 * The banner animates its own height open, so a straight click lands on a
 * moving target and can be swapped out mid-press. It is one-time-ever, so a
 * retry is exactly what a real user does.
 */
export async function dismissRetentionNotice(page: Page): Promise<void> {
  const button = page.getByTestId('create.retention-notice.dismiss-forever')
  await expect(async () => {
    if (await button.count() === 0) return
    await button.click({ timeout: 3_000 })
    await expect(button).toHaveCount(0, { timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
}

/** The Create button in the composer action bar (the header one shares its name). */
export function createButton(page: Page) {
  return page.getByTestId('create.generation.start')
}

/** The main prompt textarea. */
export function promptField(page: Page) {
  return page.getByTestId('create.prompt-field.submit')
}

/** Render one cloud image and wait for it to land in the gallery. */
export async function renderOneCloudImage(page: Page, prompt: string): Promise<void> {
  await promptField(page).fill(prompt)
  await createButton(page).click()
  await expect(page.locator('img[src*="/e2e/result.png"]').first()).toBeVisible({ timeout: 30_000 })
}

const CORS_JSON = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'content-type': 'application/json',
}

/**
 * Hand every submitted job its own id.
 *
 * The shared cloud mock answers with the SAME job id every time, and the
 * gallery keys its items on that id, so two renders collapse into two tiles
 * that are literally the same item. Any journey that needs to tell two results
 * apart (selecting, deleting) registers this first.
 */
export async function routeUniqueJobs(page: Page): Promise<void> {
  let n = 0
  await page.route('https://lu-labs.ai/api/jobs', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_JSON })
    n += 1
    return route.fulfill({
      status: 202,
      headers: CORS_JSON,
      body: JSON.stringify({ id: `job-e2e-${n}`, status: 'queued', created_at: new Date().toISOString() }),
    })
  })
  await page.route(/https:\/\/lu-labs\.ai\/api\/jobs\/job-e2e-\d+$/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_JSON })
    const id = new URL(route.request().url()).pathname.split('/').pop()!
    return route.fulfill({
      status: 200,
      headers: CORS_JSON,
      body: JSON.stringify({
        job: {
          id, kind: 'image', model: 'flux-schnell', provider: 'wavespeed', status: 'succeeded',
          result_url: 'https://lu-labs.ai/e2e/result.png', attestation: null, cost_units: 300,
          created_at: new Date().toISOString(), completed_at: new Date().toISOString(), error: null,
        },
      }),
    })
  })
}

/** Serve a fixed wallet, overriding the shared mock's generous default. */
export async function routeQuota(page: Page, remainingCredits: number): Promise<void> {
  await page.route('https://lu-labs.ai/api/jobs/quota', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_JSON })
    return route.fulfill({
      status: 200,
      headers: CORS_JSON,
      body: JSON.stringify({
        tier: 'hosted-max',
        period: '2026-07',
        limits: { credits: 2_550_000 },
        costs: { image: 1200, video: 40000 },
        used: { credits_used: 2_550_000 - remainingCredits },
        remaining: { credits: remainingCredits },
        topup: { credits: 0 },
        video: { limit: 300_000, used: 0, remaining: 300_000 },
        trainings: { limit: 2, used: 0, remaining: 2 },
      }),
    })
  })
}

export interface SeedItem {
  id: string
  type: 'image' | 'video' | 'audio'
  prompt: string
  jobId?: string
  remoteUrl?: string
  /** A LOCAL ComfyUI render: no remote URL, so its media resolves to the
   *  engine's /view path and fails when no engine is there. That failure is
   *  the whole point for the cross-origin banner journey. */
  local?: true
  /** Self-contained media, the way an MLX render carries its own bytes.
   *  Takes priority over the /view path, so the item is readable with no
   *  engine at all. */
  dataUrl?: string
}

/**
 * Pre-seed the persisted gallery.
 *
 * Some surfaces only exist once the gallery already holds a clip or a track:
 * the Extend picker lists cloud videos, the Lightbox branches per media type,
 * and Enhance needs a finished cloud render's job id. Rendering a real video
 * through the mock is not possible (there is no video job in the shared cloud
 * mock), and a returning user with a persisted gallery is a genuine state, so
 * the journeys seed it the same way `seedOnboardingDone` seeds settings.
 *
 * Call BEFORE the boot helper. Init scripts run in registration order and all
 * of them run before the page script.
 */
export async function seedGallery(page: Page, items: SeedItem[]): Promise<void> {
  await page.addInitScript((seed: SeedItem[]) => {
    const gallery = seed.map((s) => ({
      id: s.id,
      type: s.type,
      filename: s.local ? 'lu-local-render.png' : '',
      subfolder: s.local ? '' : '',
      prompt: s.prompt,
      negativePrompt: '',
      model: 'wan-2.2-720p',
      modelType: 'wan22',
      seed: 1,
      steps: 20,
      cfgScale: 5,
      sampler: 'euler',
      scheduler: 'simple',
      width: 1280,
      height: 720,
      batchSize: 1,
      createdAt: Date.now(),
      intent: s.type === 'video' ? 'video' : s.type === 'audio' ? 'music' : 'image',
      jobId: s.jobId,
      dataUrl: s.dataUrl,
      remoteUrl: s.local || s.dataUrl ? undefined : (s.remoteUrl ?? 'https://lu-labs.ai/e2e/result.png'),
    }))
    window.localStorage.setItem('create-store', JSON.stringify({ state: { gallery }, version: 1 }))
  }, items)
}

/** Everything the page pushed into a mock recorder bucket. */
export function bucket(page: Page, name: string) {
  return page.evaluate(
    (key) => (window as unknown as Record<string, unknown[]>)[key] ?? [],
    name,
  ) as Promise<unknown[]>
}

/** The width / height number inputs inside the Advanced drawer. */
export function sizeFields(page: Page) {
  return {
    width: page.locator('input[type="number"][max="4096"]').first(),
    height: page.locator('input[type="number"][max="4096"]').nth(1),
  }
}

/** Read a number input as a number. */
export async function numberOf(locator: ReturnType<Page['locator']>): Promise<number> {
  return Number(await locator.inputValue())
}
