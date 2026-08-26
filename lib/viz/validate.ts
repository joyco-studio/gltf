type GltfValidationType = 'error' | 'warning'

interface GltfValidationResult {
  type: GltfValidationType
  title: string
  description: string
}

function invalidDocument(description: string): GltfValidationResult[] {
  return [
    {
      type: 'error',
      title: 'Invalid glTF document',
      description,
    },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Derives validation results from source glTF data. GLTFLoader makes node
 * names unique at load time because Three's animation bindings target objects
 * by name. Reading source names avoids false positives from our UI fallbacks.
 * This function is environment-neutral so the viewer and public API use the
 * exact same validation rules and response contract.
 */
function validateGltf(source: unknown): GltfValidationResult[] {
  if (!isRecord(source)) {
    return invalidDocument('Expected a glTF JSON object.')
  }

  if (source.nodes !== undefined && !Array.isArray(source.nodes)) {
    return invalidDocument('Expected “nodes” to be an array when present.')
  }

  const nodeIdsByName = new Map<string, number[]>()

  for (const [id, node] of (source.nodes ?? []).entries()) {
    if (!isRecord(node) || typeof node.name !== 'string' || !node.name) continue
    const ids = nodeIdsByName.get(node.name) ?? []
    ids.push(id)
    nodeIdsByName.set(node.name, ids)
  }

  return [...nodeIdsByName.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({
      type: 'warning',
      title: `${ids.length} nodes share the name “${name}”`,
      description: `Nodes ${ids.map((id) => `#${id}`).join(', ')} use the same name. Three.js GLTFLoader applies suffixes to later matches so their runtime names are unique. Code targeting “${name}” may therefore fail to find the intended node after loading.`,
    }))
}

export { validateGltf }
export type { GltfValidationResult, GltfValidationType }
