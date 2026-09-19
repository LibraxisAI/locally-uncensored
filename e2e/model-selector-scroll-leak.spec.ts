import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'

/**
 * Alt-Fehler (gefunden waehrend der Flash-Popup-Arbeit, Runde 4, 19.09.2026):
 * bei 360px Fensterbreite fasst die Aktionszeile des Composers (Clip, Voice,
 * Think, Effort, die view-eigenen Actions, Sampling, der Modellwaehler, Send)
 * mehr Knoepfe, als die Zeile breit ist. Vor dem Fix zaehlte dieser
 * Ueberschuss zur scrollbaren Flaeche des gemeinsamen `ChatView`-Vorfahren
 * dazu (`flex-1 flex overflow-hidden min-h-0`, umschliesst Verlauf UND
 * Composer). Ein Klick auf den Modellwaehler, der teilweise ausserhalb der
 * sichtbaren Zeile lag, holte der Browser ihn mit `scrollLeft` auf GENAU
 * DIESEM Vorfahren "in Sicht", und das verschob die ganze Spalte seitlich,
 * Verlauf inklusive, dauerhaft, auch nach dem Schliessen des Menues (gemessen
 * vor dem Fix: 290 bis 357px).
 *
 * Der Fix (siehe `ChatInput.tsx`, `ModelSelector.tsx`, `SamplingControls.tsx`,
 * `PluginsDropdown.tsx`): die Aktionszeile traegt jetzt ihren EIGENEN
 * `overflow-x-auto`, der Ueberschuss bleibt lokal. Das zwingt `overflow-y`
 * derselben Zeile auf `auto` (CSS Overflow Module Level 3), also haengen die
 * drei Panels, die in dieser Zeile aufgehen, jetzt an `position: fixed` statt
 * `absolute`: das escaped jedes `overflow` im Baum.
 *
 * Diese Spec faehrt die echte `ChatView` (kein Harness) bei drei
 * Fensterbreiten, jedesmal NATIV bei der Zielbreite gebootet (kein
 * Wahl-bei-1024-dann-verkleinern-Umweg mehr, siehe die Aenderung an
 * `flash-notice-real-geometry.spec.ts`s `boot()` im selben Commit) und misst
 * `scrollLeft` auf dem gemeinsamen Vorfahren vor dem Oeffnen, nach dem
 * Oeffnen, nach der Wahl und nach dem Schliessen.
 */

/**
 * Der gemeinsame Vorfahr, der Verlauf UND Composer umschliesst
 * (`ChatView.tsx`, `flex-1 flex overflow-hidden min-h-0`) — nicht der neue,
 * lokale `overflow-x-auto` der Aktionszeile selbst, der genau DIESEN Vorfahr
 * seit dem Fix abschirmt und deshalb legitim seinen eigenen `scrollLeft`
 * bewegen darf. `overflow: hidden` unterscheidet die beiden: nur der
 * gemeinsame Vorfahr traegt es, die Aktionszeile traegt `auto`.
 */
async function findeSchneidendenVorfahren(page: Page) {
  return page.evaluateHandle(() => {
    const btn = document.querySelector('[aria-label="Select chat model"]') as HTMLElement
    let p: HTMLElement | null = btn
    while (p) {
      const cs = getComputedStyle(p)
      if (cs.overflowX === 'hidden' || cs.overflowY === 'hidden') return p
      p = p.parentElement
    }
    return null
  })
}

async function scrollLeftVon(page: Page, handle: Awaited<ReturnType<typeof findeSchneidendenVorfahren>>) {
  return page.evaluate((el) => (el as HTMLElement | null)?.scrollLeft ?? null, handle)
}

async function boot(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height })
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await page.goto('/')
  await page.getByRole('button', { name: /New Chat/i }).first().click()
}

