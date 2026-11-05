import { WRAP_REPEAT, textureTransformMatrix } from './uv-coverage'

/**
 * Resolves, from raw glTF JSON, every way a texture gets sampled: which
 * material slot binds it, through which UV set and texture transform, and
 * which mesh primitives draw with that material.
 */

interface TextureRef {
  slot: string
  textureId: number
  texCoord: number
  transform: number[] | null
}

interface TextureUser {
  materialId: number
  materialName: string
  meshId: number
  meshName: string
  slot: string
  texCoord: number
}

/** A unique (primitive, UV set, transform) the coverage pass must rasterize. */
interface TextureLayerRef {
  meshId: number
  primitiveIndex: number
  texCoord: number
  transform: number[] | null
}

interface TextureBindings {
  textureId: number
  /** The glTF image this texture reads, or null when it has no source. */
  imageIndex: number | null
  /** Referenced by at least one material. */
  referenced: boolean
  users: TextureUser[]
  layers: TextureLayerRef[]
  texCoords: number[]
  wrapS: number
  wrapT: number
}

interface BindingsPrimitive {
  material?: number
  mode?: number
  extensions?: {
    KHR_materials_variants?: { mappings?: { material?: number }[] }
  }
}

interface BindingsJson {
  meshes?: { name?: string; primitives: BindingsPrimitive[] }[]
  materials?: Record<string, unknown>[]
  textures?: {
    sampler?: number
    source?: number
    extensions?: Record<string, { source?: number } | undefined>
  }[]
  samplers?: { wrapS?: number; wrapT?: number }[]
}

interface TextureTransformJson {
  offset?: number[]
  rotation?: number
  scale?: number[]
  texCoord?: number
}

/** The image a texture samples; extensions like KHR_texture_basisu/webp move the source. */
function textureImageIndex(texture: NonNullable<BindingsJson['textures']>[number] | undefined) {
  const extensionSource = Object.values(texture?.extensions ?? {}).find(
    (extension) => typeof extension?.source === 'number'
  )?.source
  return extensionSource ?? texture?.source ?? null
}

/**
 * Every material a primitive can draw with: its default plus any
 * KHR_materials_variants alternatives, which swap in at runtime.
 */
function primitiveMaterials(primitive: BindingsPrimitive) {
  const materials = new Set<number>()
  if (primitive.material !== undefined) materials.add(primitive.material)
  for (const mapping of primitive.extensions?.KHR_materials_variants?.mappings ?? []) {
    if (typeof mapping.material === 'number') materials.add(mapping.material)
  }
  return materials
}

/** Primitive modes that sample textures across an area. */
const TRIANGLE_MODES = new Set([4, 5, 6])

/**
 * Recursively walks a material definition collecting `{ index }` texture
 * references keyed by slot name (baseColorTexture, normalTexture,
 * clearcoatTexture, ...). Covers core PBR slots and extension slots alike.
 */
function collectTextureRefs(value: unknown, refs: TextureRef[], key = '') {
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>

  if (/texture$/i.test(key) && typeof record.index === 'number') {
    const transform = (
      record.extensions as { KHR_texture_transform?: TextureTransformJson } | undefined
    )?.KHR_texture_transform
    refs.push({
      slot: key,
      textureId: record.index,
      texCoord:
        transform?.texCoord ??
        (typeof record.texCoord === 'number' ? record.texCoord : 0),
      transform: transform ? textureTransformMatrix(transform) : null,
    })
    return
  }

  for (const [childKey, childValue] of Object.entries(record)) {
    collectTextureRefs(childValue, refs, childKey)
  }
}

function resolveTextureBindings(json: BindingsJson): TextureBindings[] {
  const materials = json.materials ?? []
  const meshes = json.meshes ?? []

  const refsByMaterial = materials.map((material) => {
    const refs: TextureRef[] = []
    collectTextureRefs(material, refs)
    return refs
  })

  return (json.textures ?? []).map((texture, textureId) => {
    const sampler = json.samplers?.[texture.sampler ?? -1]
    const users: TextureUser[] = []
    const layers = new Map<string, TextureLayerRef>()
    let referenced = false

    refsByMaterial.forEach((refs, materialId) => {
      const bound = refs.filter((ref) => ref.textureId === textureId)
      if (bound.length === 0) return
      referenced = true
      const materialName =
        (materials[materialId].name as string | undefined) ??
        `material_${materialId}`

      meshes.forEach((mesh, meshId) => {
        mesh.primitives.forEach((primitive, primitiveIndex) => {
          if (!primitiveMaterials(primitive).has(materialId)) return
          if (!TRIANGLE_MODES.has(primitive.mode ?? 4)) return
          for (const ref of bound) {
            const key = `${meshId}:${primitiveIndex}:${ref.texCoord}:${ref.transform?.join(',') ?? ''}`
            if (!layers.has(key)) {
              layers.set(key, {
                meshId,
                primitiveIndex,
                texCoord: ref.texCoord,
                transform: ref.transform,
              })
            }
            const userExists = users.some(
              (user) =>
                user.materialId === materialId &&
                user.meshId === meshId &&
                user.slot === ref.slot
            )
            if (!userExists) {
              users.push({
                materialId,
                materialName,
                meshId,
                meshName: mesh.name ?? `mesh_${meshId}`,
                slot: ref.slot,
                texCoord: ref.texCoord,
              })
            }
          }
        })
      })
    })

    const layerList = [...layers.values()]
    return {
      textureId,
      imageIndex: textureImageIndex(texture),
      referenced,
      users,
      layers: layerList,
      texCoords: [...new Set(layerList.map((layer) => layer.texCoord))].sort(),
      wrapS: sampler?.wrapS ?? WRAP_REPEAT,
      wrapT: sampler?.wrapT ?? WRAP_REPEAT,
    }
  })
}

export { collectTextureRefs, resolveTextureBindings, textureImageIndex }
export type { TextureBindings, TextureLayerRef, TextureRef, TextureUser }
