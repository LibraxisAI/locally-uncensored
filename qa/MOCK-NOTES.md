# Mock-Formen: Herkunftsnachweis pro Kommando

Stand 19.08.2026, Phase 3 des QA-Sweeps. Fuer jeden der 99 neuen
Mock-Cases in e2e/support/tauri-mock.ts steht hier, aus welcher
Rust-Zeile die Antwortform stammt und welche Unsicherheiten bleiben.
Wer einen Case aendert, zieht die Zeile hier nach.

## ComfyUI

Return-shape sources (Rust) and open uncertainties per command:

cancel_comfyui_install  src-tauri/src/commands/install.rs:69, json at :88
  ({status:"cancelling"}). Worker later flips install_status to "cancelled"
  (state.rs:213); mock does that on the next status poll.
check_model_sizes  download.rs:995; result struct CheckFileResult
  download.rs:984-991 with serde rename_all camelCase, so the wire fields
  are filename/exists/actualBytes/complete. Callers consume filename,
  exists, complete (api/comfyui.ts:670, api/discover.ts:91/119/251).
  UNSURE/limitation: the mock cannot express "exists but partial"
  (exists true, complete false), which is the case filterPartialFiles
  actually filters on. completeFiles only toggles fully installed.
  Extend the option if a partial-download spec needs it.
comfy_upload_image  proxy.rs:631, returns Result<String> = raw body
  (proxy.rs:662). The {name, subfolder, type} body is what the code
  comments and api/comfyui.ts:1323 assume ComfyUI sends; not verified
  against a live ComfyUI, but only .name is read.
comfy_ws_connect  comfy_ws.rs:48, Result<(),String>. Default world has no
  ComfyUI, so the mock rejects; api/comfyui-ws.ts:96 catches, schedules
  reconnect and the caller falls back to /history polling.
comfy_ws_disconnect  comfy_ws.rs:116, Ok(()) always.
comfyui_last_output  process.rs:1534, json :1545 {lines, exited,
  envBroken} (envBroken literal camelCase). DESIGN CHOICE: exited is
  always true in the mock because nothing can run in e2e; a spec that
  needs a healthy running ComfyUI is out of scope anyway since the
  existing comfyui_status case rejects unconditionally.
delete_comfy_model  download.rs:104, success json :138
  ({status:"deleted", bytes}). ModelManager.tsx:97 reads no fields, only
  catches the error message. bytes value is invented (1024).
detect_all_comfyui_installs  process.rs:659; ComfyUIInstall struct
  :610-624, plain Serialize = snake_case (has_embedded_python), matching
  the frontend type Onboarding.tsx:97-102.
find_comfyui  process.rs:1655, json :1662-1673 ({found, path, complete}).
fix_comfyui_cors  process.rs:885; error strings :897/:909; success is
  start_comfyui_blocking's result (:940), i.e. {status:"started", path}.
get_comfy_gpu_status  process.rs:1701-1706 ({mode, startedCpu} camelCase
  literal; startedCpu null until LU started ComfyUI). mode is always
  'auto' in the mock; set_comfy_gpu_mode was not in scope.
install_comfyui  install.rs:712; already_installing :726, no_python error
  :790s, final return :1023 ({status:"installing"}). Mock assumes Python
  is present (python_check/install_python are separate commands, not in
  this batch). Callers only poll the status afterwards.
install_comfyui_status  install.rs:1201-1210: exactly status/logs/
  download_progress/download_total/download_speed, snake_case json
  literals, no error and no phase field. Default status is "idle"
  (state.rs:71).
install_custom_node  install.rs:3311, success json :3474-3477
  ({status:"installed"|"updated", path}). discover.ts:230/312 pass
  repoUrl/nodeName (allow non_snake_case args) and require
  installed/updated via assertNodeInstallOk.
repair_comfyui_env  install.rs:1041; not-installed error :1051, portable
  error :1066, return :1197 ({status:"installing"}); completion log
  :1191-1194 (quoted verbatim in the mock).
set_comfyui_host  process.rs:1783, json :1834 ({status:"saved", host,
  isLocal}); empty/invalid errors :1786/:1790; split_host_port :1768.
