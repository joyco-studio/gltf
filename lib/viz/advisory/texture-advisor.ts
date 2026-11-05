import type { BufferGeometry, Object3D } from 'three/webgpu'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

import { Disposer } from '../disposer'
import { EventEmitter } from '../event-emitter'
import type { GltfDocumentInfo, GltfTextureInfo } from '../inspect'
import { getTextureBlob } from '../texture-download'
import { AdvisoryClient } from './advisory-client'
import {
  type DownloadProjection,
  type TextureAdvice,
} from './advice'
import { canReencode } from './advisory-jobs'
import { buildAdvisoryReport } from './advisory-report'
import { resolveTextureBindings, type TextureBindings } from './texture-bindings'
import type { UvLayer, UvRect } from './uv-coverage'
import type { TexelRect } from './advisory-jobs'

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

type Mask = { mask: Uint8Array; width: number; height: number }

/**
 * Textures that read the same image. Coverage, crops and savings belong to
 * the image, so they are computed over every member's UVs at once.
 */
function groupByImage(bindings: TextureBindings[], textureCount: number) {
  const groups = new Map<string, number[]>()
  for (let id = 0; id < textureCount; id += 1) {
    const imageIndex = bindings[id]?.imageIndex ?? null
    const key = imageIndex === null ? `texture:${id}` : `image:${imageIndex}`
    groups.set(key, [...(groups.get(key) ?? []), id])
  }
  return [...groups.values()]
}

function base64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

class TextureAdvisor extends EventEmitter<AdvisoryEvents> {
  private snapshot: AdvisorySnapshot = IDLE_ADVISORY
  private model: AdvisoryModel | null = null
  private run: Disposer | null = null
  private client: AdvisoryClient | null = null
  private disposed = false
  /** Unused-texel masks (PNG) of the current run, for the report. */
  private unusedMasks = new Map<number, Blob>()

  getSnapshot(): AdvisorySnapshot {
    return this.snapshot
  }

  /** Point the advisor at a freshly loaded model; analysis waits for `start`. */
  setModel(model: AdvisoryModel | null) {
    this.run?.dispose()
    this.run = null
    // A job still running for the old model would hold up the new one's queue.
    if (this.snapshot.status === 'analyzing') {
      this.client?.dispose()
      this.client = null
    }
    this.unusedMasks = new Map()
    this.model = model
    this.setSnapshot(IDLE_ADVISORY)
  }

  /**
   * The finished analysis as a Markdown + JSON hand-off report. Built only
   * from the model this analysis ran on, never from a newer one mid-load.
   */
  async exportReport(threshold: number) {
    const { model, snapshot, unusedMasks } = this
    if (!model || snapshot.status !== 'ready') return null
    const masks = new Map<number, string>()
    for (const [id, blob] of unusedMasks) {
      masks.set(id, base64(new Uint8Array(await blob.arrayBuffer())))
    }
    return {
      fileName: model.document.fileName,
      text: buildAdvisoryReport({
        fileName: model.document.fileName,
        document: model.document,
        json: model.gltf.parser.json,
        textures: snapshot.textures,
        threshold,
        unusedMasks: masks,
      }),
    }
  }

  /** Begin analysis for the current model (idempotent). */
  start() {
    if (!this.model || this.run) return
    const run = new Disposer()
    this.run = run
    void this.analyze(this.model, run)
  }

