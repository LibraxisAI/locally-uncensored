// @vitest-environment jsdom
/**
 * Die Preisseite auf locallyuncensored.com.
 *
 * Die Zahlen selbst haelt scripts/check-cloud-sales.mjs gegen das Web-Repo,
 * weil nur dort die Quelle liegt. Hier steht, was die Seite SAGEN muss und was
 * sie nicht sagen darf: sie nimmt kein Geld an, sie verspricht nichts, was
 * hinter einem Schalter liegt, ohne den Schalter zu nennen, und sie nennt die
 * beiden Grenzen, die keine Einstellung verschiebt.
 */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const html = readFileSync('docs/pricing/index.html', 'utf8')
const page = new DOMParser().parseFromString(html, 'text/html')
const text = () => page.body.textContent ?? ''

it('takes no money itself: every buy link goes to the checkout domain', () => {
  const buys = [...page.querySelectorAll<HTMLAnchorElement>('a.cta-btn')]
  expect(buys.length).toBeGreaterThanOrEqual(2)
  for (const a of buys) {
    const url = new URL(a.getAttribute('href')!, 'https://locallyuncensored.com')
    expect(url.hostname).toBe('lu-labs.ai')
    expect(url.searchParams.get('src')).toBe('luc-pricing')
  }
  expect(page.querySelectorAll('form')).toHaveLength(0)
  expect(page.querySelectorAll('script')).toHaveLength(0)
})

it('names the switch in the same breath as the capability behind it', () => {
  // Der Auftrag ist ausdruecklich: was hinter dem Schalter liegt, wird im
  // selben Satz als hinter dem Schalter liegend benannt. Sonst liest der
  // Kaeufer eine Zusage und findet eine Ablehnung.
  expect(text()).toMatch(/once you turn your own filter off/i)
  expect(text()).toMatch(/18 or older/i)
})

it('says that unmetered is a paid benefit, not a free tier', () => {
  expect(text()).toMatch(/never paid/i)
  expect(text()).toMatch(/no free tier/i)
  expect(text()).toMatch(/API keys always pay credits/i)
})

it('states the two lines no setting moves', () => {
  expect(text()).toContain('Material involving minors')
  expect(text()).toContain('without their consent')
})

it('does not sell cloud as private', () => {
  expect(text()).toMatch(/not local privacy/i)
  expect(text()).not.toMatch(/we never see|fully private|zero knowledge/i)
})

it('is discoverable, canonical and free of dashes', () => {
  expect(page.documentElement.lang).toBe('en')
  expect(page.querySelectorAll('h1')).toHaveLength(1)
  expect(page.querySelector('link[rel="canonical"]')?.getAttribute('href'))
    .toBe('https://locallyuncensored.com/pricing/')
  expect(readFileSync('docs/index.html', 'utf8')).toContain('href="/pricing/"')
  expect(readFileSync('docs/sitemap.xml', 'utf8')).toContain('<loc>https://locallyuncensored.com/pricing/</loc>')
  expect(html).not.toMatch(/[–—]/u)
})
