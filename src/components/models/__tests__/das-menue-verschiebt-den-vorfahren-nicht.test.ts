/**
 * Alt-Fehler (gefunden waehrend der Flash-Popup-Arbeit, Runde 4, 19.09.2026):
 * bei 360px Fensterbreite hinterliess der Modellwaehler nach einer Wahl ein
 * `scrollLeft` auf dem `overflow-hidden`-Vorfahren, der Verlauf UND Composer
 * umschliesst (`ChatView.tsx`). Ursache: das Menue haengt (hing) an
 * `position: absolute`, fest `right-0`/`left-1/2 -translate-x-1/2`, ohne jede
 * Fenstermessung; bei 360px reichte die Summe der Composer-Knoepfe laengst
 * nicht mehr in die verfuegbare Breite, der Ausloeser stand teilweise oder
 * ganz ausserhalb des sichtbaren Bereichs, und ein Klick darauf holte der
 * Browser ihn mit `scrollLeft` auf dem gemeinsamen Vorfahren "in Sicht".
 *
 * Die numerische, echte Playwright-Messung (scrollLeft bleibt 0 bei 360,
 * 900, 1280px, plus Negativkontrolle) steht in
 * `e2e/model-selector-scroll-leak.spec.ts`, hier nur der pure Teil, der ohne
 * DOM testbar ist: die Klemmrechnung selbst.
 */
import { describe, it, expect } from 'vitest'
import { clampMenuLeft } from '../ModelSelector'

describe('clampMenuLeft, die horizontale Klemme des Modell-Menues', () => {
  it('bleibt beim natuerlichen Rand, wenn genug Platz da ist', () => {
    expect(clampMenuLeft(20, 1200, 288)).toEqual({ left: 20, width: 288 })
  })

  it('schiebt das Menue nach rechts, statt links aus der Flaeche zu laufen', () => {
    // Ausloeser nahe der linken Kante, Menue 288px breit: mit `right-0`
    // haette es weit ins Negative gereicht, ueber die linke Kante hinaus.
    const { left, width } = clampMenuLeft(-150, 268, 288)
    expect(left).toBeGreaterThanOrEqual(8 - 0.001)
    expect(width).toBeLessThanOrEqual(268)
  })

  it('schiebt das Menue nach links, statt rechts aus der Flaeche zu laufen', () => {
    const { left, width } = clampMenuLeft(300, 360, 288)
    expect(300 + width).toBeGreaterThan(360) // der unbeschnittene Fall waere ausserhalb
    expect(left + width).toBeLessThanOrEqual(360 - 8 + 0.001)
  })

  it('schrumpft die Breite, statt einen negativen Rand zu verlangen, wenn selbst 2 * Rand mehr ist als die Flaeche', () => {
    const { width } = clampMenuLeft(10, 100, 288)
    expect(width).toBe(100 - 8 * 2)
  })

  it('haelt mindestens den Rand zur linken Kante der schneidenden Flaeche ein', () => {
    const { left, width } = clampMenuLeft(-500, 268, 288)
    expect(left).toBeGreaterThanOrEqual(8 - 0.001)
    expect(width).toBeLessThanOrEqual(268)
  })

  it('bei 360px (die reale Messung): der Ausloeser rechts bei ~208, das Menue bleibt vollstaendig innerhalb 0..268', () => {
    // Reale Zahlen aus dem eigenen Repro bei 360px (CSS-Pixel, Zoom bereits
    // herausgerechnet): Ausloeser-Rechteck endet bei rechts=181,7 relativ zur
    // schneidenden Flaeche, deren Breite 233px betraegt.
    const { left, width } = clampMenuLeft(181.7 - 288, 233, 288)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(left + width).toBeLessThanOrEqual(233 + 0.001)
  })
})
