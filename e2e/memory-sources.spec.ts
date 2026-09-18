import { expect, test } from '@playwright/test'
for (const action of ['Mark source sensitive', 'Forget source', 'Mark source outdated', 'Move source project']) {
  test(`real answer source chip persists and hides after ${action}`, async ({ page }, testInfo) => {
    await page.goto('/e2e/memory-sources-proof.html')
    await page.getByRole('button', { name: 'Create sourced answer' }).click()
    await expect(page.getByText('Memory sources (1)', { exact: true })).toBeVisible()
    await page.getByText('Memory sources (1)', { exact: true }).click()
    await expect(page.getByText('Chat: Original proof conversation', { exact: true })).toBeVisible()
    await expect(page.getByText('Project: proof-project', { exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Answer save completed')
    await page.reload()
    await page.getByText('Memory sources (1)', { exact: true }).click()
    await expect(page.getByText('Remembered preference', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath('memory-sources.png'), fullPage: true })
    await page.getByRole('button', { name: action, exact: true }).click()
    await expect(page.getByText('Memory sources (1)', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Synthetic answer', { exact: true })).toBeVisible()
  })
}
