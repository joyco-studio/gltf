import type { BufferGeometry, Object3D } from 'three/webgpu'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

import { Disposer } from '../disposer'
import { EventEmitter } from '../event-emitter'
import type { GltfDocumentInfo, GltfTextureInfo } from '../inspect'
import { getTextureBlob } from '../texture-download'
import { AdvisoryClient } from './advisory-client'
import { canReencode, type TexelRect } from './advisory-jobs'
import {
  resolveTextureBindings,
  type TextureBindings,
  type TextureUser,
} from './texture-bindings'
import type { UvLayer, UvRect } from './uv-coverage'

/**
 * Texture-space advisory: for every texture, how much of it the model's UVs
 * can ever sample, and how much download size reclaiming the rest would
 * save. Runs lazily (the first time the UI asks) and reports progressively.
 */

/** Coverage is rasterized at most this large on the longest side. */
const MASK_MAX_SIZE = 512
/** Texel gutter kept around UV islands so mip filtering never bleeds. */
const PADDING_TEXELS = 4
/** A crop is only worth suggesting when it drops at least this share of texels. */
const MIN_CROP_REDUCTION = 0.25

type DownloadProjection =
  | { status: 'pending' }
  | { status: 'unavailable' }
  | {
      /** `measured` re-encoded the image; `estimated` scaled by area. */
      status: 'measured' | 'estimated'
      original: number
      /** Same resolution, unused texels flattened. */
      cleared: number | null
      /** Cropped to the used bounds (and flattened, when measured). */
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
      download: DownloadProjection
    }
  | {
      status: 'analyzed'
      coverage: number
      /** Used bounds in texels, or null when cropping would not shrink it. */
      crop: TexelRect | null
      tiling: boolean
      texCoords: number[]
      users: TextureUser[]
      overlays: TextureOverlays
      download: DownloadProjection
    }
  | { status: 'failed'; message: string }

type AdvisorySnapshot =
  | { status: 'idle' }
  | {
      status: 'analyzing' | 'ready'
      textures: readonly TextureAdvice[]
    }

interface AdvisoryEvents extends Record<string, unknown> {
  change: AdvisorySnapshot
}

interface AdvisoryModel {
  gltf: GLTF
  files: File[]
  document: GltfDocumentInfo
}

const IDLE_ADVISORY: AdvisorySnapshot = { status: 'idle' }

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

function maskSize(texture: GltfTextureInfo) {
  if (!texture.width || !texture.height) {
    return { width: MASK_MAX_SIZE, height: MASK_MAX_SIZE, scale: 1 }
  }
  const scale = Math.min(1, MASK_MAX_SIZE / Math.max(texture.width, texture.height))
  return {
    width: Math.max(1, Math.round(texture.width * scale)),
    height: Math.max(1, Math.round(texture.height * scale)),
    scale,
  }
}

/** Used UV bounds → texel rect, or null when cropping would barely shrink it. */
function cropRect(bounds: UvRect, width: number, height: number): TexelRect | null {
  if (!width || !height) return null
  const x = Math.max(0, Math.floor(bounds.minU * width))
  const y = Math.max(0, Math.floor(bounds.minV * height))
  const right = Math.min(width, Math.ceil(bounds.maxU * width))
  const bottom = Math.min(height, Math.ceil(bounds.maxV * height))
  const rect = { x, y, width: right - x, height: bottom - y }
  if (rect.width <= 0 || rect.height <= 0) return null
  if (rect.width * rect.height > width * height * (1 - MIN_CROP_REDUCTION)) {
    return null
  }
  return rect
}

/** The runtime primitive (Mesh/Points/Line) GLTFLoader built for a glTF primitive. */
function primitiveObject(mesh: Object3D, primitiveIndex: number) {
  if ((mesh as Object3D & { isGroup?: boolean }).isGroup) {
    return mesh.children[primitiveIndex] ?? null
  }
  return primitiveIndex === 0 ? mesh : null
}

