# Mock-Wuensche: Bereich create

Wave vom 2026-08-20. Alles hier betrifft `e2e/support/tauri-mock.ts`, das der
Bereichsagent nicht anfassen darf. Ohne diese Faehigkeiten bleiben 6 Elemente
`blocked`; mit ihnen sind alle 103 offenen Create-Elemente erreichbar.

## 1. Eine ComfyUI, die antwortet (blockiert 3 Elemente)

`proxy_localhost` lehnt heute jede ComfyUI-URL ab, deshalb ist `connected`
dauerhaft `false`. Damit sind alle Listen leer, die aus `/object_info/*`
kommen.

Gewuenscht: eine Option `comfy: { running?: true, loras?: string[],
vaes?: string[], checkpoints?: string[] }`. Bei `running: true` sollte
`proxy_localhost` fuer den ComfyUI-Host antworten:

- `/system_stats` mit einem beliebigen JSON-Objekt (nur die 200 zaehlt,
  `checkComfyConnection` prueft den Inhalt nicht)
- `/object_info/LoraLoader` mit
  `{"LoraLoader":{"input":{"required":{"lora_name":[[...loras]]}}}}`
- `/object_info/VAELoader`, `/object_info/CheckpointLoaderSimple`,
  `/object_info/KSampler` im gleichen Schema
- `/object_info` (ohne Knotennamen) mit einem Objekt, dessen Schluessel die
  vorhandenen Knotenklassen sind

Damit werden erreichbar:

- `create.lora.toggle` (der LoRA-Stack ist ohne Liste unsichtbar)
- `create.re-scan-comfyui.click` (`refreshModelLists` kehrt bei
  `connected !== true` sofort zurueck, der Klick hat heute keine Wirkung)
- `create.local-character.select` (die lokale Charakterablage liest
  `getLoraModels()`; ein Eintrag `char_davechar_zimage.safetensors` reicht)

## 2. Ein lokaler Videolauf ohne VHS_VideoCombine (blockiert 3 Elemente)

`VhsInstallModal` erscheint nur, wenn `useCreate` waehrend eines lokalen
Videolaufs `webpOnly` feststellt und `vhsInstallPrompt` im Store setzt. Dazu
braucht es einen kompletten ComfyUI-Renderpfad im Mock: `/prompt` nimmt den
Graph an, `/history/<id>` liefert ein Ergebnis, und `/object_info` kennt
`SaveAnimatedWEBP`, aber **nicht** `VHS_VideoCombine`.

Gewuenscht: Punkt 1 plus eine Option `comfy: { render?: 'ok' | 'webpOnly' }`,
die genau diesen Fall stellt.

Damit werden erreichbar:

- `create.vhs-install.confirm`
- `create.vhs-install.continue-webp`
- `create.vhs-install.cancel-generation`

## Was der Bereich selbst geloest hat, ohne den Mock anzufassen

Nur zur Information, damit niemand dieselben Loecher zweimal stopft:

- Verschiedene Auftraege pro Job: eigene Route in
  `e2e/support/journeys/create.ts` (`routeUniqueJobs`). Der geteilte
  Cloud-Mock vergibt immer dieselbe Job-id, wodurch zwei Renderergebnisse zu
  einem einzigen Galerieeintrag verschmelzen.
- Leeres Guthaben: `routeQuota`.
- Ein Auftrag, der nicht fertig wird (fuer Cancel): eigene Route im Spec.
- Cloud-Charakterablage `/api/loras`: eigene Route im Spec.
- Videos und Tonspuren in der Galerie: `seedGallery` schreibt den
  persistierten `create-store`, so wie die App ihn selbst schreibt.
