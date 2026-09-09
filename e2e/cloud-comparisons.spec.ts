import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

for (const slug of ['ollama-cloud', 'featherless']) {
  test(`${slug} has readable, keyboard-scrollable comparison rows on mobile`, async ({ page }) => {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.hostname !== 'lu-docs.test') return route.abort()
      const path = url.pathname === `/vs/${slug}/` ? `docs/vs/${slug}/index.html` : url.pathname === '/assets/lu.css' ? 'docs/assets/lu.css' : null
      if (!path) return route.fulfill({ status: 404, body: '' })
      await route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'text/html', body: await readFile(path) })
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`http://lu-docs.test/vs/${slug}/`)
    const region = page.getByRole('region', { name: 'Plan and usage comparison' })
    await region.focus()
    await expect(region).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.locator('[data-comparison-row]')).toHaveCount(3)
    await expect(page.getByRole('link', { name: 'Review LU packs and calculator' })).toHaveAttribute('href', 'https://lu-labs.ai/pricing?tab=credits&src=luc')
  })
}