/** Copy a (possibly quantized, interleaved or Draco-decoded) UV set out of three. */
function readUvs(geometry: BufferGeometry, texCoord: number) {
  const attribute = geometry.getAttribute(texCoord === 0 ? 'uv' : `uv${texCoord}`)
  if (!attribute) return null
  const uv = new Float32Array(attribute.count * 2)
  for (let vertex = 0; vertex < attribute.count; vertex += 1) {
    uv[vertex * 2] = attribute.getX(vertex)
    uv[vertex * 2 + 1] = attribute.getY(vertex)
  }
  const index = geometry.index ? Uint32Array.from(geometry.index.array) : null
  return { uv, index }
}

class TextureAdvisor extends EventEmitter<AdvisoryEvents> {
  private snapshot: AdvisorySnapshot = IDLE_ADVISORY
  private model: AdvisoryModel | null = null
  private run: Disposer | null = null
  private client: AdvisoryClient | null = null

  getSnapshot(): AdvisorySnapshot {
    return this.snapshot
  }

  /** Point the advisor at a freshly loaded model; analysis waits for `start`. */
  setModel(model: AdvisoryModel | null) {
    this.run?.dispose()
    this.run = null
    this.model = model
    this.setSnapshot(IDLE_ADVISORY)
  }

  /** Begin analysis for the current model (idempotent). */
  start() {
    if (!this.model || this.run) return
    const run = new Disposer()
    this.run = run
    void this.analyze(this.model, run)
  }

  dispose() {
    this.run?.dispose()
    this.run = null
    this.client?.dispose()
    this.client = null
    this.model = null
    this.clear()
  }

  private setSnapshot(snapshot: AdvisorySnapshot) {
    this.snapshot = snapshot
    this.emit('change', snapshot)
  }

  private getClient() {
    this.client ??= new AdvisoryClient()
    return this.client
  }

