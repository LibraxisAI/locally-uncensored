import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const read = (name: string) => JSON.parse(readFileSync(`src-tauri/${name}`, 'utf8'))
const base = read('tauri.conf.json')

for (const platform of ['windows', 'linux', 'macos']) {
  it(`${platform} release metadata preserves setup and network qualifications`, () => {
    const platformConfig = read(`tauri.${platform}.conf.json`)
    const release = read('tauri.release.conf.json')
    const bundle = { ...base.bundle, ...platformConfig.bundle, ...release.bundle }
    expect(bundle.shortDescription).toContain('optional cloud inference')
    for (const phrase of ['compatible hardware and downloaded models',
      'additional backends or runtime components', 'sends requests to hosted services',
      'usage limits, billing and content restrictions', 'tool permissions and data destination']) {
      expect(bundle.longDescription).toContain(phrase)
    }
    expect(`${bundle.shortDescription} ${bundle.longDescription}`).not.toMatch(
      /[\u2013\u2014]|zero setup|no external software|no data leaves|entirely on your own machine|\d+ tools|\d+ optional local backends/i,
    )
  })
}

/**
 * T8 hat am 11.09. `apt show locally-uncensored` auf Ubuntu 22.04 und 26.04
 * gelesen und im ganzen Kopf gezaehlt: GPU 0 Treffer, VRAM 0, RAM 0, GB 0,
 * CPU 0. Zur Hardware stand genau ein Satzteil da, "Local inference requires
 * compatible hardware and downloaded models", also kein Mass, an dem jemand
 * vor dem Herunterladen erkennen kann, ob seine Kiste reicht.
 *
 * Die Zahlen sind nicht geschaetzt, sie stehen geschrieben: die
 * Systemvoraussetzungen der Download-Seite von lu-labs.ai nennen
 * "8 GB min . 16 GB rec." und "NVIDIA 6 GB+" mit dem Zusatz, dass eine Karte
 * nur fuer Bild und Video noetig ist. Dieselben zwei Zahlen stehen in diesem
 * Repo auf locallyuncensored.com, und genau dagegen prueft dieser Waechter:
 * eine Zahl in der Paketbeschreibung, die dort nicht steht, faellt auf.
 */
it('die Paketbeschreibung nennt Hardware, und zwar die geschriebene', () => {
  const beschreibung: string = base.bundle.longDescription
  expect(beschreibung).toContain('8 GB of system memory')
  expect(beschreibung).toContain('6 GB of VRAM')

  const quelle = readFileSync('docs/llms-full.txt', 'utf8')
  expect(quelle).toContain('8 GB RAM')
  expect(quelle).toContain('6 GB VRAM')

  // Gegenkontrolle: der Waechter kann eine erfundene Zahl auch sehen.
  expect(quelle).not.toContain('64 GB VRAM')
})
