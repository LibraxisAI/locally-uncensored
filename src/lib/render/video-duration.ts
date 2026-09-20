// Supported and priced LU clip lengths. Provider schemas checked 2026-09-19.
// Kept byte-identical between API and worker by a contract test.
import durations from './video-durations.json'
export function videoDurations(model: string): readonly number[] {
  return (durations as Record<string, number[]>)[model] ?? []
}

// UI model switches reset stale selections to the shortest valid choice.
export function selectedVideoSeconds(model: string, frames: number, fps: number): number {
  const allowed = videoDurations(model)
  const raw = frames / fps
  if (allowed.includes(raw)) return raw
  const legacy = raw >= 6.5 ? 8 : 5
  return allowed.includes(legacy) && raw <= 8 ? legacy : (allowed[0] ?? 5)
}

export function bookedVideoSeconds(model: string, params: Record<string, unknown>): number {
  const allowed = videoDurations(model)
  const invalid = () => new Error(`This model supports ${allowed.join(', ')} seconds in LU. Select a supported length before generating.`)
  let seconds = 5
  if (params.frames !== undefined || params.fps !== undefined) {
    const frames = params.frames ?? 80
    const fps = params.fps ?? 16
    if (typeof frames !== 'number' || typeof fps !== 'number' || !Number.isFinite(frames) || !Number.isFinite(fps) || frames <= 0 || fps <= 0) throw invalid()
    const raw = frames / fps
    seconds = allowed.includes(raw) ? raw : raw <= 8 ? (raw >= 6.5 ? 8 : 5) : NaN
  }
  if (params.duration !== undefined) {
    if (typeof params.duration !== 'number' || !allowed.includes(params.duration) ||
        ((params.frames !== undefined || params.fps !== undefined) && params.duration !== seconds)) throw invalid()
    seconds = params.duration
  }
  if (!allowed.includes(seconds)) throw invalid()
  return seconds
}
