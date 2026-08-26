import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BoxGeometry, Group, Mesh } from 'three/webgpu'

import { ModelSystem } from './model-system'

describe('ModelSystem.getNodeTargetForObject', () => {
  it('resolves a primitive hit to its owning glTF node', () => {
    const root = new Group()
    const node = new Group()
    const primitive = new Mesh(new BoxGeometry())
    node.add(primitive)
    root.add(node)

    const associations = new Map<object, Record<string, number>>([
      [node, { meshes: 3, nodes: 7 }],
      [primitive, { meshes: 3, primitives: 0 }],
    ])
    const model = new ModelSystem()
    model.current = {
      root,
      fileName: 'test.gltf',
      gltf: {
        parser: {
          associations,
          json: {
            meshes: [{}, {}, {}, { name: 'shared_mesh' }],
            nodes: [{}, {}, {}, {}, {}, {}, {}, { mesh: 3 }],
          },
        },
      },
    } as unknown as NonNullable<ModelSystem['current']>

    assert.deepEqual(model.getNodeTargetForObject(primitive), {
      kind: 'node',
      id: 7,
      name: 'shared_mesh',
    })
  })
})

describe('ModelSystem.getElementTransformInfo', () => {
  it('reports local and composed world transforms for an exact glTF node', () => {
    const root = new Group()
    root.position.set(10, 0, -2)
    root.scale.setScalar(2)

    const node = new Group()
    node.position.set(1, 2, 3)
    node.rotation.set(0, Math.PI / 2, 0)
    node.scale.set(0.5, 1, 2)
    root.add(node)

    const associations = new Map([[node, { nodes: 7 }]])
    const model = new ModelSystem()
    model.current = {
      root,
      fileName: 'test.gltf',
      gltf: { parser: { associations } },
    } as unknown as NonNullable<ModelSystem['current']>

    const info = model.getElementTransformInfo({ kind: 'node', id: 7 })

    assert.ok(info)
    assert.deepEqual(info.local?.position, [1, 2, 3])
    assert.deepEqual(info.local?.scale, [0.5, 1, 2])
    assert.deepEqual(info.world.position, [12, 4, 4])
    assert.ok(Math.abs(info.world.rotation[1] - Math.PI / 2) < 1e-10)
    assert.ok(Math.abs(info.world.scale[0] - 1) < 1e-10)
    assert.ok(Math.abs(info.world.scale[1] - 2) < 1e-10)
    assert.ok(Math.abs(info.world.scale[2] - 4) < 1e-10)
    assert.equal(info.bounds, null)
    assert.equal(info.renderables, 0)
  })

  it('returns null when a node is not part of the loaded scene', () => {
    const root = new Group()
    const model = new ModelSystem()
    model.current = {
      root,
      fileName: 'test.gltf',
      gltf: { parser: { associations: new Map() } },
    } as unknown as NonNullable<ModelSystem['current']>

    assert.equal(
      model.getElementTransformInfo({ kind: 'node', id: 99 }),
      null
    )
  })

  it('uses the first runtime mesh transform and bounds every instance', () => {
    const root = new Group()
    const first = new Mesh(new BoxGeometry(2, 2, 2))
    const second = new Mesh(new BoxGeometry(2, 2, 2))
    first.position.set(-2, 0, 0)
    second.position.set(2, 0, 0)
    root.add(first, second)

    const associations = new Map([
      [first, { meshes: 3 }],
      [second, { meshes: 3 }],
    ])
    const model = new ModelSystem()
    model.current = {
      root,
      fileName: 'test.gltf',
      gltf: { parser: { associations } },
    } as unknown as NonNullable<ModelSystem['current']>

    const info = model.getElementTransformInfo({ kind: 'mesh', id: 3 })

    assert.ok(info)
    assert.equal(info.local, null)
    assert.deepEqual(info.world.position, [-2, 0, 0])
    assert.deepEqual(info.bounds?.center, [0, 0, 0])
    assert.deepEqual(info.bounds?.size, [6, 2, 2])
    assert.equal(info.renderables, 2)
  })
})
