import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseGltfValidationSchema } from './validation-schema'
import { validateGltf } from './validate'

const document = {
  scenes: [{ nodes: [0] }, { nodes: [5] }],
  nodes: [
    { name: 'Root', children: [1] },
    { name: 'Body', children: [2, 3] },
    { name: 'Frame' },
    { name: 'DisplayGroup', children: [4] },
    { name: 'Screen' },
    { name: 'OtherRoot' },
  ],
}

function validate(operator: string, value: unknown, path = '$.nodes[1]', source: unknown = document) {
  const parsed = parseGltfValidationSchema({
    version: 1,
    rules: [{ id: 'hierarchy', operator, path, value }],
  })
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  return validateGltf(source, parsed.schema).filter((result) => result.ruleId)
}

describe('hierarchy rule schemas', () => {
  it('requires the correct value for every operator and rejects extra keys', () => {
    for (const operator of ['hasChildren', 'hasDescendants', 'hasPath']) {
      for (const value of [undefined, null, [], [''], [3], 'Screen', {}]) {
        assert.equal(parseGltfValidationSchema({ version: 1, rules: [
          { id: 'test', path: '$.nodes[0]', operator, value },
        ] }).ok, false, `${operator}: ${JSON.stringify(value)}`)
      }
    }
    for (const value of [undefined, null, [], { children: [{}] }, { children: [{ name: 'A', extra: true }] }, { extra: true }]) {
      assert.equal(parseGltfValidationSchema({ version: 1, rules: [
        { id: 'test', path: '$.nodes[0]', operator: 'matchesTree', value },
      ] }).ok, false)
    }
    assert.equal(parseGltfValidationSchema({ version: 1, rules: [
      { id: 'test', path: '$.nodes[0]', operator: 'hasChildren', value: ['A'], node: 'Root' },
    ] }).ok, false)
    assert.equal(parseGltfValidationSchema({ version: 1, rules: [
      { id: 'test', path: '$.nodes[*].name', operator: 'unique', value: [] },
    ] }).ok, false)
  })
})

