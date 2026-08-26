import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { Texture } from 'three/webgpu'

import { validateGltf, type GltfValidationResult } from './validate'

/**
 * Normalized, UI-friendly snapshot of a glTF document. Built once per load
 * from the raw glTF JSON (via GLTFLoader's parser) so the React layer never
 * has to touch three.js objects to render the contents browser.
 */

interface GltfMeshInfo {
  kind: 'mesh'
  id: number
  name: string
  mode: string
  primitives: number
  vertexCount: number
  indexType: string | null
  attributes: { name: string; type: string }[]
  instances: number
  size: number
  materialIds: number[]
  materialNames: string[]
}

type GltfNodeType =
  | 'mesh'
  | 'skinned-mesh'
  | 'instanced-mesh'
  | 'camera'
  | 'light'
  | 'joint'
  | 'group'
  | 'empty'

/**
 * One node of the scene graph, flattened into a depth-first list. `depth` and
 * `hasChildren` are all the tree view needs to render indentation and toggles;
 * a collapsed row hides the contiguous run of following rows with a greater
 * depth. `meshId` ties a node to its mesh's stats (null for transform/group
 * nodes, which render as parent rows with empty columns).
 */
interface GltfNodeInfo {
  kind: 'node'
  id: number
  name: string
  objectType: GltfNodeType
  depth: number
  hasChildren: boolean
  meshId: number | null
}

interface GltfMaterialInfo {
  kind: 'material'
  id: number
  name: string
  instances: number
  textureSlots: string[]
  alphaMode: string
  doubleSided: boolean
}

interface GltfTextureInfo {
  kind: 'texture'
  id: number
  name: string
  uri: string | null
  slots: string[]
  instances: number
  mimeType: string | null
  width: number
  height: number
  size: number | null
  gpuSize: number | null
  previewUrl: string | null
}

interface GltfAnimationInfo {
  kind: 'animation'
  id: number
  name: string
  channels: number
  samplers: number
  duration: number
  keyframes: number
  size: number
}

interface GltfSceneInfo {
  name: string
  nodeCount: number
  totalVertexCount: number
  animationCount: number
}

interface GltfDocumentInfo {
  fileName: string
  scene: GltfSceneInfo
  /** Scene graph flattened to a DFS list — the source for the tree view. */
  nodes: GltfNodeInfo[]
  meshes: GltfMeshInfo[]
  materials: GltfMaterialInfo[]
  textures: GltfTextureInfo[]
  animations: GltfAnimationInfo[]
  validationIssues: GltfValidationResult[]
}

/* ------------------------------- glTF JSON ------------------------------- */

interface GltfJsonAccessor {
  componentType: number
  count: number
  type: string
}

interface GltfJsonPrimitive {
  attributes: Record<string, number>
  indices?: number
  material?: number
  mode?: number
}

interface GltfJsonNode {
  name?: string
  mesh?: number
  skin?: number
  camera?: number
  children?: number[]
  extensions?: {
    EXT_mesh_gpu_instancing?: { attributes?: Record<string, number> }
    KHR_lights_punctual?: { light?: number }
  }
}

interface GltfJson {
  accessors?: GltfJsonAccessor[]
  meshes?: { name?: string; primitives: GltfJsonPrimitive[] }[]
  materials?: Record<string, unknown>[]
  textures?: {
    name?: string
    source?: number
    extensions?: Record<string, { source?: number }>
  }[]
  images?: {
    name?: string
    uri?: string
    mimeType?: string
    bufferView?: number
  }[]
  bufferViews?: { byteLength: number }[]
  nodes?: GltfJsonNode[]
  skins?: { joints?: number[] }[]
  scene?: number
  scenes?: { name?: string; nodes?: number[] }[]
  animations?: {
    name?: string
    channels?: { sampler: number }[]
    samplers?: { input: number; output: number }[]
  }[]
}

const COMPONENT_TYPE_LABELS: Record<number, string> = {
  5120: 'i8',
  5121: 'u8',
  5122: 'i16',
  5123: 'u16',
  5125: 'u32',
  5126: 'f32',
}

const COMPONENT_TYPE_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
}

const TYPE_COMPONENT_COUNTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}

const PRIMITIVE_MODE_LABELS: Record<number, string> = {
  0: 'POINTS',
  1: 'LINES',
  2: 'LINE_LOOP',
  3: 'LINE_STRIP',
  4: 'TRIANGLES',
  5: 'TRIANGLE_STRIP',
  6: 'TRIANGLE_FAN',
}

