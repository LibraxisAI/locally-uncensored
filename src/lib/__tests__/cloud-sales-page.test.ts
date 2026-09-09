// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const html = readFileSync('docs/cloud/index.html', 'utf8')
const page = new DOMParser().parseFromString(html, 'text/html')

it('states cloud restrictions and allowance semantics without blanket privacy promises', () => {
  expect(page.documentElement.lang).toBe('en')
  expect(page.querySelectorAll('h1')).toHaveLength(1)
  const text = page.body.textContent!
  for (const fact of ['Hosted requests leave your machine', 'Hosted image and video prompts are checked',
    'API-key usage draws credits', 'one free request', 'Missing final usage', 'visible notice']) {
    expect(text).toContain(fact)
  }
  expect(html).not.toMatch(/[\u2013\u2014]/u)
  expect(page.querySelectorAll('script')).toHaveLength(0)
})

it('tags every pricing and checkout CTA with the required source', () => {
  const links = [...page.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((a) => new URL(a.getAttribute('href')!, 'https://locallyuncensored.com'))
    .filter((url) => url.hostname === 'lu-labs.ai' && /^\/(pricing|checkout)/.test(url.pathname))
  expect(links.length).toBeGreaterThanOrEqual(3)
  for (const url of links) expect(url.searchParams.get('src')).toBe('luc')
})

it('is discoverable from the homepage and sitemap with a canonical URL', () => {
  expect(page.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://locallyuncensored.com/cloud/')
  expect(readFileSync('docs/index.html', 'utf8')).toContain('href="/cloud/"')
  expect(readFileSync('docs/sitemap.xml', 'utf8')).toContain('<loc>https://locallyuncensored.com/cloud/</loc>')
})