const SIZES: Array<{ label: string; width: number; height: number }> = [
  { label: '360px breit (Telefonbreite)', width: 360, height: 720 },
  { label: '900x600 (kleines Fenster)', width: 900, height: 600 },
  { label: '1280x800 (breiter Desktop)', width: 1280, height: 800 },
]

for (const { label, width, height } of SIZES) {
  test(`scrollLeft bleibt 0 durch Oeffnen, Waehlen, Schliessen bei ${label}`, async ({ page }) => {
    await boot(page, width, height)
    const vorfahr = await findeSchneidendenVorfahren(page)
    expect(await scrollLeftVon(page, vorfahr)).toBe(0)

    const trigger = page.getByRole('button', { name: 'Select chat model', exact: true })
    await trigger.click()
    expect(await scrollLeftVon(page, vorfahr), 'nach dem Oeffnen').toBe(0)

    const menu = page.getByTestId('model-picker-menu')
    await expect(menu).toBeVisible()
    // Das Menue selbst muss bei 360px vollstaendig bedienbar bleiben: nicht
    // nur "gefunden" (`toBeVisible` prueft CSS-Sichtbarkeit, nicht Lage im
    // Fenster), das X-lose Menue hat hier keinen eigenen Schliessknopf, also
    // wird die erste Modellzeile direkt vermessen.
    const row = page.locator('[data-testid="model-picker-menu"] [role="button"]').first()
    await expect(row).toBeVisible()
    const kasten = await row.boundingBox()
    expect(kasten, 'die Modellzeile muss ein messbares Rechteck haben').not.toBeNull()
    if (kasten) {
      expect(kasten.x).toBeGreaterThanOrEqual(0)
      expect(kasten.y).toBeGreaterThanOrEqual(0)
      expect(kasten.x + kasten.width).toBeLessThanOrEqual(width + 0.5)
      expect(kasten.y + kasten.height).toBeLessThanOrEqual(height + 0.5)
    }

    await row.click()
    await expect(menu).toBeHidden()
    expect(await scrollLeftVon(page, vorfahr), 'nach der Wahl, Menue zu').toBe(0)

    // Nochmal oeffnen und mit Escape schliessen, der zweite Weg hinaus.
    await trigger.click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    expect(await scrollLeftVon(page, vorfahr), 'nach Escape').toBe(0)
  })
}

/**
 * Negativkontrolle: beweist, dass die Messung oben wirklich etwas prueft.
 *
 * Am LAUFENDEN, echten Baum wird der Fix zur Laufzeit zurueckgedreht (keine
 * Quelldatei angefasst, `page.evaluate` setzt nur die Inline-Stilregel
 * zurueck, die `ChatInput.tsx` jetzt traegt): die Aktionszeile bekommt wieder
 * `overflow: visible`, genau der Zustand vor diesem Fix. Danach muss dieselbe
 * Modellwahl den gemeinsamen Vorfahren wieder seitlich verschieben.
 */
test('Negativkontrolle: ohne den eigenen Bildlauf der Zeile verschiebt die Wahl den gemeinsamen Vorfahren', async ({ page }) => {
  await boot(page, 360, 720)
  const vorfahr = await findeSchneidendenVorfahren(page)
  expect(await scrollLeftVon(page, vorfahr)).toBe(0)

  await page.evaluate(() => {
    const btn = document.querySelector('[aria-label="Select chat model"]') as HTMLElement
    let p: HTMLElement | null = btn
    while (p) {
      const cs = getComputedStyle(p)
      if (cs.overflowX === 'auto') { p.style.overflow = 'visible'; break }
      p = p.parentElement
    }
  })

  await page.getByRole('button', { name: 'Select chat model', exact: true }).click()
  const row = page.locator('[data-testid="model-picker-menu"] [role="button"]').first()
  await row.click({ timeout: 5000 }).catch(() => {})

  const nachher = await scrollLeftVon(page, vorfahr)
  expect(nachher, 'ohne die eigene Bildlauf-Zeile bleibt der Alt-Fehler bestehen').not.toBe(0)
})
