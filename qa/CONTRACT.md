# Contract: Backend-Kommandos gegen Frontend und Mock

Stand 19.08.2026 (Mock-Ausbau: 19.08.2026 abends), Branch qa/sweep auf 2.6.5 (bf903044). Erhoben von
scan.mjs, die drei Listen summieren sich auf 171.

## Wie das Frontend die Kommandos erreicht

Drei Wege, und nur wer alle drei zaehlt, sieht die Wahrheit:

1. `invoke("name")` direkt, 23 Namen.
2. `backendCall("name")` aus `src/api/backend.ts`, 111 Namen. Der Wrapper
   routet in Tauri auf invoke und im Vite-Dev-Modus auf `/local-api/`.
3. `invokeMedia("name")` in `src/api/mlx-image.ts` und `mlx-video.ts`,
   22 Namen. Duenner Wrapper ueber backendCall, der die Nutzlast unter
   einen `args`-Schluessel legt, weil die Rust-Seite ein einzelnes
   `serde_json::Value` erwartet.

Der erste Scan zaehlte nur Weg 1 und meldete 25 von 171. Diese Zahl war
falsch und haette fast zu der Fehlannahme gefuehrt, der grosse Rest sei
toter Rust-Code.

## Im Mock korrekt: 161 Definitionen, 158 Namen

Vom Frontend gerufen und in `e2e/support/tauri-mock.ts` mit einem case
bedient. Die Differenz zwischen 161 und 158: `secret_set`, `secret_get`
und `secret_delete` sind in `src-tauri/src/commands/secret.rs` je
zweimal definiert (cfg-Plattformvarianten mit demselben Namen), der
Scanner zaehlt Definitionen. Ein Name, ein case. Seit dem Mock-Ausbau (Phase 3) ist das die komplette lebende
Kommandoflaeche; die Herkunft jeder Antwortform steht mit Rust-Zeile in
`qa/MOCK-NOTES.md`. Die Default-Welt bleibt die frische Box: extern
laeuft nichts, ComfyUI/LM Studio/Ollama nicht installiert bzw. leer,
Piper ohne Stimmen. Wer eine andere Ausgangslage braucht, nimmt die
Optionen (`comfy`, `sys`, `trainer`, `voice`, `remoteDevices`,
`importableModels`, `lmsLoadedModels`, `oauthCallbackQuery`).

- `backup_rag_chunks`
- `backup_stores`
- `bundled_embed_status`
- `bundled_engine_status`
- `cancel_character_training`
- `cancel_comfyui_install`
- `cancel_download`
- `cancel_model_pull`
- `cancel_proxy_stream`
- `character_trainer_status`
- `character_training_status`
- `check_git_installed`
- `check_model_sizes`
- `clear_training_set`
- `comfy_upload_image`
- `comfy_ws_connect`
- `comfy_ws_disconnect`
- `comfyui_last_output`
- `comfyui_status`
- `delete_comfy_model`
- `detect_all_comfyui_installs`
- `detect_gpus`
- `detect_model_path`
- `disconnect_remote_device`
- `download_model`
- `download_model_to_path`
- `download_progress`
- `download_voice`
- `execute_code`
- `exit_app`
- `fetch_external`
- `fetch_external_bytes`
- `find_comfyui`
- `fix_comfyui_cors`
- `fs_list`
- `fs_read`
- `fs_search`
- `fs_write`
- `get_comfy_gpu_status`
- `get_current_time`
- `get_ollama_host`
- `hf_token_present`
- `import_local_model`
- `install_character_trainer`
- `install_comfyui`
- `install_comfyui_status`
- `install_custom_node`
- `install_lmstudio`
- `install_lmstudio_status`
- `install_mlx_diffusion`
- `install_mlx_diffusion_status`
- `install_ollama`
- `install_ollama_status`
- `install_python`
- `install_python_status`
- `install_tts`
- `install_tts_status`
- `install_whisper`
- `install_whisper_status`
- `installed_piper_voices`
- `is_onboarding_done`
- `kv_slot_action`
- `list_bundled_models`
- `list_importable_models`
- `lmstudio_list_loaded`
- `lmstudio_load_model`
- `lmstudio_model_context`
- `lmstudio_server_status`
- `lmstudio_unload_model`
- `mlx_generate`
- `mlx_image_delete_model`
- `mlx_image_install_model`
- `mlx_image_install_status`
- `mlx_image_models`
- `mlx_start`
- `mlx_status`
- `mlx_unload`
- `oauth_start`
- `oauth_wait`
- `offload_local_models`
- `pause_download`
- `pick_folder`
- `process_list`
- `proxy_localhost`
- `proxy_localhost_stream`
- `proxy_localhost_stream_chunked`
- `pull_model_stream`
- `python_check`
- `read_media_file`
- `regenerate_remote_token`
- `register_openai_host`
- `remote_connected_devices`
- `remote_qr_code`
- `remote_server_status`
- `repair_comfyui_env`
- `repo_map`
- `restart_remote_server`
- `restore_rag_chunks`
- `restore_stores`
- `resume_download`
- `save_binary_file_dialog`
- `save_text_file_dialog`
- `screenshot`
- `secret_delete`
- `secret_get`
- `secret_set`
- `set_chat_workspace_override`
- `set_comfy_gpu_mode`
- `set_comfyui_host`
- `set_comfyui_path`
- `set_comfyui_port`
- `set_gpu_selection`
- `set_hf_token`
- `set_ollama_host`
- `set_onboarding_done`
- `set_remote_permissions`
- `shell_execute`
- `shell_task_kill`
- `shell_task_list`
- `shell_task_start`
- `shell_task_status`
- `show_window`
- `stage_training_image`
- `start_bundled_embed`
- `start_bundled_engine`
- `start_character_training`
- `start_comfyui`
- `start_lmstudio_server`
- `start_ollama`
- `start_remote_server`
- `start_tunnel`
- `stop_bundled_embed`
- `stop_bundled_engine`
- `stop_comfyui`
- `stop_remote_server`
- `stop_tunnel`
- `swap_bundled_model`
- `synthesize`
- `synthesize_external`
- `system_health`
- `system_info`
- `transcribe`
- `tts_status`
- `update_comfyui`
- `video_cancel`
- `video_delete_model`
- `video_generate`
- `video_install_mlx`
- `video_install_mlx_status`
- `video_install_model`
- `video_install_model_status`
- `video_list_models`
- `video_progress`
- `video_status`
- `waitlist_submit`
- `web_fetch`
- `web_search`
- `whisper_status`

