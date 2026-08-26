import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { OPTIONS, POST } from './route'

function request(method: 'OPTIONS' | 'POST', origin?: string) {
  return new Request('https://gltf.joyco.studio/api/validate', {
    method,
    headers: {
      ...(origin && { Origin: origin }),
      ...(method === 'POST' && { 'Content-Type': 'application/json' }),
    },
    ...(method === 'POST' && {
      body: JSON.stringify({ asset: { version: '2.0' } }),
    }),
  })
}

function assertCorsHeaders(response: Response) {
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
  assert.equal(
    response.headers.get('Access-Control-Allow-Methods'),
    'POST, OPTIONS'
  )
  assert.equal(
    response.headers.get('Access-Control-Allow-Headers'),
    'Content-Type'
  )
  assert.equal(response.headers.get('Vary'), null)
}

describe('/api/validate CORS', () => {
  it('answers preflight requests', () => {
    const response = OPTIONS()

    assert.equal(response.status, 204)
    assertCorsHeaders(response)
  })

  it('includes CORS headers on POST responses', async () => {
    const response = await POST(request('POST', 'https://example.com'))

    assert.equal(response.status, 200)
    assertCorsHeaders(response)
  })

  it('includes CORS headers on request errors', async () => {
    const response = await POST(
      new Request('https://gltf.joyco.studio/api/validate', {
        method: 'POST',
        headers: {
          Origin: 'https://example.com',
          'Content-Type': 'text/plain',
        },
        body: 'not glTF',
      })
    )

    assert.equal(response.status, 415)
    assertCorsHeaders(response)
  })

  it('allows every origin with the same wildcard response', async () => {
    for (const origin of [
      'https://example.com',
      'https://joyco.studio',
      'https://consumer.joyco.studio.example.com',
      'http://consumer.joyco.studio',
    ]) {
      const response = await POST(request('POST', origin))

      assert.equal(response.status, 200)
      assertCorsHeaders(response)
    }
  })

  it('returns wildcard CORS even when Origin is absent', async () => {
    const response = await POST(request('POST'))

    assert.equal(response.status, 200)
    assertCorsHeaders(response)
  })
})
