import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { routeCloud, signInViaGate, cloudSwitch, type CloudScenario } from './support/cloud-mock'

/**
 * Wie die Preset-Oberflaeche AUSSIEHT, als Bilder auf dem Mac.
 *
 * Der Eigner hat die Popups der Presets als "komisches grau, komische edges"
 * beanstandet. Optik laesst sich nicht behaupten, sie muss gezeigt werden,
 * deshalb faehrt diese Datei die Schiene und die Werkstatt im echten Browser
 * an (gemocktes Tauri/Netz wie create-studio.spec.ts) und legt Bilder ab.
 * Derselbe Lauf nimmt zusaetzlich ein HAUS-Popup auf (das Was-ist-neu-Blatt),
 * damit der Vergleich "passt es zum Rest der App" ein Bild hat und keine
 * Erinnerung ist.
 *
 * `LU_PRESETLOOK_PHASE=vorher` nimmt denselben Satz vor dem Umbau auf.
 *
 * Geprueft wird dabei auch die Hausregel fuer Popups: ein echtes X mit
 * aria-label, und Escape schliesst (feedback-sampling-popup-mit-x.md).
 */

const PHASE = process.env.LU_PRESETLOOK_PHASE ?? 'nachher'
const SHOTS = process.env.LU_PRESETLOOK_DIR ?? '/Users/purple/Desktop/LU/lu-301/e2e/presetlook'

function shotPath(name: string): string {
  mkdirSync(SHOTS, { recursive: true })
  return resolve(SHOTS, `${PHASE}-${name}.png`)
}

const WINDOWS_OPTS: TauriMockOptions = {
  assistantReply: DEFAULT_ASSISTANT_REPLY,
  modelName: DEFAULT_MODEL_NAME,
  platform: 'windows',
}

const STUDIO: CloudScenario = { license: 'active', access: true, mediaLive: true, studioCatalog: true }

/**
 * Wie `seedOnboardingDone`, aber mit einer ALTEN gemerkten Notenversion:
 * damit geht das Was-ist-neu-Blatt beim Start auf und liefert das
 * Referenzbild eines gelungenen Haus-Popups aus demselben Lauf.
 */
async function seedWithReleaseNotes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'chat-settings',
      JSON.stringify({ state: { settings: { onboardingDone: true, appMode: 'local' }, _version: 10 }, version: 10 }),
    )
    window.localStorage.setItem(
      'lu_release_notes',
      JSON.stringify({ state: { lastNotesVersion: '0.0.0' }, version: 0 }),
    )
  })
}

const presetShelf = (page: Page) => page.locator('aside[aria-label="Presets"]')

/** Bis in den Create-Tab, mit dem Haus-Referenzbild unterwegs. */
async function bootIntoCloudCreate(page: Page, withReference: boolean): Promise<void> {
  await page.addInitScript(tauriMockInit, WINDOWS_OPTS)
  await seedWithReleaseNotes(page)
  await routeCloud(page, STUDIO)
  await page.goto('/')

  const notes = page.getByRole('dialog', { name: /What's new/ })
  await expect(notes).toBeVisible({ timeout: 20_000 })
  if (withReference) await notes.screenshot({ path: shotPath('referenz-hauspopup') })
  await notes.getByRole('button', { name: 'Close' }).click()
  await expect(notes).toBeHidden()

  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await signInViaGate(page)
  await expect(cloudSwitch(page)).toBeChecked({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(presetShelf(page)).toBeVisible({ timeout: 15_000 })
}

test('die Preset-Schiene und die Werkstatt, fotografiert', async ({ page }) => {
  await bootIntoCloudCreate(page, true)

  await page.getByRole('button', { name: 'Expand presets' }).click()
  await expect(page.getByText('Song from Words')).toBeVisible()
  await page.screenshot({ path: shotPath('a-schiene') })
  await presetShelf(page).screenshot({ path: shotPath('b-schiene-nah') })

  // Die Werkstatt eines einstufigen Presets: Preis, Modellwahl, Startknopf.
  await page.getByRole('button', { name: /Song from Words/ }).click()
  const song = page.getByRole('dialog', { name: 'Song from Words' })
  await expect(song).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Preset prompt').fill('a bright acoustic tune about a summer road trip')
  await expect(page.getByText('1,500 credits')).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: shotPath('c-werkstatt') })
  await song.screenshot({ path: shotPath('d-werkstatt-nah') })

  // Hausregel Popup, beide Haelften: ein echtes X mit Beschriftung, und
  // Escape schliesst.
  const x = song.getByRole('button', { name: 'Close' })
  await expect(x).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(song).toBeHidden()

  // Ein mehrstufiges Preset mit Hochladefeld und erweiterten Einstellungen:
  // genau die Flaechen, die als "graue Kaesten" beanstandet waren.
  await page.getByRole('button', { name: /Product in a Scene/ }).click()
  const scene = page.getByRole('dialog', { name: 'Product in a Scene' })
  await expect(scene).toBeVisible({ timeout: 15_000 })
  await scene.screenshot({ path: shotPath('e-werkstatt-eingaben') })
  await scene.getByRole('button', { name: /Advanced settings/ }).click()
  await scene.screenshot({ path: shotPath('f-werkstatt-erweitert') })
  await scene.getByRole('button', { name: 'Close' }).click()
  await expect(scene).toBeHidden()
})

test('dieselben Flaechen schmal bei 900 Pixel', async ({ page }) => {
  // Erst in den Create-Tab, dann schmal stellen: unter 900 Pixel raeumt die
  // Kopfzeile die Reiter in ein Menue, und der Lauf suchte einen Knopf, den
  // es dort nicht mehr gibt.
  await bootIntoCloudCreate(page, false)
  await page.setViewportSize({ width: 900, height: 780 })

  await page.getByRole('button', { name: 'Expand presets' }).click()
  await expect(page.getByText('Song from Words')).toBeVisible()
  await page.screenshot({ path: shotPath('g-schmal-schiene') })

  await page.getByRole('button', { name: /Song from Words/ }).click()
  const song = page.getByRole('dialog', { name: 'Song from Words' })
  await expect(song).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Preset prompt').fill('a bright acoustic tune about a summer road trip')
  await expect(page.getByText('1,500 credits')).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: shotPath('h-schmal-werkstatt') })

  await expect(song.getByRole('button', { name: 'Close' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(song).toBeHidden()
})