const PREVIEW_MAX_SIZE = 256

function accessorByteLength(accessor: GltfJsonAccessor) {
  const componentBytes = COMPONENT_TYPE_BYTES[accessor.componentType] ?? 0
  const componentCount = TYPE_COMPONENT_COUNTS[accessor.type] ?? 0
  return accessor.count * componentBytes * componentCount
}

/**
 * Recursively walks a material definition collecting `{ index }` texture
 * references, keyed by their slot name (baseColorTexture, normalTexture,
 * clearcoatTexture, ...). Covers core PBR slots and extension slots alike.
 */
function collectTextureSlots(
  value: unknown,
  slots: { slot: string; textureId: number }[],
  key = ''
) {
  if (typeof value !== 'object' || value === null) return

  const record = value as Record<string, unknown>

  if (/texture$/i.test(key) && typeof record.index === 'number') {
    slots.push({ slot: key, textureId: record.index })
    return
  }

  for (const [childKey, childValue] of Object.entries(record)) {
    collectTextureSlots(childValue, slots, childKey)
  }
}

function buildMeshInfos(json: GltfJson, materialNames: string[]) {
  const accessors = json.accessors ?? []
  const nodes = json.nodes ?? []

  return (json.meshes ?? []).map((mesh, id): GltfMeshInfo => {
    let vertexCount = 0
    let size = 0
    let indexType: string | null = null
    let mode = 4
    const attributeTypes = new Map<string, string>()
    const materialIds = new Set<number>()
    const seenAccessors = new Set<number>()

    const addAccessor = (index: number) => {
      if (seenAccessors.has(index)) return
      seenAccessors.add(index)
      const accessor = accessors[index]
      if (accessor) size += accessorByteLength(accessor)
    }

    for (const primitive of mesh.primitives) {
      mode = primitive.mode ?? mode

      for (const [attribute, accessorIndex] of Object.entries(
        primitive.attributes
      )) {
        const accessor = accessors[accessorIndex]
        if (!accessor) continue
        attributeTypes.set(
          attribute,
          COMPONENT_TYPE_LABELS[accessor.componentType] ?? '?'
        )
        addAccessor(accessorIndex)
        if (attribute === 'POSITION') vertexCount += accessor.count
      }

      if (primitive.indices !== undefined) {
        const accessor = accessors[primitive.indices]
        if (accessor) {
          indexType = COMPONENT_TYPE_LABELS[accessor.componentType] ?? '?'
        }
        addAccessor(primitive.indices)
      }

      if (primitive.material !== undefined) materialIds.add(primitive.material)
    }

    // A mesh is instanced once per node referencing it; GPU instancing
    // extensions multiply that by the per-node instance count.
    let instances = 0
    for (const node of nodes) {
      if (node.mesh !== id) continue
      const gpuAttributes =
        node.extensions?.EXT_mesh_gpu_instancing?.attributes
      const firstAttribute = gpuAttributes
        ? Object.values(gpuAttributes)[0]
        : undefined
      const gpuCount =
        firstAttribute !== undefined
          ? (accessors[firstAttribute]?.count ?? 1)
          : 1
      instances += gpuCount
    }

    const ids = [...materialIds].sort((a, b) => a - b)

    return {
      kind: 'mesh',
      id,
      name: mesh.name ?? `mesh_${id}`,
      mode: PRIMITIVE_MODE_LABELS[mode] ?? `MODE_${mode}`,
      primitives: mesh.primitives.length,
      vertexCount,
      indexType,
      attributes: [...attributeTypes.entries()]
        .map(([name, type]) => ({ name, type }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      instances,
      size,
      materialIds: ids,
      materialNames: ids.map((index) => materialNames[index] ?? `${index}`),
    }
  })
}

/**
 * Walks the scene graph depth-first into a flat, pre-ordered node list. Roots
 * come from the active scene (or, lacking scenes, every node that isn't some
 * other node's child). A `seen` guard keeps a malformed file with a node cycle
 * from recursing forever. Node names fall back to the referenced mesh's name,
 * then a synthetic `node_<i>`, mirroring how editors label unnamed nodes.
 */
function buildNodeInfos(
  json: GltfJson,
  meshes: GltfMeshInfo[]
): GltfNodeInfo[] {
  const nodes = json.nodes ?? []
  if (nodes.length === 0) return []
  const jointIds = new Set(
    (json.skins ?? []).flatMap(({ joints }) => joints ?? [])
  )

  const scene = json.scenes?.[json.scene ?? 0]
  const roots =
    scene?.nodes ??
    nodes
      .map((_, index) => index)
      .filter(
        (index) => !nodes.some((node) => node.children?.includes(index))
      )

  const list: GltfNodeInfo[] = []
  const seen = new Set<number>()

  const visit = (index: number, depth: number) => {
    const node = nodes[index]
    if (!node || seen.has(index)) return
    seen.add(index)

    const children = node.children ?? []
    const meshId = node.mesh ?? null

    list.push({
      kind: 'node',
      id: index,
      // `||` (not `??`): unnamed nodes often carry an empty string, which
      // should fall through to the mesh name and then a synthetic label.
      name:
        node.name?.trim() ||
        (meshId !== null ? meshes[meshId]?.name : undefined) ||
        `node_${index}`,
      objectType: classifyNode(node, index, jointIds),
      depth,
      hasChildren: children.length > 0,
      meshId,
    })

    for (const child of children) visit(child, depth + 1)
  }

  for (const root of roots) visit(root, 0)
  return list
}

function classifyNode(
  node: GltfJsonNode,
  index: number,
  jointIds: Set<number>
): GltfNodeType {
  if (node.extensions?.EXT_mesh_gpu_instancing) return 'instanced-mesh'
  if (node.mesh !== undefined && node.skin !== undefined) return 'skinned-mesh'
  if (node.mesh !== undefined) return 'mesh'
  if (node.camera !== undefined) return 'camera'
  if (node.extensions?.KHR_lights_punctual?.light !== undefined) return 'light'
  if (jointIds.has(index)) return 'joint'
  return node.children?.length ? 'group' : 'empty'
}

function buildMaterialInfos(json: GltfJson, meshes: GltfMeshInfo[]) {
  return (json.materials ?? []).map((material, id): GltfMaterialInfo => {
    const slots: { slot: string; textureId: number }[] = []
    collectTextureSlots(material, slots)

    // A material instance = a mesh primitive using it, counted once per
    // node instance of that mesh (matches gltf.report semantics).
    let instances = 0
    for (const mesh of meshes) {
      if (mesh.materialIds.includes(id)) {
        instances += Math.max(mesh.instances, 1)
      }
    }

    return {
      kind: 'material',
      id,
      name: (material.name as string | undefined) ?? `material_${id}`,
      instances,
      textureSlots: [...new Set(slots.map(({ slot }) => slot))],
      alphaMode: (material.alphaMode as string | undefined) ?? 'OPAQUE',
      doubleSided: Boolean(material.doubleSided),
    }
  })
}

function fileNameFromUri(uri: string) {
  const base = uri.split('/').pop() ?? uri
  return decodeURIComponent(base.split('?')[0])
}

/**
 * Renders a downscaled preview of a decoded texture image. Compressed
 * textures (e.g. KTX2 transcoded to GPU formats) have no drawable image and
 * return null.
 */
function renderTexturePreview(image: unknown): string | null {
  if (typeof document === 'undefined') return null
  if (
    !(image instanceof HTMLImageElement) &&
    !(image instanceof HTMLCanvasElement) &&
    !(typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)
  ) {
    return null
  }

  const { width, height } = image
  if (!width || !height) return null

  const scale = Math.min(1, PREVIEW_MAX_SIZE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))

  const context = canvas.getContext('2d')
  if (!context) return null

  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

async function buildTextureInfos(
  gltf: GLTF,
  json: GltfJson,
  materials: GltfMaterialInfo[]
) {
  const images = json.images ?? []
  const bufferViews = json.bufferViews ?? []

  // slot usage across all materials, keyed by texture id
  const slotsByTexture = new Map<number, Set<string>>()
  const instancesByTexture = new Map<number, number>()
  ;(json.materials ?? []).forEach((material, materialId) => {
    const slots: { slot: string; textureId: number }[] = []
    collectTextureSlots(material, slots)
    const materialInstances = materials[materialId]?.instances ?? 1
    for (const { slot, textureId } of slots) {
      if (!slotsByTexture.has(textureId)) {
        slotsByTexture.set(textureId, new Set())
      }
      slotsByTexture.get(textureId)!.add(slot)
      instancesByTexture.set(
        textureId,
        (instancesByTexture.get(textureId) ?? 0) + materialInstances
      )
    }
  })

  return Promise.all(
    (json.textures ?? []).map(async (texture, id): Promise<GltfTextureInfo> => {
      // Extensions like KHR_texture_basisu/webp move the source reference.
      const extensionSource = Object.values(texture.extensions ?? {}).find(
        (extension) => typeof extension?.source === 'number'
      )?.source
      const image = images[extensionSource ?? texture.source ?? -1]

      let width = 0
      let height = 0
      let previewUrl: string | null = null

      try {
        const threeTexture = (await gltf.parser.getDependency(
          'texture',
          id
        )) as Texture | null
        const textureImage = threeTexture?.image as
          | { width?: number; height?: number }
          | undefined
        width = textureImage?.width ?? 0
        height = textureImage?.height ?? 0
        previewUrl = renderTexturePreview(threeTexture?.image)
      } catch {
        // texture failed to decode — keep the row with whatever JSON tells us
      }

      const size =
        image?.bufferView !== undefined
          ? (bufferViews[image.bufferView]?.byteLength ?? null)
          : null

      // Uncompressed RGBA upload with full mip chain (~4/3 overhead).
      const gpuSize = width && height ? Math.round(width * height * 4 * 1.33) : null

      return {
        kind: 'texture',
        id,
        name:
          texture.name ??
          image?.name ??
          (image?.uri ? fileNameFromUri(image.uri) : `texture_${id}`),
        uri: image?.uri ?? null,
        slots: [...(slotsByTexture.get(id) ?? [])],
        instances: instancesByTexture.get(id) ?? 0,
        mimeType:
          image?.mimeType ??
          (image?.uri ? `image/${fileNameFromUri(image.uri).split('.').pop()}` : null),
        width,
        height,
        size,
        gpuSize,
        previewUrl,
      }
    })
  )
}

function buildAnimationInfos(json: GltfJson) {
  const accessors = json.accessors ?? []

  return (json.animations ?? []).map((animation, id): GltfAnimationInfo => {
    const samplers = animation.samplers ?? []

    // duration = latest keyframe time; the spec mandates min/max on inputs
    let duration = 0
    let keyframes = 0
    let size = 0
    const seenAccessors = new Set<number>()

    const addAccessor = (index: number) => {
      if (seenAccessors.has(index)) return
      seenAccessors.add(index)
      const accessor = accessors[index]
      if (accessor) size += accessorByteLength(accessor)
    }

    for (const sampler of samplers) {
      const input = accessors[sampler.input] as
        | (GltfJsonAccessor & { max?: number[] })
        | undefined
      if (input) {
        duration = Math.max(duration, input.max?.[0] ?? 0)
        if (!seenAccessors.has(sampler.input)) keyframes += input.count
      }
      addAccessor(sampler.input)
      addAccessor(sampler.output)
    }

    return {
      kind: 'animation',
      id,
      name: animation.name ?? `animation_${id}`,
      channels: animation.channels?.length ?? 0,
      samplers: samplers.length,
      duration,
      keyframes,
      size,
    }
  })
}

async function inspectGltf(
  gltf: GLTF,
  fileName: string
): Promise<GltfDocumentInfo> {
  const json = gltf.parser.json as GltfJson

  const materialNames = (json.materials ?? []).map(
    (material, id) => (material.name as string | undefined) ?? `material_${id}`
  )

  const meshes = buildMeshInfos(json, materialNames)
  const nodes = buildNodeInfos(json, meshes)
  const materials = buildMaterialInfos(json, meshes)
  const textures = await buildTextureInfos(gltf, json, materials)

  return {
    fileName,
    scene: {
      name: json.scenes?.[0]?.name ?? 'Scene',
      nodeCount: json.nodes?.length ?? 0,
      totalVertexCount: meshes.reduce(
        (total, mesh) => total + mesh.vertexCount * Math.max(mesh.instances, 1),
        0
      ),
      animationCount: json.animations?.length ?? 0,
    },
    nodes,
    meshes,
    materials,
    textures,
    animations: buildAnimationInfos(json),
    validationIssues: validateGltf(json),
  }
}

export { inspectGltf }
export type {
  GltfDocumentInfo,
  GltfNodeInfo,
  GltfNodeType,
  GltfMeshInfo,
  GltfMaterialInfo,
  GltfTextureInfo,
  GltfAnimationInfo,
  GltfSceneInfo,
}
