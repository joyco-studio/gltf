import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

import { inspectGltf } from './inspect'
import { getTextureBlob, textureFileName } from './texture-download'

function fixture(image: Record<string, unknown>, compressed = false) {
  return {
    parser: {
      json: {
        images: [image],
        textures: [{ name: 'Surface', ...(compressed
          ? { extensions: { KHR_texture_basisu: { source: 0 } } }
          : { source: 0 }) }],
      },
      options: { path: 'https://example.com/models/', requestHeader: {} },
      fileLoader: { withCredentials: false },
      async getDependency(type: string, id: number) {
        if (type === 'texture') throw new Error('No preview available')
        assert.equal(type, 'bufferView')
        assert.equal(id, 0)
        return new Uint8Array([1, 2, 3, 4]).buffer
      },
    },
  } as unknown as GLTF
}

describe('texture downloads', () => {
  it('preserves embedded compressed bytes even without a decoded preview', async () => {
    const gltf = fixture({ bufferView: 0, mimeType: 'image/ktx2' }, true)
    const { textures: [texture] } = await inspectGltf(gltf, 'model.glb')
    const blob = await getTextureBlob(texture, gltf)
    assert.equal(texture.previewUrl, null)
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3, 4]))
    assert.equal(textureFileName(texture, blob), 'Surface.ktx2')
  })

  it('reads local sibling files after their loading URLs have been revoked', async () => {
    const gltf = fixture({ uri: 'textures/base%20color.png' })
    const { textures: [texture] } = await inspectGltf(gltf, 'model.gltf')
    const file = new File(['original image'], 'base color.png', { type: 'image/png' })
    assert.equal(await getTextureBlob(texture, gltf, [file]), file)
  })

  it('downloads embedded data URIs with the correct extension and safe name', async () => {
    const gltf = fixture({ uri: 'data:image/png;base64,AQIDBA==' })
    const { textures: [texture] } = await inspectGltf(gltf, 'model.gltf')
    const blob = await getTextureBlob(texture, gltf)
    assert.equal(blob.size, 4)
    assert.equal(textureFileName({ ...texture, name: 'folder/Surface.jpg' }, blob), 'folder_Surface.png')
  })

  it('resolves remote image paths and rejects failed downloads', async (t) => {
    const gltf = fixture({ uri: 'textures/color.webp' })
    const { textures: [texture] } = await inspectGltf(gltf, 'model.gltf')
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string) => {
      assert.equal(url, 'https://example.com/models/textures/color.webp')
      return new Response('original', { headers: { 'Content-Type': 'image/webp' } })
    })
    const blob = await getTextureBlob(texture, gltf)
    assert.equal(await blob.text(), 'original')
    assert.equal(textureFileName(texture, blob), 'Surface.webp')
    fetchMock.mock.mockImplementation(async () => new Response(null, { status: 404 }))
    await assert.rejects(getTextureBlob(texture, gltf), /Could not download/)
  })
})
