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
