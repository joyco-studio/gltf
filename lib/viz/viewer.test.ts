import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Viewer } from './viewer'

describe('Viewer.inspectItem', () => {
  it('exits a stale inspection when the target has no renderables', () => {
    const viewer = Object.create(Viewer.prototype) as Viewer
    let exited = false

    Object.defineProperties(viewer, {
      model: {
        value: {
          getMeshesForTarget: () => [],
          getWorldBoxOfMeshes: () => null,
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
