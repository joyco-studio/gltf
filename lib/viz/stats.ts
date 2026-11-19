import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

/**
 * File-weight statistics for a glTF document: where every byte of the file
 * goes (geometry, extra vertex attributes, textures, animation, …) plus the
 * scene counts and GPU-memory estimates that explain that weight.
 *
 * Bytes are attributed per bufferView — the unit that actually occupies the
 * file — so interleaved, shared, sparse, Draco and meshopt data are counted
 * once and at their stored (compressed) size. Whatever no resource claims
 * (JSON, GLB headers, alignment padding) is the remainder against the
 * measured file size, so the breakdown always sums to the net weight.
 */

type SizeCategory =
  | 'geometry'
  | 'attributes'
  | 'textures'
  | 'animation'
  | 'skinning'
  | 'morphs'
  | 'instancing'
  | 'unreferenced'
  | 'overhead'

interface SizeEntry {
  /** Semantic / mime type / sub-part this slice of the category came from. */
  key: string
  bytes: number
}

/** An inspectable element that owns bytes of a category. */
interface SizeOwner {
  kind: 'node' | 'mesh' | 'texture' | 'animation'
  id: number
}

interface SizeOffender extends SizeOwner {
  bytes: number
}

interface SizeBreakdownItem {
  category: SizeCategory
  bytes: number
  /** Sub-breakdown, largest first. */
  entries: SizeEntry[]
  /** The heaviest elements in this category, largest first (top 5). */
  offenders: SizeOffender[]
}

interface GltfStats {
  container: 'glb' | 'gltf'
  generator: string | null
  /** Measured weight of the root file plus every external resource. */
  totalSize: number | null
  /**
   * Non-empty categories in display order. Sums to `totalSize` when it is
   * known; otherwise it covers only what could be measured (no overhead).
   */
  breakdown: SizeBreakdownItem[]
  counts: {
    nodes: number
    meshes: number
    primitives: number
    drawCalls: number
    materials: number
    textures: number
    images: number
    animations: number
    skins: number
    vertices: { unique: number; rendered: number }
    triangles: { unique: number; rendered: number }
  }
  /** Rough GPU residency once decoded (compressed file data expands). */
  gpu: {
    /** Vertex + index buffers at their decoded accessor size. */
    geometry: number
    /** Uncompressed RGBA8 with mips — an upper bound for KTX2 textures. */
    textures: number
  }
  extensionsUsed: string[]
  extensionsRequired: string[]
}

/* ------------------------------- glTF JSON ------------------------------- */

interface StatsAccessor {
  bufferView?: number
  componentType: number
  count: number
  type: string
  sparse?: {
    count: number
    indices: { bufferView: number; componentType: number }
    values: { bufferView: number }
  }
}

interface StatsPrimitive {
  attributes: Record<string, number>
  indices?: number
  mode?: number
  targets?: Record<string, number>[]
  extensions?: {
    KHR_draco_mesh_compression?: { bufferView?: number }
  }
}

interface StatsJson {
  asset?: { generator?: string }
  extensionsUsed?: string[]
  extensionsRequired?: string[]
  accessors?: StatsAccessor[]
  buffers?: {
    byteLength: number
    uri?: string
  }[]
  bufferViews?: {
    buffer: number
    byteLength: number
    extensions?: {
      EXT_meshopt_compression?: { buffer: number; byteLength: number }
      KHR_meshopt_compression?: { buffer: number; byteLength: number }
    }
  }[]
  images?: { uri?: string; mimeType?: string; bufferView?: number }[]
  meshes?: { primitives: StatsPrimitive[] }[]
  nodes?: {
    mesh?: number
    skin?: number
    extensions?: {
      EXT_mesh_gpu_instancing?: { attributes?: Record<string, number> }
    }
  }[]
  skins?: { inverseBindMatrices?: number }[]
  animations?: {
    channels?: { sampler: number; target?: { path?: string } }[]
    samplers?: { input: number; output: number }[]
  }[]
  materials?: unknown[]
  textures?: {
    source?: number
    extensions?: Record<string, { source?: number } | undefined>
  }[]
}

