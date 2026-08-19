# Schleife, Element 1: layout.dismiss.click-4 (Stale-Chip-Dismiss)

Stand 19.08.2026, WIP. Spec liegt in e2e/stale-chip-dismiss.spec.ts,
Mock-Option `ollamaModels` ist in tauri-mock.ts eingebaut (Commit folgt
mit dem Element). Der Bug ist per Code-Lesen bestaetigt: Header.tsx:242
setzt nur lokalen State, der Effekt ab Header.tsx:114 baut den Chip aus
dem Health-Store sofort wieder auf.

Precondition-Erkenntnisse (teuer erarbeitet, nicht wegwerfen):
- Ollama-Modelle tragen KEINEN Provider-Praefix (prefixModelName).
- Ein geseedeter activeModel wird von der Boot-Logik ueberstimmt: der
  Mock meldet die Built-in-Engine als running+loaded, die App adoptiert
  sie. setModels-Validierung ersetzt den Seed.
- Ollama kommt nur in die Modellliste, wenn lu-providers den Provider
  enabled hat (voller Objekt-Seed noetig, merge ist auf Provider-Ebene
  flach).
- Der Health-Scan laeuft 3 s nach Boot, checkConnection geht ueber
  /tags (der Mock antwortet), der Scan wuerde den Health-Seed also
  ueberschreiben. Spec setzt den app-eigenen Session-Marker
  lu-model-health-scan-done, das ist der legitime Zustand "Scan lief
  schon".

NAECHSTER ANSATZ (statt Seeds gegen die Boot-Logik zu stemmen): das
Modell wie ein echter Nutzer im Header-Modellpicker waehlen. Der
Auto-Load des gewaehlten Ollama-Modells schlaegt im Mock fehl
(/api/generate rejected), und src/lib/sync-ollama-health.ts:33 traegt
das Modell dann selbst in den Health-Store ein, das ist exakt der
Produktionspfad, der den Chip erzeugt. Danach Dismiss klicken, Chip
muss wegbleiben (Test aktuell rot erwartet), dann den App-Fix bauen:
Dismiss merkt sich das Modell session-lokal (dismissed-Set im Header),
der Effekt respektiert es. Vorher pruefen, auf welche Fehlerarten
sync-ollama-health anspringt.
