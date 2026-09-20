/**
 * Senden und Stop gelten je Unterhaltung.
 *
 * Befund T1 (Box, 11.09.2026), Punkt 4 und Nebenfund 4: solange irgendwo eine
 * Antwort lief, verschwand der Sendeknopf in JEDER Unterhaltung, und der
 * Stop-Knopf in der zweiten brach die Erzeugung der ersten ab. Der Komposer
 * las eine einzige app-weite Fahne. Diese Datei nagelt die Aufteilung fest.
 *
 * Run: npx vitest run src/lib/__tests__/composer-busy.test.ts
 */
import { describe, it, expect } from 'vitest'
import { composerBusy } from '../composer-busy'

describe('composerBusy', () => {
  it('gives Stop to the chat that is answering and leaves the other one Send', () => {
    const map = { a: true }
    expect(composerBusy(true, map, 'a')).toEqual({ thisChat: true, otherChat: false })
    expect(composerBusy(true, map, 'b')).toEqual({ thisChat: false, otherChat: true })
  })

  it('says nothing at all while nothing runs', () => {
    expect(composerBusy(false, {}, 'a')).toEqual({ thisChat: false, otherChat: false })
    expect(composerBusy(false, { a: false }, 'a')).toEqual({ thisChat: false, otherChat: false })
  })

  it('keeps Stop on a run the map does not know about, rather than losing it', () => {
    // An orphaned run picked up after a reload, or the window between starting
    // a stream and registering it: the hook knows, the map does not yet. The
    // chat on screen keeps Stop, because a run nobody can stop is worse than a
    // Stop button one click too early.
    expect(composerBusy(true, {}, 'a')).toEqual({ thisChat: true, otherChat: false })
  })

  it('does not hand the chat on screen a Stop for a run that is somewhere else', () => {
    // The counter-case to the one above, and the whole point of the split.
    expect(composerBusy(true, { b: true }, 'a').thisChat).toBe(false)
  })

  it('lets a chat that is answering itself stay Stop while another one also runs', () => {
    expect(composerBusy(true, { a: true, b: true }, 'a')).toEqual({ thisChat: true, otherChat: false })
  })

  it('survives a chat list with no conversation open', () => {
    expect(composerBusy(true, { b: true }, null)).toEqual({ thisChat: false, otherChat: true })
    expect(composerBusy(false, {}, null)).toEqual({ thisChat: false, otherChat: false })
  })
})
