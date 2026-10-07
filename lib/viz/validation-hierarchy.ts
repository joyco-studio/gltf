import type { GltfHierarchyTree, GltfValidationRule } from './validation-schema-definition'
import type { GltfValidationReference } from './validate'

type HierarchyRule = Extract<GltfValidationRule, {
  operator: 'hasChildren' | 'hasDescendants' | 'hasPath' | 'matchesTree'
}>

interface HierarchyFailure {
  description: string
  references: GltfValidationReference[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failure(description: string, ids: number[] = []): HierarchyFailure {
  return {
    description,
    references: [...new Set(ids)].map((id) => ({ kind: 'node', id, label: `#${id}` })),
  }
}

function nodeIndices(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.every(
    (id) => Number.isInteger(id) && id >= 0 && id < length
  )
}

/** Build once per validation, without loading Three.js or altering source names. */
function buildHierarchy(source: unknown) {
  const nodes = isRecord(source) ? source.nodes ?? [] : []
  if (!Array.isArray(nodes) || !nodes.every(isRecord)) {
    return failure('Invalid hierarchy: expected nodes to be an array of objects.')
  }

  const children: number[][] = []
  const parents = new Int32Array(nodes.length).fill(-1)
  for (const [id, node] of nodes.entries()) {
    const childIds = node.children === undefined ? [] : node.children
    if (!nodeIndices(childIds, nodes.length)) {
      return failure(`Invalid hierarchy: node #${id} has invalid child indices.`, [id])
    }
    for (const child of childIds) {
      if (parents[child] !== -1) {
        return failure(`Invalid hierarchy: node #${child} is referenced more than once as a child.`, [id, child, parents[child]])
      }
      parents[child] = id
    }
    children.push(childIds)
  }

  // A strict forest has one incoming edge per non-root. Walking from all roots
  // visits every node iff no cycle exists, even in a disconnected component.
  const queue = [...parents.keys()].filter((id) => parents[id] === -1)
  for (let i = 0; i < queue.length; i++) {
    for (const child of children[queue[i]]) queue.push(child)
  }
  if (queue.length !== nodes.length) {
    return failure('Invalid hierarchy: node children contain a cycle.')
  }

  return {
    nodes,
    children,
    parents,
    nodeIds: new Map<unknown, number>(nodes.map((node, id) => [node, id])),
    scenes: isRecord(source) && Array.isArray(source.scenes) ? source.scenes : [],
  }
}

type Hierarchy = Exclude<ReturnType<typeof buildHierarchy>, HierarchyFailure>

/** Match distinct siblings, including duplicate names with different subtrees. */
function matchChildren(
  actual: number[],
  expected: NonNullable<GltfHierarchyTree['children']>,
  matches: (id: number, tree: GltfHierarchyTree) => boolean
) {
  const assigned = new Map<number, number>()
  function assign(index: number, seen: Set<number>): boolean {
    for (const id of actual) {
      if (seen.has(id) || !matches(id, expected[index])) continue
      seen.add(id)
      const previous = assigned.get(id)
      if (previous === undefined || assign(previous, seen)) {
        assigned.set(id, index)
        return true
      }
    }
    return false
  }
  const missing = expected.filter((_, index) => !assign(index, new Set()))
  return { missing, unexpected: actual.filter((id) => !assigned.has(id)) }
}

function evaluateHierarchy(
  hierarchy: Hierarchy,
  rule: HierarchyRule,
  values: unknown[]
): HierarchyFailure | null {
  const { nodes, children, parents, nodeIds, scenes } = hierarchy
  const label = (id: number) => typeof nodes[id].name === 'string'
    ? `“${nodes[id].name}” (#${id})` : `node #${id}`
  const names = (values: string[]) => values.map((name) => `“${name}”`).join(', ')

  // Memoization avoids re-comparing a subtree while assigning duplicate names.
  const treeMatches = new WeakMap<GltfHierarchyTree, Map<number, boolean>>()
  function matchesTree(id: number, tree: GltfHierarchyTree): boolean {
    let cached = treeMatches.get(tree)
    if (!cached) treeMatches.set(tree, cached = new Map())
    const known = cached.get(id)
    if (known !== undefined) return known
    const matchesName = tree.name === undefined || nodes[id].name === tree.name
    const result = matchesName && (tree.children === undefined || (
      children[id].length === tree.children.length &&
      matchChildren(children[id], tree.children, matchesTree).missing.length === 0
    ))
    cached.set(id, result)
    return result
  }

  for (const value of values) {
    if (rule.operator === 'hasPath') {
      const sceneId = scenes.indexOf(value)
      if (sceneId === -1 || !isRecord(value)) {
        return failure(`Operator “hasPath” requires scene objects selected from $.scenes, not properties or node objects.`)
      }
      const roots = value.nodes === undefined ? [] : value.nodes
      if (!nodeIndices(roots, nodes.length)) {
        return failure(`Invalid hierarchy: scene #${sceneId} has invalid root node indices.`)
      }
      if (new Set(roots).size !== roots.length || roots.some((id) => parents[id] !== -1)) {
        return failure(`Invalid hierarchy: scene #${sceneId} must reference distinct root nodes.`, roots)
      }
      let candidates = roots
      let previous: number[] = []
      for (const [index, name] of rule.value.entries()) {
        const matched = candidates.filter((id) => nodes[id].name === name)
        if (matched.length === 0) {
          const prefix = index === 0 ? `scene #${sceneId} roots` : names(rule.value.slice(0, index))
          return failure(`Scene #${sceneId} is missing hierarchy path ${names(rule.value)}: “${name}” was not found under ${prefix}.`, previous)
        }
        previous = matched
        candidates = matched.flatMap((id) => children[id])
      }
      continue
    }

    const id = nodeIds.get(value)
    if (id === undefined) {
      return failure(`Operator “${rule.operator}” requires node objects selected from $.nodes, not properties or scene objects.`)
    }

    if (rule.operator === 'matchesTree') {
      if (matchesTree(id, rule.value)) continue
      if (rule.value.name !== undefined && nodes[id].name !== rule.value.name) {
        return failure(`${label(id)} must be named “${rule.value.name}”.`, [id])
      }
      const { missing, unexpected } = matchChildren(children[id], rule.value.children ?? [], matchesTree)
      return failure(
        `${label(id)} does not match the expected tree.` +
        (missing.length ? ` Missing or mismatched branches: ${names(missing.map((tree) => tree.name))}.` : '') +
        (unexpected.length ? ` Unexpected or mismatched branches: ${unexpected.map(label).join(', ')}.` : ''),
        [id, ...unexpected]
      )
    }

    const candidates = [...children[id]]
    if (rule.operator === 'hasDescendants') {
      // The graph was checked above, so traversal cannot revisit nodes or cycle.
      for (let i = 0; i < candidates.length; i++) {
        for (const child of children[candidates[i]]) candidates.push(child)
      }
    }
    const foundNames = new Set(candidates.map((child) => nodes[child].name))
    const missing = rule.value.filter((name) => !foundNames.has(name))
    if (missing.length) {
      const relationship = rule.operator === 'hasChildren' ? 'direct children' : 'descendants'
      return failure(`${label(id)} is missing required ${relationship}: ${names(missing)}.`, [id])
    }
  }
  return null
}

function createHierarchyValidator(source: unknown) {
  let hierarchy: ReturnType<typeof buildHierarchy> | undefined
  return (rule: HierarchyRule, values: unknown[]): HierarchyFailure | null => {
    if (values.length === 0) {
      return failure(`Path “${rule.path}” did not resolve any ${rule.operator === 'hasPath' ? 'scenes' : 'nodes'} to validate.`)
    }
    hierarchy ??= buildHierarchy(source)
    return 'description' in hierarchy ? hierarchy : evaluateHierarchy(hierarchy, rule, values)
  }
}

export { createHierarchyValidator }
