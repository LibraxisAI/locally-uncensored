import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'

/**
 * David (18.09.2026): "die Reitergruppe [Chat/Create/Compare/Benchmark/
 * Models/Settings] sitzt irgendwie falsch mittig". Sein Massstab: die
 * horizontale Mitte dieser Gruppe soll ueber dem "VS" liegen, das im
 * Compare-Screen zwischen Model A und Model B steht, "das ist genau die
 * Mitte des Programms".
 *
 * Befund vor dem Fix (Header.tsx, grid-cols-[auto_1fr_auto]): die Mitte-
 * Spalte war der REST zwischen zwei ungleich breiten Aussenspalten (links
 * Burger+Logo, rechts vier Werkzeuge), und `justify-center` zentrierte nur
 * INNERHALB dieser Restflaeche. Gemessen am laufenden Fenster stand die
 * Reihe deshalb 59,7px links von der Fenster- und VS-Achse, bei jeder
 * Fensterbreite und in Cloud wie Lokal gleich weit (die Differenz kommt
 * allein aus den Aussenspalten, nicht aus der Fensterbreite oder dem
 * Betriebsmodus). Der Fix (`grid-cols-[1fr_auto_1fr]`) macht die Mitte zu
 * einer eigenen, inhaltsgetriebenen Spalte zwischen zwei GLEICH GROSSEN
 * Restspalten, die automatisch auf der Fenstermitte liegt.
 *
 * Das VS selbst zentriert sich im Inhaltsbereich (ABCompare.tsx,
 * grid-cols-[1fr_auto_1fr]); Compare blendet die Seitenleiste aus
 * (`AppShell.tsx`: `{!isComparing && <Sidebar />}`), und bei symmetrischem
 * `p-2` liegt dieser Inhaltsbereich im Fenster mittig, Fenstermitte und
 * VS-Achse sind hier also dieselbe Achse.
 *
 * Gegenprobe: mit der alten Anordnung (`auto_1fr_auto`) ist die Differenz
 * ~59,7px bei jeder Breite, weit ueber der 1px-Toleranz unten. Siehe
 * bau/topnav.md fuer die Messreihe.
 */

async function boot(page: Page) {
  await page.addInitScript(tauriMockInit, {
    assistantReply: DEFAULT_ASSISTANT_REPLY,
    modelName: DEFAULT_MODEL_NAME,
  })
  await seedOnboardingDone(page)
  await page.goto('/')
  await expect(page.locator('nav[aria-label="Main"]')).toBeVisible()
}

async function gotoCompare(page: Page) {
  const wide = page.getByRole('button', { name: 'Compare', exact: true }).first()
  if (await wide.isVisible().catch(() => false)) {
    await wide.click()
    return
  }
  // Below the `lg` breakpoint the six-item bar is collapsed into the kebab
  // menu, same target view, reached through the overflow menu instead.
  await page.getByRole('button', { name: 'Main navigation' }).click()
  await page.getByRole('menuitem', { name: 'Compare', exact: true }).click()
}

const WIDTHS = [1100, 1280, 1440, 1920]

for (const width of WIDTHS) {
  test(`nav group centers on the VS axis at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await boot(page)
    await gotoCompare(page)
    await expect(page.getByText('VS', { exact: true })).toBeVisible()

    const navBox = await page.locator('nav[aria-label="Main"]').boundingBox()
    const vsBox = await page.getByText('VS', { exact: true }).boundingBox()
    expect(navBox, 'nav group bounding box').not.toBeNull()
    expect(vsBox, 'VS bounding box').not.toBeNull()

    const navCenter = navBox!.x + navBox!.width / 2
    const vsCenter = vsBox!.x + vsBox!.width / 2
    expect(Math.abs(navCenter - vsCenter), `nav center ${navCenter} vs VS center ${vsCenter}`).toBeLessThanOrEqual(1)
  })
}

test('at the lg breakpoint the centered bar does not overlap the side groups', async ({ page }) => {
  // 1024px is the `lg` breakpoint (`hidden lg:flex` in Header.tsx) where the
  // full six-item bar first appears: the tightest realistic squeeze between
  // the centered group and the fixed-width side groups.
  await page.setViewportSize({ width: 1024, height: 800 })
  await boot(page)
  await gotoCompare(page)
  await expect(page.getByText('VS', { exact: true })).toBeVisible()

  const bar = page.locator('nav[aria-label="Main"] > div.hidden.lg\\:flex')
  const barBox = await bar.boundingBox()
  const logo = await page.getByRole('button', { name: 'LU' }).boundingBox()
  const cloudSwitch = await page.getByRole('switch', { name: /^Cloud$/i }).boundingBox()
  expect(barBox && logo && cloudSwitch, 'bar, logo and cloud switch all present').toBeTruthy()

  const barLeft = barBox!.x
  const barRight = barBox!.x + barBox!.width
  const leftGroupEnd = logo!.x + logo!.width
  const rightGroupStart = cloudSwitch!.x

  expect(barLeft, 'bar does not reach into the left group').toBeGreaterThan(leftGroupEnd)
  expect(barRight, 'bar does not reach into the right group').toBeLessThan(rightGroupStart)
})

test('left and right header groups keep their pixel position across views', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await boot(page)
  const toggleBefore = await page.getByRole('button', { name: /Toggle sidebar/i }).boundingBox()
  const themeBefore = await page.getByRole('button', { name: /Light Mode|Dark Mode/i }).boundingBox()

  await gotoCompare(page)
  await expect(page.getByText('VS', { exact: true })).toBeVisible()

  const toggleAfter = await page.getByRole('button', { name: /Toggle sidebar/i }).boundingBox()
  const themeAfter = await page.getByRole('button', { name: /Light Mode|Dark Mode/i }).boundingBox()

  expect(toggleAfter!.x).toBeCloseTo(toggleBefore!.x, 3)
  expect(themeAfter!.x).toBeCloseTo(themeBefore!.x, 3)
})
