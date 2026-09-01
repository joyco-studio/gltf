import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Group, PerspectiveCamera, Scene } from 'three/webgpu'

import type { InspectTarget } from '../controls/control-system'
import type { Viewer } from '../viewer'
import { CameraHelperSystem, HELPER_NAME } from './camera-helper-system'
import { ModelSystem } from './model-system'

describe('CameraHelperSystem', () => {
  it('shows a camera helper only while its node is inspected', () => {
    const root = new Group()
    const camera = new PerspectiveCamera(50, 1, 0.1, 100)
    root.add(camera)

    const model = new ModelSystem()
    model.current = {
      root,
      fileName: 'camera.gltf',
      gltf: {
        parser: {
          associations: new Map([[camera, { nodes: 4 }]]),
          json: { nodes: [{}, {}, {}, {}, { camera: 0 }] },
        },
      },
    } as unknown as NonNullable<ModelSystem['current']>

    let publishInspection: (target: InspectTarget | null) => void = () =>
      assert.fail('CameraHelperSystem did not subscribe to control changes')
    const scene = new Scene()
    const system = new CameraHelperSystem()
    system.init({
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

    const helper = scene.getObjectByName(HELPER_NAME)
    assert.ok(helper)
    assert.equal(helper.visible, false)

    publishInspection({ kind: 'node', id: 4, name: 'Camera' })

    assert.equal(helper.visible, true)
    assert.equal('camera' in helper && helper.camera, camera)

    publishInspection(null)

    assert.equal(helper.visible, false)

    publishInspection({ kind: 'node', id: 4, name: 'Camera' })

    assert.equal(scene.getObjectByName(HELPER_NAME), helper)
    assert.equal(helper.visible, true)

    system.dispose()

    assert.equal(scene.getObjectByName(HELPER_NAME), undefined)
  })
})
