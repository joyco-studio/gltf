import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BoxGeometry, Group, Mesh, Scene } from 'three/webgpu'

import type { InspectTarget } from '../controls/control-system'
import type { Viewer } from '../viewer'
import { AxesSystem } from './axes-system'
import { ModelSystem } from './model-system'

describe('AxesSystem', () => {
  it('shows empty-node axes at the world origin and rotation, and clears on exit', () => {
    const root = new Group()
    root.position.set(10, 0, 0)
    root.rotation.set(0, Math.PI / 2, 0)
    const node = new Group()
    node.position.set(1, 2, 3)
    node.rotation.set(Math.PI / 4, 0, 0)
    root.add(node)

    const model = new ModelSystem()
    model.current = {
      root,
      gltf: { parser: { associations: new Map([[node, { nodes: 7 }]]) } },
    } as unknown as NonNullable<ModelSystem['current']>

    let publishInspection: (target: InspectTarget | null) => void = () =>
      assert.fail('AxesSystem did not subscribe to control changes')
    const scene = new Scene()
    const axes = new AxesSystem()
    axes.init({
      scene,
      model,
      controls: {
        on: (
          _event: 'change',
          listener: (snapshot: { inspecting: InspectTarget | null }) => void
        ) => {
          publishInspection = (inspecting) => listener({ inspecting })
          return () => undefined
        },
      },
    } as unknown as Viewer)
    axes.setVisible(true)
    publishInspection({ kind: 'node', id: 7, name: 'empty' })

    const helper = scene.getObjectByName('element-axes')!
    assert.equal(helper.visible, true)
    assert.ok(
      helper.position.distanceTo(node.getWorldPosition(node.position.clone())) < 1e-10
    )
    assert.ok(
      helper.quaternion.angleTo(node.getWorldQuaternion(node.quaternion.clone())) < 1e-7
    )
    assert.ok(helper.scale.x > 0)
    axes.setVisible(false)
    assert.equal(helper.visible, false)
    axes.setVisible(true)
    assert.equal(helper.visible, true)
    publishInspection(null)
    assert.equal(helper.visible, false)
    axes.dispose()
    assert.equal(scene.getObjectByName('element-axes'), undefined)
  })

  it('anchors node axes at the node origin instead of its bounds center', () => {
    const root = new Group()
    const node = new Group()
    node.position.set(4, 5, 6)
    node.rotation.set(0, Math.PI / 2, 0)

    const primitive = new Mesh(new BoxGeometry(2, 2, 2).translate(0, 10, 0))
    primitive.rotation.set(Math.PI / 4, 0, 0)
    node.add(primitive)
    root.add(node)

    const model = new ModelSystem()
    model.current = {
      root,
      fileName: 'offset-origin.gltf',
      gltf: {
        parser: {
          associations: new Map<object, Record<string, number>>([
            [node, { nodes: 7 }],
            [primitive, { meshes: 3, primitives: 0 }],
          ]),
        },
      },
    } as unknown as NonNullable<ModelSystem['current']>

    let publishInspection: (target: InspectTarget | null) => void = () =>
      assert.fail('AxesSystem did not subscribe to control changes')
    const scene = new Scene()
    const axes = new AxesSystem()
    axes.init({
      scene,
      model,
      controls: {
        on: (
          _event: 'change',
          listener: (snapshot: { inspecting: InspectTarget | null }) => void
        ) => {
          publishInspection = (inspecting) => listener({ inspecting })
          return () => undefined
        },
      },
    } as unknown as Viewer)

    publishInspection({ kind: 'node', id: 7, name: 'offset-origin' })

    const helper = scene.getObjectByName('element-axes')
    assert.ok(helper)
    assert.deepEqual(helper.position.toArray(), [4, 5, 6])
    assert.ok(
      helper.quaternion.angleTo(
        node.getWorldQuaternion(node.quaternion.clone())
      ) < 1e-10
    )

    axes.dispose()
  })

  it('anchors multi-instance mesh axes at the aggregate bounds center', () => {
    const root = new Group()
    const first = new Mesh(new BoxGeometry(2, 2, 2))
    const second = new Mesh(new BoxGeometry(2, 2, 2))
    first.position.set(-5, 0, 0)
    second.position.set(5, 0, 0)
    root.add(first, second)

    const model = new ModelSystem()
    model.current = {
      root,
      fileName: 'instanced-mesh.gltf',
      gltf: {
        parser: {
          associations: new Map<object, Record<string, number>>([
            [first, { meshes: 3 }],
            [second, { meshes: 3 }],
          ]),
        },
      },
    } as unknown as NonNullable<ModelSystem['current']>

    let publishInspection: (target: InspectTarget | null) => void = () =>
      assert.fail('AxesSystem did not subscribe to control changes')
    const scene = new Scene()
    const axes = new AxesSystem()
    axes.init({
      scene,
      model,
      controls: {
        on: (
          _event: 'change',
          listener: (snapshot: { inspecting: InspectTarget | null }) => void
        ) => {
          publishInspection = (inspecting) => listener({ inspecting })
          return () => undefined
        },
      },
    } as unknown as Viewer)

    publishInspection({ kind: 'mesh', id: 3, name: 'instanced-mesh' })

    const helper = scene.getObjectByName('element-axes')
    assert.ok(helper)
    assert.deepEqual(helper.position.toArray(), [0, 0, 0])

    axes.dispose()
  })
})