set_comfyui_path  process.rs:1708, json :1761 ({status:"saved", path}).
  UNSURE/limitation: the real command rejects when main.py is missing;
  the mock accepts any path (a fresh-box spec cannot exercise the
  invalid-path error without a new option).
set_comfyui_port  process.rs:1831, json :1860 ({status:"saved", port});
  zero-port error :1833.
start_comfyui  process.rs:1199; remote json :1214, already_running :1256,
  starting :1271, not-found error :1284 ("ComfyUI not found"), started
  json :1485 ({status:"started", path}). The mock skips the remote and
  "starting" branches (no tracked child concept).
stop_comfyui  process.rs:1493, stopped :1522 / not_running :1529.
update_comfyui  install.rs:1220; already_installing :1224, not-found and
  not-a-git-repo errors :1246/:1250s, return :1364 ({status:"installing"}).
  UNSURE: the worker's final success log line was not read (thread body
  skipped); mock uses a generic 'ComfyUI updated'. Only status gates the
  frontend (SettingsPage.tsx:785 polls for status complete/error).

General: all mutating commands record into __E2E_COMFY_CALLS__, matching
the existing comfyui_status entry, so the Mac zero-calls assertion keeps
covering the whole ComfyUI surface. Install log wording is approximate;
the frontends only display the last line and substring-match 'Downloading'.

## Installer und System

check_git_installed
  Shape: src-tauri/src/commands/install.rs:1610 (struct GitStatus, plain
  Serialize, snake_case field names incl. download_url), command at :1662.
  Frontend: src/api/backend.ts:803 (interface GitStatus, :821 raw invoke),
  consumed by src/components/chat/CodexView.tsx:90. Default installed:true
  so the Codex install banner stays hidden; OPTIONS flag drives the branch.

install_ollama / install_ollama_status
  Start: install.rs:1437, returns {"status":"downloading"} (:1483) or
  {"status":"already_installing"}. Status: install.rs:1896 blocking body
  :1905, serializes status/logs/download_progress/download_total/
  download_speed (snake_case json! keys, no serde rename involved).
  Terminal states in the impls: "complete" (:1766) or "error". Frontend
  poller Onboarding.tsx:944 reads exactly these five keys and stops on
  complete/error; the start call's return value is ignored.

install_lmstudio / install_lmstudio_status
  Start: install.rs:2166, returns {"status":"downloading"} (:2413) or
  already_installing. Status: install.rs:2416, same five keys. Frontend
  Onboarding.tsx:1056, same poll contract. On macOS/Linux the REAL command
  ends in status "error" with a download pointer (install.rs:2203..2226);
  the mock completes on every platform. A spec asserting the Mac error
  branch must not rely on this default (uncertainty noted below).

install_python / install_python_status / python_check
  Start: install.rs:2722; short-circuit {"status":"already_installed",
  "path":...} when Python is real, else {"status":"installing"} (:2943).
  Status: install.rs:2946, same five keys. python_check: install.rs:2962,
  returns {"available":bool,"path":string|null} (json! literal, camelCase
  irrelevant, keys are lowercase single words). Frontend: Onboarding.tsx:685
  reads probe.available; pollers Onboarding.tsx:709 and SettingsPage.tsx:718
  accept 'complete' OR 'already_installed' and stop on 'error' using the
  last log line as the message. Mock flips sysPythonAvailable on complete,
  mirroring the Rust re-resolve of python_bin.

detect_gpus
  gpu.rs:452, returns Vec<DetectedGpu> directly (array, not wrapped).
  Struct gpu.rs:31: index/vendor/name/memory_mib/source/note, plain
  Serialize so snake_case memory_mib stays as written. Frontends:
  HardwareSettings.tsx:52 (renders name/memory_mib/note, filters by
  vendor), lib/hardware.ts:36 (max memory_mib for the image-gen noti
  threshold: VRAM >= 12 GB OR RAM >= 16 GB). Default card is 12282 MiB
  (11.996 GB, just UNDER the VRAM bar) but default RAM 32 GiB clears the
  RAM bar, so isImageGenCapable() is true by default; override sys.gpus
  plus totalMemoryBytes to test the incapable branch.

