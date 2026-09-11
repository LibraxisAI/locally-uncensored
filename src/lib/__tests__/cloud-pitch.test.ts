/**
 * Das Argument des Wolkenschalters.
 *
 * Die Zahlen selbst haengen an scripts/check-cloud-sales.mjs, das sie gegen
 * den Katalog im Web-Repo haelt. Hier steht, was die Zeilen SAGEN muessen:
 * die richtige Reihenfolge, kein Versprechen ohne Bedingung, keine Zahl, die
 * nicht aus der Konstante kommt.
 */
import { describe, expect, it } from 'vitest'
import { CLOUD_PITCH, cloudPitchLines } from '../cloud-pitch'

describe('cloud pitch', () => {
  it('leads with what the models may do, then the price, then the equipment', () => {
    const [first, second, third] = cloudPitchLines()
    expect(first).toMatch(/without refusing/i)
    expect(second).toMatch(/no credits/i)
    expect(third).toMatch(/image and .* video/i)
  })

  it('never promises unmetered without naming the paid plan and the ceiling', () => {
    const line = cloudPitchLines()[1]
    expect(line).toMatch(/paid plan/i)
    expect(line).toContain(CLOUD_PITCH.flashDailyTokens.toLocaleString('en-US'))
  })

  it('calls the measurement a measurement', () => {
    expect(cloudPitchLines()[0]).toMatch(/measured, not guessed/i)
  })

  it('takes every number from the constant, never from a typed-out string', () => {
    const doubled = cloudPitchLines({
      ...CLOUD_PITCH,
      unfilteredChatModels: CLOUD_PITCH.unfilteredChatModels + 1,
      imageModels: CLOUD_PITCH.imageModels + 1,
    })
    expect(doubled[0]).toContain(String(CLOUD_PITCH.unfilteredChatModels + 1))
    expect(doubled[2]).toContain(String(CLOUD_PITCH.imageModels + 1))
  })

  it('claims nothing the catalogue cannot carry', () => {
    expect(CLOUD_PITCH.unfilteredChatModels).toBeLessThanOrEqual(CLOUD_PITCH.measuredChatModels)
    expect(CLOUD_PITCH.measuredChatModels).toBeLessThanOrEqual(CLOUD_PITCH.chatModels)
    expect(CLOUD_PITCH.flashModels).toBeLessThanOrEqual(CLOUD_PITCH.chatModels)
    for (const line of cloudPitchLines()) expect(line).not.toMatch(/[–—]/u)
  })
})
