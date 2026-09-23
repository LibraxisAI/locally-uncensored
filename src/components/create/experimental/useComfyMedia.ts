import { useState, useEffect, useRef, useCallback } from 'react'
import { galleryItemUrl, isComfyViewUrl, proxiedComfyBlobUrl, recoverGalleryUrl, markGalleryItemAvailable } from './galleryUrl'
import { isComfyLocal, isTauri } from '../../../api/backend'
import { useCreateStore, type GalleryItem } from '../../../stores/createStore'

/**
 * Display src for a gallery item's `<img>`/`<video>`.
 *
 * ComfyUI 0.19+ answers the webview's cross-origin `<img src="…/view">` with
 * 403 (Sec-Fetch-Site), and the webview logs that before onError can run.
 * In Tauri we never assign that URL: bytes come through the Rust proxy (no
 * Origin header) as a blob. If ComfyUI is not running, we do not request
 * `/view` at all. Dev mode keeps the same-origin Vite proxy path.
 */
export function useComfyMedia(item: GalleryItem | null) {
  const base = item ? galleryItemUrl(item) : ''
  const comfyRunning = useCreateStore((s) => s.comfyRunning)
  const directView = isComfyViewUrl(base)
  // Cross-origin /view is the 403. Same-origin `/comfyui/view` (dev) is fine.
  const blockDirectView = isTauri() && directView
  const [proxied, setProxied] = useState<{ base: string; url: string } | null>(null)
  const src = proxied && proxied.base === base ? proxied.url : (blockDirectView ? '' : base)
  const blobRef = useRef<string | null>(null)
  const triedProxy = useRef(false)

  useEffect(() => {
    triedProxy.current = false
    return () => {
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current)
        blobRef.current = null
      }
    }
  }, [base])

  useEffect(() => {
    if (!item || !blockDirectView) return
    // Bytes we own on disk are not a Comfy output. Re-read the file; do not
    // ask /view for a name ComfyUI never wrote.
    if (item.localPath && !item.dataUrl) {
      recoverGalleryUrl(item)
      return
    }
    if (!comfyRunning) return
    let cancelled = false
    triedProxy.current = true
    void proxiedComfyBlobUrl(item).then((blob) => {
      if (cancelled) {
        if (blob) URL.revokeObjectURL(blob)
        return
      }
      if (blob) {
        blobRef.current = blob
        setProxied({ base, url: blob })
      } else {
        recoverGalleryUrl(item)
      }
    })
    return () => { cancelled = true }
  }, [item, base, blockDirectView, comfyRunning])

  const onError = useCallback(() => {
    if (!item) return
    if (triedProxy.current) {
      recoverGalleryUrl(item)
      return
    }
    triedProxy.current = true
    void proxiedComfyBlobUrl(item).then((blob) => {
      if (blob) {
        blobRef.current = blob
        setProxied({ base, url: blob })
        if (isComfyLocal()) useCreateStore.getState().setComfyCorsBlocked(true)
      } else {
        recoverGalleryUrl(item)
      }
    })
  }, [item, base])

  const onLoad = useCallback(() => { if (item) markGalleryItemAvailable(item) }, [item])

  return { src, onError, onLoad }
}