set_gpu_selection
  gpu.rs:478, arg key `selection` = {vendor: string, indices: number[]},
  returns Ok(()) which serializes to null. Callers: App.tsx:55 and
  HardwareSettings.tsx:69, both fire-and-forget with .catch(() => {}).

set_comfy_gpu_mode
  process.rs:1681, arg key `mode`, normalizes to cpu/gpu/auto and returns
  {"mode": normalized}. Callers AppShell.tsx:157 and
  HardwareSettings.tsx:95, both fire-and-forget.

system_health
  health.rs:240. Report: health.rs:68 (SystemHealthReport), probes
  health.rs:38 with ProbeStatus rename_all = "snake_case" so the wire
  values are "ok"/"unreachable"/"not_installed"/"error". Host facts
  health.rs:48 (snake_case field idents as written). Frontend interface:
  SettingsPage.tsx:1997 matches 1:1; detail/endpoint feed the badge title.
  version is env!(CARGO_PKG_VERSION); mock uses '0.0.0-e2e' since no spec
  should pin the app version (HARTE REGEL: nie eine Version verdrahten).

system_info
  system.rs:20, json! keys os/arch/hostname/username/totalMemory/cpuCount
  (mixed case exactly as written). Consumers: lib/hardware.ts:47 reads
  totalMemory (bytes); api/mcp/builtin-tools.ts:1154 passes the whole
  object to the agent as text.

show_window
  process.rs:81, returns unit (null). Callers App.tsx:11 and
  lib/fatal-error.ts:43, both ignore the result. Mock records only; the
  window is the Playwright page and needs no showing.

exit_app
  system.rs:242, kills subprocesses and app.exit(0). Caller
  stores/updateStore.ts:252 awaits it after update install. Mock records
  only, per instruction: never actually exit.

backup_stores / restore_stores / backup_rag_chunks / restore_rag_chunks
  system.rs:270/:282/:313/:328. backup_* take arg key `data` (String),
  return null. restore_* return Option<String>: the JSON payload string or
  null when no backup exists. Caller AppShell.tsx:382/:458 (backup, every
  5 s + beforeunload), :219/:256/:284 (restore, JSON.parse of the string).
  Fresh-box default: null, so AppShell takes the no-backup path. Seeding
  sys.storeBackup lets a spec drive the restore-and-reload flow; note that
  flow calls window.location.reload() on success (AppShell.tsx around 300),
  which re-runs the init script and resets all mock state.

Uncertainties
  1. install_lmstudio / install_python on macOS end in status "error" in
     the real Rust (manual-download hint); the mock completes on all
     platforms. Mac onboarding specs that assert the manual-download copy
     need a platform-aware variant or an OPTIONS switch not built here.
  2. InstallState's initial status string (state.rs:54) before any install
     was started is unverified; the mock returns 'idle' for an unstarted
     slot, matching the MLX slot convention. No frontend poller reads the
     status endpoints before starting an install, so this should be inert.
  3. sysPythonPath is a plausible display string, not a byte-accurate copy
     of a real resolve; the UI only renders it ("Found Python at ...").
  4. system_health host facts (os_version, disk_free_gb, cpu_count) are
     invented plausible values; the Troubleshoot panel renders them raw
     and no spec contract exists yet for their exact numbers.
  5. record() on backup_* stores only byte counts. If a spec must assert
     snapshot CONTENT, read sysStoreBackup via restore_stores instead.

## Trainer und Voice

install_character_trainer: trainer.rs:555 (return shapes 563/610). Arg is
  camelCase `installPath` (allow(non_snake_case)); trainer.ts:59 sends
  { installPath: null } when omitted. Returns {status:'installing'} or
  {status:'already_installing'}.
character_trainer_status: trainer.rs:771, response json trainer.rs:791-799
  {envReady, basesReady, dit, textEncoder, vae, root, install:{status,logs}}.
  install mirrors InstallState, initial status 'idle' (state.rs:71).
  Consumers: SpecialIntentControls.tsx:282-286 (install.logs tail +
  install.status), 325-327 (dit/textEncoder/vae null checks), useCreate has
  no direct reader. basesReady is additionally derived from startedDownloads
  (existing mock state) so the base-model download journey closes the gate.
