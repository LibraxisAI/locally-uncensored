/**
 * Der Notvorrat des Desktops gegen den Katalog des Webs.
 *
 * Zur Laufzeit ist /api/jobs/catalog die Wahrheit, CLOUD_MODEL_SEED ist nur
 * die Liste ohne Netz. Genau deshalb faellt ein Rueckstand hier nicht auf:
 * der Seed lag zehn Videomodelle hinter dem Web, ohne dass irgendetwas rot
 * wurde. Dieser Waechter haelt die Zeilen, die beide Seiten fuehren, Wort fuer
 * Wort und Zahl fuer Zahl gegeneinander.
 *
 * Verglichen wird die klassische Liste (ohne `ops`), denn nur die steht in den
 * Waehlern: Ids und Beschriftungen bei Bild und Video, dazu bei den offenen
 * Videomodellen die Flags und der Preis aus MEDIA_MODEL_USD des Webs. Die
 * fuenf alten Videomodelle fuehren im Seed bis heute keinen Preis, das ist
 * Altbestand und nicht Gegenstand dieses Laufs.
 *
 * Ohne Web-Checkout wird uebersprungen statt falsch gruen zu sein. Wo er
 * liegt, sagt LU_WEB_REPO; daneben werden die ueblichen Nachbarpfade probiert.
 *
 * Run: LU_WEB_REPO=/pfad/zum/web npx vitest run \
 *   src/lib/render/__tests__/katalog-paritaet-web.test.ts
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CLOUD_MODEL_SEED } from '../cloud-models'

const KANDIDATEN = [
  ...(process.env.LU_WEB_REPO?.trim() ? [resolve(process.env.LU_WEB_REPO.trim())] : []),
  resolve(process.cwd(), '../lu-300-web-katalog'),
  resolve(process.cwd(), '../lu-300-web'),
]
const WEB = KANDIDATEN.find((p) => existsSync(resolve(p, 'apps/web/lib/render/cloud-models.ts')))
if (!WEB) {
  process.stderr.write(
    '[katalog-paritaet] uebersprungen: kein Web-Checkout gefunden. Gesucht in: ' +
      KANDIDATEN.join(' | ') +
      '. Setze LU_WEB_REPO, damit der Paritaetswaechter laeuft.\n',
  )
}

/** Ein Credit kostet uns 0,00001 Dollar (Web: CREDIT_USD). */
const CREDIT_USD = 1e-5

/** Kommentare raus, Zeilenumbrueche weg: danach ist jede Zeile ein Objekt. */
function ohneKommentare(text: string): string {
  return text
    .split('\n')
    .map((z) => z.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
}

interface WebZeile {
  id: string
  label: string
  kind: string
  t2v?: boolean
  i2v?: boolean
  adult?: boolean
  ops?: boolean
}

/** Die Eintraege aus CLOUD_MODELS des Webs, ohne TypeScript zu laden. */
function webKatalog(): WebZeile[] {
  const datei = readFileSync(resolve(WEB!, 'apps/web/lib/render/cloud-models.ts'), 'utf8')
  const start = datei.indexOf('export const CLOUD_MODELS')
  const ende = datei.indexOf('\n]', start)
  const rumpf = ohneKommentare(datei.slice(start, ende))
  const out: WebZeile[] = []
  for (const treffer of rumpf.matchAll(/\{[^{}]*\}/g)) {
    const roh = treffer[0]
    const id = /id: '([^']+)'/.exec(roh)?.[1]
    const label = /label: '([^']+)'/.exec(roh)?.[1]
    const kind = /kind: '([^']+)'/.exec(roh)?.[1]
    if (!id || !label || !kind) continue
    out.push({
      id,
      label,
      kind,
      t2v: /t2v: (true|false)/.exec(roh)?.[1] === 'true' ? true : /t2v: false/.test(roh) ? false : undefined,
      i2v: /i2v: (true|false)/.exec(roh)?.[1] === 'true' ? true : /i2v: false/.test(roh) ? false : undefined,
      adult: /adult: true/.test(roh),
      ops: /ops: \[/.test(roh),
    })
  }
  return out
}

/** MEDIA_MODEL_USD des Webs: der Einkaufspreis je Lauf, in Dollar. */
function webPreise(): Record<string, { base: number; long?: number; lora?: number }> {
  const datei = readFileSync(resolve(WEB!, 'apps/web/lib/billing/credits.ts'), 'utf8')
  const start = datei.indexOf('export const MEDIA_MODEL_USD')
  const ende = datei.indexOf('\n}', start)
  const rumpf = ohneKommentare(datei.slice(start, ende))
  const out: Record<string, { base: number; long?: number; lora?: number }> = {}
  for (const treffer of rumpf.matchAll(/'([^']+)': \{([^}]*)\}/g)) {
    const zahl = (feld: string) => {
      const m = new RegExp(`${feld}: ([0-9.]+)`).exec(treffer[2])
      return m ? Number(m[1]) : undefined
    }
    const base = zahl('base')
    if (base === undefined) continue
    out[treffer[1]] = { base, long: zahl('long'), lora: zahl('lora') }
  }
  return out
}

