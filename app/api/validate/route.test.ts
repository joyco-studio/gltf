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

describe('/api/validate custom schemas', () => {
  it('returns a schema error instead of throwing for deeply nested expected trees', async () => {
    const depth = 3000
    // Build valid JSON iteratively so JSON.stringify's own depth limit is irrelevant.
    const tree = '{"name":"Part","children":['.repeat(depth) +
      '{"name":"Part"}' + ']}'.repeat(depth)
    const response = await POST(new Request('https://gltf.joyco.studio/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: `{"document":{},"schema":{"version":1,"rules":[{"id":"deep","path":"$.nodes[0]","operator":"matchesTree","value":${tree}}]}}`,
    }))
    assert.equal(response.status, 400)
    const [issue] = await response.json()
    assert.equal(issue.title, 'Invalid validation schema')
    assert.match(issue.description, /cannot exceed 128 node levels/)
    assertCorsHeaders(response)
  })

  it('applies hierarchy rules through the same public API contract', async () => {
    const response = await POST(new Request('https://gltf.joyco.studio/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: {
          scenes: [{ nodes: [0] }],
          nodes: [{ name: 'Body', children: [1] }, { name: 'Screen' }],
        },
        schema: { version: 1, rules: [
          { id: 'children', path: '$.nodes[0]', operator: 'hasChildren', value: ['Screen'] },
          { id: 'descendants', path: '$.nodes[0]', operator: 'hasDescendants', value: ['Screen'] },
          { id: 'path', path: '$.scenes[0]', operator: 'hasPath', value: ['Body', 'Screen'] },
          { id: 'tree', path: '$.nodes[0]', operator: 'matchesTree', value: { children: [] } },
        ] },
      }),
    }))
    assert.equal(response.status, 200)
    const [issue, ...rest] = await response.json()
    assert.deepEqual(rest, [])
    assert.equal(issue.ruleId, 'tree')
    assert.equal(issue.type, 'error')
    assert.deepEqual(issue.references.map(({ id }: { id: number }) => id), [0, 1])
  })

  it('rejects hierarchy values with the wrong operator-specific shape', async () => {
    const response = await POST(new Request('https://gltf.joyco.studio/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: {}, schema: { version: 1, rules: [
        { id: 'tree', path: '$.nodes[0]', operator: 'matchesTree', value: ['Screen'] },
      ] } }),
    }))
    assert.equal(response.status, 400)
    assert.equal((await response.json())[0].title, 'Invalid validation schema')
  })

  it('validates a wrapped glTF document with the supplied schema', async () => {
    const response = await POST(
      new Request('https://gltf.joyco.studio/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: {
            meshes: [{ name: 'Body' }, { name: 'Frame' }, { name: 'Glass' }],
          },
          schema: {
            version: 1,
            rules: [
              {
                id: 'required-code-meshes',
                path: '$.meshes[*].name',
                operator: 'includesAll',
                value: ['Body', 'Frame', 'Glass', 'Screen'],
                level: 'error',
              },
            ],
          },
        }),
      })
    )

    assert.equal(response.status, 200)
    const [result] = await response.json()
    assert.equal(result.ruleId, 'required-code-meshes')
    assert.match(result.description, /“Screen”/)
  })

  it('returns invalid schemas through the normal issue contract', async () => {
    const response = await POST(
      new Request('https://gltf.joyco.studio/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: { asset: { version: '2.0' } },
          schema: { version: 1, rules: [{ operator: 'nope' }] },
        }),
      })
    )

    assert.equal(response.status, 400)
    const [result] = await response.json()
    assert.equal(result.type, 'error')
    assert.equal(result.title, 'Invalid validation schema')
  })
})