stage_training_image: trainer.rs:806, args setId/filename/fileBytes/caption
  (all camelCase in Rust), returns {staged:"<stem>.<ext>"} (trainer.rs:839).
  SIMPLIFICATION: the mock echoes the sent filename instead of the sanitized
  deduped stem; the only caller (useCreate.ts:371) ignores the return value.
  fileBytes arrives as number[] (trainer.ts:66-73), recorded as byteCount.
clear_training_set: trainer.rs:844, Ok(()) so the mock resolves null.
start_character_training: trainer.rs:860, args setId/name/triggerWord/steps,
  returns {status:'running'} (trainer.rs:1135) or already_running
  (trainer.rs:872). steps clamp 100..4000, default 1200 (trainer.rs:888).
character_training_status: trainer.rs:1139-1148 {status, phase, logs (last
  30), step, totalSteps}. Consumer useCreate.ts:383-408 branches on
  running/complete/cancelled/else and reads phase, logs, step, totalSteps.
  The mock emits one running poll with a tqdm-style step line, then complete.
cancel_character_training: trainer.rs:1154, Ok(()) so null. Run status flips
  to 'cancelled' like set_status does on the cancel path (trainer.rs:999).

tts_status: tts.rs:79, response tts.rs:113-117 {available, piper, voice}.
  voice arg optional (voice.ts:344 sends {voice}). The old reject was
  half-true because checkTtsAvailable catches it into {available:false}
  (voice.ts:342-349), but it erased the piper/voice detail that
  getLastTtsStatus (voice.ts:334-338) feeds into error copy. Default world
  is not-installed to keep existing specs' verdicts identical.
installed_piper_voices: tts.rs:123, plain Vec<String> of complete voices.
download_voice: tts.rs:157, returns {ok:true, voice} (tts.rs:217). Caller
  downloadPiperVoice (voice.ts:413) ignores the body, SettingsPage:1216
  relies on resolve/reject only.
synthesize: tts.rs:224, success {audio_base64, mime:'audio/wav'}
  (tts.rs:323); missing voice rejects with the 'no_voice: ...' head
  (tts.rs:264-269). voice.ts:394-398 consumes audio_base64 + mime. The wav
  is byte-valid PCM so playNeuralAudio (voice.ts:513) settles.
synthesize_external: tts.rs:338, success {audio_base64, mime} (tts.rs:408).
  Args text/url/voice (voice.ts:406-410). Always succeeds in the mock, the
  external engine is user config with no local install state.
transcribe: whisper.rs:277, passes through the python server reply
  {transcript, language} (public/whisper_server.py:12,70). Frontend sends
  camelCase audioBase64/contentType (voice.ts:206-209) and reads data.error
  + data.transcript. Only the base64 LENGTH is recorded, not the payload.
install_tts: install.rs:3168, returns {status:'installing'} (install.rs:3292)
  or already_installing (install.rs:3175).
install_whisper: install.rs:3009, returns {status:'installing'}
  (install.rs:3098) or already_installing (install.rs:3016).
install_whisper_status: install.rs:3105-3117 {status, logs, error,
  download_progress, download_total, download_speed}; error only set when
  status is 'error'. Consumer SettingsPage.tsx:1150-1160 reads status+error.

UNCERTAIN / LIMITATIONS:
1. install_tts_status keeps rejecting (existing case, not on the list), so
   the SettingsPage install loop (SettingsPage.tsx:1180-1195) never sees
   'complete' and would poll to its 10 min cap. The mock therefore completes
   the TTS install on tts_status polls; a spec for the full Settings install
   journey needs that reject case replaced first.
2. Same class for whisper: whisper_status keeps rejecting, so even after
   install_whisper_status reports complete the badge re-probe
   (checkWhisperAvailable, voice.ts:183) still reads unavailable.
3. stage_training_image returns the raw filename, not the sanitized deduped
   stem free_stem would produce (trainer.rs:68-80); no caller reads it today.
4. character_training_status 'error' branch is never emitted by the mock;
   specs for the failure copy (useCreate.ts:406) need an option or a forced
   error hook that does not exist yet.

## Remote und OAuth

