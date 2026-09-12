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
 * Stand 3.0.0: 47 im Katalog, 46 im Messlauf.
 *
 * ZWEI der Zahlen stehen NICHT hier, und das ist Absicht (Entscheid vom
 * 12.09.2026). `unfilteredChatModels` und `heldBackChatModels` haengen an der
 * strengen Regel, und deren Ergebnis liegt als Tabelle in
 * `src/lib/no-refusals-measurement.md`. Eine ausgeschriebene Markenzahl waere
 * genau der Fehler, den dieser Waechter verhindern soll: sie kann nicht laut
 * falsch sein, weil sie nur sich selbst bestaetigt. Der Waechter zaehlt
 * stattdessen die Zeilen der Messdatei. Wer die Marke verschieben will,
 * aendert die Messung, nicht die Zahl.
 *
 * Run: npx vitest run src/lib/__tests__/die-verkaufszahlen-sind-von-hand-gehalten.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CLOUD_PITCH } from '../cloud-pitch'

/**
 * Die sechs von Hand gehaltenen Felder, ausgeschrieben. Die zwei aus der
 * Messdatei stehen darunter. Ein neues Feld gehoert in eine der beiden Listen,
 * sonst faellt es durch.
 */
const ERWARTET = {
  chatModels: 47,
  measuredChatModels: 46,
  flashModels: 12,
  flashDailyTokens: 500_000,
  imageModels: 10,
  videoModels: 11,
} as const

/** Die Felder, deren Wert aus der Messdatei gezaehlt wird statt hier zu stehen. */
const AUS_DER_MESSDATEI = ['unfilteredChatModels', 'heldBackChatModels'] as const

/**
 * Die Zeilen der Messtabelle, eine je Modell.
 *
 * Kopf- und Trennzeile fallen heraus, weil ihre letzte Spalte keine Marke
 * traegt. Eine zerschossene Datei liefert damit null Zeilen, und die Erwartung
 * unten faellt darauf sofort durch.
 */
function messzeilen(): { id: string; marke: string }[] {
  const datei = readFileSync(resolve(__dirname, '..', 'no-refusals-measurement.md'), 'utf8')
  return datei.split('\n')
    .map(zeile => zeile.split('|').map(feld => feld.trim()))
    .filter(felder => felder.length === 6 && felder[0] === '' && ['full', 'partial', 'none'].includes(felder[4]))
    .map(felder => ({ id: felder[1], marke: felder[4] }))
}

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
    const ungehalten = Object.keys(CLOUD_PITCH).filter((k) => !(k in ERWARTET) && !AUS_DER_MESSDATEI.includes(k as typeof AUS_DER_MESSDATEI[number]))
    expect(ungehalten, `neues Feld in CLOUD_PITCH, gehoert als Zeile nach ERWARTET: ${ungehalten.join(', ')}`)
      .toEqual([])
    const verschwunden = Object.keys(ERWARTET).filter((k) => !(k in CLOUD_PITCH))
    expect(verschwunden, `Feld weg, die Zeile in ERWARTET gehoert mit: ${verschwunden.join(', ')}`)
      .toEqual([])
  })

  it('bleiben in sich stimmig', () => {
    expect(CLOUD_PITCH.unfilteredChatModels).toBeLessThanOrEqual(ERWARTET.measuredChatModels)
    expect(ERWARTET.measuredChatModels).toBeLessThanOrEqual(ERWARTET.chatModels)
    expect(ERWARTET.flashModels).toBeLessThanOrEqual(ERWARTET.chatModels)
  })

  it('und die Markenzahl kommt aus der Messdatei, nicht von hier', () => {
    // Der Entscheid vom 12.09.2026: die Marke gilt streng, also traegt sie
    // nur, wer in BEIDEN Laeufen beide Fragen beantwortet hat. Diese Zahl ist
    // gezaehlt, nicht gesetzt: faellt eine Zeile der Tabelle von `full` auf
    // `partial`, wird dieser Waechter rot, bis die Konstante nachzieht.
    const zeilen = messzeilen()
    expect(zeilen.length, 'Messtabelle unlesbar oder leer').toBe(ERWARTET.measuredChatModels)
    expect(new Set(zeilen.map(zeile => zeile.id)).size, 'ein Modell steht zweimal in der Messtabelle').toBe(zeilen.length)
    expect(CLOUD_PITCH.unfilteredChatModels, 'unfilteredChatModels gegen die full-Zeilen')
      .toBe(zeilen.filter(zeile => zeile.marke === 'full').length)
    expect(CLOUD_PITCH.heldBackChatModels, 'heldBackChatModels gegen die partial-Zeilen')
      .toBe(zeilen.filter(zeile => zeile.marke === 'partial').length)
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
