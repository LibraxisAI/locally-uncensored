/**
 * Portiert aus dem Web (P1, Vertrag), dd29f359. Der Web-Fall "covers every
 * advertised classic video and has a price for every long choice" haengt an
 * CLOUD_MODELS und MEDIA_MODEL_USD aus lib/billing/credits, das es im Desktop
 * nicht gibt (Preise kommen aus dem Katalog, nicht aus einer eigenen Tabelle).
 * Diese Deckung gehoert in P3, sobald CloudModel.clip.durations im
 * Desktop-Katalogtyp steht.
 *
 * Der Web-Fall "keeps the worker contract byte-identical to the API
 * contract" vergleicht API- gegen Worker-Kopie im selben Repo; dafuer gibt es
 * im Desktop keine Entsprechung. Stattdessen haelt der Fall unten
 * video-durations.json byteidentisch gegen den Web-Worktree, wenn
 * LU_STUDIO_WEB_REPO gesetzt ist, und ueberspringt sonst sauber.
 *
 * Run mit Drift-Pruefung: LU_STUDIO_WEB_REPO=/pfad/zum/web npx vitest run \
 *   src/lib/render/__tests__/video-duration.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bookedVideoSeconds, videoDurations } from '../video-duration'

const WEB = process.env.LU_STUDIO_WEB_REPO?.trim() ? resolve(process.env.LU_STUDIO_WEB_REPO.trim()) : undefined
if (!WEB) {
  process.stderr.write(
    '[video-duration] Driftwaechter uebersprungen: LU_STUDIO_WEB_REPO ist nicht gesetzt.\n',
  )
}

describe('priced video duration contract', () => {
  describe.skipIf(!WEB)('haelt video-durations.json byteidentisch gegen den Web-Worktree', () => {
    it('video-durations.json', () => {
      const desktop = readFileSync(resolve('src/lib/render/video-durations.json'), 'utf8')
      const web = readFileSync(resolve(WEB!, 'apps/web/lib/render/video-durations.json'), 'utf8')
      expect(desktop).toBe(web)
    })
  })

  it.each([0, -1, NaN, Infinity, '8'])('rejects invalid frame count %s', (frames) => {
    expect(() => bookedVideoSeconds('wan-2.2-720p', { frames, fps: 16 })).toThrow()
  })

  it('preserves older frame buckets only for supported lengths', () => {
    expect(bookedVideoSeconds('wan-2.2-720p', { frames: 121, fps: 16 })).toBe(8)
    expect(() => bookedVideoSeconds('wan-2.7-spicy', { frames: 121, fps: 16 })).toThrow()
    expect(bookedVideoSeconds('wan-2.7-spicy', { duration: 10 })).toBe(10)
    expect(bookedVideoSeconds('wan-2.7-spicy', { frames: 120, fps: 8 })).toBe(15)
    expect(() => bookedVideoSeconds('missing', {})).toThrow()
  })

  it('exposes the durations file directly, since P3 does not wire CLOUD_MODELS yet', () => {
    expect(videoDurations('wan-2.2-720p')).toEqual([5, 8])
    expect(videoDurations('missing')).toEqual([])
  })
})
