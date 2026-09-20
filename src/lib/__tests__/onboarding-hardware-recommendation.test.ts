/**
 * Auftrag: Qwen 3.5 9B in ONBOARDING_MODELS. Die Empfehlung soll auf
 * Hardware, die 9B traegt, auf 9B wechseln, sonst beim 7B-Starter bleiben.
 *
 * Wiederverwendet ist die Schwelle, die es in ModelsStep.tsx schon gibt:
 * `systemVRAM >= model.vramGB`, dieselbe Zahl, die dort die "may not
 * fit"-Warnung treibt. Keine neue Schwelle, nur derselbe Vergleich an einer
 * zweiten Stelle gelesen.
 *
 * Lauf: npx vitest run src/lib/__tests__/onboarding-hardware-recommendation.test.ts
 */
import { describe, it, expect } from 'vitest'
import { ONBOARDING_MODELS, recommendedOnboardingModelName } from '../constants'

describe('recommendedOnboardingModelName', () => {
  const SIEBEN_B = 'qwen2.5-7b'
  const NEUN_B = 'qwen3.5-9b'

  it('unbekannte Hardware (null) laesst den statisch markierten 7B-Starter stehen', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, null)).toBe(SIEBEN_B)
  })

  it('eine RTX 3060 mit 12 GB, die Hardware aus dem Auftrag, empfiehlt 9B', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, 12)).toBe(NEUN_B)
  })

  it('genau die 8 GB, die 9B selbst verlangt, empfehlen bereits 9B', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, 8)).toBe(NEUN_B)
  })

  // Negativkontrolle mit Zahlen: 7 GB traegt den 7B-Starter (Bedarf 6),
  // aber nicht 9B (Bedarf 8). Ohne diese Zeile koennte eine Funktion, die
  // immer NEUN_B zurueckgibt, die 12-GB- und die 8-GB-Zusicherung auch
  // bestehen.
  it('7 GB traegt den 7B-Starter, aber nicht 9B, und empfiehlt darum 7B', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, 7)).toBe(SIEBEN_B)
  })

  it('0 GB (Sonde fehlgeschlagen, aber nicht null) traegt keinen der beiden und faellt auf 7B zurueck', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, 0)).toBe(SIEBEN_B)
  })

  it('knapp unter dem 7B-Bedarf traegt keinen der beiden und faellt auf 7B zurueck', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, 5)).toBe(SIEBEN_B)
  })

  it('eine Liste ohne statisch Empfohlenes und ohne tragende Hardware liefert undefined', () => {
    const ohneEmpfehlung = ONBOARDING_MODELS.map(m => ({ ...m, recommended: false }))
    expect(recommendedOnboardingModelName(ohneEmpfehlung, 0)).toBeUndefined()
  })
})
