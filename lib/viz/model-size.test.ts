import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createGltfFileSet } from './file-set'
import { getRemoteModelSize } from './model-size'

describe('model file size', () => {
  it('counts local dependencies once and excludes unrelated dropped files', () => {
    const fileSet = createGltfFileSet([
      new File(['root'], 'model.gltf'),
      new File(['buffer'], 'model.bin'),
      new File(['texture'], 'albedo map.png'),
      new File(['unrelated'], 'other.glTF'),
    ])!
    try {
      fileSet.manager.resolveURL(fileSet.rootUrl)
      fileSet.manager.resolveURL('model.bin')
      fileSet.manager.resolveURL('textures/albedo%20map.png')
      fileSet.manager.resolveURL('textures/albedo%20map.png')
      fileSet.manager.resolveURL('data:image/png;base64,AAAA')
      assert.equal(fileSet.totalSize, 17)
    } finally {
      fileSet.revoke()
    }
  })

  it('does not count embedded GLB assets twice', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('No metadata request expected')
    })
    assert.equal(await getRemoteModelSize({
      buffers: [{}], images: [{}, { uri: 'data:image/png;base64,AAAA' }],
    }, 2048, 'https://example.com/model.glb'), 2048)
    assert.equal(fetchMock.mock.callCount(), 0)
  })

  it('includes unique external resources, resolving relative URLs', async (t) => {
    const requested: string[] = []
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      requested.push(url)
      assert.equal(init.method, 'HEAD')
      return new Response(null, { headers: { 'content-length': '100' } })
    })
    assert.equal(await getRemoteModelSize({
      buffers: [{ uri: 'mesh.bin' }],
      images: [{ uri: './texture.png' }, { uri: 'texture.png' }],
    }, 50, 'https://example.com/models/model.gltf?token=abc'), 250)
    assert.deepEqual(requested, [
      'https://example.com/models/mesh.bin',
      'https://example.com/models/texture.png',
    ])
  })

  it('reports unavailable instead of a partial total when metadata is missing', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(null))
    assert.equal(await getRemoteModelSize({ images: [{ uri: 'image.png' }] },
      100, 'https://example.com/model.gltf'), null)
    assert.equal(await getRemoteModelSize({}, null, 'https://example.com/model.glb'), null)
  })

  it('does not fail model loading when metadata requests fail', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('CORS') })
    assert.equal(await getRemoteModelSize({ buffers: [{ uri: 'mesh.bin' }] },
      100, 'https://example.com/model.gltf'), null)
  })
})
