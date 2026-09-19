import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, signInViaGate, cloudSwitch } from './support/cloud-mock'

/**
 * Proof for Blocker A1 (Abnahme 19.09.2026): the Flash popup must open
 * UPWARD from the session strip, because that strip sits right above the
 * composer, near the BOTTOM of the window (`ChatView.tsx:506`), not near the
 * top. The previous proof (Runde 2) measured a harness that put the strip at
 * the top of a tall page with 300px of free space below it, so it could
 * never have caught a panel opening the wrong way. This file drives the real
 * `ChatView`, with the real `overflow-hidden` ancestor and the real bottom-of-
 * window strip, and measures with `boundingBox()`, the same way
 * `sampling-popup.spec.ts` does for the sibling popup.
 *
 * Three window sizes, because the geometry differs at each: a tall desktop
 * window (plenty of room above the strip), a short one (900x600, closer to
 * what the review measured against), and a narrow phone-width one (360px,
 * where the left clamp matters too). At all three, the whole panel, X button
 * included, must be measurable INSIDE the viewport: no negative x/y, no edge
 * past width/height.
 */

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' }

/**
 * Boots the app NATIVELY at the size under test and picks the model through
 * the real UI there, no select-wide-then-resize detour.
 *
 * Runde 4 (19.09.2026): this used to pick the model at a roomy 1024px width
 * and resize down afterwards, because `ModelSelector`'s dropdown, opened at
 * a native 360px, used to leave the shared scroll-clipped ancestor
 * (`ChatView.tsx`'s `overflow-hidden` content column) scrolled roughly 290 to
 * 357px to the right, permanently, dragging the whole chat column off-screen.
 * That Alt-Fehler is fixed now (`ChatInput.tsx`'s action row carries its own
 * `overflow-x-auto`, `ModelSelector`/`SamplingControls`/`PluginsDropdown`
 * hang their panels off `position: fixed` instead of `absolute` so that row's
 * own overflow never clips them), proven separately and numerically in
 * `e2e/model-selector-scroll-leak.spec.ts`. This spec no longer needs to
 * sidestep it: picking the model at the REAL 360px width this test runs at
 * is exactly the path a phone-width user takes.
 */
async function boot(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height })
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true, paidPlan: true })
  await page.route('**/api/inference/v1/models', (route) => route.fulfill({ status: 200, headers: CORS,
    contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [{
      id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B Turbo',
      context_length: 131072, supports_tools: true, think: 'never', usage_class: 'flash',
      flash: { daily_tokens: 50000, default_max_output: 8192, request_seconds: 240, sessions_only: true, concurrent_requests: 1 },
    }] }),
  }))
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible()
  await signInViaGate(page)
  await expect(cloudSwitch(page)).toBeChecked()
  await page.getByRole('button', { name: /New Chat/i }).first().click()
  await page.getByRole('button', { name: 'Select chat model', exact: true }).click()
  await page.getByRole('button', { name: /Llama 3.1 8B Turbo/ }).click()
}

interface Box { x: number; y: number; width: number; height: number }

const SIZES: Array<{ label: string; width: number; height: number }> = [
  { label: '1280x800 (breiter Desktop)', width: 1280, height: 800 },
  { label: '900x600 (kleines Fenster)', width: 900, height: 600 },
  { label: '360px breit (Telefonbreite)', width: 360, height: 720 },
]

for (const { label, width, height } of SIZES) {
  test(`das Panel oeffnet nach OBEN und bleibt bei ${label} vollstaendig sichtbar`, async ({ page }) => {
    await boot(page, width, height)

    const trigger = page.getByTestId('flash-chat-notice-trigger')
    await expect(trigger).toBeVisible()
    const ausloeser = (await trigger.boundingBox()) as Box

    await trigger.click()
    const panel = page.getByTestId('flash-chat-notice-panel')
    await expect(panel).toBeVisible()
    const x = page.getByTestId('flash-chat-notice-close')
    await expect(x).toBeVisible()

    const kasten = (await panel.boundingBox()) as Box
    const xKasten = (await x.boundingBox()) as Box

    // Richtung: das Panel haengt UEBER dem Trigger, nicht darunter. Nur
    // `position: absolute` zu pruefen faengt eine falsche Richtung nicht, ein
    // gemessenes Rechteck schon.
    expect(kasten.y + kasten.height).toBeLessThanOrEqual(ausloeser.y + 1)

    // Sichtbarkeit: das ganze Panel liegt im Fenster, nicht nur seine obere
    // linke Ecke. Alle vier Kanten werden gemessen.
    expect(kasten.x).toBeGreaterThanOrEqual(0)
    expect(kasten.y).toBeGreaterThanOrEqual(0)
    expect(kasten.x + kasten.width).toBeLessThanOrEqual(width + 0.5)
    expect(kasten.y + kasten.height).toBeLessThanOrEqual(height + 0.5)

    // Das X liegt ebenfalls im sichtbaren Bereich, nicht nur behauptet
    // sichtbar: `toBeVisible()` prueft CSS-Sichtbarkeit, nicht Lage im
    // Fenster. Ein Panel, das zur Haelfte rechts aus dem Fenster haengt, kann
    // sein X trotzdem als "visible" melden.
    expect(xKasten.x).toBeGreaterThanOrEqual(0)
    expect(xKasten.y).toBeGreaterThanOrEqual(0)
    expect(xKasten.x + xKasten.width).toBeLessThanOrEqual(width + 0.5)
    expect(xKasten.y + xKasten.height).toBeLessThanOrEqual(height + 0.5)
  })
}

/**
 * Negativkontrolle: beweist, dass der Waechter oben wirklich etwas misst und
 * nicht nur immer gruen ist.
 *
 * Statt den alten, fehlerhaften Code wiederherzustellen (der Zweig hat davon
 * keine Kopie mehr, und eine zweite Kopie wuerde selbst zu totem Code), wird
 * hier mit denselben ECHTEN Messwerten geprueft, was `top: '100%'` (die
 * Richtung aus Runde 2) an genau dieser Stelle bedeutet: der Trigger sitzt in
 * der untersten Leiste vor dem Composer, und die Fensterhoehe ist bekannt.
 * Ein Panel von `panel.boundingBox()`s eigener Hoehe, das ab der Trigger-
 * Unterkante nach UNTEN gerechnet wird, muesste weit ueber den unteren
 * Fensterrand hinausragen. Das ist keine Behauptung, sondern dieselbe
 * Messung wie oben, nur mit der Rechenrichtung von Runde 2, und sie zeigt:
 * die Richtung war der Fehler, nicht ein Zufall dieses einen Harnesses.
 */
test('Negativkontrolle: nach UNTEN gerechnet haette das Panel den Fensterrand gerissen', async ({ page }) => {
  await boot(page, 900, 600)

  const trigger = page.getByTestId('flash-chat-notice-trigger')
  const ausloeser = (await trigger.boundingBox()) as Box

  await trigger.click()
  const panel = page.getByTestId('flash-chat-notice-panel')
  await expect(panel).toBeVisible()
  const kasten = (await panel.boundingBox()) as Box

  const wuerdeUntenEnden = ausloeser.y + ausloeser.height + 6 /* PANEL_GAP */ + kasten.height
  const fensterHoehe = 600
  expect(wuerdeUntenEnden).toBeGreaterThan(fensterHoehe)
})
