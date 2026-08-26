import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { fetchGlbJson } from './fetch-glb-json'

const GLB_LENGTH = 15 * 1024 * 1024
const originalFetch = globalThis.fetch
const originalAllowedHosts = process.env.GLTF_VALIDATION_REMOTE_HOSTS

function remoteGlbParts(json: unknown) {
  const source = new TextEncoder().encode(JSON.stringify(json))
  const jsonLength = (source.length + 3) & ~3
  const header = new ArrayBuffer(20)
  const view = new DataView(header)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, GLB_LENGTH, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true)

  const jsonBytes = new Uint8Array(jsonLength).fill(0x20)
  jsonBytes.set(source)
  return { header, jsonBytes }
}

function rangeResponse(
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
  start: number,
  etag: string
) {
  const length = bytes.byteLength
  return new Response(bytes, {
    status: 206,
    headers: {
      'Content-Range': `bytes ${start}-${start + length - 1}/${GLB_LENGTH}`,
      ETag: etag,
    },
  })
}

describe('fetchGlbJson', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalAllowedHosts === undefined) {
      delete process.env.GLTF_VALIDATION_REMOTE_HOSTS
    } else {
      process.env.GLTF_VALIDATION_REMOTE_HOSTS = originalAllowedHosts
    }
  })

  it('reads only the header and JSON chunk from a large R2 GLB', async () => {
    process.env.GLTF_VALIDATION_REMOTE_HOSTS = 'models.example.com'
    const document = {
      asset: { version: '2.0' },
      nodes: [{ name: 'Duplicate' }, { name: 'Duplicate' }],
    }
    const { header, jsonBytes } = remoteGlbParts(document)
    const responses = [
      rangeResponse(header, 0, '"version-1"'),
      rangeResponse(jsonBytes, 20, '"version-1"'),
    ]
    const headers: HeadersInit[] = []
    globalThis.fetch = (async (_input, init) => {
      headers.push(init?.headers ?? {})
      const response = responses.shift()
      assert(response)
      return response
    }) as typeof fetch

    const result = await fetchGlbJson(
      'https://models.example.com/model.glb'
    )

    assert.deepEqual(result, { ok: true, json: document })
    assert.deepEqual(headers, [
      { 'Accept-Encoding': 'identity', Range: 'bytes=0-19' },
      {
        'Accept-Encoding': 'identity',
        'If-Range': '"version-1"',
        Range: `bytes=20-${19 + jsonBytes.byteLength}`,
      },
    ])
    assert.equal(responses.length, 0)
  })

  it('rejects a same-length object replacement between ranges', async () => {
    process.env.GLTF_VALIDATION_REMOTE_HOSTS = 'models.example.com'
    const original = remoteGlbParts({
      asset: { version: '2.0' },
      nodes: [{ name: 'Old' }],
    })
    const replacement = remoteGlbParts({
      asset: { version: '2.0' },
      nodes: [{ name: 'New' }],
    })
    const responses = [
      rangeResponse(original.header, 0, '"version-1"'),
      rangeResponse(replacement.jsonBytes, 20, '"version-2"'),
    ]
    globalThis.fetch = (async () => {
      const response = responses.shift()
      assert(response)
      return response
    }) as typeof fetch

    const result = await fetchGlbJson(
      'https://models.example.com/model.glb'
    )

    assert.deepEqual(result, {
      ok: false,
      title: 'Remote GLB changed during validation',
      description: 'Retry validation after the object has finished updating.',
      status: 409,
    })
  })

  it('requires a strong ETag before requesting the JSON chunk', async () => {
    process.env.GLTF_VALIDATION_REMOTE_HOSTS = 'models.example.com'
    const { header } = remoteGlbParts({ asset: { version: '2.0' } })
    const responses = [rangeResponse(header, 0, 'W/"weak-version"')]
    globalThis.fetch = (async () => {
      const response = responses.shift()
      assert(response)
      return response
    }) as typeof fetch

    const result = await fetchGlbJson(
      'https://models.example.com/model.glb'
    )

    assert.deepEqual(result, {
      ok: false,
      title: 'Remote GLB cannot be validated safely',
      description:
        'The remote server must return a strong ETag for ranged requests.',
      status: 502,
    })
    assert.equal(responses.length, 0)
  })

  it('rejects every host when no allowlist is configured', async () => {
    delete process.env.GLTF_VALIDATION_REMOTE_HOSTS
    let fetched = false
    globalThis.fetch = (async () => {
      fetched = true
      throw new Error('Unexpected fetch')
    }) as typeof fetch

    const result = await fetchGlbJson(
      'https://r2.joyco.studio/models/model.glb'
    )

    assert.deepEqual(result, {
      ok: false,
      title: 'Remote GLB host is not allowed',
      description:
        'Configure GLTF_VALIDATION_REMOTE_HOSTS to allow this R2 hostname.',
      status: 403,
    })
    assert.equal(fetched, false)
  })
})
