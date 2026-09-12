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

/**
 * R2-47: drei Zeilen, nie vier. Eine vierte Zeile faellt hier auf, bevor sie
 * an der Oberflaeche steht.
 */
describe('cloud pitch', () => {
  it('is exactly three lines', () => {
    expect(cloudPitchLines()).toHaveLength(3)
  })

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

  /**
   * R6-7: "12 of them" stand direkt hinter den 27 gemessenen Modellen und las
   * sich als genau die Schnittmenge aus gemessen-ohne-Ablehnung und
   * Flash-Klasse. Diese Schnittmenge ist NIRGENDS gemessen. Die Zeile nennt
   * deshalb den Katalog, auf den sich die 12 wirklich beziehen, und der
   * Rueckbezug darf nicht zurueckkommen.
   */
  it('never claims the intersection of the measured set and the free class', () => {
    // Die Schnittmenge, die niemand kennt. Sie steht hier als eigene Groesse,
    // damit sichtbar ist, dass sie fehlt und nicht etwa 12 ist.
    const SCHNITTMENGE_FLASH_UND_FULL: number | null = null
    expect(SCHNITTMENGE_FLASH_UND_FULL, 'ungemessen, also unbehauptbar').toBeNull()

    const line = cloudPitchLines()[1]
    expect(line).not.toMatch(/\bof them\b/i)
    expect(line).toContain(String(CLOUD_PITCH.chatModels))
    // Die Zeile davor traegt den Messnenner, diese den Katalog. Zwei Nenner,
    // zwei Mengen.
    expect(cloudPitchLines()[0]).toContain(String(CLOUD_PITCH.measuredChatModels))
  })

  it('claims nothing the catalogue cannot carry', () => {
    expect(CLOUD_PITCH.unfilteredChatModels).toBeLessThanOrEqual(CLOUD_PITCH.measuredChatModels)
    expect(CLOUD_PITCH.measuredChatModels).toBeLessThanOrEqual(CLOUD_PITCH.chatModels)
    expect(CLOUD_PITCH.flashModels).toBeLessThanOrEqual(CLOUD_PITCH.chatModels)
    // Gemessen wurde jedes Modell des Messlaufs genau einmal: ganz, teilweise
    // oder gar nicht. Markierte plus zurueckhaltende koennen den Messlauf
    // deshalb nicht ueberschreiten.
    expect(CLOUD_PITCH.unfilteredChatModels + CLOUD_PITCH.heldBackChatModels)
      .toBeLessThanOrEqual(CLOUD_PITCH.measuredChatModels)
    for (const line of cloudPitchLines()) expect(line).not.toMatch(/[–—]/u)
  })
})
