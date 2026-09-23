# **CEL — Dokończyć budowę aplikacji LU Mac Desktop w trybie lokalnym**

Zlecenie David 2026-07-22: Dokończyć tryb lokalny aplikacji Mac (Cloud gotowy).
Każda funkcja **Chat / Agent / Coding** + każde narzędzie przetestowane osobno, długie sesje,
5 licencjonowanych + 5 niescenzurowanych modeli obrazów i 5 licencjonowanych + 5 niescenzurowanych modeli wideo
uruchomione po razie. **Twarda zasada:** Media na Mac = **tylko MLX, NIGDY ComfyUI**.
Decyzja Davida: całkowicie przebudować MLX-Media.

Gałąź: `feat/mac-local-mode` (z `release/2.5.7-merged`). Commit na każdy krok, bez push.
Legenda: `[ ]` otwarte · `[~]` w trakcie · `[x]` zielone (zweryfikowane) · `[!]` zablokowane / uczciwy limit

---

## **Faza 1 — Fundament (Un-wall + działająca lokalna aplikacja)**

### 1.1 **Zdjąć blokadę** `[~]`
- `isCloudOnly()` → false (14 bramek przełączalnych)
- Martwe gałęzie usunąć = otwarte (commit porządkujący)

#### 1.1.1 **Migracja v14** `[x]`
- Wymuszone `cloud` na Mac przywrócone jednorazowo do `local` (settingsStore)

### 1.2 **tsc / vitest** `[x]`
- `tsc` (`tsconfig.app.json`) Baseline-Diff = 0 nowych błędów (331 baza bez zmian)
- `vitest` dot. Stores 108 zielonych

#### 1.2.1 **Test jednostkowy migracji v14** `[x]`
- Plik: `settingsStore-migrate-v14.test.ts`
- 4/4 zielone (Mac cloud→local, Win zostaje cloud, v14-cloud zostaje, Personas przebudowane)
- Commit: `b261e9d`

### 1.3 **e2e-Specs** `[ ]`
- Dostosowane do nowego stanu, zielone

### 1.4 **Start lokalny aplikacji** `[~]`
- `tauri:dev` działa (v2.5.7)
- Local-Onboarding renderuje (UI-Smoke :5173)
- Switch/Local live do potwierdzenia

### 1.5 **Dowód działania lokalnej inferencji** `[~]`
- Ollama :11434 (qwen2.5:0.5b) → „LOCAL OK”
- Po restarcie Rust: aplikacja startuje w lokalnym (bez `[Offload] cloud`)
- **TODO:** Pobranie Builtin-Engine-GGUF (Faza 2.4)

### 1.6 **ComfyUI connect-only on Mac (default 8080)** `[~]`
- Spawn/install stay refused (`comfy_supported_here`). Connecting to an already-running instance is the goal.
- Default listen port on macOS is 8080 (elsewhere 8188). Settings Host/Port persist via `set_comfyui_port`. Health probes live `comfy_port`, not a zombie :8188.

### 1.7 **Modele na /workspace (config `models_root`)** `[~]`
- Rust: `os_paths::configured_models_root()` (config.json `models_root` → env `LU_MODELS_ROOT` → domyślne ścieżki bez zmian)
- `mlx.rs` `hf_home()` → `<root>/hf-home` (3× HF_HOME + `image_model_cache_dir`); venv ZOSTAJE w lu-labs (absolute shebangi)
- `video.rs` `models_root()` → `<root>/mlx-video`; `engine.rs` `builtin_models_dir()` → `<root>/builtin-models`
- Testy: 5 nowych w os_paths + 1 w mlx; pełny `cargo test` 546/546 zielonych
- config.json zapisany: `"models_root": "/workspace/lu-models"`; builtin-models (80 MB) przeniesione
- Settings UI: `ModelsRootSetting` writes `models_root` (folder picker + path). `get_models_root` returns the config key only (empty = defaults).
- 2026-09-23: config przez chwilę wskazywał `/workspace/shared-models` (tam lądowały nowe modele). Skonsolidowane z powrotem do `lu-models`: `hf-home` (27 GB, 5 modeli obrazów), `mlx-video` (78 GB, wan21/wan22), `builtin-models` (nomic-embed GGUF). W `vibecrafted-models` zostały symlinki `hf-home`/`mlx-video`/`builtin-models` → `../lu-models/…`. Backup configu: `config.json.bak-20260923`.
- ComfyUI (zewnętrzny, :8080) czyta `/workspace/comfy-models/*` — przeniesienie go nie dotyczy. `custom_model_dir` (HF download override) dalej = `vibecrafted-models`.
- **TODO:** weryfikacja live w buildzie 3.0.0 (Models ✓ + render sd-turbo + built-in engine widzi GGUF), potem decyzja o duplikatach: `lu-models/hf-home.stale-20260923` (8 GB, stara kopia NSFW-gen-v2) i `lu-labs/mlx/cache` (4,9 GB, ta sama)
- Build 3.0.0 z tego brancha czyta `models_root`; uwaga o 2.6.7 ignorującym `models_root` jest nieaktualna

---

## **Faza 2 — Lokalny Chat**

### 2.1 **Chat streamuje tokeny** `[ ]`
- Przez Builtin-Engine (Qwen)

### 2.2 **Think-Toggle** `[ ]`
- Tam, gdzie wspierane

### 2.3 **Zmiana modelu (2. model)** `[ ]`