interface GltfStatsInput {
  json: unknown
  /** Measured net weight (root + external resources), null if unknown. */
  totalSize: number | null
  /** Byte length of the GLB JSON chunk; null for a .gltf root. */
  glbJsonLength: number | null
  /** Measured size of external resources, keyed by their raw JSON `uri`. */
  resourceSizes?: ReadonlyMap<string, number>
  /** Per-mesh instance counts (node refs × GPU instances), by mesh id. */
  meshInstances?: readonly number[]
  /** Estimated GPU bytes per unique image (null when not decoded). */
  textureGpuSizes?: readonly (number | null)[]
}

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
}

const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}

/** Display order — also the fixed categorical color order. */
const CATEGORY_ORDER: SizeCategory[] = [
  'geometry',
  'attributes',
  'textures',
  'animation',
  'skinning',
  'morphs',
  'instancing',
  'unreferenced',
  'overhead',
]

function accessorBytes(accessor: StatsAccessor) {
  return (
    accessor.count *
    (COMPONENT_BYTES[accessor.componentType] ?? 0) *
    (TYPE_COMPONENTS[accessor.type] ?? 0)
  )
}

function dataUriMime(uri: string) {
  return /^data:([^;,]+)/.exec(uri)?.[1] ?? null
}

function imageMime(image: { uri?: string; mimeType?: string }) {
  if (image.mimeType) return image.mimeType
  if (image.uri?.startsWith('data:')) return dataUriMime(image.uri) ?? 'image'
  const extension = image.uri?.split(/[?#]/)[0].split('.').pop()?.toLowerCase()
  if (!extension) return 'image'
  return `image/${extension === 'jpg' ? 'jpeg' : extension}`
}

function primitiveTriangles(mode: number, count: number) {
  if (mode === 4) return Math.floor(count / 3)
  if (mode === 5 || mode === 6) return Math.max(count - 2, 0)
  return 0
}

const OFFENDER_LIMIT = 5

class ByteLedger {
  private totals = new Map<SizeCategory, Map<string, number>>()
  private owners = new Map<SizeCategory, Map<string, SizeOffender>>()

  add(category: SizeCategory, key: string, bytes: number, owner?: SizeOwner) {
    if (!(bytes > 0)) return
    let entries = this.totals.get(category)
    if (!entries) {
      entries = new Map()
      this.totals.set(category, entries)
    }
    entries.set(key, (entries.get(key) ?? 0) + bytes)

    if (!owner) return
    let owners = this.owners.get(category)
    if (!owners) {
      owners = new Map()
      this.owners.set(category, owners)
    }
    const ownerKey = `${owner.kind}:${owner.id}`
    const offender = owners.get(ownerKey) ?? { ...owner, bytes: 0 }
    offender.bytes += bytes
    owners.set(ownerKey, offender)
  }

  sum() {
    let total = 0
    for (const entries of this.totals.values()) {
      for (const bytes of entries.values()) total += bytes
    }
    return total
  }

  toBreakdown(): SizeBreakdownItem[] {
    return CATEGORY_ORDER.flatMap((category) => {
      const entries = [...(this.totals.get(category) ?? new Map())]
        .map(([key, bytes]) => ({ key, bytes: Math.round(bytes) }))
        .filter(({ bytes }) => bytes > 0)
        .sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key))
      const bytes = entries.reduce((total, entry) => total + entry.bytes, 0)
      const offenders = [...(this.owners.get(category)?.values() ?? [])]
        .map((offender) => ({ ...offender, bytes: Math.round(offender.bytes) }))
        .filter(({ bytes }) => bytes > 0)
        .sort((a, b) => b.bytes - a.bytes || a.id - b.id)
        .slice(0, OFFENDER_LIMIT)
      return bytes > 0 ? [{ category, bytes, entries, offenders }] : []
    })
  }
}

