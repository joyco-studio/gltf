import type { TexelRect } from './advisory-jobs'
import type { TextureUser } from './texture-bindings'

/**
 * What the advisor concludes per texture, plus the pure readings of it the
 * UI and the report share (usage, flagging, savings).
 */

type DownloadProjection =
  | { status: 'pending' }
  | { status: 'unavailable' }
  | {
      /** `measured` re-encoded the image; `estimated` scaled by area. */
      status: 'measured' | 'estimated'
      original: number
      /** Same resolution, unused texels filled by bleeding island colors. */
      cleared: number | null
      /** Cropped to the used bounds (and bled, when measured). */
      cropped: number | null
    }

interface TextureOverlays {
  unusedUrl: string | null
  wireUrl: string | null
}

type TextureAdvice =
  | { status: 'pending' }
  | {
      status: 'unused'
      /** Not bound by any material, or bound only by materials no primitive draws. */
      reason: 'unreferenced' | 'no-geometry'
      /** Other textures reading the same image; the advice covers all of them. */
      sharedWith: number[]
      download: DownloadProjection
    }
  | {
      status: 'analyzed'
      coverage: number
      /** Used bounds in texels, or null when cropping would not shrink it. */
      crop: TexelRect | null
      tiling: boolean
      /** Islands sit in a repeat tile other than 0–1, so cropping is withheld. */
      offset: boolean
      /** Resolution of the coverage mask, and the gutter it keeps in image texels. */
      mask: { width: number; height: number; paddingTexels: number }
      sharedWith: number[]
      texCoords: number[]
      users: TextureUser[]
      overlays: TextureOverlays
      download: DownloadProjection
    }
  | { status: 'failed'; message: string }

/** Utilization 0..1, or null while unknown. Unused textures are 0. */
function usageOf(advice: TextureAdvice) {
  if (advice.status === 'unused') return 0
  if (advice.status === 'analyzed') return advice.coverage
  return null
}

/** Whether a texture falls under the usage threshold (0–100). */
function isFlagged(advice: TextureAdvice, threshold: number) {
  if (advice.status === 'unused') return true
  // Tiled textures repeat by design; folded coverage isn't reclaimable space.
  if (advice.status !== 'analyzed' || advice.tiling) return false
  return advice.coverage * 100 < threshold
}

/**
 * Id that stands for a texture's image: textures sharing an image share one
 * advice, so totals must count it once.
 */
function imageKey(id: number, advice: TextureAdvice) {
  return advice.status === 'analyzed' || advice.status === 'unused'
    ? Math.min(id, ...advice.sharedWith)
    : id
}

/** Bytes a texture could stop shipping, taking the best available fix. */
function projectedSavings(advice: TextureAdvice): number | null {
  if (advice.status !== 'unused' && advice.status !== 'analyzed') return null
  const { download } = advice
  if (download.status !== 'measured' && download.status !== 'estimated') {
    return null
  }
  if (advice.status === 'unused') return download.original
  const best = Math.min(
    download.cleared ?? download.original,
    download.cropped ?? download.original
  )
  return Math.max(0, download.original - best)
}

export { imageKey, isFlagged, projectedSavings, usageOf }
export type { DownloadProjection, TextureAdvice, TextureOverlays }
