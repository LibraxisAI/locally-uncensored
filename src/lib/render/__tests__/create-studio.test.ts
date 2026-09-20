// Der Create-Tab und das Preset-Fenster bieten dieselben Modelle an.
//
// 19.09.2026, Entscheid von David: die neuen Endpunkte sollen auch in den
// Unterkategorien von Create waehlbar sein. Bis dahin kannte der normale
// Composer den Studio-Pfad ueberhaupt nicht, und die Unterkategorien zeigten
// eine eigene, aeltere Liste. Der Fall unten haelt beide Seiten zusammen.
//
// Desktop port (P2): 'video_upscale' ist im Web eine eigene Absicht, getrennt
// von 'upscale' (Bild-Upscale). Der Desktop kennt bislang nur ein einziges
// 'upscale' fuer Bild UND Video (aelterer Utility-Op-Pfad in createStore.ts,
// P5's Datei). StudioIntent in create-studio.ts ist der lokale Behelf dafuer;
// siehe die Notiz dort und den Bericht fuer P9.
import { describe, expect, it } from 'vitest'
import {
  intentPickerModels, intentRequiredInputs, intentRoleFor, intentRoles,
  isStudioModel, resolveIntentPick, createStudioCost, type StudioIntent,
} from '../create-studio'
import { STUDIO_MODELS } from '../studio-contract'
import { opPickerModels } from '../../../stores/cloudCatalogStore'
import type { CreateIntent } from '../../../stores/createStore'

const MIT_ROLLE: StudioIntent[] = ['lipsync', 'music', 'extend', 'motion', 'video_upscale']

describe('die Unterkategorien von Create fahren dieselben Modelle wie die Presets', () => {
  it('jede Unterkategorie mit einer Rolle hat eine Auswahl, und jedes Mitglied steht einmal drin', () => {
    for (const intent of MIT_ROLLE) {
      const list = intentPickerModels(intent)
      expect(list.length, intent).toBeGreaterThan(1)
      expect(new Set(list.map((m) => m.id)).size, intent).toBe(list.length)
    }
  })

  it('nimmt keiner Unterkategorie ein Modell weg, das sie vorher schon hatte', () => {
    // Die Regression, die beim Umbau am leichtesten passiert: die Rolle
    // ersetzt die alte Liste, statt sie zu erweitern.
    for (const [intent, op] of [['lipsync', 'lipsync'], ['music', 'music'], ['extend', 'extend'], ['motion', 'motion']] as const) {
      const jetzt = intentPickerModels(intent).map((m) => m.id)
      for (const alt of opPickerModels(op)) {
        // Ein klassischer Eintrag darf durch seinen Studio-Zwilling ersetzt
        // sein: dann faehrt derselbe Endpunkt, nur ueber die Registrierung.
        const zwilling = Object.entries(STUDIO_MODELS).find(([, m]) => m.sourceModel === alt.id)?.[0]
        expect(jetzt.includes(alt.id) || (!!zwilling && jetzt.includes(zwilling)), `${intent}/${alt.id}`).toBe(true)
      }
    }
  })

  it('bringt die neuen Endpunkte wirklich in ihre Unterkategorie', () => {
    const hat = (intent: StudioIntent, id: string) => intentPickerModels(intent).some((m) => m.id === id)
    for (const id of ['longcat-avatar', 'lipsync-3-avatar', 'seedance-2.5-avatar', 'heygen-twin']) {
      expect(hat('lipsync', id), id).toBe(true)
    }
    for (const id of ['minimax-music', 'mureka-song', 'eleven-music']) expect(hat('music', id), id).toBe(true)
    for (const id of ['wan-3.0-extend', 'seedance-2.5-extend', 'preset-wan-2.2-spicy-extend']) {
      expect(hat('extend', id), id).toBe(true)
    }
    expect(hat('motion', 'wan-2.2-animate-2')).toBe(true)
    for (const id of ['flashvsr', 'crystal-upscaler', 'video-upscaler-pro']) {
      expect(hat('video_upscale', id), id).toBe(true)
    }
  })

  it('laesst Enhance Video auf dem Endpunkt starten, auf dem es bisher lief', () => {
    // Ohne Auswahl lief diese Unterkategorie fest auf wavespeed-ai/video-upscaler.
    // Wer nichts waehlt, bekommt weiterhin genau den.
    expect(intentPickerModels('video_upscale')[0].id).toBe('video-upscaler')
    expect(resolveIntentPick('video_upscale', '')).toBe('video-upscaler')
    expect(STUDIO_MODELS['video-upscaler'].endpoint).toBe('wavespeed-ai/video-upscaler')
  })

  it('haelt eine gueltige Wahl fest und faengt eine fremde ab', () => {
    expect(resolveIntentPick('music', 'mureka-song')).toBe('mureka-song')
    // Eine Wahl aus einer anderen Unterkategorie darf nicht ueberleben.
    expect(resolveIntentPick('music', 'flashvsr')).toBe(intentPickerModels('music')[0].id)
    // Eine Absicht ohne Rolle laesst die Wahl unberuehrt.
    expect(resolveIntentPick('image', 'chroma')).toBe('chroma')
  })

  it('kennt zu jedem Mitglied die Rolle, die Eingaben und einen Preis groesser null', () => {
    for (const intent of MIT_ROLLE) {
      for (const m of intentPickerModels(intent)) {
        if (!isStudioModel(m.id)) continue
        expect(intentRoleFor(intent, m.id), `${intent}/${m.id}`).toBeTruthy()
        expect(intentRequiredInputs(intent, m.id), `${intent}/${m.id}`).toBeDefined()
        expect(createStudioCost(m.id, {}), `${intent}/${m.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('verlangt vom Presenter kein eigenes Foto, von den anderen schon', () => {
    // Genau die Unterscheidung, an der der Startknopf haengt.
    expect(intentRequiredInputs('lipsync', 'heygen-twin')).toEqual(['audio_path'])
    for (const id of ['longcat-avatar', 'seedance-2.5-avatar', 'lipsync-3-avatar']) {
      expect(intentRequiredInputs('lipsync', id).sort(), id).toEqual(['audio_path', 'source_path'])
    }
  })

  it('gibt keiner Absicht ohne Rolle eine Auswahl', () => {
    for (const intent of ['image', 'video', 'animate', 'edit', 'character', 'upscale'] as CreateIntent[]) {
      expect(intentRoles(intent), intent).toEqual([])
      expect(intentPickerModels(intent), intent).toEqual([])
    }
  })
})
