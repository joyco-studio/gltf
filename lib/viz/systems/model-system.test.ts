import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BoxGeometry, Group, Mesh, PerspectiveCamera, Vector3 } from 'three/webgpu'

import { ModelSystem } from './model-system'

describe('ModelSystem.getInspectBox', () => {
  it('sizes empty-node framing relative to the model without inventing geometry bounds', () => {
    const root = new Group()
    root.scale.setScalar(2)
    const node = new Group()
    node.position.set(3, 4, 5)
    const mesh = new Mesh(new BoxGeometry(20, 10, 5))
    root.add(node, mesh)
    const model = new ModelSystem()
    model.current = {
      root,
      gltf: { parser: { associations: new Map([[node, { nodes: 7 }]]) } },
    } as unknown as NonNullable<ModelSystem['current']>

    const box = model.getInspectBox({ kind: 'node', id: 7, name: 'empty' })!
    assert.deepEqual(box.getCenter(new Vector3()).toArray(), [6, 8, 10])
    assert.deepEqual(box.getSize(new Vector3()).toArray(), [4, 4, 4])
    assert.equal(model.getElementTransformInfo({ kind: 'node', id: 7 })?.bounds, null)
    assert.equal(model.getInspectBox({ kind: 'node', id: 99, name: 'missing' }), null)
    assert.equal(model.getInspectBox({ kind: 'material', id: 99, name: 'unused' }), null)
    mesh.geometry.dispose()
  })

  it('keeps geometry bounds for groups with mesh descendants', () => {
    const root = new Group()
    const node = new Group()
    node.position.set(10, 0, 0)
    const mesh = new Mesh(new BoxGeometry(2, 4, 6))
    mesh.position.set(0, 5, 0)
    node.add(mesh)
    root.add(node)
    const model = new ModelSystem()
    model.current = {
      root,
      gltf: { parser: { associations: new Map([[node, { nodes: 7 }]]) } },
    } as unknown as NonNullable<ModelSystem['current']>

    const box = model.getInspectBox({ kind: 'node', id: 7, name: 'group' })!
    assert.deepEqual(box.getCenter(new Vector3()).toArray(), [10, 5, 0])
    assert.deepEqual(box.getSize(new Vector3()).toArray(), [2, 4, 6])
    mesh.geometry.dispose()
  })
})

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
    node.userData = { category: 'structure', nested: { floor: 2 } }
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
    assert.deepEqual(info.userData, {
      category: 'structure',
      nested: { floor: 2 },
    })
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
    first.userData = { source: 'first-runtime-mesh' }
    second.userData = { source: 'second-runtime-mesh' }
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
    assert.deepEqual(info.userData, { source: 'first-runtime-mesh' })
    assert.equal(info.renderables, 2)
  })
})

describe('ModelSystem.getCameraForNode', () => {
  it('finds a camera attached beneath a grouped glTF node', () => {
    const root = new Group()
    const node = new Group()
    const camera = new PerspectiveCamera()
    node.add(camera)
    root.add(node)

    const model = new ModelSystem()
    model.current = {
      root,
      fileName: 'camera.gltf',
      gltf: {
        parser: {
          associations: new Map([[node, { nodes: 7 }]]),
          json: {
            nodes: Array.from({ length: 8 }, (_, id) =>
              id === 7 ? { camera: 0 } : {}
            ),
          },
        },
      },
    } as unknown as NonNullable<ModelSystem['current']>

    assert.equal(model.getCameraForNode(7), camera)
    assert.equal(model.getCameraForNode(8), null)
  })
})
