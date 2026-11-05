import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  Group,
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  type Camera,
} from 'three/webgpu'

import type { Viewer } from '../viewer'
import { CameraPreviewSystem } from './camera-preview-system'

// node has no window — the system listens there for detaching input
const globals = globalThis as { window?: EventTarget }
globals.window ??= new EventTarget()

function setup(
  camera: Camera,
  cameraJson: object,
  canvas = new EventTarget()
) {
  const root = new Group()
  root.position.set(1, 2, 3)
  root.add(camera)
  camera.position.set(0, 0, 5)

  const system = new CameraPreviewSystem(canvas as HTMLCanvasElement)
  system.init({
    on: () => () => undefined,
    model: {
      getCameraForNode: (nodeId: number) => (nodeId === 0 ? camera : null),
      current: {
        gltf: {
          parser: {
            json: { nodes: [{ camera: 0 }], cameras: [cameraJson] },
          },
        },
      },
    },
  } as unknown as Viewer)
  return system
}

describe('CameraPreviewSystem', () => {
  it('renders through a proxy that copies the camera world pose', () => {
    const source = new PerspectiveCamera(40, 1, 0.5, 50)
    const system = setup(source, { type: 'perspective', perspective: {} })
    system.resize(1600, 800)

    assert.equal(system.getSnapshot(), null)
    assert.equal(system.start(0, 'Shot'), true)
    assert.deepEqual(system.getSnapshot(), {
      nodeId: 0,
      name: 'Shot',
      aspect: null,
    })

    const proxy = system.camera
    assert.ok(proxy instanceof PerspectiveCamera)
    assert.notEqual(proxy, source)
    assert.deepEqual(proxy.position.toArray(), [1, 2, 8])
    // no authored aspect → adopt the viewport's, keep the vertical fov
    assert.equal(proxy.aspect, 2)
    assert.equal(proxy.fov, 40)
    assert.equal(proxy.near, 0.5)
    // the model's camera is never mutated
    assert.equal(source.aspect, 1)

    source.position.x = 10
    system.update(0)
    assert.equal(proxy.position.x, 11)

    assert.equal(system.start(1, 'Not a camera'), false)
  })

  it('widens the fov so an authored frame fits a narrower viewport', () => {
    const source = new PerspectiveCamera(40, 2)
    const system = setup(source, {
      type: 'perspective',
      perspective: { aspectRatio: 2 },
    })
    system.resize(1000, 1000)
    system.start(0, 'Wide')

    const proxy = system.camera as PerspectiveCamera
    assert.equal(system.getSnapshot()?.aspect, 2)
    const horizontalTan =
      Math.tan(MathUtils.degToRad(proxy.fov) / 2) * proxy.aspect
    const authoredTan = Math.tan(MathUtils.degToRad(40) / 2) * 2
    assert.ok(Math.abs(horizontalTan - authoredTan) < 1e-9)
  })

  it('expands an orthographic frame to the viewport aspect', () => {
    const source = new OrthographicCamera(-2, 2, 1, -1)
    const system = setup(source, { type: 'orthographic' })
    system.resize(1000, 1000)
    system.start(0, 'Ortho')

    const proxy = system.camera as OrthographicCamera
    assert.equal(system.getSnapshot()?.aspect, 2)
    assert.deepEqual(
      [proxy.left, proxy.right, proxy.top, proxy.bottom],
      [-2, 2, 2, -2]
    )
  })

  it('detaches only on presses over the viewport', () => {
    const canvas = new EventTarget()
    const system = setup(
      new PerspectiveCamera(),
      { type: 'perspective' },
      canvas
    )
    system.start(0, 'Shot')

    // UI presses, viewport wheel and key presses keep the preview
    window.dispatchEvent(new Event('pointerdown'))
    canvas.dispatchEvent(new Event('wheel'))
    window.dispatchEvent(new Event('keydown'))
    assert.notEqual(system.getSnapshot(), null)

    canvas.dispatchEvent(new Event('pointerdown'))
    assert.equal(system.getSnapshot(), null)
    assert.equal(system.camera, null)
    system.dispose()
  })

  it('wheel zooms the preview with easing, hiding it from the controls', () => {
    const canvas = new EventTarget()
    const source = new PerspectiveCamera()
    source.zoom = 2
    const system = setup(source, { type: 'perspective' }, canvas)
    let controlsSawWheel = false
    canvas.addEventListener('wheel', () => (controlsSawWheel = true))

    // not previewing → the wheel belongs to the viewer controls
    canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: -100 }))
    assert.equal(controlsSawWheel, true)

    controlsSawWheel = false
    system.start(0, 'Shot')
    const wheel = Object.assign(new Event('wheel', { cancelable: true }), {
      deltaY: -100,
      deltaMode: 0,
    })
    canvas.dispatchEvent(wheel)
    assert.equal(controlsSawWheel, false)
    assert.equal(wheel.defaultPrevented, true)

    const proxy = system.camera as PerspectiveCamera
    system.update(1 / 60)
    // eased: partway toward the 1/0.95 target, on top of the authored zoom
    assert.ok(proxy.zoom > 2 && proxy.zoom < 2 / 0.95)
    system.update(10)
    assert.ok(Math.abs(proxy.zoom - 2 / 0.95) < 1e-9)

    // a fresh preview starts back at the authored zoom
    system.start(0, 'Shot')
    assert.equal(proxy.zoom, 2)
    system.dispose()
  })
})