  private async analyze(model: AdvisoryModel, run: Disposer) {
    const { gltf, document } = model
    const bindings = resolveTextureBindings(gltf.parser.json)
    const textures: TextureAdvice[] = document.textures.map(() => ({
      status: 'pending',
    }))
    const masks = new Map<number, { mask: Uint8Array; width: number; height: number }>()

    const commit = (id: number, advice: TextureAdvice) => {
      if (run.disposed) return
      textures[id] = advice
      this.setSnapshot({ status: 'analyzing', textures: [...textures] })
    }
    this.setSnapshot({ status: 'analyzing', textures: [...textures] })

    // Pass 1: coverage for every texture, so the list fills in quickly.
    const uvCache = new Map<string, ReturnType<typeof readUvs>>()
    for (const texture of document.textures) {
      if (run.disposed) return
      const binding = bindings[texture.id]
      try {
        const advice = await this.analyzeCoverage(
          gltf,
          texture,
          binding,
          uvCache,
          run,
          masks
        )
        commit(texture.id, advice)
      } catch (error) {
        commit(texture.id, {
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    uvCache.clear()

    // Pass 2: download projections (image re-encodes are the slow part).
    for (const texture of document.textures) {
      if (run.disposed) return
      const advice = textures[texture.id]
      if (advice.status !== 'unused' && advice.status !== 'analyzed') continue
      const download = await this.projectDownload(
        model,
        texture,
        advice,
        masks.get(texture.id) ?? null
      ).catch((): DownloadProjection => ({ status: 'unavailable' }))
      commit(texture.id, { ...advice, download })
    }

    if (!run.disposed) {
      this.setSnapshot({ status: 'ready', textures: [...textures] })
    }
  }

  private async analyzeCoverage(
    gltf: GLTF,
    texture: GltfTextureInfo,
    binding: TextureBindings | undefined,
    uvCache: Map<string, ReturnType<typeof readUvs>>,
    run: Disposer,
    masks: Map<number, { mask: Uint8Array; width: number; height: number }>
  ): Promise<TextureAdvice> {
    const pending: DownloadProjection = { status: 'pending' }
    if (!binding?.referenced) {
      return { status: 'unused', reason: 'unreferenced', download: pending }
    }

    const layers: UvLayer[] = []
    for (const ref of binding.layers) {
      const key = `${ref.meshId}:${ref.primitiveIndex}:${ref.texCoord}`
      if (!uvCache.has(key)) {
        const mesh = (await gltf.parser.getDependency('mesh', ref.meshId)) as Object3D
        const object = primitiveObject(mesh, ref.primitiveIndex) as
          | (Object3D & { geometry?: BufferGeometry })
          | null
        uvCache.set(key, object?.geometry ? readUvs(object.geometry, ref.texCoord) : null)
      }
      const uvs = uvCache.get(key)
      if (!uvs) continue
      layers.push({
        ...uvs,
        transform: ref.transform,
        wrapS: binding.wrapS,
        wrapT: binding.wrapT,
      })
    }
    if (layers.length === 0) {
      return { status: 'unused', reason: 'no-geometry', download: pending }
    }

    const { width, height, scale } = maskSize(texture)
    const result = await this.getClient().coverage({
      width,
      height,
      padding: Math.max(1, Math.ceil(PADDING_TEXELS * scale)),
      layers,
    })
    masks.set(texture.id, { mask: result.mask, width, height })

    const url = (blob: Blob | null) => {
      if (!blob || typeof URL.createObjectURL !== 'function') return null
      const objectUrl = URL.createObjectURL(blob)
      run.add(() => URL.revokeObjectURL(objectUrl))
      return objectUrl
    }

    return {
      status: 'analyzed',
      coverage: result.coverage,
      crop:
        result.tiling || !result.bounds
          ? null
          : cropRect(result.bounds, texture.width, texture.height),
      tiling: result.tiling,
      texCoords: binding.texCoords,
      users: binding.users,
      overlays: {
        unusedUrl: url(result.unusedOverlay),
        wireUrl: url(result.wireOverlay),
      },
      download: pending,
    }
  }

  private async projectDownload(
    { gltf, files }: AdvisoryModel,
    texture: GltfTextureInfo,
    advice: Extract<TextureAdvice, { status: 'unused' | 'analyzed' }>,
    mask: { mask: Uint8Array; width: number; height: number } | null
  ): Promise<DownloadProjection> {
    const blob = await getTextureBlob(texture, gltf, files)
    const original = blob.size
    if (advice.status === 'unused') {
      return { status: 'measured', original, cleared: null, cropped: null }
    }
    // Tiled or fully-sampled textures have nothing to reclaim.
    if (advice.tiling || advice.coverage >= 1 || !mask) {
      return { status: 'measured', original, cleared: original, cropped: null }
    }

    const mimeType = blob.type || texture.mimeType || ''
    const area = texture.width * texture.height
    const cropArea = advice.crop ? advice.crop.width * advice.crop.height : area
    if (canReencode(mimeType)) {
      try {
        const measured = await this.getClient().download({
          blob,
          mimeType,
          mask: mask.mask,
          maskWidth: mask.width,
          maskHeight: mask.height,
          crop: advice.crop,
        })
        const ratio = (size: number) =>
          Math.round(original * Math.min(1, size / measured.full))
        return {
          status: 'measured',
          original,
          cleared: ratio(measured.cleared),
          cropped:
            measured.croppedCleared === null ? null : ratio(measured.croppedCleared),
        }
      } catch {
        // fall through to the area estimate
      }
    }

    // Block-compressed formats (KTX2/Basis) scale ~linearly with area.
    return {
      status: 'estimated',
      original,
      cleared: null,
      cropped: area && advice.crop ? Math.round(original * (cropArea / area)) : null,
    }
  }
}

export { IDLE_ADVISORY, TextureAdvisor, isFlagged, projectedSavings, usageOf }
export type {
  AdvisorySnapshot,
  DownloadProjection,
  TextureAdvice,
  TextureOverlays,
}