start_remote_server: remote.rs:4660 (json result port/passcode/passcodeExpiresAt/lanUrl/mobileUrl at remote.rs:4839); errors "Remote server already running" when handle exists; clears connected devices on every start. Store consumer remoteStore.ts startServer reads exactly these five camelCase keys. Args arrive camelCase from remoteStore (model, systemPrompt, backendKind, backendBase, backendKey); Tauri maps them to the snake_case Rust params.
restart_remote_server: remote.rs:4851, stop + start, fresh passcode, tunnel torn down by the stop leg (remote.rs:4871). Same result shape as start.
stop_remote_server: remote.rs:4871, kills tunnel pid and clears tunnel_url, returns unit (null).
remote_server_status: remote.rs:4909 json at remote.rs:4941; passcode/expiresAt/lanUrl/mobileUrl are empty/0 when stopped, port always 11435, tunnelActive from pid, tunnelUrl unwrap_or_default. remoteStore.refreshStatus consumes all eight keys.
regenerate_remote_token: remote.rs:4953, returns the bare new 6 digit passcode string (generate_passcode remote.rs:137, format "{:06}"). PASSCODE_TTL_SECS = 900 (remote.rs:34); note remoteStore.regenerateToken locally assumes +300 for the display timer, that mismatch is in the app, not the mock.
remote_qr_code: remote.rs:4983, errors "Remote server not running" when stopped; result keys qr_png_base64 (raw base64 PNG, Sidebar.tsx:355 prepends data:image/png;base64,), url (tunnel `${turl}/mobile` else LAN mobile url), passcode.
remote_connected_devices: remote.rs:5029, Vec<ConnectedDevice> (remote.rs:114, snake_case: id/ip/user_agent/last_seen, no serde rename in the file). Default empty; seedable via OPTIONS remoteDevices because a real device only appears after a phone authenticates. Uncertainty: whether a spec would rather have seeded devices survive start_remote_server; Rust clears them, the mock follows Rust.
disconnect_remote_device: remote.rs:5044, arg deviceId (allow(non_snake_case), so the invoke key is deviceId, matching RemoteAccessSettings.tsx:29), returns unit.
set_remote_permissions: remote.rs:5058, arg `permissions` = RemotePermissions {filesystem, downloads, process_control, shell} (remote.rs:47, shell serde(default)); full replace, unlike the HTTP handler which pins shell. Returns unit. remoteStore.setPermissions sends { permissions: perms }.
start_tunnel: remote.rs:5084, errors "Remote server not running. Start it first." when stopped; success returns the bare trycloudflare URL string (remote.rs ~5313), failure path returns Err which remoteStore.startTunnel maps to tunnelActive=false plus error chip.
stop_tunnel: remote.rs:5317, kills pid, clears tunnel_url, returns unit.
set_chat_workspace_override: agent.rs:459, args chatId (non_snake_case) + path Option<String> (null clears), returns unit. Callers Sidebar.tsx:116/127 and remoteStore.ts undispatch, both with chatId '__remote__'.
oauth_start: oauth.rs:45, returns the bound ladder port u16 (ladder 17872/17873/17874, oauth.rs:21). backend.ts:713 oauthStart casts to number.
oauth_wait: oauth.rs:135, args port + timeout_secs (invoke key timeoutSecs, backend.ts:719), returns the RAW callback query string (code=... or error=...&error_description=...). Consumer loginWithProvider (supabase.ts:162 to 191) URLSearchParams parses it; no code means it throws error_description/error, a clean failure. Uncertainty: the success path (oauthCallbackQuery with code=) still calls supabase exchangeCodeForSession, which needs real or separately mocked network, so the option alone cannot produce a signed in session.

## Modelle und Engines

pull_model_stream: src-tauri/src/commands/proxy.rs:667. Uses EVENTS, no
  Channel: app.emit("pull-progress", string payload {"model":name,"data":line})
  per NDJSON line; consumed by src/api/ollama.ts:207 (JSON.parse of
  event.payload, filters on envelope.model). Rust only returns Ok(()) when a
  {"status":"success"} line was seen (Bug Z/a), which the mock reproduces.
  Delivery rides plugin:event|listen interception; the real @tauri-apps/api
  listen resolves invoke() as the event id and invokes w[`_${handlerId}`]
  with {event,id,payload}. Uncertainty: the listen/unlisten cases now shadow
  the generic plugin fallback for ALL events; other listeners get the same
  benign treatment (resolve a number), but any future case that wants to
  emit its own events must reuse modelEventListeners.
