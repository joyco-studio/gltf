import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { fetchValidationSchema } from './fetch-validation-schema'

describe('fetchValidationSchema', () => {
  it('loads an HTTP schema without caching it', async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = []
    const fetcher = (async (input, init) => {
      requests.push({ input: String(input), init })
      return new Response('{"version":1,"rules":[]}')
    }) as typeof fetch

    const result = await fetchValidationSchema(
      ' https://schemas.example.com/gltf.json ',
      fetcher
    )

    assert.deepEqual(result, {
      ok: true,
      schema: { version: 1, rules: [] },
      url: 'https://schemas.example.com/gltf.json',
    })
    assert.equal(requests[0].input, 'https://schemas.example.com/gltf.json')
    assert.deepEqual(requests[0].init, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
  })

  it('rejects non-HTTP URLs before fetching', async () => {
    let fetched = false
    const result = await fetchValidationSchema(
      'file:///tmp/schema.json',
      (async () => {
        fetched = true
        return new Response()
      }) as typeof fetch
    )

    assert.deepEqual(result, {
      ok: false,
      error: 'Enter an absolute HTTP or HTTPS schema URL.',
    })
    assert.equal(fetched, false)
  })

  it('reports unsuccessful responses', async () => {
    const result = await fetchValidationSchema(
      'https://schemas.example.com/missing.json',
      (async () => new Response(null, { status: 404 })) as typeof fetch
    )

    assert.deepEqual(result, {
      ok: false,
      error: 'The schema URL returned HTTP 404.',
    })
  })

  it('explains browser fetch failures', async () => {
    const result = await fetchValidationSchema(
      'https://schemas.example.com/private.json',
      (async () => {
        throw new TypeError('Failed to fetch')
      }) as typeof fetch
    )

    assert.deepEqual(result, {
      ok: false,
      error:
        'The schema could not be loaded. Check that the URL is reachable and allows cross-origin requests.',
    })
  })

  it('rejects malformed JSON responses', async () => {
    const result = await fetchValidationSchema(
      'https://schemas.example.com/invalid.json',
      (async () => new Response('{')) as typeof fetch
    )

    assert.deepEqual(result, {
      ok: false,
      error: 'The loaded schema is not valid JSON.',
    })
  })

  it('rejects invalid validation schemas', async () => {
    const result = await fetchValidationSchema(
      'https://schemas.example.com/invalid-schema.json',
      (async () =>
        Response.json({
          version: 1,
          rules: [{ operator: 'nope' }],
        })) as typeof fetch
    )

    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /Rule 1 “operator”/)
  })
})
