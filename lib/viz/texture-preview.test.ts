import assert from 'node:assert/strict'
import { it, type TestContext } from 'node:test'
import {
  DataTexture,
  Group,
  RenderTarget,
  Scene,
  Texture,
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
  type NodeMaterial,
  type WebGPURenderer,
} from 'three/webgpu'

import { canvasToBlob } from './canvas-to-blob'
import { Disposer } from './disposer'
import { renderGpuTexturePreview } from './texture-preview'
import { EMPTY_SNAPSHOT, Viewer } from './viewer'

class PreviewImage {
  width = 3
  height = 2
  blob = new Blob(['png'], { type: 'image/png' })
  encode: ((callback: BlobCallback) => void) | null = null
}

class PreviewCanvas extends PreviewImage {
  pixels: Uint8ClampedArray | null = null
  getContext() {
    return {
      drawImage: (image: PreviewImage) => {
        this.blob = image.blob
        this.encode = image.encode
      },
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (image: ImageData) => { this.pixels = image.data },
    }
  }
  toBlob(callback: BlobCallback, type: string) {
    assert.equal(type, 'image/png')
    if (this.encode) this.encode(callback)
    else queueMicrotask(() => callback(this.blob))
  }
}

function browser(t: TestContext) {
  const canvases: PreviewCanvas[] = []
  const globals = {
    HTMLImageElement: PreviewImage,
    HTMLCanvasElement: PreviewCanvas,
    document: {
      createElement: (tag: string) => {
        assert.equal(tag, 'canvas')
        const canvas = new PreviewCanvas()
        canvases.push(canvas)
        return canvas
      },
    },
  }
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original)
      else Reflect.deleteProperty(globalThis, name)
    })
  }
  return canvases
}

for (const coordinateSystem of [WebGPUCoordinateSystem, WebGLCoordinateSystem]) {
  it(`encodes non-square readback rows and releases GPU resources (${coordinateSystem})`, async (t) => {
    const canvases = browser(t)
    const expected = Uint8Array.from({ length: 24 }, (_, i) => i)
    const webgpu = coordinateSystem === WebGPUCoordinateSystem
    const pixels = new Uint8Array(webgpu ? 268 : 24)
    pixels.set(expected.subarray(0, 12), webgpu ? 0 : 12)
    pixels.set(expected.subarray(12), webgpu ? 256 : 0)
    const previous = new RenderTarget()
    let target = previous
    let disposed = 0
    const renderer = {
      coordinateSystem,
      getRenderTarget: () => target,
      getActiveCubeFace: () => 2,
      getActiveMipmapLevel: () => 3,
      setRenderTarget: (next: RenderTarget, face?: number, level?: number) => {
        target = next
        if (next === previous) assert.deepEqual([face, level], [2, 3])
      },
      render: (quad: { material: NodeMaterial }) => {
        assert.equal(target.width, 3)
        assert.equal(target.height, 2)
        target.addEventListener('dispose', () => { disposed++ })
        quad.material.addEventListener('dispose', () => { disposed++ })
      },
      readRenderTargetPixelsAsync: async () => {
        assert.equal(target, previous)
        canvases[0].encode = (callback) => queueMicrotask(() => {
          assert.equal(disposed, 2, 'GPU resources are released before encoding completes')
          callback(canvases[0].blob)
        })
        return pixels
      },
    } as unknown as WebGPURenderer

    const blob = await renderGpuTexturePreview(new DataTexture(null, 3, 2), renderer, 256)
    assert.equal(blob?.type, 'image/png')
    assert.deepEqual(canvases[0].pixels, new Uint8ClampedArray(expected))
    assert.equal(disposed, 2)
    assert.equal(target, previous)
  })
}

