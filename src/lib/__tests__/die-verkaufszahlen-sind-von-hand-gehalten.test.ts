/**
 * Die Reissleine unter `CLOUD_PITCH`.
 *
 * R2-46: zwei Kommentare versprachen eine Automatik, die es nicht gibt.
 * `scripts/check-cloud-sales.mjs` haelt die sieben Zahlen gegen den Katalog im
 * Web-Repo, steht aber in keinem Workflow, in keiner `ci.yml` und in keinem
 * npm-Skript, weil es einen zweiten Checkout als Argument braucht. Es wird vor
 * einem Release von Hand gefahren, und ob es ins CI kommt, ist Entscheid David.
 *
 * Bis dahin haelt diese Datei die Stelle: dasselbe Muster wie die Reissleine
 * unter den Preisen (`pricing-page.test.ts`). Die Werte sind ausgeschrieben,
 * nicht aus der Konstante gelesen; eine Reissleine, die ihre Quelle liest,
 * reisst nie. Wer eine Zahl aendert, aendert sie zweimal, und die zweite
 * Aenderung ist die Stelle, an der er merkt, dass die andere Seite mitgehoert.
 *
 * Stand 3.0.0, Quelle der Zahlen ist der Satz von V6 vom 10.09.2026: 47 im
 * Katalog, 46 im Messlauf, 27 markiert.
 *
 * Run: npx vitest run src/lib/__tests__/die-verkaufszahlen-sind-von-hand-gehalten.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CLOUD_PITCH } from '../cloud-pitch'

/**
 * Die acht Felder, ausgeschrieben. Ein neuntes Feld gehoert hier als eigene
 * Zeile hinein, sonst faellt es durch.
 */
const ERWARTET = {
  chatModels: 47,
  measuredChatModels: 46,
  unfilteredChatModels: 27,
  heldBackChatModels: 4,
  flashModels: 12,
  flashDailyTokens: 500_000,
  imageModels: 10,
  videoModels: 11,
} as const

describe('die Zahlen des Wolkentors', () => {
  it('stehen auf dem Stand, den jemand von Hand gesetzt hat', () => {
    for (const [feld, wert] of Object.entries(ERWARTET)) {
      expect(CLOUD_PITCH[feld as keyof typeof ERWARTET], feld).toBe(wert)
    }
  })

  it('und kein Feld entkommt der Reissleine', () => {
    // Sonst waechst die Konstante um eine ungehaltene Zahl, und der Waechter
    // darueber meldet weiter alles in Ordnung. Wer ein Feld anlegt, schreibt
    // seinen Wert oben als eigene Zeile dazu.
    const ungehalten = Object.keys(CLOUD_PITCH).filter((k) => !(k in ERWARTET))
    expect(ungehalten, `neues Feld in CLOUD_PITCH, gehoert als Zeile nach ERWARTET: ${ungehalten.join(', ')}`)
      .toEqual([])
    const verschwunden = Object.keys(ERWARTET).filter((k) => !(k in CLOUD_PITCH))
    expect(verschwunden, `Feld weg, die Zeile in ERWARTET gehoert mit: ${verschwunden.join(', ')}`)
      .toEqual([])
  })

  it('bleiben in sich stimmig', () => {
    expect(ERWARTET.unfilteredChatModels).toBeLessThanOrEqual(ERWARTET.measuredChatModels)
    expect(ERWARTET.measuredChatModels).toBeLessThanOrEqual(ERWARTET.chatModels)
    expect(ERWARTET.flashModels).toBeLessThanOrEqual(ERWARTET.chatModels)
  })

  it('und kein Kommentar verspricht eine Automatik, die es nicht gibt', () => {
    // Die zweite Haelfte von R2-46: beide Kommentare behaupteten, der Waechter
    // im Skript falle bei einer Abweichung auf. Er laeuft nie von allein.
    for (const datei of ['cloud-pitch.ts', 'release-notes.ts']) {
      const src = readFileSync(resolve(__dirname, '..', datei), 'utf8')
      expect(src, datei).toContain('check-cloud-sales.mjs')
      expect(src, datei).toMatch(/VON HAND|BY HAND/)
      expect(src, datei).not.toContain('faellt dort auf')
      expect(src, datei).not.toContain('guard fails until both sides agree again')
    }
  })
})
