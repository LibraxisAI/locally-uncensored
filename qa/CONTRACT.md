# Contract: Backend-Kommandos gegen Frontend und Mock

Stand 19.08.2026, Branch qa/sweep auf 2.6.5 (bf903044). Erhoben von
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

## Im Mock korrekt: 62

Vom Frontend gerufen und in `e2e/support/tauri-mock.ts` mit einem
case bedient. Diese Kommandos sind im Playwright-Harness fahrbar.

- `bundled_embed_status`
- `bundled_engine_status`
- `cancel_download`
- `cancel_proxy_stream`
- `comfyui_status`
- `detect_model_path`
- `download_model_to_path`
- `download_progress`
- `fetch_external`
- `fs_list`
- `fs_read`
- `fs_write`
- `get_ollama_host`
- `hf_token_present`
- `install_mlx_diffusion`
- `install_mlx_diffusion_status`
- `install_tts_status`
- `is_onboarding_done`
- `list_bundled_models`
- `lmstudio_model_context`
- `lmstudio_server_status`
- `mlx_generate`
- `mlx_image_delete_model`
- `mlx_image_install_model`
- `mlx_image_install_status`
- `mlx_image_models`
- `mlx_start`
- `mlx_status`
- `mlx_unload`
- `pause_download`
- `proxy_localhost`
- `proxy_localhost_stream`
- `proxy_localhost_stream_chunked`
- `read_media_file`
- `repo_map`
- `resume_download`
- `secret_delete`
- `secret_delete`
- `secret_get`
- `secret_get`
- `secret_set`
- `secret_set`
- `set_hf_token`
- `set_onboarding_done`
- `shell_execute`
- `start_bundled_embed`
- `start_bundled_engine`
- `start_ollama`
- `stop_bundled_embed`
- `stop_bundled_engine`
- `swap_bundled_model`
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
- `whisper_status`

## Im Mock fehlend: 99

Vom Frontend gerufen, aber ohne case im Mock. Jeder Test, der einen
dieser Pfade beruehrt, laeuft in den Default-Zweig des Routers. Das ist
die Driftgefahr: gruen im Harness, kaputt in der gebauten App. Diese
Liste ist die Arbeitsvorlage fuer den Mock-Ausbau, nicht fuer die App.

