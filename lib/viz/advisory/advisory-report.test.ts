import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { GltfDocumentInfo, GltfTextureInfo } from '../inspect'
import { REPORT_SCHEMA, buildAdvisoryReport } from './advisory-report'
import type { TextureAdvice } from './texture-advisor'

function texture(id: number, name: string): GltfTextureInfo {
  return {
    kind: 'texture',
    id,
    name,
    uri: null,
    bufferView: id,
    slots: ['baseColorTexture'],
    instances: 1,
    mimeType: 'image/png',
    width: 1000,
    height: 500,
    size: 1000,
    gpuSize: null,
    previewUrl: null,
  }
}

const json = {
  meshes: [{ name: 'BodyMesh', primitives: [{ material: 0 }] }],
  materials: [{ name: 'Skin', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
  textures: [{ source: 0 }, { source: 1 }],
  images: [
    { name: 'skin_albedo', bufferView: 0, mimeType: 'image/png' },
    { name: 'orphan', bufferView: 1, mimeType: 'image/png' },
  ],
}

const document = {
  fileName: 'hero.glb',
  nodes: [{ kind: 'node', id: 0, name: 'Hero', objectType: 'mesh', depth: 0, hasChildren: false, meshId: 0 }],
  textures: [texture(0, 'skin'), texture(1, 'orphan')],
} as unknown as GltfDocumentInfo

const advice: TextureAdvice[] = [
  {
    status: 'analyzed',
    coverage: 0.4,
    crop: { x: 100, y: 50, width: 500, height: 250 },
    tiling: false,
    offset: false,
    sharedWith: [],
    texCoords: [0],
    users: [{ materialId: 0, materialName: 'Skin', meshId: 0, meshName: 'BodyMesh', slot: 'baseColorTexture', texCoord: 0 }],
    overlays: { unusedUrl: null, wireUrl: null },
    download: { status: 'measured', original: 1000, cleared: 800, cropped: 300 },
  },
  {
    status: 'unused',
    reason: 'unreferenced',
    sharedWith: [],
    download: { status: 'measured', original: 2000, cleared: null, cropped: null },
  },
]

function parse(report: string) {
  const match = report.match(/```json\n([\s\S]+?)\n```/)
  assert.ok(match, 'report embeds a JSON block')
  return JSON.parse(match[1])
}

describe('buildAdvisoryReport', () => {
  const report = buildAdvisoryReport({
    fileName: 'hero.glb',
    document,
    json,
    textures: advice,
    threshold: 85,
    unusedMasks: new Map([[0, 'AAAA']]),
    generatedAt: new Date('2026-11-04T00:00:00Z'),
  })
  const data = parse(report)
  const [skin, orphan] = data.textures

  it('orders actions by projected savings', () => {
    assert.equal(data.schema, REPORT_SCHEMA)
    assert.ok(report.indexOf('`orphan`') < report.indexOf('`skin`'))
    assert.deepEqual(orphan.actions, ['remove'])
    // the mask describes the uncropped image, so flatten must come first
    assert.deepEqual(skin.actions, ['flatten', 'crop'])
    assert.equal(skin.bytes.savings, 700)
  })

  it('gives the crop in Blender space with a matching Mapping node', () => {
    // top-left y=50,h=250 on a 500px-tall image → bottom-left y=200
    assert.deepEqual(skin.crop.pixelsBottomLeft, { x: 100, y: 200, width: 500, height: 250 })
    assert.deepEqual(skin.crop.uvBlender, { minU: 0.1, minV: 0.4, maxU: 0.6, maxV: 0.9 })
    const { location, scale } = skin.crop.mappingNode
    // out = location + scale · in must send the crop's corners to 0 and 1
    for (const [u, v, expected] of [[0.1, 0.4, 0], [0.6, 0.9, 1]]) {
      assert.ok(Math.abs(location[0] + scale[0] * u - expected) < 1e-6)
      assert.ok(Math.abs(location[1] + scale[1] * v - expected) < 1e-6)
    }
  })

  it('names the Blender objects, materials and images to touch', () => {
    assert.equal(skin.image.name, 'skin_albedo')
    assert.deepEqual(skin.usedBy, [
      { material: 'Skin', slot: 'baseColorTexture', uvMapIndex: 0, mesh: 'BodyMesh', objects: ['Hero'] },
    ])
    assert.equal(skin.unusedMaskPng, 'AAAA')
  })
})
