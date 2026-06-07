import type { GltfDocumentInfo } from '@/lib/viz/inspect'

import type { Selection } from './viewer-provider'

/**
 * Shareable `?path=` format: `<collection>.<name>`, e.g. `materials.mat_1`.
 * The collection segment matches the GltfDocumentInfo list keys; the name is
 * everything after the first dot (names may contain dots themselves).
 */

const SEGMENT_BY_KIND = {
  mesh: 'meshes',
  material: 'materials',
  texture: 'textures',
  animation: 'animations',
} as const satisfies Record<Selection['kind'], keyof GltfDocumentInfo>

function formatSharePath(kind: Selection['kind'], name: string) {
  return `${SEGMENT_BY_KIND[kind]}.${name}`
}

function resolveSharePath(
  document: GltfDocumentInfo,
  path: string
): { selection: Selection; name: string } | null {
  const dot = path.indexOf('.')
  if (dot === -1) return null
  const segment = path.slice(0, dot)
  const name = path.slice(dot + 1)

  const kind = (
    Object.keys(SEGMENT_BY_KIND) as Selection['kind'][]
  ).find((key) => SEGMENT_BY_KIND[key] === segment)
  if (!kind || !name) return null

  const items = document[SEGMENT_BY_KIND[kind]]
  const item =
    items.find((entry) => entry.name === name) ??
    items.find((entry) => entry.name.toLowerCase() === name.toLowerCase())
  return item ? { selection: { kind, id: item.id }, name: item.name } : null
}

export { formatSharePath, resolveSharePath }
