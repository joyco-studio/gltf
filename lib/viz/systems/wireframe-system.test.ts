import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three/webgpu'

import type { Viewer } from '../viewer'
import { WireframeSystem } from './wireframe-system'

// node has no window — the system listens there for the Tab hotkey
const globals = globalThis as { window?: EventTarget }
globals.window ??= new EventTarget()

function createModel() {
  const root = new Group()
  const single = new Mesh<BoxGeometry, MeshStandardMaterial | MeshBasicMaterial>(
    new BoxGeometry(),
    new MeshStandardMaterial()
  )
  const multi = new Mesh(new BoxGeometry(), [
    new MeshStandardMaterial(),
    new MeshBasicMaterial(),
  ])
  root.add(single, multi)
  const materials = [single.material, ...multi.material]
  const meshes = [single, multi]
  const viewer = {
    model: { current: { root }, getAllMeshes: () => meshes },
  } as unknown as Viewer
  return { root, single, materials, viewer }
}

function dispatchKey(init: Partial<KeyboardEvent>) {
  const event = Object.assign(new Event('keydown', { cancelable: true }), {
    key: 'Tab',
    repeat: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    ...init,
  })
  window.dispatchEvent(event)
  return event
}

describe('WireframeSystem', () => {
  it('applies the current state to a bound model and toggles it', () => {
    const { root, materials, viewer } = createModel()
    const system = new WireframeSystem()
    system.init(viewer)
    system.setEnabled(true)
    system.bind(root)
    assert.ok(materials.every((m) => (m as MeshBasicMaterial).wireframe))

    let changes = 0
    system.on('change', () => changes++)
    system.toggle()
    assert.equal(system.isEnabled, false)
    assert.ok(materials.every((m) => !(m as MeshBasicMaterial).wireframe))
    system.setEnabled(false)
    assert.equal(changes, 1)
    system.dispose()
  })

  it('updates swapped-in materials and syncs out-of-scene ones', () => {
    const { root, single, viewer } = createModel()
    const system = new WireframeSystem()
    system.init(viewer)
    system.bind(root)

    const swapped = new MeshBasicMaterial()
    single.material = swapped
    system.setEnabled(true)
    assert.equal(swapped.wireframe, true)

    const offscreen = new MeshBasicMaterial()
    system.sync(offscreen)
    assert.equal(offscreen.wireframe, true)
    system.dispose()
  })

  it('toggles on Tab, but not with modifiers or inside fields', () => {
    const { root, viewer } = createModel()
    const system = new WireframeSystem()
    system.init(viewer)
    system.bind(root)

    const event = dispatchKey({})
    assert.equal(system.isEnabled, true)
    assert.equal(event.defaultPrevented, true)

    dispatchKey({ shiftKey: true })
    dispatchKey({ key: 'a' })
    assert.equal(system.isEnabled, true)
    system.dispose()
  })
})