cancel_model_pull: proxy.rs:818, Ok(()) even when no pull exists (callers
  src/stores/modelStore.ts:194 and src/api/ollama.ts:221 fire and forget).
  Cancel makes the in-flight pull promise reject "cancelled", matching
  Rust's Err("cancelled"); useModels.ts:268 filters that out via regex.
download_model: download.rs:162, args url/subfolder/filename/expectedBytes
  (non_snake_case Rust param), success {"status":"started","id":filename}
  (download.rs:284). Caller src/api/discover.ts:53 only reads status/id/error.
  Reuses startedDownloads so the shared download_progress case reports it
  complete on the next poll. Alternate Rust returns (exists, already_running,
  error) are not modeled.
list_importable_models: engine.rs:943, {"candidates":[ImportCandidate]}.
  ImportCandidate engine.rs:773 has NO rename_all: name, source, path, size,
  already_imported stay snake_case (matches src/api/engine.ts:206). Default
  empty per fresh-box philosophy; opts.importableModels overrides.
import_local_model: engine.rs:967, args path/name, returns {"path":target}.
  sanitize_model_file_name (engine.rs:785) always ends in .gguf, mirrored.
  Caller src/api/engine.ts:219 ignores the return value. The Rust
  already-exists / cross-drive link errors are not modeled.
lmstudio_list_loaded: install.rs:2507, {"loaded":[ids]}; down server returns
  the empty list, not an error, so the default here is {loaded:[]} exactly.
  Callers src/api/lmstudio.ts:12, src/api/vram-handoff.ts:416.
lmstudio_load_model: install.rs:2550, args model/contextLength (Rust param
  is literally contextLength, non_snake_case), returns
  {ok:true,model,contextLength}. Callers src/api/lmstudio.ts:26,
  src/api/vram-handoff.ts:1008. Mock succeeds and mutates lmsLoaded even
  though lms is "not installed"; needed so the handoff reload path works.
  Uncertainty: real Rust would Err without the CLI.
lmstudio_unload_model: install.rs:2683, {ok:true,model}. "--all" comes from
  AppShell.tsx:148 and useCreate.ts:792 and clears everything.
start_lmstudio_server: install.rs:2434. Not-installed rejects with the
  verbatim Rust error string (install.rs:2457). Uncertainty: a spec driving
  the happy path would want {"status":"starting"} plus a
  lmstudio_server_status flip; the current mock rejects that status probe,
  so the reject here is the consistent default. Callers ModelSelector.tsx:144,
  ProviderConfig.tsx:185, Onboarding.tsx:1153 all catch.
offload_local_models: process.rs:2401, returns {"offloaded":[names]}.
  Frontend sends includeComfyui (camelCase, AppShell.tsx:147 sends nothing,
  useCreate.ts:791 sends false); Tauri maps it to include_comfyui. Empty
  freed list because nothing external runs; the recorded includeComfyui is
  what specs should assert.
kv_slot_action: engine.rs:378, args port/action ("save"|"restore"), returns
  {ok:bool,body:json}. Callers vram-handoff.ts:906 and 1023 gate the restore
  on ok===true; ok:true chosen so specs can prove the full carry path.
  Uncertainty: a spec asserting the degraded path needs an option to flip
  this to ok:false.
register_openai_host: proxy.rs:343, Ok(()) so null. Caller backend.ts:934
  (ensureProxyAllowsHost) ignores the value and caches the host client-side.
  Validation (blocked metadata hosts, 64 cap) not modeled.
set_ollama_host: process.rs:1889, returns {status:"saved",base,isLocal};
  normalize_ollama_base (process.rs:1866) scheme-prefixes and trims trailing
  slashes, mirrored loosely. Caller AppShell.tsx:544 ignores the return.
fetch_external_bytes: proxy.rs:82, Result<Vec<u8>,String> which crosses as
  number[]; caller backend.ts:740 casts to number[] and wraps in Uint8Array,
  so a small enc() byte array is the right shape (NOT base64).

