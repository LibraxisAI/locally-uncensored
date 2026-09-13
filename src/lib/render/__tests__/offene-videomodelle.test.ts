/**
 * Die offenen Videomodelle im Notvorrat des Desktops.
 *
 * Zur Laufzeit kommt der Katalog von /api/jobs/catalog; CLOUD_MODEL_SEED ist
 * die Liste, die ein Build ohne Netz zeigt. Sie hinkte dem Web hinterher
 * (Bericht lu-300/e2e/6-nachlauf/bauer-w-katalog.md, 13.09.2026).
 *
 * Gezaehlt wird hier, nicht getippt: offen ist jeder Endpunkt, dessen Id
 * `spicy` traegt. So kennzeichnet der Anbieter seine Routen, und genau so
 * steht die Regel im Web. Eine abgeschriebene Liste von Ids muesste bei jedem
 * neuen Endpunkt von Hand nachgezogen werden und faende deshalb nie etwas.
 *
 * Run: npx vitest run src/lib/render/__tests__/offene-videomodelle.test.ts
 */
import { describe, expect, it } from 'vitest'
import { CLOUD_MODEL_SEED } from '../cloud-models'
import { i2vModels, t2vModels, useCloudCatalogStore } from '../../../stores/cloudCatalogStore'

const klassischeVideo = CLOUD_MODEL_SEED.filter((m) => m.kind === 'video' && !m.ops)
const offeneVideo = klassischeVideo.filter((m) => m.id.includes('spicy'))

describe('offene Videomodelle im Seed', () => {
  it('fuehrt welche, und die Trennung ist echt', () => {
    // Positivkontrolle: griffe der Filter ins Leere, pruefte jeder Fall unten
    // eine leere Menge und waere still gruen.
    expect(offeneVideo.length).toBeGreaterThan(0)
    expect(offeneVideo.length).toBeLessThan(klassischeVideo.length)
  })

  it('bietet keines als Text-zu-Video an, der Anbieter hat dafuer keinen Endpunkt', () => {
    for (const m of offeneVideo) {
      expect(m.t2v, m.id).toBe(false)
      expect(m.i2v, m.id).toBe(true)
    }
  })

  it('nennt keines nach dem, was es kann', () => {
    // Die Beschriftung steht im Waehler und damit auf einer Oberflaeche, die
    // an der Zahlungsbeziehung haengt. Die Id darf heissen, wie der Anbieter
    // sie nennt, die Beschriftung nicht.
    for (const m of offeneVideo) {
      expect(m.label, m.id).not.toMatch(/spicy|uncensored|nsfw|adult|nude|porn/i)
      expect(m.label, m.id).toMatch(/ Open$/)
    }
  })

  it('und keine einzige Beschriftung im Seed tut es, auch nicht hinter einem ops-Eintrag', () => {
    // wan-2.2-spicy-extend steht nicht in `offeneVideo`, weil es ueber `ops`
    // laeuft. Seine Beschriftung steht trotzdem im Waehler der Fortsetzung,
    // und sie hiess bis 13.09.2026 "Wan 2.2 Spicy Extend".
    for (const m of CLOUD_MODEL_SEED) {
      expect(m.label, m.id).not.toMatch(/spicy|uncensored|nsfw|adult|nude|porn/i)
    }
  })

  it('quotiert einen Preis und keinen 8-Sekunden-Knopf', () => {
    // Der Anbieter nennt fuer diese Routen nur den 5-Sekunden-Grundpreis. Ein
    // 8-Sekunden-Knopf haette eine Laenge versprochen, die der Worker nicht
    // rendert und die Preistabelle nicht kennt.
    for (const m of offeneVideo) {
      expect(m.credits?.base, m.id).toBeGreaterThan(0)
      expect(m.credits?.long, m.id).toBeUndefined()
      expect(m.clip, m.id).toEqual({ short: 5 })
    }
  })

  it('steht im Animate-Waehler und in keinem anderen', () => {
    useCloudCatalogStore.setState({ models: CLOUD_MODEL_SEED })
    const animate = i2vModels().map((m) => m.id)
    for (const m of offeneVideo) expect(animate, m.id).toContain(m.id)
    expect(t2vModels().filter((m) => m.id.includes('spicy'))).toEqual([])
  })

  it('nimmt seedance-2.0-mini-spicy nicht auf', () => {
    // Beschreibung und Grundpreis des Anbieters widersprechen sich bei dieser
    // einen Route. Der Fall haelt fest, dass sie draussen bleibt, damit sie
    // beim naechsten Abgleich nicht versehentlich nachwaechst.
    expect(CLOUD_MODEL_SEED.map((m) => m.id)).not.toContain('seedance-2.0-mini-spicy')
  })
})
