import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Box3, Group, Vector3 } from 'three/webgpu'

import { ModelSystem } from './systems/model-system'
import { Viewer } from './viewer'

describe('Viewer.inspectItem', () => {
  it('frames a transform-only node at its composed world position', () => {
    const viewer = Object.create(Viewer.prototype) as Viewer
    let inspected = false
    const root = new Group()
    root.position.set(10, 0, 0)
    root.scale.setScalar(2)
    const node = new Group()
    node.position.set(1, 2, 3)
    root.add(node)
    const model = new ModelSystem()
    model.current = {
      root,
      gltf: { parser: { associations: new Map([[node, { nodes: 4 }]]) } },
    } as unknown as NonNullable<ModelSystem['current']>

    Object.defineProperties(viewer, {
      model: { value: model },
      controls: {
        value: {
          inspect: (
            target: { kind: string; id: number; name: string },
            box: unknown
          ) => {
            assert.deepEqual(target, { kind: 'node', id: 4, name: 'empty' })
            assert.ok(box instanceof Box3)
            assert.deepEqual(box.getCenter(new Vector3()).toArray(), [12, 4, 6])
            assert.ok(box.getSize(new Vector3()).x > 0)
            inspected = true
          },
        },
      },
    })

    viewer.inspectItem('node', 4, 'empty')

    assert.equal(inspected, true)
  })

  it('exits a stale inspection when the target does not exist', () => {
    const viewer = Object.create(Viewer.prototype) as Viewer
    let exited = false

    Object.defineProperties(viewer, {
      model: { value: new ModelSystem() },
      controls: {
        value: {
          exitInspect: () => {
            exited = true
          },
        },
      },
    })

    viewer.inspectItem('node', 4, 'empty')

    assert.equal(exited, true)
  })
})