for (const failure of ['render', 'readback']) {
  it(`restores renderer state and releases resources after ${failure} failure`, async (t) => {
    browser(t)
    let target: RenderTarget | null = null
    let disposed = 0
    const renderer = {
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      setRenderTarget: (next: RenderTarget | null) => { target = next },
      render: (quad: { material: NodeMaterial }) => {
        target!.addEventListener('dispose', () => { disposed++ })
        quad.material.addEventListener('dispose', () => { disposed++ })
        if (failure === 'render') throw new Error('render')
      },
      readRenderTargetPixelsAsync: async () => { throw new Error('readback') },
    } as unknown as WebGPURenderer

    await assert.rejects(
      renderGpuTexturePreview(new DataTexture(null, 3, 2), renderer, 256),
      new RegExp(failure)
    )
    assert.equal(disposed, 2)
    assert.equal(target, null)
  })
}

function viewerFixture(t: TestContext) {
  browser(t)
  const created: string[] = []
  const revoked: string[] = []
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => {
    assert.equal(blob.type, 'image/png')
    const url = `blob:preview-${created.length}`
    created.push(url)
    return url
  })
  t.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url))
  const images = new Map<string, PreviewImage[]>()
  const model = {
    current: null as unknown,
    async loadUrl(url: string) {
      const entries = images.get(url)
      if (!entries) throw new Error('Load failed')
      const loaded = {
        root: new Group(),
        fileName: url,
        gltf: {
          parser: {
            json: { textures: entries.map(() => ({})) },
            getDependency: async (_type: string, id: number) => new Texture(entries[id]),
          },
        },
      }
      this.current = loaded
      return loaded
    },
  }
  const viewer = Object.create(Viewer.prototype) as Viewer
  Object.assign(viewer, {
    model,
    scene: new Scene(),
    listeners: new Map(),
    disposer: new Disposer(),
    documentPreviews: new Disposer(),
    pendingPreviews: null,
    snapshot: EMPTY_SNAPSHOT,
    frameHandle: null,
    validationSchema: null,
    controls: { setIdle: () => {} },
  })
  t.after(() => viewer.dispose())
  return { viewer, images, created, revoked }
}

it('retains previews after a failed replacement, revokes on success and disposal', async (t) => {
  const { viewer, images, created, revoked } = viewerFixture(t)
  images.set('first', [new PreviewImage()])
  images.set('second', [new PreviewImage()])
  await viewer.loadUrl('first')
  assert.equal(viewer.getSnapshot().document?.textures[0].previewUrl, created[0])
  assert.deepEqual(revoked, [])
  await viewer.loadUrl('missing')
  assert.deepEqual(revoked, [])
  assert.equal(viewer.getSnapshot().document?.fileName, 'first')
  await viewer.loadUrl('second')
  assert.deepEqual(revoked, [created[0]])
  viewer.dispose()
  viewer.dispose()
  assert.deepEqual(revoked, created)
})

for (const abandon of ['replace', 'dispose']) {
  it(`cleans up partial previews and ignores late encoding on ${abandon}`, async (t) => {
    const { viewer, images, created, revoked } = viewerFixture(t)
    const delayed = new PreviewImage()
    let finish!: BlobCallback
    delayed.encode = (callback) => { finish = callback }
    images.set('pending', [new PreviewImage(), delayed])
    images.set('replacement', [new PreviewImage()])
    const pending = viewer.loadUrl('pending')
    await new Promise(setImmediate)
    assert.equal(created.length, 1)
    assert.equal(typeof finish, 'function')
    if (abandon === 'replace') await viewer.loadUrl('replacement')
    else viewer.dispose()
    assert.deepEqual(revoked, [created[0]])
    const count = created.length
    finish(delayed.blob)
    await pending
    assert.equal(created.length, count)
    if (abandon === 'replace') {
      assert.equal(viewer.getSnapshot().document?.fileName, 'replacement')
    }
  })
}

it('returns null when PNG encoding fails', async () => {
  const canvas = new PreviewCanvas()
  canvas.encode = (callback) => callback(null)
  assert.equal(await canvasToBlob(canvas as unknown as HTMLCanvasElement), null)
})