## Agent-Tools und Dialoge

execute_code: src-tauri/src/commands/agent.rs:274 (flat params code/timeout/chatId/workingDirectory;
  success shape { stdout, stderr, exitCode, timedOut } at agent.rs:352). Caller
  src/api/mcp/builtin-tools.ts:910 reads exactly those four fields.
fs_search: src-tauri/src/commands/filesystem.rs:358, returns
  { results: [{ file, matches: [{ line, text }] }], count } (filesystem.rs:423). Caller
  builtin-tools.ts:876 sends max_results snake_case and reads results[].file / matches[].line/.text.
get_current_time: src-tauri/src/commands/system.rs:376, keys unix / iso_local / iso_utc /
  timezone / timezone_offset. Caller builtin-tools.ts:1441 reads iso_local, timezone, iso_utc, unix.
  Fixed instant: 2026-01-02T12:00:00Z (unix 1767355200), offset +0000.
process_list: src-tauri/src/commands/system.rs:34, { processes: [{ name, pid, memory, cpu }], count },
  memory in bytes, cpu a float (caller builtin-tools.ts:1159 calls cpu?.toFixed(1)).
screenshot: src-tauri/src/commands/system.rs:71 (screenshot_blocking system.rs:92),
  { image: <base64>, format: 'png', encoding: 'base64' }. Caller builtin-tools.ts:1170 only
  checks data.image, so TINY_PNG is enough.
web_fetch: src-tauri/src/commands/search.rs:465, { url, status, contentType, title, text,
  truncated } (search.rs:505). Caller builtin-tools.ts:722 consumes all six.
web_search: src-tauri/src/commands/search.rs:283; success is { results: [SearchResult], provider }
  with SearchResult { title, url, snippet } (search.rs:7); free tier attaches optional
  providerError (search.rs:347). Caller builtin-tools.ts:686 maps title/url/snippet.
  Mock always answers as the searxng tier; providerError deliberately absent.
shell_task_start: src-tauri/src/commands/bg_tasks.rs:144 (StartArgs bg_tasks.rs:126: command,
  cwd, shell, chat_id, working_directory; all snake_case, no serde rename). Returns { id }
  (bg_tasks.rs:311). Frontend wraps the payload under an `args` key (src/api/agents/bg-tasks.ts:36),
  which the router's `m = args?.args ?? args` already unwraps. Empty command rejects with
  'command is empty' (bg_tasks.rs:148, errors are plain strings per commands/mod.rs:37).
shell_task_status: bg_tasks.rs:318, returns the BgTaskStatus struct (bg_tasks.rs:38: id, command,
  cwd, started_at, finished_at, exit_code, running, cancelled, output_tail; Serialize without
  rename, so snake_case, matching the interface in bg-tasks.ts:3). Unknown id rejects
  'task not found: <id>'. Mock semantics: the first poll flips the task to exited with exit code 0.
shell_task_kill: bg_tasks.rs:329, { ok: true, cancelled: true } while running, else
  { ok: true, cancelled: false, reason: 'already finished' }. Rust leaves exit_code null on cancel.
shell_task_list: bg_tasks.rs:346, { tasks: [...] } sorted newest first.
pick_folder: src-tauri/src/commands/system.rs:222, param default_path (JS sends defaultPath,
  FileTree.tsx:66; Tauri v2 camelizes), returns Option<String>: path string or null on cancel.
  Callers AgentWorkspaceDialog.tsx:73, Sidebar.tsx:102, SettingsPage.tsx:269 all treat the value
  as string | null. Mock always picks /tmp/lu-e2e/workspace.
save_text_file_dialog: src-tauri/src/commands/filesystem.rs:460 (content, defaultName, extension,
  ext_label; returns Option<String> chosen path or null). chat-export.ts:100/:158 branches on the
  returned path (null = cancelled), ChatArtifactCard.tsx:40 ignores it. Mock returns a path so the
  flow reads as 'saved'.
save_binary_file_dialog: filesystem.rs:502 (bytes as number[], defaultName, extension, ext_label;
  returns Option<String>). Callers OutputView.tsx:101 and backend.ts:663 ignore the return value.
