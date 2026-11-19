import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { computeGltfStats, type GltfStats, type SizeCategory } from './stats'

function bytesOf(stats: GltfStats, category: SizeCategory) {
  return stats.breakdown.find((item) => item.category === category)?.bytes ?? 0
}

function entriesOf(stats: GltfStats, category: SizeCategory) {
  return Object.fromEntries(
    (stats.breakdown.find((item) => item.category === category)?.entries ?? [])
      .map(({ key, bytes }) => [key, bytes])
  )
}

// One triangle: positions (36 B) + normals (36 B) interleaved in one view,
// uv (24 B), u16 indices (6 B), plus a 100 B embedded PNG.
const triangleJson = {
  asset: { version: '2.0', generator: 'test' },
  extensionsUsed: ['KHR_materials_unlit'],
  buffers: [{ byteLength: 300 }],
  bufferViews: [
    { buffer: 0, byteLength: 72, byteStride: 24 },
    { buffer: 0, byteLength: 24 },
    { buffer: 0, byteLength: 6 },
    { buffer: 0, byteLength: 100 },
    { buffer: 0, byteLength: 40 }, // referenced by nothing
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
    { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  meshes: [
    {
      primitives: [
        {
          attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
          indices: 3,
        },
      ],
    },
  ],
  nodes: [{ mesh: 0 }, { mesh: 0 }],
  images: [{ bufferView: 3, mimeType: 'image/png' }],
  textures: [{ source: 0 }],
  materials: [{}],
}

describe('computeGltfStats', () => {
  it('splits a GLB into geometry, extra attributes, textures and overhead', () => {
    const stats = computeGltfStats({
      json: triangleJson,
      totalSize: 1000,
      glbJsonLength: 600,
      meshInstances: [2],
    })

    assert.equal(stats.container, 'glb')
    assert.equal(stats.generator, 'test')
    // interleaved view is shared proportionally between POSITION and NORMAL
    assert.deepEqual(entriesOf(stats, 'geometry'), { Positions: 36, Indices: 6 })
    assert.deepEqual(entriesOf(stats, 'attributes'), {
      NORMAL: 36,
      TEXCOORD_0: 24,
    })
    assert.deepEqual(entriesOf(stats, 'textures'), { 'image/png': 100 })
    assert.equal(bytesOf(stats, 'unreferenced'), 40)
    assert.deepEqual(entriesOf(stats, 'overhead'), {
      JSON: 600,
      'Headers & padding': 158,
    })
    // the breakdown always reconciles to the measured file weight
    assert.equal(
      stats.breakdown.reduce((total, item) => total + item.bytes, 0),
      1000
    )

    assert.equal(stats.counts.drawCalls, 2)
    assert.deepEqual(stats.counts.triangles, { unique: 1, rendered: 2 })
    assert.deepEqual(stats.counts.vertices, { unique: 3, rendered: 6 })
    assert.equal(stats.gpu.geometry, 36 + 36 + 24 + 6)
  })

  it('counts compressed streams at their stored size', () => {
    const stats = computeGltfStats({
      json: {
        buffers: [
          { byteLength: 50 },
          { byteLength: 400, extensions: { EXT_meshopt_compression: { fallback: true } } },
        ],
        bufferViews: [
          { buffer: 0, byteLength: 20 }, // draco blob
          {
            buffer: 1,
            byteLength: 400,
            extensions: {
              EXT_meshopt_compression: { buffer: 0, byteOffset: 20, byteLength: 30 },
            },
          },
        ],
        accessors: [
          { componentType: 5126, count: 10, type: 'VEC3' },
          { bufferView: 1, componentType: 5126, count: 4, type: 'SCALAR' },
          { bufferView: 1, componentType: 5126, count: 4, type: 'VEC4' },
        ],
        meshes: [
          {
            primitives: [
              {
                attributes: { POSITION: 0 },
                extensions: { KHR_draco_mesh_compression: { bufferView: 0 } },
              },
            ],
          },
        ],
        animations: [
          {
            channels: [{ sampler: 0, target: { path: 'rotation' } }],
            samplers: [{ input: 1, output: 2 }],
          },
        ],
      },
      totalSize: null,
      glbJsonLength: null,
    })

    assert.deepEqual(entriesOf(stats, 'geometry'), { 'Draco compressed': 20 })
    assert.deepEqual(entriesOf(stats, 'animation'), {
      'Keyframe times': 6,
      rotation: 24,
    })
    // unknown total → no guessed overhead
    assert.equal(bytesOf(stats, 'overhead'), 0)
  })

  it('weighs external and inline images from their stored bytes', () => {
    const inline = 'data:image/jpeg;base64,AAAA'
    const stats = computeGltfStats({
      json: {
        buffers: [{ byteLength: 12, uri: 'mesh.bin' }],
        bufferViews: [{ buffer: 0, byteLength: 12 }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        images: [{ uri: 'albedo.png' }, { uri: inline }],
      },
      totalSize: 2000,
      glbJsonLength: null,
      resourceSizes: new Map([
        ['mesh.bin', 12],
        ['albedo.png', 1500],
      ]),
    })

    assert.equal(stats.container, 'gltf')
    assert.deepEqual(entriesOf(stats, 'textures'), {
      'image/png': 1500,
      'image/jpeg': inline.length,
    })
    assert.deepEqual(entriesOf(stats, 'overhead'), {
      JSON: 2000 - 1500 - inline.length - 12,
    })
  })

  it('ranks the top 5 inspectable offenders per category', () => {
    // seven meshes with 12·(i+1) B of positions each → only the 5 largest
    const meshCount = 7
    const stats = computeGltfStats({
      json: {
        buffers: [{ byteLength: 10_000 }],
        bufferViews: [
          ...Array.from({ length: meshCount }, (_, i) => ({
            buffer: 0,
            byteLength: 12 * (i + 1),
          })),
          { buffer: 0, byteLength: 500 }, // image 0
          { buffer: 0, byteLength: 64 }, // inverse bind matrices
        ],
        accessors: [
          ...Array.from({ length: meshCount }, (_, i) => ({
            bufferView: i,
            componentType: 5126,
            count: i + 1,
            type: 'VEC3',
          })),
          { bufferView: meshCount + 1, componentType: 5126, count: 1, type: 'MAT4' },
        ],
        meshes: Array.from({ length: meshCount }, (_, i) => ({
          primitives: [{ attributes: { POSITION: i } }],
        })),
        nodes: [{ mesh: 0, skin: 0 }],
        skins: [{ inverseBindMatrices: meshCount }],
        images: [{ bufferView: meshCount, mimeType: 'image/png' }],
        // two textures share image 0 → credited once, to the first
        textures: [{ source: 0 }, { source: 0 }],
      },
      totalSize: null,
      glbJsonLength: null,
    })

    const offenders = (category: SizeCategory) =>
      stats.breakdown.find((item) => item.category === category)?.offenders

    assert.deepEqual(offenders('geometry'), [
      { kind: 'mesh', id: 6, bytes: 84 },
      { kind: 'mesh', id: 5, bytes: 72 },
      { kind: 'mesh', id: 4, bytes: 60 },
      { kind: 'mesh', id: 3, bytes: 48 },
      { kind: 'mesh', id: 2, bytes: 36 },
    ])
    assert.deepEqual(offenders('textures'), [{ kind: 'texture', id: 0, bytes: 500 }])
    // skins aren't inspectable — the skinned node stands in
    assert.deepEqual(offenders('skinning'), [{ kind: 'node', id: 0, bytes: 64 }])
  })
})
