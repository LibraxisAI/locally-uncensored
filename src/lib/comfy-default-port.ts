/**
 * Default ComfyUI listen port.
 *
 * Windows/Linux ComfyUI ships on 8188. On this Mac the user's ComfyUI is on
 * 8080, and the frontend dist is shared across OS builds, so the Mac default
 * is a runtime `darwin` check — never a compile-time flag. `LU_COMFY_PORT` /
 * `COMFYUI_PORT` win when they name a real port, so `npm run dev` and the
 * Vite proxy can follow the same instance the desktop app talks to.
 */

export function defaultComfyPort(opts?: {
  isMac?: boolean
  platform?: string
  env?: NodeJS.ProcessEnv
}): number {
  const env = opts?.env ?? (typeof process !== 'undefined' ? process.env : undefined)
  const raw = Number(env?.LU_COMFY_PORT || env?.COMFYUI_PORT || '')
  if (Number.isInteger(raw) && raw > 0 && raw < 65536) return raw
  if (opts?.isMac === true) return 8080
  if (opts?.isMac === false) return 8188
  const plat = opts?.platform
    ?? (typeof process !== 'undefined' ? process.platform : '')
  return plat === 'darwin' ? 8080 : 8188
}