waitlist_submit: src-tauri/src/commands/waitlist.rs:61 (single-word params email/source/version by
  design; caller src/api/waitlist.ts:65 passes them flat). Result<(), String>, so resolve null.
Uncertainties:
- shell_task_kill on an ALREADY exited mock task: real Rust would usually be polled while still
  running; the mock finishes on the first status poll, so a spec that polls before killing gets the
  'already finished' branch. Kill before any poll gets cancelled: true. Both branches are faithful,
  but which one a spec sees depends on its poll order.
- web_search provider label: the mock always claims 'searxng'. Real 'auto' on a fresh box would
  more likely land on 'duckduckgo' (searxng_available defaults false), but no caller branches on
  the label; it is only echoed in the providerError note path.
- screenshot/pick_folder etc. reach the router flat (not nested), and none of the agent tool
  payloads carry an `args` key themselves except shell_execute (already handled upstream), so the
  shared `m` unwrap is safe for every case above.

## Fallen beim Vorbereiten der Ausgangslage (aus der Welle, 20.08.2026)

Drei Dinge haben in dieser Welle zusammen mehrere Stunden gekostet,
ohne dass ein Test rot wurde. Sie sind alle still.

1. **Ein `lu-providers`-Seed mit `version: 0` wird kommentarlos
   verworfen.** Der Store persistiert auf Version 1 und hat kein
   `migrate`. Der Seed liegt dann im localStorage und wirkt nicht.
2. **AppShell repariert die Anbieterwelt beim Booten.** Die
   Backend-Erkennung schaltet jedes gefundene Backend wieder ein und
   pinnt die `baseUrl`; der Mock beantwortet Ollamas `/api/tags`
   immer, also wird Ollama immer gefunden. Wer eine kaputte
   Ollama-Welt braucht, setzt vorher
   `sessionStorage['lu-backend-detection-done'] = '1'`.
3. **`proxy_localhost` beantwortet JEDE 11434-URL mit der
   `/api/tags`-Nutzlast.** Damit meldet `/api/ps` alle Modelle als
   geladen, ein Loeschen entfernt nichts, und Methode und Body landen
   in keinem Eimer. Ein zustandsbehaftetes Ollama plus ein
   `__E2E_PROXY_CALLS__`-Eimer ist der groesste einzelne Hebel fuer
   die naechste Welle.

Und eine Umgebungsregel, keine Mock-Sache: waehrend eine Testschleife
laeuft, darf niemand nach `src/` schreiben. Vite schickt sonst einen
Full-Reload in die laufende Seite, `uiStore.currentView` ist nicht
persistiert, die App faellt mitten im Test auf Chat zurueck und der
Lauf wird rot, ohne dass die App etwas falsch gemacht haette.

### Die stillste Falle: `import('/src/stores/X.ts')` im page.evaluate

Mehrere Specs bauen ihre Vorbedingung, indem sie im Seitenkontext das
Store-Modul nachladen und einen Setter rufen. Das funktioniert genau so
lange, wie niemand diese Datei waehrend der Sitzung anfasst.

Bewiesen am 20.08.2026 an `modelHealthStore.ts`:

- Frischer Dev-Server: nach einem Klick auf den X-Knopf liest
  `import('/src/stores/modelHealthStore.ts')` `dismissed: true`. Es ist
  dasselbe Modul, das die App benutzt.
- Nach einem HMR-Update derselben Datei laedt die App die Datei unter
  einer Zeitstempel-URL. Der Import ohne Zeitstempel liefert dann eine
  ZWEITE, abgekoppelte Instanz: der Lesewert war `dismissed: false`,
  waehrend das Banner sichtbar weg war, und ein `setStaleModels` ueber
  diesen Weg kam in der App nie an.

Das faellt nicht auf, weil beide Seiten plausibel aussehen. Ein Test,
der so seine Vorbedingung setzt und danach "nichts passiert" behauptet,
beweist im schlimmsten Fall nur, dass er an einer Attrappe gedreht hat.

Konsequenz: Vorbedingungen so bauen, wie die App sie selbst erzeugt
(Mock-Welt, localStorage-Seed, Klicks), nicht ueber das Store-Modul.
Zehn Stellen in vier Specs nutzen den Weg noch, alle in `layout-*`.