  dispose() {
    this.disposed = true
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

  /** The worker client for a still-live run; never spawns one after cancellation. */
  private getClient(run: Disposer) {
    if (this.disposed || run.disposed) throw new Error('Advisory run cancelled')
    this.client ??= new AdvisoryClient()
    return this.client
  }

  private async analyze(model: AdvisoryModel, run: Disposer) {
    const { gltf, document } = model
    const bindings = resolveTextureBindings(gltf.parser.json)
    const groups = groupByImage(bindings, document.textures.length)
    const textures: TextureAdvice[] = document.textures.map(() => ({
      status: 'pending',
    }))
    const masks = new Map<number[], Mask>()
    // Owned by this run; the report reads it only while this run is current.
    const unusedMasks = new Map<number, Blob>()
    this.unusedMasks = unusedMasks

    const commit = (group: number[], advice: TextureAdvice) => {
      if (run.disposed) return
      for (const id of group) {
        textures[id] =
          advice.status === 'analyzed' || advice.status === 'unused'
            ? { ...advice, sharedWith: group.filter((other) => other !== id) }
            : advice
      }
      this.setSnapshot({ status: 'analyzing', textures: [...textures] })
    }
    this.setSnapshot({ status: 'analyzing', textures: [...textures] })

    // Pass 1: coverage for every image, so the list fills in quickly.
    const uvCache = new Map<string, ReturnType<typeof readUvs>>()
    for (const group of groups) {
      if (run.disposed) return
      try {
        const advice = await this.analyzeCoverage(
          gltf,
          document.textures[group[0]],
          group.map((id) => bindings[id]).filter(Boolean),
          uvCache,
          run,
          (mask) => masks.set(group, mask),
          unusedMasks
        )
        commit(group, advice)
      } catch (error) {
        commit(group, {
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    uvCache.clear()

    // Pass 2: download projections (image re-encodes are the slow part).
    for (const group of groups) {
      if (run.disposed) return
      const advice = textures[group[0]]
      if (advice.status !== 'unused' && advice.status !== 'analyzed') continue
      const download = await this.projectDownload(
        model,
        document.textures[group[0]],
        advice,
        masks.get(group) ?? null,
        run
      ).catch((): DownloadProjection => ({ status: 'unavailable' }))
      commit(group, { ...advice, download })
    }

    if (!run.disposed) {
      this.setSnapshot({ status: 'ready', textures: [...textures] })
    }
  }

  private async analyzeCoverage(
    gltf: GLTF,
    texture: GltfTextureInfo,
    bindings: TextureBindings[],
    uvCache: Map<string, ReturnType<typeof readUvs>>,
    run: Disposer,
    keepMask: (mask: Mask) => void,
    unusedMasks: Map<number, Blob>
  ): Promise<TextureAdvice> {
    const pending: DownloadProjection = { status: 'pending' }
    if (!bindings.some((binding) => binding.referenced)) {
      return { status: 'unused', reason: 'unreferenced', sharedWith: [], download: pending }
    }

    // Every texture reading this image contributes its UVs, each through
    // its own sampler's wrap modes.
    const layers: UvLayer[] = []
    for (const binding of bindings) {
      for (const ref of binding.layers) {
        const key = `${ref.meshId}:${ref.primitiveIndex}:${ref.texCoord}`
        if (!uvCache.has(key)) {
          const mesh = (await gltf.parser.getDependency('mesh', ref.meshId)) as Object3D
          if (run.disposed) throw new Error('Advisory run cancelled')
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
    }
    if (layers.length === 0) {
      return { status: 'unused', reason: 'no-geometry', sharedWith: [], download: pending }
    }

    const { width, height, scale } = maskSize(texture)
    const result = await this.getClient(run).coverage({
      width,
      height,
      padding: Math.max(1, Math.ceil(PADDING_TEXELS * scale)),
      layers,
    })
    // An inline job can't be interrupted and may finish after the model was
    // replaced; drop its results instead of mixing them into the new run.
    if (run.disposed) throw new Error('Advisory run cancelled')
    keepMask({ mask: result.mask, width, height })
    if (result.unusedOverlay) {
      for (const binding of bindings) {
        unusedMasks.set(binding.textureId, result.unusedOverlay)
      }
    }

    const url = (blob: Blob | null) => {
      if (!blob || typeof URL.createObjectURL !== 'function') return null
      const objectUrl = URL.createObjectURL(blob)
      run.add(() => URL.revokeObjectURL(objectUrl))
      return objectUrl
    }

    return {
      status: 'analyzed',
      coverage: result.coverage,
      // Cropping remaps UVs; tiled or tile-offset islands would land wrong.
      crop:
        result.tiling || result.offset || !result.bounds
          ? null
          : cropRect(result.bounds, texture.width, texture.height),
      tiling: result.tiling,
      offset: result.offset,
      sharedWith: [],
      texCoords: [...new Set(bindings.flatMap((binding) => binding.texCoords))].sort(),
      users: bindings.flatMap((binding) => binding.users),
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
    mask: Mask | null,
    run: Disposer
  ): Promise<DownloadProjection> {
    const blob = await getTextureBlob(texture, gltf, files)
    // The fetch may outlive the run (model replaced, viewer closed).
    if (run.disposed) return { status: 'unavailable' }
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
        const measured = await this.getClient(run).download({
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

export { IDLE_ADVISORY, TextureAdvisor }
export { imageKey, isFlagged, projectedSavings, usageOf } from './advice'
export type { DownloadProjection, TextureAdvice, TextureOverlays } from './advice'
export type { AdvisorySnapshot }
