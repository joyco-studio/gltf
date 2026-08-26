import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { validateGltf } from './validate'

describe('validateGltf', () => {
  it('includes structured references for duplicate node names', () => {
    const [result] = validateGltf({
      nodes: [
        { name: 'shoe' },
        { name: 'other' },
        { name: 'shoe' },
      ],
    })

    assert.equal(result.title, '2 nodes share the name “shoe”')
    assert.deepEqual(result.references, [
      { kind: 'node', id: 0, label: '#0' },
      { kind: 'node', id: 2, label: '#2' },
    ])
    assert.match(result.description, /^Nodes #0, #2 use the same name\./)
  })

  it('does not attach references to document-level errors', () => {
    const [result] = validateGltf(null)

    assert.equal(result.type, 'error')
    assert.equal(result.references, undefined)
  })
})
