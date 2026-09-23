import { describe, it, expect } from 'vitest'
import { defaultComfyPort } from '../comfy-default-port'

describe('defaultComfyPort', () => {
  it('is 8080 on macOS and 8188 elsewhere', () => {
    expect(defaultComfyPort({ isMac: true, env: {} })).toBe(8080)
    expect(defaultComfyPort({ isMac: false, env: {} })).toBe(8188)
    expect(defaultComfyPort({ platform: 'darwin', env: {} })).toBe(8080)
    expect(defaultComfyPort({ platform: 'win32', env: {} })).toBe(8188)
    expect(defaultComfyPort({ platform: 'linux', env: {} })).toBe(8188)
  })

  it('honours LU_COMFY_PORT over the OS default', () => {
    expect(defaultComfyPort({ isMac: true, env: { LU_COMFY_PORT: '8188' } })).toBe(8188)
    expect(defaultComfyPort({ isMac: false, env: { LU_COMFY_PORT: '8080' } })).toBe(8080)
  })

  it('honours COMFYUI_PORT when LU_COMFY_PORT is unset', () => {
    expect(defaultComfyPort({ platform: 'linux', env: { COMFYUI_PORT: '9000' } })).toBe(9000)
  })

  it('ignores garbage env values', () => {
    expect(defaultComfyPort({ isMac: true, env: { LU_COMFY_PORT: 'nope' } })).toBe(8080)
    expect(defaultComfyPort({ isMac: false, env: { COMFYUI_PORT: '0' } })).toBe(8188)
  })
})