interface Claim {
  category: SizeCategory
  key: string
  weight: number
  owner?: SizeOwner
}

function computeGltfStats({
  json: rawJson,
  totalSize,
  glbJsonLength,
  resourceSizes,
  meshInstances = [],
  textureGpuSizes = [],
}: GltfStatsInput): GltfStats {
  const json = (rawJson ?? {}) as StatsJson
  const accessors = json.accessors ?? []
  const buffers = json.buffers ?? []
  const bufferViews = json.bufferViews ?? []
  const meshes = json.meshes ?? []
  const nodes = json.nodes ?? []

  /* ---- who uses each bufferView (first claim on an accessor wins) ---- */

  const claims = new Map<number, Claim[]>()
  const claimedAccessors = new Set<number>()
  let gpuGeometry = 0

  const claimView = (view: number | undefined, claim: Claim) => {
    if (view === undefined || !bufferViews[view]) return
    const list = claims.get(view) ?? []
    list.push(claim)
    claims.set(view, list)
  }

  const claimAccessor = (
    index: number | undefined,
    category: SizeCategory,
    key: string,
    residentOnGpu: boolean,
    owner?: SizeOwner
  ) => {
    if (index === undefined || claimedAccessors.has(index)) return
    const accessor = accessors[index]
    if (!accessor) return
    claimedAccessors.add(index)
    const bytes = accessorBytes(accessor)
    if (residentOnGpu) gpuGeometry += bytes
    claimView(accessor.bufferView, { category, key, weight: bytes, owner })
    const { sparse } = accessor
    if (sparse) {
      claimView(sparse.indices.bufferView, {
        category,
        key,
        owner,
        weight: sparse.count * (COMPONENT_BYTES[sparse.indices.componentType] ?? 0),
      })
      claimView(sparse.values.bufferView, {
        category,
        key,
        owner,
        weight:
          sparse.count *
          (COMPONENT_BYTES[accessor.componentType] ?? 0) *
          (TYPE_COMPONENTS[accessor.type] ?? 0),
      })
    }
  }

  let primitiveCount = 0
  const uniqueTrianglesByMesh: number[] = []
  const uniqueVerticesByMesh: number[] = []

  meshes.forEach((mesh, meshId) => {
    const owner: SizeOwner = { kind: 'mesh', id: meshId }
    let triangles = 0
    let vertices = 0
    for (const primitive of mesh.primitives ?? []) {
      primitiveCount += 1
      const positions = accessors[primitive.attributes?.POSITION ?? -1]
      const indices =
        primitive.indices !== undefined ? accessors[primitive.indices] : undefined
      vertices += positions?.count ?? 0
      triangles += primitiveTriangles(
        primitive.mode ?? 4,
        indices?.count ?? positions?.count ?? 0
      )

      const draco = primitive.extensions?.KHR_draco_mesh_compression
      if (draco) {
        claimView(draco.bufferView, {
          category: 'geometry',
          key: 'Draco compressed',
          weight: 1,
          owner,
        })
      }

      claimAccessor(primitive.indices, 'geometry', 'Indices', true, owner)
      for (const [semantic, index] of Object.entries(primitive.attributes ?? {})) {
        if (semantic === 'POSITION') {
          claimAccessor(index, 'geometry', 'Positions', true, owner)
        } else if (/^(JOINTS|WEIGHTS)_\d+$/.test(semantic)) {
          claimAccessor(index, 'skinning', semantic, true, owner)
        } else {
          claimAccessor(index, 'attributes', semantic, true, owner)
        }
      }
      for (const target of primitive.targets ?? []) {
        for (const [semantic, index] of Object.entries(target)) {
          claimAccessor(index, 'morphs', semantic, true, owner)
        }
      }
    }
    uniqueTrianglesByMesh[meshId] = triangles
    uniqueVerticesByMesh[meshId] = vertices
  })

  // Skins aren't inspectable on their own — credit the first node using one.
  ;(json.skins ?? []).forEach((skin, skinId) => {
    const nodeId = nodes.findIndex((node) => node.skin === skinId)
    claimAccessor(
      skin.inverseBindMatrices,
      'skinning',
      'Inverse bind matrices',
      false,
      nodeId >= 0 ? { kind: 'node', id: nodeId } : undefined
    )
  })

  let drawCalls = 0
  nodes.forEach((node, nodeId) => {
    if (node.mesh === undefined) return
    drawCalls += meshes[node.mesh]?.primitives?.length ?? 0
    const instancing = node.extensions?.EXT_mesh_gpu_instancing?.attributes
    for (const [semantic, index] of Object.entries(instancing ?? {})) {
      claimAccessor(index, 'instancing', semantic, true, { kind: 'node', id: nodeId })
    }
  })

  ;(json.animations ?? []).forEach((animation, animationId) => {
    const owner: SizeOwner = { kind: 'animation', id: animationId }
    const samplers = animation.samplers ?? []
    // Values are named by what they drive; shared samplers count once.
    const pathBySampler = new Map<number, string>()
    for (const channel of animation.channels ?? []) {
      if (!pathBySampler.has(channel.sampler)) {
        pathBySampler.set(channel.sampler, channel.target?.path ?? 'values')
      }
    }
    samplers.forEach((sampler, index) => {
      claimAccessor(sampler.input, 'animation', 'Keyframe times', false, owner)
      claimAccessor(
        sampler.output,
        'animation',
        pathBySampler.get(index) ?? 'values',
        false,
        owner
      )
    })
  })

  // Images are inspected through the first texture that samples them;
  // extensions like KHR_texture_basisu/webp move the source reference.
  const textureByImage = new Map<number, number>()
  ;(json.textures ?? []).forEach((texture, textureId) => {
    const source =
      Object.values(texture.extensions ?? {}).find(
        (extension) => typeof extension?.source === 'number'
      )?.source ?? texture.source
    if (source !== undefined && !textureByImage.has(source)) {
      textureByImage.set(source, textureId)
    }
  })
  const imageOwner = (imageId: number): SizeOwner | undefined => {
    const textureId = textureByImage.get(imageId)
    return textureId !== undefined ? { kind: 'texture', id: textureId } : undefined
  }

  ;(json.images ?? []).forEach((image, imageId) => {
    claimView(image.bufferView, {
      category: 'textures',
      key: imageMime(image),
      weight: 1,
      owner: imageOwner(imageId),
    })
  })

  /* ---------------- stored bytes per bufferView → ledger ---------------- */

  // File bytes per stored byte: 1 for GLB/.bin, ~4/3 for base64 data URIs.
  const bufferScale = buffers.map((buffer) =>
    buffer.uri?.startsWith('data:') && buffer.byteLength > 0
      ? buffer.uri.length / buffer.byteLength
      : 1
  )

  const ledger = new ByteLedger()
  bufferViews.forEach((view, index) => {
    // Meshopt stores the compressed stream elsewhere; the view's own buffer
    // is a decode target that typically has no bytes in the file.
    const meshopt =
      view.extensions?.EXT_meshopt_compression ??
      view.extensions?.KHR_meshopt_compression
    const stored = meshopt
      ? meshopt.byteLength * (bufferScale[meshopt.buffer] ?? 1)
      : view.byteLength * (bufferScale[view.buffer] ?? 1)

    const viewClaims = claims.get(index)
    if (!viewClaims?.length) {
      ledger.add('unreferenced', 'Buffer views', stored)
      return
    }
    const totalWeight = viewClaims.reduce((total, claim) => total + claim.weight, 0)
    for (const claim of viewClaims) {
      const share = totalWeight > 0 ? claim.weight / totalWeight : 1 / viewClaims.length
      ledger.add(claim.category, claim.key, stored * share, claim.owner)
    }
  })

  // Images outside any bufferView: inline data URIs or sibling files.
  let unmeasuredResources = false
  ;(json.images ?? []).forEach((image, imageId) => {
    if (image.bufferView !== undefined || !image.uri) return
    const size = image.uri.startsWith('data:')
      ? image.uri.length // inline in the JSON text
      : resourceSizes?.get(image.uri)
    if (size === undefined) unmeasuredResources = true
    else ledger.add('textures', imageMime(image), size, imageOwner(imageId))
  })

  // External buffers that are larger than their declared byteLength (or
  // unused tails) still weigh in the file.
  for (const buffer of buffers) {
    if (!buffer.uri || buffer.uri.startsWith('data:')) continue
    const size = resourceSizes?.get(buffer.uri)
    if (size === undefined) unmeasuredResources = true
    else if (size > buffer.byteLength) {
      ledger.add('overhead', 'Buffer padding', size - buffer.byteLength)
    }
  }

  /* ------------------- remainder: JSON, headers, padding ------------------ */

  if (totalSize !== null && !unmeasuredResources) {
    const remainder = Math.max(totalSize - ledger.sum(), 0)
    if (glbJsonLength !== null) {
      const jsonBytes = Math.min(glbJsonLength, remainder)
      ledger.add('overhead', 'JSON', jsonBytes)
      ledger.add('overhead', 'Headers & padding', remainder - jsonBytes)
    } else {
      ledger.add('overhead', 'JSON', remainder)
    }
  } else if (glbJsonLength !== null) {
    ledger.add('overhead', 'JSON', glbJsonLength)
  }

  /* -------------------------------- counts -------------------------------- */

  let uniqueVertices = 0
  let renderedVertices = 0
  let uniqueTriangles = 0
  let renderedTriangles = 0
  meshes.forEach((_, meshId) => {
    const instances = meshInstances[meshId] ?? 1
    uniqueVertices += uniqueVerticesByMesh[meshId] ?? 0
    uniqueTriangles += uniqueTrianglesByMesh[meshId] ?? 0
    renderedVertices += (uniqueVerticesByMesh[meshId] ?? 0) * instances
    renderedTriangles += (uniqueTrianglesByMesh[meshId] ?? 0) * instances
  })

  return {
    container: glbJsonLength !== null ? 'glb' : 'gltf',
    generator: json.asset?.generator ?? null,
    totalSize,
    breakdown: ledger.toBreakdown(),
    counts: {
      nodes: nodes.length,
      meshes: meshes.length,
      primitives: primitiveCount,
      drawCalls,
      materials: json.materials?.length ?? 0,
      textures: json.textures?.length ?? 0,
      images: json.images?.length ?? 0,
      animations: json.animations?.length ?? 0,
      skins: json.skins?.length ?? 0,
      vertices: { unique: uniqueVertices, rendered: renderedVertices },
      triangles: { unique: uniqueTriangles, rendered: renderedTriangles },
    },
    gpu: {
      geometry: gpuGeometry,
      textures: textureGpuSizes.reduce<number>((total, size) => total + (size ?? 0), 0),
    },
    extensionsUsed: [...(json.extensionsUsed ?? [])].sort(),
    extensionsRequired: [...(json.extensionsRequired ?? [])].sort(),
  }
}

/** Byte length of the JSON chunk when GLTFLoader parsed a GLB container. */
function glbJsonLength(gltf: GLTF): number | null {
  const extensions = gltf.parser.extensions as
    | Record<string, { content?: unknown } | undefined>
    | undefined
  const binary = extensions?.KHR_binary_glTF
  return typeof binary?.content === 'string'
    ? new TextEncoder().encode(binary.content).byteLength
    : null
}

export { CATEGORY_ORDER, computeGltfStats, glbJsonLength }
export type {
  GltfStats,
  GltfStatsInput,
  SizeBreakdownItem,
  SizeCategory,
  SizeEntry,
  SizeOffender,
  SizeOwner,
}
