import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { OPTIONS, POST } from './route'

const ALLOWED_ORIGIN = 'https://consumer.joyco.studio'

function request(method: 'OPTIONS' | 'POST', origin: string) {
  return new Request('https://gltf.joyco.studio/api/validate', {
    method,
    headers: {
      Origin: origin,
      ...(method === 'POST' && { 'Content-Type': 'application/json' }),
    },
    ...(method === 'POST' && {
      body: JSON.stringify({ asset: { version: '2.0' } }),
    }),
  })
}

function assertCorsHeaders(response: Response, origin = ALLOWED_ORIGIN) {
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin)
  assert.equal(
    response.headers.get('Access-Control-Allow-Methods'),
    'POST, OPTIONS'
  )
  assert.equal(
    response.headers.get('Access-Control-Allow-Headers'),
    'Content-Type'
  )
  assert.match(response.headers.get('Vary') ?? '', /\bOrigin\b/)
}

describe('/api/validate CORS', () => {
  it('answers preflight requests', () => {
    const response = OPTIONS(request('OPTIONS', ALLOWED_ORIGIN))

    assert.equal(response.status, 204)
    assertCorsHeaders(response)
  })

  it('includes CORS headers on POST responses', async () => {
    const response = await POST(request('POST', ALLOWED_ORIGIN))

    assert.equal(response.status, 200)
    assertCorsHeaders(response)
  })

  it('includes CORS headers on request errors', async () => {
    const response = await POST(
      new Request('https://gltf.joyco.studio/api/validate', {
        method: 'POST',
        headers: {
          Origin: ALLOWED_ORIGIN,
          'Content-Type': 'text/plain',
        },
        body: 'not glTF',
      })
    )

    assert.equal(response.status, 415)
    assertCorsHeaders(response)
  })

  it('does not allow unrelated or lookalike origins', () => {
    for (const origin of [
      'https://example.com',
      'https://joyco.studio',
      'https://consumer.joyco.studio.example.com',
      'http://consumer.joyco.studio',
    ]) {
      const response = OPTIONS(request('OPTIONS', origin))

      assert.equal(response.status, 204)
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
    }
  })
})
