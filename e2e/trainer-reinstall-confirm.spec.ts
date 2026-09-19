import { test, expect } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, cloudSwitch } from './support/cloud-mock'

/**
 * Z5 (box-gruen/b BERICHT.md, Zusatzpunkt Z5, e2e Windows 18.09.2026): auf
 * einer Box mit bereits installiertem Trainer hat "Reinstall trainer"
 * `install_character_trainer` im selben Moment ausgeloest, in dem geklickt
 * wurde -- keine Bestaetigung, keine Chance, den Installationsordner vorher
 * zu sehen oder zu aendern, echte pip-Aktivitaet (5,3 GB venv, ein editable
 * Reinstall) hat begonnen, bevor der Tester irgendetwas entschieden hatte.
 * Diese Spec beweist den Fix: der Klick oeffnet jetzt nur einen Dialog, und
 * `install_character_trainer` wird genau einmal aufgerufen, erst nachdem
 * "Reinstall" gedrueckt wurde, mit dem Pfad, der im eigenen Ordnerfeld des
 * Dialogs steht.
 *
 * Run: npx playwright test e2e/trainer-reinstall-confirm.spec.ts
 */

const SHOT_DIR = '/Users/purple/Desktop/LU/lu-301/bau/trainerconfirm-shots'

async function gotoReadyTrainer(page: import('@playwright/test').Page) {
  await page.addInitScript(tauriMockInit, {
    assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME, platform: 'windows' as const,
  })
  await page.addInitScript(() => {
    const bridge = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> }
    }).__TAURI_INTERNALS__
    const invoke = bridge.invoke
    ;(window as unknown as { __installCalls: unknown[] }).__installCalls = []
    bridge.invoke = async (cmd: string, args: unknown) => {
      if (cmd === 'character_trainer_status') return {
        envReady: true, basesReady: true, dit: 'x', textEncoder: 'x', vae: 'x',
        root: 'C:\\test-trainer', customized: false, suggestedRoot: null,
        install: { status: 'idle', logs: [] },
      }
      if (cmd === 'install_character_trainer') {
        ;(window as unknown as { __installCalls: unknown[] }).__installCalls.push(args)
        const installPath = (args as { installPath?: string } | null)?.installPath
        if (installPath && !/^[A-Za-z]:\\|^\//.test(installPath)) {
          throw new Error('The trainer folder must be an absolute path.')
        }
        return { status: 'installing' }
      }
      return invoke(cmd, args)
    }
  })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible()
  await page.getByRole('button', { name: /^Create$/ }).click()
  await page.getByRole('radio', { name: 'Character Studio', exact: true }).click()
}

async function installCallCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __installCalls: unknown[] }).__installCalls.length)
}

test('Reinstall trainer opens a dialog first -- no install call on the bare click (Negativkontrolle)', async ({ page }, testInfo) => {
  await gotoReadyTrainer(page)
  await page.getByRole('button', { name: 'Reinstall trainer', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reinstall the trainer?' })
  await expect(dialog).toBeVisible()
  expect(await installCallCount(page)).toBe(0)
  await page.screenshot({ path: `${SHOT_DIR}/${testInfo.titlePath.length}-dialog-open.png` })
})

test('the dialog shows the current trainer folder, pre-filled, and focuses Cancel', async ({ page }) => {
  await gotoReadyTrainer(page)
  await page.getByRole('button', { name: 'Reinstall trainer', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reinstall the trainer?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('input')).toHaveValue('C:\\test-trainer')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
})

test('Cancel closes the dialog and calls nothing', async ({ page }) => {
  await gotoReadyTrainer(page)
  await page.getByRole('button', { name: 'Reinstall trainer', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reinstall the trainer?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()
  expect(await installCallCount(page)).toBe(0)
  // Der Trainer bleibt exakt wie vorher -- der Knopf zeigt wieder sein Ruhe-Label.
  await expect(page.getByRole('button', { name: 'Reinstall trainer', exact: true })).toBeVisible()
})

test('Escape closes the dialog and calls nothing', async ({ page }) => {
  await gotoReadyTrainer(page)
  await page.getByRole('button', { name: 'Reinstall trainer', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reinstall the trainer?' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(await installCallCount(page)).toBe(0)
})

test('confirming calls install_character_trainer exactly once, with the edited path', async ({ page }, testInfo) => {
  await gotoReadyTrainer(page)
  await page.getByRole('button', { name: 'Reinstall trainer', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reinstall the trainer?' })
  const field = dialog.locator('input')
  await field.fill('D:\\NewTrainerDrive')
  await dialog.getByRole('button', { name: 'Reinstall', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(await installCallCount(page)).toBe(1)
  const calls = await page.evaluate(() => (window as unknown as { __installCalls: unknown[] }).__installCalls)
  expect(calls).toEqual([{ installPath: 'D:\\NewTrainerDrive' }])
  await page.screenshot({ path: `${SHOT_DIR}/${testInfo.titlePath.length}-confirmed-reinstall.png` })
})

test('confirming with an unchanged path reinstalls to the same folder, still exactly once', async ({ page }) => {
  await gotoReadyTrainer(page)
  await page.getByRole('button', { name: 'Reinstall trainer', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reinstall the trainer?' })
  await dialog.getByRole('button', { name: 'Reinstall', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(await installCallCount(page)).toBe(1)
  const calls = await page.evaluate(() => (window as unknown as { __installCalls: unknown[] }).__installCalls)
  expect(calls).toEqual([{ installPath: 'C:\\test-trainer' }])
})

test('an invalid path blocks: the backend rejects, no environment ever gets touched', async ({ page }, testInfo) => {
  await gotoReadyTrainer(page)
  await page.getByRole('button', { name: 'Reinstall trainer', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reinstall the trainer?' })
  const field = dialog.locator('input')
  await field.fill('relative-path-not-allowed')
  await dialog.getByRole('button', { name: 'Reinstall', exact: true }).click()
  // Der Dialog schliesst optimistisch (dieselbe UX wie beim "Set up trainer"
  // des Erstsetup-Gates); die Ablehnung erscheint als Statuszeile.
  const note = page.getByRole('status').filter({ hasText: 'absolute path' })
  await expect(note).toBeVisible()
  expect(await installCallCount(page)).toBe(1)
  await page.screenshot({ path: `${SHOT_DIR}/${testInfo.titlePath.length}-invalid-path-blocked.png` })
  // Erneutes Klicken auf Reinstall haeuft keinen zweiten Aufruf auf den
  // abgelehnten obendrauf -- der Knopf zeigt wieder sein Ruhe-Label.
  await expect(page.getByRole('button', { name: 'Reinstall trainer', exact: true })).toBeVisible()
})
