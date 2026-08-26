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
      { fetcher }
    )

    assert.deepEqual(result, {
      ok: true,
      schema: { version: 1, rules: [] },
      url: 'https://schemas.example.com/gltf.json',
    })
    assert.equal(requests[0].input, 'https://schemas.example.com/gltf.json')
    const { signal, ...init } = requests[0].init ?? {}
    assert.deepEqual(init, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    assert.ok(signal instanceof AbortSignal)
  })

  it('rejects non-HTTP URLs before fetching', async () => {
    let fetched = false
    const result = await fetchValidationSchema(
      'file:///tmp/schema.json',
      {
        fetcher: (async () => {
          fetched = true
          return new Response()
        }) as typeof fetch,
      }
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
      {
        fetcher: (async () =>
          new Response(null, { status: 404 })) as typeof fetch,
      }
    )

    assert.deepEqual(result, {
      ok: false,
      error: 'The schema URL returned HTTP 404.',
    })
  })

  it('explains browser fetch failures', async () => {
    const result = await fetchValidationSchema(
      'https://schemas.example.com/private.json',
      {
        fetcher: (async () => {
          throw new TypeError('Failed to fetch')
        }) as typeof fetch,
      }
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
      { fetcher: (async () => new Response('{')) as typeof fetch }
    )

    assert.deepEqual(result, {
      ok: false,
      error: 'The loaded schema is not valid JSON.',
    })
  })

  it('rejects invalid validation schemas', async () => {
    const result = await fetchValidationSchema(
      'https://schemas.example.com/invalid-schema.json',
      {
        fetcher: (async () =>
          Response.json({
            version: 1,
            rules: [{ operator: 'nope' }],
          })) as typeof fetch,
      }
    )

    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /Rule 1 “operator”/)
  })

  it('rejects advertised response sizes over the configured limit', async () => {
    const result = await fetchValidationSchema(
      'https://schemas.example.com/large.json',
      {
        fetcher: (async () =>
          new Response('{}', {
            headers: { 'Content-Length': '11' },
          })) as typeof fetch,
        maxBytes: 10,
      }
    )

    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /exceeds the .* MiB limit/)
  })

  it('rejects streamed response bodies over the configured limit', async () => {
    const result = await fetchValidationSchema(
      'https://schemas.example.com/large.json',
      {
        fetcher: (async () => new Response('12345678901')) as typeof fetch,
        maxBytes: 10,
      }
    )

    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /exceeds the .* MiB limit/)
  })

  it('times out stalled response bodies', async () => {
    const fetcher = (async (_input, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(init.signal?.reason),
              { once: true }
            )
          },
        })
      )) as typeof fetch

    const result = await fetchValidationSchema(
      'https://schemas.example.com/stalled.json',
      { fetcher, timeoutMs: 1 }
    )

    assert.deepEqual(result, {
      ok: false,
      error: 'The validation schema request timed out.',
    })
  })

  it('forwards caller cancellation to the request', async () => {
    const controller = new AbortController()
    const fetcher = (async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true }
        )
      })) as typeof fetch

    const request = fetchValidationSchema(
      'https://schemas.example.com/cancelled.json',
      { fetcher, signal: controller.signal }
    )
    controller.abort()

    assert.deepEqual(await request, {
      ok: false,
      error: 'The validation schema request was cancelled.',
    })
  })
})