## Im Mock fehlend: 0

Leer seit dem Mock-Ausbau am 19.08.2026. Bekannte Restspannungen, beide
in MOCK-NOTES.md dokumentiert: die historischen Reject-Cases
`whisper_status` und `install_tts_status` bleiben Rejects, weshalb der
TTS-Install im Mock ueber `tts_status`-Polls abschliesst und das
Whisper-Badge trotz complete rot bleibt. Wer die vollen
Settings-Install-Reisen testet, ersetzt zuerst diese zwei Rejects.

## Kein Aufrufer gefunden: 10

Kein literaler Aufruf ueber einen der drei Wege. Einzeln geprueft am
19.08.2026: `file_read` und `file_write` sind NICHT tot, das
Handy-Relay dispatcht sie in `src-tauri/src/commands/remote.rs:580`
direkt als Rust-Funktionen; der Scanner sieht nur Frontend-Aufrufe.
Die uebrigen acht sind nur in `main.rs` registriert und haben weder
Frontend- noch Rust-interne Nutzer; die drei SearXNG-Kommandos sehen
nach einem nie fertig gebauten Feature aus. Anschliessen oder loeschen
ist Davids Entscheidung, in FINDINGS.md vorgemerkt.

- `file_read` definiert in `src-tauri/src/commands/agent.rs`
- `file_write` definiert in `src-tauri/src/commands/agent.rs`
- `fs_info` definiert in `src-tauri/src/commands/filesystem.rs`
- `get_chat_workspace_override` definiert in `src-tauri/src/commands/agent.rs`
- `get_gpu_selection` definiert in `src-tauri/src/commands/gpu.rs`
- `install_searxng` definiert in `src-tauri/src/commands/search.rs`
- `ollama_search` definiert in `src-tauri/src/commands/proxy.rs`
- `search_status` definiert in `src-tauri/src/commands/search.rs`
- `searxng_status` definiert in `src-tauri/src/commands/search.rs`
- `tunnel_status` definiert in `src-tauri/src/commands/remote.rs`

## Was daraus folgt

- 161 der 171 Kommandos sind lebender Code. Die Rust-Seite ist nicht
  ueberwiegend tot, wie die erste Messung nahelegte.
- Seit dem Mock-Ausbau haben alle 161 lebenden Kommandos einen case;
  ein gruener Playwright-Lauf kann diese Pfade jetzt beweisen. Die
  Formen stammen aus der Rust-Quelle, Zeilennachweis in MOCK-NOTES.md.
- Von den zehn ohne Aufrufer leben zwei ueber das Handy-Relay, acht
  warten auf Davids Anschliessen-oder-Loeschen-Entscheid.
