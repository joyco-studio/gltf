import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three/webgpu'
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js'

import { VisibilitySystem, isWorldVisible } from './visibility-system'

function createModel() {
  const root = new Group()
  const parent = new Group()
  const child = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  const sibling = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  const authoredHidden = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  authoredHidden.visible = false
  parent.add(child)
  root.add(parent, sibling, authoredHidden)
  const associations = new Map<object, { nodes: number }>([
    [parent, { nodes: 0 }],
    [child, { nodes: 1 }],
    [sibling, { nodes: 2 }],
    [authoredHidden, { nodes: 3 }],
  ]) as unknown as GLTFParser['associations']
  const system = new VisibilitySystem()
  system.bind(root, associations)
  return { system, parent, child, sibling, authoredHidden }
}

describe('VisibilitySystem', () => {
  it('hides a node with its subtree and restores it', () => {
    const { system, parent, child, sibling } = createModel()
    let changes = 0
    system.on('change', () => changes++)

    system.toggle(0)
    assert.equal(parent.visible, false)
    assert.equal(isWorldVisible(child), false)
    assert.equal(sibling.visible, true)
    assert.deepEqual([...system.getSnapshot()], [0])

    system.setHidden(0, true)
    assert.equal(changes, 1, 'no-op when already hidden')

    system.toggle(0)
    assert.equal(parent.visible, true)
    assert.equal(isWorldVisible(child), true)
    assert.equal(changes, 2)
  })

  it('never reveals authored-invisible nodes and resets on rebind', () => {
    const { system, authoredHidden } = createModel()

    system.toggle(3)
    system.toggle(3)
    assert.equal(authoredHidden.visible, false)

    system.toggle(2)
    system.bind(new Group(), new Map() as unknown as GLTFParser['associations'])
    assert.equal(system.getSnapshot().size, 0)
  })
})
