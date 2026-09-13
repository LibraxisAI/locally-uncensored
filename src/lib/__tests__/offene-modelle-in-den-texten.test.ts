// @vitest-environment jsdom
/**
 * Die Zahl der offenen Modelle, auf allen Flaechen dieselbe.
 *
 * Der Medienkatalog ist am 13.09.2026 von sechs auf zehn offene Videomodelle
 * gewachsen. Die Zahl stand als WORT auf drei Seiten in docs/ und einmal im
 * Was-ist-neu-Blatt, also an vier Stellen, die kein Waechter zusammenhielt:
 * `scripts/check-cloud-sales.mjs` zaehlt die Zeilen der Preistabelle, laeuft
 * aber nur von Hand und braucht einen zweiten Checkout. Ein ausgeschriebenes
 * Zahlwort kann nicht laut falsch sein, es steht einfach da, und genau so hat
 * es den Katalogumbau ueberlebt.
 *
 * Dieser Waechter laeuft bei jedem Commit und haelt die vier Stellen an
 * `CLOUD_PITCH.openVideoModels`.
 *
 * Lauf: npx vitest run src/lib/__tests__/offene-modelle-in-den-texten.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLOUD_PITCH } from '../cloud-pitch'

const WURZEL = resolve(__dirname, '..', '..', '..')
const lies = (pfad: string) => readFileSync(resolve(WURZEL, pfad), 'utf8')
const SEITEN = ['docs/index.html', 'docs/cloud/index.html', 'docs/pricing/index.html'] as const
const ZAHLWORT: Record<number, string> = { 3: 'three', 6: 'six', 10: 'ten', 15: 'fifteen' }

/**
 * Die alte Aussage, an ihrer Form erkannt statt an einem festen Satz: ein
 * Zahlwort, das eine Gattung von Modellen zaehlt. "six seconds" und die
 * sechsstellige Kennzahl im Fernzugriff sind keine Modellzahlen.
 */
const nenntSechsModelle = (text: string) =>
  /\bsix\b[^.]{0,40}\b(?:video|image)(?:-to-video)?\s+(?:models|endpoints)/i.test(text)
  || /\bthese six\b/i.test(text)
  || /the six models/i.test(text)

const alsText = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''

describe('die Zahl der offenen Modelle', () => {
  it('steht auf keiner Seite mehr als sechs', () => {
    for (const seite of SEITEN) {
      expect(nenntSechsModelle(alsText(lies(seite))), `${seite} zaehlt noch sechs`).toBe(false)
    }
  })

  it('steht auf jeder Verkaufsflaeche als das gezaehlte Zahlwort', () => {
    const wort = ZAHLWORT[CLOUD_PITCH.openVideoModels]
    expect(wort, `fuer ${CLOUD_PITCH.openVideoModels} fehlt das Zahlwort`).toBeTruthy()
    for (const seite of SEITEN) {
      expect(alsText(lies(seite)), `${seite} nennt die offene Videozahl nicht`)
        .toMatch(new RegExp(`\\b${wort}\\b[^.]{0,40}\\b(?:video|image-to-video)`, 'i'))
    }
  })

  it('und die Preisseite fuehrt jede offene Videozeile genau einmal', () => {
    const seite = new DOMParser().parseFromString(lies('docs/pricing/index.html'), 'text/html')
    const zeilen = [...seite.querySelectorAll('[data-adult-video-row]')]
    expect(zeilen, 'die Preistabelle zaehlt anders als der Katalog')
      .toHaveLength(CLOUD_PITCH.openVideoModels)
    const ids = zeilen.map((zeile) => {
      const name = zeile.querySelector<HTMLElement>('[data-adult-model-id]')
      expect(name, 'eine Zeile ohne Modellanker').toBeTruthy()
      // Offen heisst im Katalog: die Id traegt spicy. Eine Zeile, die das
      // nicht tut, gehoert nicht in diese Tabelle.
      expect(name!.dataset.adultModelId).toMatch(/spicy$/)
      const preis = zeile.querySelector<HTMLElement>('[data-clip-credits]')
      expect(preis, `kein Clippreis fuer ${name!.dataset.adultModelId}`).toBeTruthy()
      const credits = Number(preis!.dataset.clipCredits)
      expect(credits, `Clippreis 0 fuer ${name!.dataset.adultModelId}`).toBeGreaterThan(0)
      // Der Leser sieht den Text, nicht das Attribut. Beide muessen stimmen.
      expect(preis!.textContent).toBe(credits.toLocaleString('en-US'))
      return name!.dataset.adultModelId
    })
    expect(new Set(ids).size, 'ein Modell steht zweimal in der Tabelle').toBe(ids.length)
  })

  it('und das Blatt liest die Zahl, statt sie zu tippen', () => {
    const blatt = lies('src/lib/release-notes.ts')
    expect(blatt, 'das Blatt tippt die offene Videozahl').toContain(
      '${CLOUD_PITCH.openVideoModels} video models and ${CLOUD_PITCH.openImageModels} image models',
    )
    expect(nenntSechsModelle(blatt), 'das Blatt zaehlt noch sechs').toBe(false)
  })

  /**
   * NEGATIVKONTROLLE. Ohne sie waere dieser Waechter auch dann gruen, wenn er
   * gar nichts erkennt: die drei Seiten sagen "six" naemlich weiterhin, nur
   * nicht ueber Modelle.
   */
  it('erkennt die alte Aussage und verwechselt sie mit nichts', () => {
    expect(nenntSechsModelle('Six video models and three image models without a built-in restriction')).toBe(true)
    expect(nenntSechsModelle('Six image-to-video endpoints and three image models run without a restriction')).toBe(true)
    expect(nenntSechsModelle('there is no eight second option on these six.')).toBe(true)
    expect(nenntSechsModelle('Adult video: the six models and what a clip costs')).toBe(true)
    // Und die Stellen, die "six" aus einem anderen Grund sagen, bleiben in Ruhe.
    expect(nenntSechsModelle('It needs two clicks within six seconds.')).toBe(false)
    expect(nenntSechsModelle('The desktop panel displays a six-digit passcode.')).toBe(false)
    expect(nenntSechsModelle('Six Steps to a Flux 2 Dev Image')).toBe(false)
  })
})