const credits = (usd: number) => Math.ceil(usd / CREDIT_USD)

describe.skipIf(!WEB)('Katalogparitaet Desktop gegen Web', () => {
  const klassischWeb = () => webKatalog().filter((m) => !m.ops)
  const klassischSeed = CLOUD_MODEL_SEED.filter((m) => !m.ops)

  it('liest den Web-Katalog ueberhaupt', () => {
    // Positivkontrolle: ginge der Ausdruck ins Leere, waere jeder Vergleich
    // unten ein Vergleich zweier leerer Listen.
    expect(webKatalog().length).toBeGreaterThan(40)
    expect(Object.keys(webPreise()).length).toBeGreaterThan(30)
  })

  it('fuehrt dieselben Bildmodelle, in derselben Reihenfolge und mit denselben Namen', () => {
    const web = klassischWeb().filter((m) => m.kind === 'image')
    const seed = klassischSeed.filter((m) => m.kind === 'image')
    expect(seed.map((m) => m.id)).toEqual(web.map((m) => m.id))
    expect(seed.map((m) => m.label)).toEqual(web.map((m) => m.label))
  })

  it('fuehrt dieselben Videomodelle, in derselben Reihenfolge und mit denselben Namen', () => {
    const web = klassischWeb().filter((m) => m.kind === 'video')
    const seed = klassischSeed.filter((m) => m.kind === 'video')
    expect(seed.map((m) => m.id)).toEqual(web.map((m) => m.id))
    expect(seed.map((m) => m.label)).toEqual(web.map((m) => m.label))
  })

  it('gibt den offenen Videomodellen dieselben Faehigkeiten und denselben Preis', () => {
    const preise = webPreise()
    const offenWeb = klassischWeb().filter((m) => m.kind === 'video' && m.adult)
    expect(offenWeb.length).toBeGreaterThan(0)
    for (const w of offenWeb) {
      const s = CLOUD_MODEL_SEED.find((m) => m.id === w.id)
      expect(s, w.id).toBeDefined()
      expect(s!.t2v, w.id).toBe(false)
      expect(s!.i2v, w.id).toBe(true)
      expect(preise[w.id], w.id).toBeDefined()
      expect(s!.credits?.base, w.id).toBe(credits(preise[w.id].base))
      // Kein 8-Sekunden-Satz im Web, also auch keiner hier.
      expect(preise[w.id].long, w.id).toBeUndefined()
      expect(s!.credits?.long, w.id).toBeUndefined()
      expect(s!.clip, w.id).toEqual({ short: 5 })
    }
  })

  it('beschriftet die offenen Sonderendpunkte wie das Web', () => {
    // Die Endpunkte mit `ops` stehen in keiner klassischen Liste, aber sehr
    // wohl im Waehler ihrer Kategorie. wan-2.2-spicy-extend hiess im Desktop
    // noch "Wan 2.2 Spicy Extend", im Web laengst "Wan 2.2 Open Extend".
    const sonder = webKatalog().filter((m) => m.ops && m.id.includes('spicy'))
    expect(sonder.length).toBeGreaterThan(0)
    for (const w of sonder) {
      const s = CLOUD_MODEL_SEED.find((m) => m.id === w.id)
      expect(s, w.id).toBeDefined()
      expect(s!.label, w.id).toBe(w.label)
      expect(s!.ops, w.id).toBeDefined()
    }
  })

  it('kennt dieselben offenen Bildmodelle wie das Web', () => {
    // Der Desktop traegt die Marke nicht selbst (die Katalogroute liefert das
    // Feld nicht). Welche Bildmodelle offen sind, sagt also das Web, und der
    // Seed muss sie als klassische Bildmodelle fuehren.
    const offenBild = klassischWeb().filter((m) => m.kind === 'image' && m.adult)
    expect(offenBild.length).toBeGreaterThan(0)
    for (const w of offenBild) {
      const s = CLOUD_MODEL_SEED.find((m) => m.id === w.id)
      expect(s, w.id).toBeDefined()
      expect(s!.kind, w.id).toBe('image')
      expect(s!.ops, w.id).toBeUndefined()
    }
  })
})