- `backup_rag_chunks` gerufen aus `src/components/layout/AppShell.tsx`
- `backup_stores` gerufen aus `src/components/layout/AppShell.tsx`
- `cancel_character_training` gerufen aus `src/api/trainer.ts`
- `cancel_comfyui_install` gerufen aus `src/components/onboarding/Onboarding.tsx`
- `cancel_model_pull` gerufen aus `src/stores/modelStore.ts`
- `character_trainer_status` gerufen aus `src/api/trainer.ts`
- `character_training_status` gerufen aus `src/api/trainer.ts`
- `check_git_installed` gerufen aus `src/api/backend.ts`
- `check_model_sizes` gerufen aus `src/api/comfyui.ts`, `src/api/discover.ts`
- `clear_training_set` gerufen aus `src/api/trainer.ts`
- `comfy_upload_image` gerufen aus `src/api/comfyui.ts`
- `comfy_ws_connect` gerufen aus `src/api/comfyui-ws.ts`
- `comfy_ws_disconnect` gerufen aus `src/api/comfyui-ws.ts`
- `comfyui_last_output` gerufen aus `src/components/create/experimental/CreateContext.tsx`, `src/components/settings/SettingsPage.tsx`
- `delete_comfy_model` gerufen aus `src/components/models/ModelManager.tsx`
- `detect_all_comfyui_installs` gerufen aus `src/components/onboarding/Onboarding.tsx`
- `detect_gpus` gerufen aus `src/components/settings/HardwareSettings.tsx`, `src/lib/hardware.ts`
- `disconnect_remote_device` gerufen aus `src/components/settings/RemoteAccessSettings.tsx`
- `download_model` gerufen aus `src/api/discover.ts`
- `download_voice` gerufen aus `src/api/voice.ts`
- `execute_code` gerufen aus `src/api/mcp/builtin-tools.ts`
- `exit_app` gerufen aus `src/stores/updateStore.ts`
- `fetch_external_bytes` gerufen aus `src/api/backend.ts`
- `find_comfyui` gerufen aus `src/components/onboarding/Onboarding.tsx`
- `fix_comfyui_cors` gerufen aus `src/components/create/experimental/CreateExperimental.tsx`
- `fs_search` gerufen aus `src/api/mcp/builtin-tools.ts`
- `get_comfy_gpu_status` gerufen aus `src/components/create/experimental/CreateContext.tsx`
- `get_current_time` gerufen aus `src/api/mcp/builtin-tools.ts`
- `import_local_model` gerufen aus `src/api/engine.ts`
- `install_character_trainer` gerufen aus `src/api/trainer.ts`
- `install_comfyui` gerufen aus `src/components/create/experimental/CreateContext.tsx`, `src/components/onboarding/Onboarding.tsx`, `src/components/settings/SettingsPage.tsx`
- `install_comfyui_status` gerufen aus `src/components/create/experimental/CreateContext.tsx`, `src/components/onboarding/Onboarding.tsx`, `src/components/settings/SettingsPage.tsx`
- `install_custom_node` gerufen aus `src/api/discover.ts`
- `install_lmstudio` gerufen aus `src/components/onboarding/Onboarding.tsx`
- `install_lmstudio_status` gerufen aus `src/components/onboarding/Onboarding.tsx`
- `install_ollama` gerufen aus `src/components/onboarding/Onboarding.tsx`
- `install_ollama_status` gerufen aus `src/components/onboarding/Onboarding.tsx`
- `install_python` gerufen aus `src/components/onboarding/Onboarding.tsx`, `src/components/settings/SettingsPage.tsx`
- `install_python_status` gerufen aus `src/components/onboarding/Onboarding.tsx`, `src/components/settings/SettingsPage.tsx`
- `install_tts` gerufen aus `src/components/settings/SettingsPage.tsx`
- `install_whisper` gerufen aus `src/components/settings/SettingsPage.tsx`
- `install_whisper_status` gerufen aus `src/components/settings/SettingsPage.tsx`
- `installed_piper_voices` gerufen aus `src/api/voice.ts`
- `kv_slot_action` gerufen aus `src/api/vram-handoff.ts`
- `list_importable_models` gerufen aus `src/api/engine.ts`
- `lmstudio_list_loaded` gerufen aus `src/api/lmstudio.ts`, `src/api/vram-handoff.ts`
- `lmstudio_load_model` gerufen aus `src/api/lmstudio.ts`, `src/api/vram-handoff.ts`
- `lmstudio_unload_model` gerufen aus `src/api/lmstudio.ts`, `src/api/vram-handoff.ts`, `src/components/layout/AppShell.tsx`, `src/hooks/useCreate.ts`
- `oauth_start` gerufen aus `src/api/backend.ts`
- `oauth_wait` gerufen aus `src/api/backend.ts`
- `offload_local_models` gerufen aus `src/components/layout/AppShell.tsx`, `src/hooks/useCreate.ts`
- `pick_folder` gerufen aus `src/components/chat/AgentWorkspaceDialog.tsx`, `src/components/chat/FileTree.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/settings/SettingsPage.tsx`
- `process_list` gerufen aus `src/api/mcp/builtin-tools.ts`
- `pull_model_stream` gerufen aus `src/api/ollama.ts`
- `python_check` gerufen aus `src/components/onboarding/Onboarding.tsx`, `src/components/settings/SettingsPage.tsx`
- `regenerate_remote_token` gerufen aus `src/stores/remoteStore.ts`
- `register_openai_host` gerufen aus `src/api/backend.ts`
- `remote_connected_devices` gerufen aus `src/stores/remoteStore.ts`
- `remote_qr_code` gerufen aus `src/stores/remoteStore.ts`
- `remote_server_status` gerufen aus `src/stores/remoteStore.ts`
- `repair_comfyui_env` gerufen aus `src/components/create/experimental/CreateContext.tsx`, `src/components/settings/SettingsPage.tsx`
- `restart_remote_server` gerufen aus `src/stores/remoteStore.ts`
- `restore_rag_chunks` gerufen aus `src/components/layout/AppShell.tsx`
- `restore_stores` gerufen aus `src/components/layout/AppShell.tsx`
- `save_binary_file_dialog` gerufen aus `src/api/backend.ts`, `src/components/create/experimental/OutputView.tsx`
- `save_text_file_dialog` gerufen aus `src/components/chat/ChatArtifactCard.tsx`, `src/lib/chat-export.ts`
- `screenshot` gerufen aus `src/api/mcp/builtin-tools.ts`
- `set_chat_workspace_override` gerufen aus `src/components/layout/Sidebar.tsx`, `src/stores/remoteStore.ts`
- `set_comfy_gpu_mode` gerufen aus `src/components/layout/AppShell.tsx`, `src/components/settings/HardwareSettings.tsx`
- `set_comfyui_host` gerufen aus `src/components/settings/SettingsPage.tsx`
- `set_comfyui_path` gerufen aus `src/components/onboarding/Onboarding.tsx`, `src/components/settings/SettingsPage.tsx`
- `set_comfyui_port` gerufen aus `src/components/settings/SettingsPage.tsx`
- `set_gpu_selection` gerufen aus `src/App.tsx`, `src/components/settings/HardwareSettings.tsx`
- `set_ollama_host` gerufen aus `src/components/layout/AppShell.tsx`
- `set_remote_permissions` gerufen aus `src/stores/remoteStore.ts`
- `shell_task_kill` gerufen aus `src/api/agents/bg-tasks.ts`
- `shell_task_list` gerufen aus `src/api/agents/bg-tasks.ts`
- `shell_task_start` gerufen aus `src/api/agents/bg-tasks.ts`
- `shell_task_status` gerufen aus `src/api/agents/bg-tasks.ts`
- `show_window` gerufen aus `src/App.tsx`, `src/lib/fatal-error.ts`
- `stage_training_image` gerufen aus `src/api/trainer.ts`
- `start_character_training` gerufen aus `src/api/trainer.ts`
- `start_comfyui` gerufen aus `src/api/comfy-restart.ts`, `src/api/discover.ts`, `src/api/vram-handoff.ts`, `src/components/create/experimental/CreateContext.tsx`, `src/components/onboarding/Onboarding.tsx`, `src/components/settings/SettingsPage.tsx`
- `start_lmstudio_server` gerufen aus `src/components/models/ModelSelector.tsx`, `src/components/onboarding/Onboarding.tsx`, `src/components/settings/ProviderConfig.tsx`
- `start_remote_server` gerufen aus `src/stores/remoteStore.ts`
- `start_tunnel` gerufen aus `src/stores/remoteStore.ts`
- `stop_comfyui` gerufen aus `src/api/comfy-restart.ts`, `src/api/discover.ts`, `src/api/vram-handoff.ts`, `src/components/settings/SettingsPage.tsx`
- `stop_remote_server` gerufen aus `src/stores/remoteStore.ts`
- `stop_tunnel` gerufen aus `src/stores/remoteStore.ts`
- `synthesize` gerufen aus `src/api/voice.ts`
- `synthesize_external` gerufen aus `src/api/voice.ts`
- `system_health` gerufen aus `src/components/settings/SettingsPage.tsx`
- `system_info` gerufen aus `src/api/mcp/builtin-tools.ts`, `src/lib/hardware.ts`
- `transcribe` gerufen aus `src/api/voice.ts`
- `tts_status` gerufen aus `src/api/voice.ts`
- `update_comfyui` gerufen aus `src/components/settings/SettingsPage.tsx`
- `waitlist_submit` gerufen aus `src/api/waitlist.ts`
- `web_fetch` gerufen aus `src/api/mcp/builtin-tools.ts`
- `web_search` gerufen aus `src/api/mcp/builtin-tools.ts`

## Kein Aufrufer gefunden: 10

Kein literaler Aufruf ueber einen der drei Wege. Verdacht auf toten
Code, aber vor dem Loeschen einzeln pruefen: sechs davon stehen in der
endpointMap in `src/api/backend.ts`, sind also fuer den Dev-Pfad
gemappt, ohne dass jemand sie ruft. `file_read` und `file_write` sind
Namen von Agenten-Werkzeugen, nicht die Kommandos dahinter; das
Werkzeug `file_read` ruft in Wahrheit `fs_read`.

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
- 99 lebende Kommandos haben keinen Mock. Solange das so ist, beweist
  ein gruener Playwright-Lauf fuer diese Pfade nichts.
- Die zehn ohne Aufrufer sind ein eigener, kleiner Auftrag: pruefen,
  dann entweder anschliessen oder loeschen.
