/**
 * Portiert aus dem Web (P1, Vertrag). Gekuerzt gegenueber dem Web-Original:
 * die Faelle zu CREATE_PRESETS/presetBaseCredits (create-presets.ts),
 * presetModels('duo') (preset-models.ts) und ownStudioPaths/probeDuration
 * (studio-prepare.ts, server, NICHT Teil des Desktops) haengen an Dateien,
 * die erst in P2 bzw. gar nicht in den Desktop kommen. Sie gehoeren, wo
 * sinnvoll, in die Testdatei ihres eigenen Pakets.
 *
 * Der Web-Fall "keeps API and worker definitions identical" vergleicht die
 * API-Kopie gegen die Worker-Kopie im selben Repo. Dafuer gibt es im Desktop
 * keine Entsprechung; stattdessen haelt der Fall unten die drei JSON-Dateien
 * byteidentisch gegen den Web-Worktree, wenn LU_STUDIO_WEB_REPO gesetzt ist,
 * und ueberspringt sonst sauber, denn der Web-Stand ist beweglich.
 *
 * Run mit Drift-Pruefung: LU_STUDIO_WEB_REPO=/pfad/zum/web npx vitest run \
 *   src/lib/render/__tests__/studio-contract.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { STUDIO_MODELS, studioSchema, studioOptions, studioCredits, supportsProviderField } from '../studio-contract'

const WEB = process.env.LU_STUDIO_WEB_REPO?.trim() ? resolve(process.env.LU_STUDIO_WEB_REPO.trim()) : undefined
if (!WEB) {
  process.stderr.write(
    '[studio-contract] Driftwaechter uebersprungen: LU_STUDIO_WEB_REPO ist nicht gesetzt.\n',
  )
}

describe('Cloud studio contracts', () => {
  describe.skipIf(!WEB)('haelt die Vertragsdaten byteidentisch gegen den Web-Worktree', () => {
    it.each(['studio-models.json', 'provider-schemas.json', 'provider-endpoints.json'])('%s', (f) => {
      const desktop = readFileSync(resolve('src/lib/render', f), 'utf8')
      const web = readFileSync(resolve(WEB!, 'apps/web/lib/render', f), 'utf8')
      expect(desktop).toBe(web)
    })
  })

  it.each(Object.keys(STUDIO_MODELS))('has a schema for %s', (id) => expect(studioSchema(id).properties).toBeTruthy())

  it('reads negative prompt support from endpoint schemas', () => {
    for (const id of ['wan-2.6-spicy', 'wan-2.7-spicy']) expect(supportsProviderField(id, 'negative_prompt', 'animate')).toBe(true)
    for (const id of ['wan-2.2-spicy', 'open-video']) expect(supportsProviderField(id, 'negative_prompt', 'animate')).toBe(false)
  })

  it('prices OpenVideo seconds and resolution', () => {
    expect(studioCredits('open-video', studioOptions('open-video', 'test', { duration: 20, resolution: '1080p' }))).toBe(120000)
    expect(studioCredits('open-video-lora', studioOptions('open-video-lora', 'test', { duration: 10, resolution: '720p' }))).toBe(50000)
  })

  it('rejects arbitrary URLs in curated LoRAs', () => {
    expect(() => studioOptions('open-video-lora', 'test', { loras: [{ path: 'https://evil.test/model' }] })).toThrow()
    expect(studioOptions('open-video-lora', 'test', { loras: [{ path: 'better_motion', scale: 1 }] }).loras).toBeTruthy()
  })

  it('validates options', () => {
    expect(studioOptions('open-video', 'test', {}).duration).toBe(5)
    for (const options of [{ duration: 100 }, { negative_prompt: 'x' }, { seed: NaN }]) expect(() => studioOptions('open-video', 'test', options)).toThrow()
    expect(studioOptions('scail-2', 'test', { mode: 'replace' }).mode).toBe('replace')
  })

  it('rounds measured duration and enforces input caps', () => {
    const o = studioOptions('infinitetalk', '', {})
    expect(studioCredits('infinitetalk', o, 1)).toBe(9000)
    expect(studioCredits('infinitetalk', o, 5.2)).toBe(18000)
    expect(() => studioCredits('infinitetalk', o)).toThrow()
    expect(() => studioCredits('infinitetalk', o, 601)).toThrow()
  })

  it('prices extra images and 2k', () =>
    expect(studioCredits('minimax-h3-edit', studioOptions('minimax-h3-edit', 'test', { resolution: '2k' }), undefined, 3)).toBe(10000))

  it('requires a valid Ditto style', () => {
    expect(() => studioOptions('wan-ditto', 'something', {})).toThrow()
    expect(studioOptions('wan-ditto', 'Watercolor', {}).resolution).toBe('480p')
  })
})

it('prices TTS per character above its minimum and preserves full WAN duration support', () => {
  expect(studioCredits('preset-qwen3-tts', studioOptions('preset-qwen3-tts', 'hello', {}), undefined, 1, 101)).toBe(505)
  expect(studioCredits('preset-qwen3-tts', studioOptions('preset-qwen3-tts', 'hello', {}), undefined, 1, 4000)).toBe(20000)
  for (const id of ['wan-3.0', 'wan-3.0-spicy']) for (const duration of [2, 3, 30]) expect(studioOptions(id, 'scene', { duration }).duration).toBe(duration)
  for (const duration of [1, 31]) expect(() => studioOptions('wan-3.0', 'scene', { duration })).toThrow()
})

import livePrices from './fixtures/studio-prices-2026-09-19.json'
it.each(livePrices)('matches live provider price for $model with $options', (row) => {
  const options = studioOptions(row.model, '', row.options, false)
  expect(studioCredits(row.model, options, row.seconds, 1, row.promptLength)).toBe(Math.round(row.usd * 100000))
})
