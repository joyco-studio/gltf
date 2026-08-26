type GltfValidationTier = 'error' | 'warning'

interface GltfValidationIssue {
  tier: GltfValidationTier
  title: string
  description: string
}

interface GltfValidationSource {
  nodes?: { name?: string }[]
}

/**
 * Derives validation results from source glTF data. GLTFLoader makes node
 * names unique at load time because Three's animation bindings target objects
 * by name. Reading source names avoids false positives from our UI fallbacks.
 */
function validateGltf(json: GltfValidationSource): GltfValidationIssue[] {
  const nodeIdsByName = new Map<string, number[]>()

  for (const [id, node] of (json.nodes ?? []).entries()) {
    if (!node.name) continue
    const ids = nodeIdsByName.get(node.name) ?? []
    ids.push(id)
    nodeIdsByName.set(node.name, ids)
  }

  return [...nodeIdsByName.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({
      tier: 'warning',
      title: `${ids.length} nodes share the name “${name}”`,
      description: `Nodes ${ids.map((id) => `#${id}`).join(', ')} use the same name. Three.js GLTFLoader applies suffixes to later matches so their runtime names are unique. Code targeting “${name}” may therefore fail to find the intended node after loading.`,
    }))
}

export { validateGltf }
export type { GltfValidationIssue, GltfValidationTier }
