import type { GltfDocumentInfo } from '../inspect'
import type { TexelRect } from './advisory-jobs'
import {
  isFlagged,
  projectedSavings,
  type TextureAdvice,
} from './texture-advisor'
import { resolveTextureBindings } from './texture-bindings'

/**
 * A hand-off report for an agent that will apply the advice in Blender:
 * Markdown instructions plus one machine-readable JSON block. Coordinates
 * are given in both glTF space (top-left origin) and Blender space
 * (bottom-left origin) so nothing has to be converted by hand.
 */

const REPORT_SCHEMA = 'gltf-texture-advisory/v1'

type ReportAction = 'remove' | 'crop' | 'flatten' | 'repack'

interface ReportJson {
  textures?: {
    name?: string
    source?: number
    extensions?: Record<string, { source?: number }>
  }[]
  images?: { name?: string; uri?: string; mimeType?: string; bufferView?: number }[]
}

interface AdvisoryReportInput {
  fileName: string
  document: GltfDocumentInfo
  json: unknown
  textures: readonly TextureAdvice[]
  /** Flag threshold, 0–100. */
  threshold: number
  /** Base64 PNG per texture id: opaque where texels are never sampled. */
  unusedMasks?: ReadonlyMap<number, string>
  generatedAt?: Date
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Crop rect in every space the Blender side might work in. */
function cropSpaces(crop: TexelRect, width: number, height: number) {
  const minU = crop.x / width
  const maxU = (crop.x + crop.width) / width
  const minV = crop.y / height
  const maxV = (crop.y + crop.height) / height
  const blenderMinV = 1 - maxV
  const blenderMaxV = 1 - minV
  const scaleU = 1 / (maxU - minU)
  const scaleV = 1 / (blenderMaxV - blenderMinV)
  return {
    pixelsTopLeft: crop,
    pixelsBottomLeft: {
      x: crop.x,
      y: height - crop.y - crop.height,
      width: crop.width,
      height: crop.height,
    },
    uvGltf: { minU: round(minU), minV: round(minV), maxU: round(maxU), maxV: round(maxV) },
    uvBlender: {
      minU: round(minU),
      minV: round(blenderMinV),
      maxU: round(maxU),
      maxV: round(blenderMaxV),
    },
    /** Blender Mapping node (type Point): out = location + scale · in. */
    mappingNode: {
      type: 'POINT',
      location: [round(-minU * scaleU), round(-blenderMinV * scaleV), 0],
      scale: [round(scaleU), round(scaleV), 1],
    },
    /** Direct UV edit in Blender space: uv' = (uv − min) · scale. */
    uvRemap: {
      subtract: [round(minU), round(blenderMinV)],
      multiply: [round(scaleU), round(scaleV)],
    },
  }
}

function actionsFor(advice: TextureAdvice, flagged: boolean): ReportAction[] {
  if (advice.status === 'unused') return ['remove']
  if (advice.status !== 'analyzed' || !flagged) return []
  return advice.crop ? ['crop', 'flatten'] : ['flatten', 'repack']
}

function buildAdvisoryReport({
  fileName,
  document,
  json,
  textures,
  threshold,
  unusedMasks,
  generatedAt = new Date(),
}: AdvisoryReportInput): string {
  const gltfJson = json as ReportJson
  const bindings = resolveTextureBindings(json as Parameters<typeof resolveTextureBindings>[0])
  const objectsByMesh = new Map<number, string[]>()
  for (const node of document.nodes) {
    if (node.meshId === null) continue
    const names = objectsByMesh.get(node.meshId) ?? []
    names.push(node.name)
    objectsByMesh.set(node.meshId, names)
  }

  const entries = document.textures.map((texture) => {
    const advice = textures[texture.id] ?? { status: 'pending' as const }
    const flagged = isFlagged(advice, threshold)
    const definition = gltfJson.textures?.[texture.id]
    const extensionSource = Object.values(definition?.extensions ?? {}).find(
      (extension) => typeof extension?.source === 'number'
    )?.source
    const imageIndex = extensionSource ?? definition?.source ?? null
    const image = imageIndex !== null ? gltfJson.images?.[imageIndex] : undefined
    const binding = bindings[texture.id]
    const analyzed = advice.status === 'analyzed' ? advice : null
    const download =
      advice.status === 'analyzed' || advice.status === 'unused'
        ? advice.download
        : null
    const sizes =
      download && (download.status === 'measured' || download.status === 'estimated')
        ? download
        : null

    return {
      id: texture.id,
      name: texture.name,
      image: {
        index: imageIndex,
        name: image?.name ?? null,
        uri: image?.uri && !image.uri.startsWith('data:') ? image.uri : null,
        embedded: image?.bufferView !== undefined || Boolean(image?.uri?.startsWith('data:')),
        mimeType: texture.mimeType,
        width: texture.width,
        height: texture.height,
      },
      status: advice.status,
      unusedReason: advice.status === 'unused' ? advice.reason : null,
      flagged,
      actions: actionsFor(advice, flagged),
      usage: analyzed ? round(analyzed.coverage, 4) : advice.status === 'unused' ? 0 : null,
      tiling: analyzed?.tiling ?? false,
      textureTransform: binding?.layers.some((layer) => layer.transform !== null) ?? false,
      crop:
        analyzed?.crop && texture.width && texture.height
          ? cropSpaces(analyzed.crop, texture.width, texture.height)
          : null,
      bytes: sizes
        ? {
            original: sizes.original,
            flattened: sizes.cleared,
            croppedAndFlattened: sizes.cropped,
            method: sizes.status,
            savings: projectedSavings(advice),
          }
        : null,
      usedBy: (analyzed?.users ?? []).map((user) => ({
        material: user.materialName,
        slot: user.slot,
        uvMapIndex: user.texCoord,
        mesh: user.meshName,
        objects: objectsByMesh.get(user.meshId) ?? [],
      })),
      unusedMaskPng: unusedMasks?.get(texture.id) ?? null,
    }
  })

  const actionable = entries
    .filter((entry) => entry.actions.length > 0)
    .sort((a, b) => (b.bytes?.savings ?? 0) - (a.bytes?.savings ?? 0))
  const totalSavings = actionable.reduce(
    (total, entry) => total + (entry.bytes?.savings ?? 0),
    0
  )

  const data = {
    schema: REPORT_SCHEMA,
    source: fileName,
    generatedAt: generatedAt.toISOString(),
    threshold: threshold / 100,
    paddingTexels: 4,
    conventions: {
      usage: 'Share of texels covered by UV triangles (plus a 4-texel mip gutter), 0–1.',
      pixelsTopLeft: 'Image pixels, origin top-left (glTF / PNG row order).',
      pixelsBottomLeft: 'Image pixels, origin bottom-left (Blender image.pixels row order).',
      uvGltf: 'glTF UVs: origin top-left, v grows down.',
      uvBlender: 'Blender UVs: origin bottom-left, v_blender = 1 − v_gltf.',
      unusedMaskPng:
        'Base64 PNG at reduced resolution; alpha 255 = never sampled. Row 0 is the TOP of the image (flip vertically for Blender).',
      uvMapIndex: 'Index of the UV map on the mesh (TEXCOORD_n). The Blender importer usually names index 0 "UVMap".',
    },
    textures: entries,
  }

  const lines: string[] = [
    `# Texture advisory: ${fileName}`,
    '',
    `Generated ${generatedAt.toISOString()} by the glTF visualizer. Flag threshold: textures using less than ${threshold}% of their texels.`,
    '',
    actionable.length > 0
      ? `**${actionable.length} of ${entries.length} textures need action. Projected download savings: ${formatBytes(totalSavings)}.**`
      : `**No texture is below the threshold. Nothing to do.**`,
    '',
    '## Instructions for the Blender agent',
    '',
    `You are working on the Blender scene imported from \`${fileName}\`. Apply the actions below, then re-export with the glTF exporter. Do not change anything that is not listed.`,
    '',
    '- **Coordinate spaces.** glTF and PNG use a top-left origin; Blender uses bottom-left. Every rect in the JSON comes in both (`pixelsTopLeft`/`pixelsBottomLeft`, `uvGltf`/`uvBlender`). Use the Blender variants inside Blender.',
    '- **Finding things.** Images, materials and meshes keep their glTF names on import. Objects are named after glTF nodes (`objects`). Embedded images may show up as packed images.',
    '- **`remove`.** Nothing samples this image. Delete the image, and any material that is listed as unused because no mesh draws it.',
    '- **`crop`.** Crop the image to `crop.pixelsBottomLeft` and save it in the same format. Then remap sampling so the meshes still line up. **Prefer a Mapping node** (type Point, values in `crop.mappingNode`) between the UV source and this Image Texture node, in every material listed in `usedBy`. The glTF exporter writes it out as `KHR_texture_transform`. Only edit mesh UVs directly (`crop.uvRemap`) when every texture sampled through that UV map gets exactly the same crop, because editing UVs moves all of them.',
    '- **`flatten`.** Fill every texel that the UV islands never sample with one flat color (opaque black, or the island edge color), keeping the resolution. This only shrinks the compressed file. `unusedMaskPng` marks those texels (flip it vertically for Blender). You can also recompute the mask by rasterizing the listed objects\' faces in that UV map, plus a 4-texel margin.',
    '- **`repack`.** The unused space sits between islands, so cropping cannot reclaim it. Pack the islands (UV › Pack Islands, margin ≥ 4 px at this resolution) and re-bake every texture in the set from the old layout. Do this only if baking is available; otherwise do `flatten` alone.',
    '- **Caution.** Textures marked `tiling` repeat by design: never crop them. If `textureTransform` is true, the material already has a Mapping node, so compose your offset/scale with it instead of replacing it.',
    '',
    '## Actions',
    '',
  ]

  if (actionable.length === 0) lines.push('_None._', '')
  actionable.forEach((entry, index) => {
    const usage = entry.usage === null ? '?' : `${Math.round(entry.usage * 100)}%`
    lines.push(
      `### ${index + 1}. \`${entry.name}\` (texture #${entry.id}): ${entry.actions.join(' + ')}`,
      '',
      `- Image: ${entry.image.name ? `\`${entry.image.name}\`` : `glTF image #${entry.image.index ?? '?'} (unnamed; match it through the materials below)`}${entry.image.uri ? ` from \`${entry.image.uri}\`` : entry.image.embedded ? ' (embedded)' : ''}, ${entry.image.mimeType ?? 'unknown format'}, ${entry.image.width}×${entry.image.height}`,
      `- Usage: ${usage}${entry.unusedReason === 'unreferenced' ? ' (no material references it)' : entry.unusedReason === 'no-geometry' ? ' (only referenced by materials no mesh draws)' : ''}`
    )
    if (entry.bytes) {
      lines.push(
        `- Download: ${formatBytes(entry.bytes.original)} → save ${formatBytes(entry.bytes.savings ?? 0)}${entry.bytes.method === 'estimated' ? ' (estimate)' : ''}`
      )
    }
    if (entry.crop) {
      const { pixelsBottomLeft: rect, mappingNode } = entry.crop
      lines.push(
        `- Crop (Blender pixels, bottom-left origin): x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}`,
        `- Mapping node: location (${mappingNode.location.join(', ')}), scale (${mappingNode.scale.join(', ')})`
      )
    }
    for (const user of entry.usedBy) {
      lines.push(
        `- Sampled by material \`${user.material}\` (${user.slot}, UV map ${user.uvMapIndex}) on mesh \`${user.mesh}\`${user.objects.length ? `, objects ${user.objects.map((name) => `\`${name}\``).join(', ')}` : ''}`
      )
    }
    if (entry.textureTransform) lines.push('- Already has a texture transform: compose with it.')
    lines.push('')
  })

  lines.push(
    '## Data',
    '',
    'Every texture is listed, including ones that need no action. Parse this block; the prose above is a summary of it.',
    '',
    '```json',
    JSON.stringify(data, null, 2),
    '```',
    ''
  )

  return lines.join('\n')
}

export { REPORT_SCHEMA, buildAdvisoryReport }
export type { AdvisoryReportInput }
