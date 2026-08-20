import { test, expect, type Page } from '@playwright/test'
import { openNewChat } from './support/ui'
import { bootApp } from './support/journeys/models'

/**
 * QA sweep, area `import` — Settings, General, "Import from other chatbots":
 * parse an export, pick which conversations to take, and push them into the
 * active chat's RAG store.
 *
 * The three controls are proven by what the panel knows afterwards: the
 * selection counter, the green "imported" tally, and the error box going
 * away. The file goes in through the real <input type=file>, so the parser
 * runs for real on a byte-accurate ChatGPT export shape.
 */

/** A minimal but schema-true ChatGPT `conversations.json` (mapping form). */
function chatgptExport(titles: string[]): string {
  return JSON.stringify(titles.map((title, i) => {
    const rootId = `root-${i}`
    const userId = `user-${i}`
    const botId = `bot-${i}`
    return {
      title,
      create_time: 1_700_000_000 + i,
      update_time: 1_700_000_100 + i,
      mapping: {
        [rootId]: { id: rootId, message: null, parent: null, children: [userId] },
        [userId]: {
          id: userId,
          message: {
            id: userId,
            author: { role: 'user' },
            create_time: 1_700_000_000 + i,
            content: { content_type: 'text', parts: [`question ${i} about local models`] },
          },
          parent: rootId,
          children: [botId],
        },
        [botId]: {
          id: botId,
          message: {
            id: botId,
            author: { role: 'assistant' },
            create_time: 1_700_000_050 + i,
            content: { content_type: 'text', parts: [`answer ${i} from the export`] },
          },
          parent: userId,
          children: [],
        },
      },
    }
  }))
}

async function openImporter(page: Page) {
  await expect(async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
    await expect(page.getByTestId('settings.tab.switch').first()).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await page.getByTestId('settings.tab.switch').filter({ hasText: 'General' }).click()
  await page.getByTestId('settings.section.toggle').filter({ hasText: 'Import from other chatbots' }).click()
  await expect(page.getByText(/Choose export file/)).toBeVisible()
}

/** Hand the hidden file input a named JSON payload. */
async function dropExport(page: Page, name: string, body: string) {
  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(body, 'utf8'),
  })
}

test('a file with no conversations explains itself, and the box can be closed', async ({ page }) => {
  await bootApp(page)
  await openNewChat(page)
  await openImporter(page)

  // ── import.error-banner.dismiss ──────────────────────────────────
  await dropExport(page, 'conversations.json', JSON.stringify({ not: 'an export' }))
  const error = page.getByText(/No conversations found/)
  await expect(error).toBeVisible()

  await page.getByTestId('import.error-banner.dismiss').click()
  await expect(error).toHaveCount(0)
  // Closing the box must not invent a conversation list.
  await expect(page.getByTestId('import.import-selected-to-rag.click')).toHaveCount(0)
})

test('Select all flips the whole list and the counter follows', async ({ page }) => {
  await bootApp(page)
  await openNewChat(page)
  await openImporter(page)

  await dropExport(page, 'conversations.json', chatgptExport(['Local models', 'Prompt tips']))
  await expect(page.getByText(/Detected: ChatGPT/)).toBeVisible()

  // ── import.select-all-conversations.toggle ───────────────────────
  // Everything starts selected, so the button offers the opposite.
  const toggle = page.getByTestId('import.select-all-conversations.toggle')
  await expect(toggle).toHaveText('Select none')
  await expect(page.getByText('2 selected')).toBeVisible()
  await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(2)

  await toggle.click()
  await expect(toggle).toHaveText('Select all')
  await expect(page.getByText('0 selected')).toBeVisible()
  // The rows themselves followed, not just the label.
  await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(0)
  // With nothing picked there is nothing to import.
  await expect(page.getByTestId('import.import-selected-to-rag.click')).toBeDisabled()

  await toggle.click()
  await expect(page.getByText('2 selected')).toBeVisible()
  await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(2)
})

test('Import feeds the picked conversations into the active chat', async ({ page }) => {
  await bootApp(page)
  await openNewChat(page)
  await openImporter(page)

  await dropExport(page, 'conversations.json', chatgptExport(['Local models', 'Prompt tips']))
  await expect(page.getByText(/Detected: ChatGPT/)).toBeVisible()

  // ── import.import-selected-to-rag.click ──────────────────────────
  const importBtn = page.getByTestId('import.import-selected-to-rag.click')
  await expect(importBtn).toBeEnabled()
  await importBtn.click()

  // Both conversations land, and the panel says so in its own tally rather
  // than merely stopping the spinner.
  await expect(page.getByText(/2 imported/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/failed/)).toHaveCount(0)
})
