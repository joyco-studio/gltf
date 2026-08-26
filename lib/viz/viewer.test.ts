import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Viewer } from './viewer'

describe('Viewer.inspectItem', () => {
  it('inspects a transform-only node without a framing box', () => {
    const viewer = Object.create(Viewer.prototype) as Viewer
    let inspected = false

    Object.defineProperties(viewer, {
      model: {
        value: {
          getMeshesForTarget: () => [],
          getWorldBoxOfMeshes: () => null,
          getElementTransformInfo: () => ({ renderables: 0 }),
        },
      },
      controls: {
        value: {
          inspect: (
            target: { kind: string; id: number; name: string },
            box: unknown
          ) => {
            assert.deepEqual(target, { kind: 'node', id: 4, name: 'empty' })
            assert.equal(box, null)
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
      model: {
        value: {
          getMeshesForTarget: () => [],
          getWorldBoxOfMeshes: () => null,
          getElementTransformInfo: () => null,
        },
      },
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
