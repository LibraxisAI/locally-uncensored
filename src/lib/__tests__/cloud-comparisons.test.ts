// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

for (const slug of ['ollama-cloud', 'featherless']) {
  const html = readFileSync(`docs/vs/${slug}/index.html`, 'utf8')
  const page = new DOMParser().parseFromString(html, 'text/html')
  it(`${slug} dates and sources every comparative fact on both sides`, () => {
    const rows = page.querySelectorAll('[data-comparison-row]')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.querySelectorAll('td')).toHaveLength(2)
      for (const cell of row.querySelectorAll('td')) {
        expect(cell.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-09')
        expect(cell.querySelector('a')?.getAttribute('href')).toMatch(/^https:\/\//)
      }
    }
    expect(html).not.toMatch(/[\u2013\u2014]/u)
    expect(page.querySelectorAll('script')).toHaveLength(0)
  })
  it(`${slug} is linked, canonical and sends LU purchase links with src=luc`, () => {
    expect(readFileSync('docs/alternatives/index.html', 'utf8')).toContain(`href="/vs/${slug}/"`)
    expect(readFileSync('docs/sitemap.xml', 'utf8')).toContain(`<loc>https://locallyuncensored.com/vs/${slug}/</loc>`)
    expect(page.querySelector('[rel="canonical"]')?.getAttribute('href')).toBe(`https://locallyuncensored.com/vs/${slug}/`)
    for (const a of page.querySelectorAll('a[href^="https://lu-labs.ai/pricing"]')) {
      expect(new URL(a.getAttribute('href')!).searchParams.get('src')).toBe('luc')
    }
  })
}