describe('hierarchy validation', () => {
  it('distinguishes children and descendants, allowing extra branches', () => {
    assert.deepEqual(validate('hasChildren', ['Frame']), [])
    const [issue] = validate('hasChildren', ['Screen'])
    assert.match(issue.description, /missing required direct children: “Screen”/)
    assert.deepEqual(issue.references, [{ kind: 'node', id: 1, label: '#1' }])
    assert.deepEqual(validate('hasDescendants', ['Frame', 'Screen']), [])
    assert.match(validate('hasDescendants', ['Body'])[0].description, /missing required descendants/)
  })

  it('checks every selected parent rather than combining their children', () => {
    const source = { nodes: [
      { name: 'Body', children: [2] }, { name: 'Body', children: [3] },
      { name: 'Frame' }, { name: 'Screen' },
    ] }
    const issues = validate('hasChildren', ['Frame', 'Screen'], '$.nodes[?@.name == "Body"]', source)
    assert.equal(issues.length, 1)
    assert.match(issues[0].description, /“Screen”/)
    assert.deepEqual(validate('hasChildren', ['Frame'], '$.nodes[0]', source), [])
    assert.equal(validate('hasChildren', ['Frame'], '$.nodes[?@.name == "Body"]', source).length, 1)
  })

  it('fails empty selections and rejects properties or unrelated objects as targets', () => {
    for (const [operator, value] of [
      ['hasChildren', ['Frame']], ['hasDescendants', ['Frame']],
      ['hasPath', ['Root']], ['matchesTree', {}],
    ] as const) {
      assert.match(validate(operator, value, '$.nodes[99]')[0].description, /did not resolve/)
      assert.match(validate(operator, value, '$.nodes[0].name')[0].description, /requires .* objects/)
    }
    assert.match(validate('hasChildren', ['Root'], '$.scenes[0]')[0].description, /requires node objects/)
    assert.match(validate('hasPath', ['Root'], '$.nodes[0]')[0].description, /requires scene objects/)
    assert.match(validate('matchesTree', {}, '$.nodes[0].extras', {
      nodes: [{ extras: {} }],
    })[0].description, /requires node objects/)
  })

  it('anchors paths to the selected scene roots and reports the first missing step', () => {
    assert.deepEqual(validate('hasPath', ['Root', 'Body', 'DisplayGroup', 'Screen'], '$.scenes[0]'), [])
    assert.match(validate('hasPath', ['Body'], '$.scenes[0]')[0].description, /scene #0 roots/)
    const [issue] = validate('hasPath', ['Root', 'Body', 'Screen'], '$.scenes[0]')
    assert.match(issue.description, /“Screen” was not found under “Root”, “Body”/)
    assert.equal(issue.references?.[0].id, 1)
    assert.match(validate('hasPath', ['Root'], '$.scenes[1]')[0].description, /scene #1/)
    assert.equal(validate('hasPath', ['Root'], '$.scenes[*]').length, 1)
    assert.equal(validate('hasPath', ['Root'], '$.scenes[0]', { scenes: [{}] }).length, 1)
  })

  it('explores duplicate-name path branches without combining unrelated chains', () => {
    const source = { scenes: [{ nodes: [0, 1] }], nodes: [
      { name: 'Root', children: [2] }, { name: 'Root', children: [3] },
      { name: 'Body' }, { name: 'Body', children: [4] }, { name: 'Screen/Glass' },
    ] }
    assert.deepEqual(validate('hasPath', ['Root', 'Body', 'Screen/Glass'], '$.scenes[0]', source), [])
    source.nodes[3].name = 'Other'
    assert.equal(validate('hasPath', ['Root', 'Body', 'Screen/Glass'], '$.scenes[0]', source).length, 1)
  })

  it('is unaffected by node index reordering', () => {
    const source = {
      scenes: [{ nodes: [5] }],
      nodes: document.nodes.toReversed().map((node) => ({
        ...node, ...(node.children && { children: node.children.map((id) => 5 - id) }),
      })),
    }
    assert.deepEqual(validate('hasChildren', ['Frame'], '$.nodes[?@.name == "Body"]', source), [])
    assert.deepEqual(validate('hasPath', ['Root', 'Body', 'DisplayGroup', 'Screen'], '$.scenes[0]', source), [])
  })

  it('matches exact trees without depending on sibling order', () => {
    const tree = { children: [
      { name: 'DisplayGroup', children: [{ name: 'Screen', children: [] }] },
      { name: 'Frame', children: [] },
    ] }
    assert.deepEqual(validate('matchesTree', tree), [])
    tree.children.reverse()
    assert.deepEqual(validate('matchesTree', tree), [])
    assert.match(validate('matchesTree', { name: 'Wrong' })[0].description, /must be named “Wrong”/)
    const [issue] = validate('matchesTree', { children: [{ name: 'Screen' }] })
    assert.match(issue.description, /Missing or mismatched branches: “Screen”/)
    assert.match(issue.description, /Unexpected or mismatched branches: “Frame”/)
    assert.deepEqual(issue.references?.map(({ id }) => id), [1, 2, 3])
  })

  it('distinguishes omitted children from an explicit leaf, at every level', () => {
    assert.deepEqual(validate('matchesTree', { name: 'Body' }), [])
    assert.equal(validate('matchesTree', { children: [] }).length, 1)
    assert.deepEqual(validate('matchesTree', { children: [] }, '$.nodes[4]'), [])
    assert.deepEqual(validate('matchesTree', { children: [{ name: 'Frame' }, { name: 'DisplayGroup' }] }), [])
    assert.equal(validate('matchesTree', { children: [{ name: 'Frame' }, { name: 'DisplayGroup', children: [] }] }).length, 1)
  })

  it('matches duplicate siblings by structure and preserves their multiplicity', () => {
    const source = { nodes: [
      { name: 'Root', children: [1, 2] },
      { name: 'Part' }, { name: 'Part', children: [3] }, { name: 'Detail' },
    ] }
    // The first wildcard can match either Part; the leaf must get node #1.
    assert.deepEqual(validate('matchesTree', { children: [
      { name: 'Part' }, { name: 'Part', children: [] },
    ] }, '$.nodes[0]', source), [])
    assert.equal(validate('matchesTree', { children: [{ name: 'Part' }] }, '$.nodes[0]', source).length, 1)
    assert.equal(validate('matchesTree', { children: [
      { name: 'Part', children: [] }, { name: 'Part', children: [] },
    ] }, '$.nodes[0]', source).length, 1)
  })

  it('reports malformed graphs without hanging or passing a partial traversal', () => {
    for (const nodes of [
      [{ children: [0] }],
      [{ children: [1] }, { children: [0] }],
      [{ children: [2] }, { children: [2] }, {}],
      [{ children: [1, 1] }, {}],
      [{ children: [99] }], [{ children: [-1] }], [{ children: [0.5] }],
      [{ children: ['0'] }], [{ children: null }], [{ children: {} }],
      [{}, null],
    ]) {
      assert.match(validate('hasDescendants', ['Screen'], '$.nodes[0]', { nodes })[0].description, /Invalid hierarchy/)
    }
    for (const roots of [[99], [1], [0, 0], null, '0']) {
      assert.match(validate('hasPath', ['Root'], '$.scenes[0]', {
        nodes: document.nodes, scenes: [{ nodes: roots }],
      })[0].description, /Invalid hierarchy/)
    }
  })

  it('walks deep descendant chains iteratively', () => {
    const nodes = Array.from({ length: 12000 }, (_, id) => ({
      name: `node-${id}`, ...(id < 11999 && { children: [id + 1] }),
    }))
    assert.deepEqual(validate('hasDescendants', ['node-11999'], '$.nodes[0]', { nodes }), [])
  })

  it('preserves custom finding metadata and supports mixed old and new rules', () => {
    const parsed = parseGltfValidationSchema({ version: 1, rules: [
      { id: 'names', path: '$.nodes[*].name', operator: 'unique' },
      { id: 'nested', path: '$.nodes[1]', operator: 'hasChildren', value: ['Screen'],
        level: 'warning', title: 'Move Screen', message: 'Check the export.' },
    ] })
    assert.ok(parsed.ok)
    const [issue] = validateGltf(document, parsed.schema)
    assert.equal(issue.type, 'warning')
    assert.equal(issue.ruleId, 'nested')
    assert.equal(issue.title, 'Move Screen')
    assert.match(issue.description, /^Check the export\./)
  })
})
