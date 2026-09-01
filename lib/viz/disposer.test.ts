import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  Texture,
} from 'three/webgpu'

import { Disposer, disposeObject3D } from './disposer'

describe('Disposer', () => {
  it('unwinds once in reverse registration order', () => {
    const calls: string[] = []
    const disposer = new Disposer()

    disposer.add(() => calls.push('first'))
    disposer.add({ dispose: () => calls.push('second') })
    disposer.dispose()
    disposer.dispose()

    assert.deepEqual(calls, ['second', 'first'])
  })

  it('immediately tears down late async registrations', () => {
    let calls = 0
    const disposer = new Disposer()
    disposer.dispose()

    disposer.add({ dispose: () => calls++ })

    assert.equal(calls, 1)
  })

  it('removes registered event listeners', () => {
    const target = new EventTarget()
    const disposer = new Disposer()
    let calls = 0
    disposer.listen(target, 'change', () => calls++)

    target.dispatchEvent(new Event('change'))
    disposer.dispose()
    target.dispatchEvent(new Event('change'))

    assert.equal(calls, 1)
  })

  it('continues teardown after a cleanup fails', () => {
    const calls: string[] = []
    const disposer = new Disposer()
    disposer.add(() => calls.push('first'))
    disposer.add(() => {
      throw new Error('broken cleanup')
    })

    assert.throws(() => disposer.dispose(), /broken cleanup/)
    assert.deepEqual(calls, ['first'])
  })
})

describe('disposeObject3D', () => {
  it('detaches a graph and disposes shared resources exactly once', () => {
    const texture = new Texture()
    const uniformTexture = new Texture()
    const geometry = new BoxGeometry()
    const material = new MeshBasicMaterial({ map: texture })
    const shader = new ShaderMaterial({
      uniforms: { maps: { value: [uniformTexture, uniformTexture] } },
    })
    const root = new Group()
    const parent = new Group()
    root.add(new Mesh(geometry, material), new Mesh(geometry, [material, shader]))
    parent.add(root)

    const disposed = { geometry: 0, material: 0, shader: 0, texture: 0, uniform: 0 }
    geometry.addEventListener('dispose', () => disposed.geometry++)
    material.addEventListener('dispose', () => disposed.material++)
    shader.addEventListener('dispose', () => disposed.shader++)
    texture.addEventListener('dispose', () => disposed.texture++)
    uniformTexture.addEventListener('dispose', () => disposed.uniform++)

    disposeObject3D(root)

    assert.equal(root.parent, null)
    assert.deepEqual(disposed, {
      geometry: 1,
      material: 1,
      shader: 1,
      texture: 1,
      uniform: 1,
    })
  })
})