### 2.4 **Discover-Download dla Builtin-Engine** `[~]`
- **Commit:** `39d2f06`
- `detect_model_path` akceptuje aliasy nazw wyświetlanych
- `DiscoverModels` ma gałąź Built-in (flat write → uruchomienie silnika)
- `tsc` / `cargo` zielone
- Live „2. Model ładuje” = po przebudowie

### 2.5 **Kierunek Faza-6 (Bridge-MLX vs In-Process-MLX)** `[ ]`
- Recon-Agent mapuje architekturę lu-bridge
- Czekać na wynik, POTEM planować Fazę 6

### 2.6 **Długie sesje** `[ ]`
- Stabilny multi-turn chat

---

## **Faza 3 — Tryb Agenta: każde narzędzie osobno (29 Builtin + MCP)**

### 3.1 **Web (auto)**
- [ ] web*_search
- [ ] web_*fetch

### 3.2 **Filesystem**
- [ ] file*_read
- [ ] file_*write
- [ ] file*_list
- [ ] file_*search

### 3.3 **Terminal**
- [ ] shell*_execute
- [ ] code_*execute
- [ ] shell*_execute_*background
- [ ] shell*_task_*status
- [ ] shell*_task_*kill
- [ ] shell*_task_*list

### 3.4 **Git**
- [ ] git*_status
- [ ] git_*commit
- [ ] git*_push
- [ ] git_*log
- [ ] git_diff

### 3.5 **Dev**
- [ ] project*_init
- [ ] pr_*resume
- [ ] gh*_pr_*create
- [ ] run_tests

### 3.6 **System**
- [ ] system*_info
- [ ] process_*list
- [ ] get*_current_*time

### 3.7 **Desktop** `[~]`
- screenshot — nowa implementacja macOS (`/usr/sbin/screencapture`)
  - Kompiluje się
  - Live-zielone wymaga **Screen-Recording (OS-TCC)** dla LU

### 3.8 **Workflow**
- [ ] run*_workflow
- [ ] delegate_*task

### 3.9 **Extern**
- [ ] MCP-Tool (min. 1 zewnętrzny serwer)

### 3.10 **Media-Tools (Faza 6)**
- [ ] image*_generate
- [ ] video_*generate (przez MLX)

---

## **Faza 4 — Tryb Coding (Codex)**

### 4.1 **Narzędzia Codex dostępne** `[ ]`
- builtin bez desktop/workflow

### 4.2 **Multi-file Coding Live Green** `[ ]`

### 4.3 **Tryb Review** `[ ]`
- Usuwa narzędzia mutujące (zweryfikowane)

---

## **Faza 5 — Długie sesje / Stabilność**
- **5.1 [ ]** Długi bieg Agenta (wiele wywołań narzędzi, wieloetapowo)
- **5.2 [ ]** Długi bieg Coding
- **5.3 [ ]** Pamięć + RAG trwałe w długiej sesji
- **5.4 [ ]** Brak wycieków/crashy, RAM czysty (offload gdzie trzeba)

---

## **Faza 6 — MLX-Media przez lu-bridge-Sidecar (Mac, tylko MLX)**

### 6.1 **MLX-Runtime WYJAŚNIONY** `[x]`
- Bridge-Source znaleziony
- Obraz = diffusers/torch-MPS (Apple-native, bez ComfyUI)
- Wideo = `mlx-video`
- Oba silniki zainstalowane na tym Mac (venv gotowe)

### 6.2 **Rust: commands::bridge start/stop/status-Sidecar** `[x]`
- Commit `7490585`
- externalBin `bin/lu-bridge`, cargo zielone

#### 6.2.1 **Backend LIVE ZWERYFIKOWANY (bez GUI)** `[x]`
- Zbundlowane binary uruchomione headless → `/health` OK
- Katalog Obraz+Wideo zwrócony
- Render `sd-turbo 512×512 PNG` przez `/cmd/mlx_generate` *(HTTP 200, 432 KB)*
- Pierwszy „zimny” call wymaga oczekiwania na gotowość Sidecar

### 6.3 **Frontend** `[ ]`
- `src/api/mlx-image.ts` + `mlx-video.ts` (localFetch → :47711)
- Mac-Local-Create → gałąź MLX w useCreate
- Ścieżka ComfyUI Mac wyłączona
- AppShell ustawia `videoBackend = 'mlx'` na Apple Silicon

### 6.4 **Katalog obrazów: 5 licencjonowanych** `[ ]`
- img-L1 · L2 · L3 · L4 · L5

### 6.5 **Katalog obrazów: 5 niescenzurowanych** `[ ]`
- img-U1 · U2 · U3 · U4 · U5

### 6.6 **Katalog wideo: 5 licencjonowanych** `[ ]`
- vid-L1 · L2 · L3 · L4 · L5

### 6.7 **Katalog wideo: 5 niescenzurowanych** `[ ]`
- vid-U1 · U2 · U3 · U4 · U5

### 6.8 **Każdy model obrazu 1x** `[ ]`
- Najtańsze ustawienia

### 6.9 **Każdy model wideo 1x** `[ ]`
- Najtańsze ustawienia

---

## **Faza 7 — Zakończenie**
- **7.1 [ ]** tsc + vitest + e2e zielone, Baseline-Diff czysty
- **7.2 [ ]** Live-Green-Log zapisany dla każdego punktu celu
- **7.3 [ ]** Commit na każdy krok, Podsumowanie, bez push (Go Davida)
