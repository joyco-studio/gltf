import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { BufferAttribute, BufferGeometry, Mesh } from 'three/webgpu'

import type { GltfDocumentInfo, GltfTextureInfo } from '../inspect'
import { TextureAdvisor, type AdvisorySnapshot } from './texture-advisor'

/** A two-triangle UV island covering [u0,v0]–[u1,v1]. */
function islandMesh(u0: number, v0: number, u1: number, v1: number) {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]), 2)
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return new Mesh(geometry)
}

function texture(id: number): GltfTextureInfo {
  return {
    kind: 'texture',
    id,
    name: `texture_${id}`,
    uri: null,
    bufferView: id,
    slots: [],
    instances: 1,
    mimeType: 'image/png',
    width: 100,
    height: 100,
    size: null,
    gpuSize: null,
    previewUrl: null,
  }
}

function fixture() {
  const meshes = [
    islandMesh(0, 0, 0.5, 0.5),
    islandMesh(0.5, 0.5, 1, 1),
    // lives in the v=1 repeat tile
    islandMesh(0.1, 1.1, 0.3, 1.3),
  ]
  const json = {
    meshes: [0, 1, 2].map((material) => ({ name: `mesh_${material}`, primitives: [{ material }] })),
    materials: [
      { name: 'A', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { name: 'B', emissiveTexture: { index: 1 } },
      { name: 'C', pbrMetallicRoughness: { baseColorTexture: { index: 2 } } },
    ],
    // textures 0 and 1 read the same image
    textures: [{ source: 0 }, { source: 0 }, { source: 1 }],
    images: [{ bufferView: 0 }, { bufferView: 1 }],
  }
  const gltf = {
    parser: {
      json,
      getDependency: async (type: string, index: number) =>
        type === 'mesh' ? meshes[index] : new Uint8Array(1000),
      options: {},
    },
  } as unknown as GLTF
  const document = {
    fileName: 'scene.glb',
    nodes: [],
    textures: [texture(0), texture(1), texture(2)],
  } as unknown as GltfDocumentInfo
  return { gltf, document }
}

function untilReady(advisor: TextureAdvisor) {
  return new Promise<Exclude<AdvisorySnapshot, { status: 'idle' }>>((resolve) => {
    advisor.on('change', (snapshot) => {
      if (snapshot.status === 'ready') resolve(snapshot)
    })
  })
}

describe('TextureAdvisor', () => {
  it('analyzes textures sharing an image as one image', async () => {
    const advisor = new TextureAdvisor()
    const { gltf, document } = fixture()
    advisor.setModel({ gltf, files: [], document })
    const ready = untilReady(advisor)
    advisor.start()
    const { textures } = await ready

    const [first, second] = textures
    assert.equal(first.status, 'analyzed')
    assert.equal(second.status, 'analyzed')
    if (first.status !== 'analyzed' || second.status !== 'analyzed') return
    // union of both textures' islands, not each texture's own half
    assert.ok(first.coverage > 0.5)
    assert.equal(first.coverage, second.coverage)
    assert.deepEqual(first.sharedWith, [1])
    assert.deepEqual(second.sharedWith, [0])
    assert.deepEqual(
      first.users.map((user) => user.materialName),
      ['A', 'B']
    )
    advisor.dispose()
  })

  it('withholds crops for islands offset into another repeat tile', async () => {
    const advisor = new TextureAdvisor()
    const { gltf, document } = fixture()
    advisor.setModel({ gltf, files: [], document })
    const ready = untilReady(advisor)
    advisor.start()
    const offset = (await ready).textures[2]
    assert.equal(offset.status, 'analyzed')
    if (offset.status !== 'analyzed') return
    assert.equal(offset.offset, true)
    assert.ok(offset.coverage < 0.25)
    assert.equal(offset.crop, null)
    advisor.dispose()
  })

  it('reports only on the model it analyzed', async () => {
    const advisor = new TextureAdvisor()
    const { gltf, document } = fixture()
    advisor.setModel({ gltf, files: [], document })
    assert.equal(await advisor.exportReport(85), null, 'nothing before analysis')
    const ready = untilReady(advisor)
    advisor.start()
    await ready
    const report = await advisor.exportReport(85)
    assert.equal(report?.fileName, 'scene.glb')
    assert.match(report!.text, /Same image is also read as texture #1/)
    // the shared image gets one action entry, not one per texture
    assert.doesNotMatch(report!.text, /### \d+\. `texture_1`/)

    advisor.setModel(null)
    assert.equal(await advisor.exportReport(85), null, 'nothing once replaced')
    advisor.dispose()
  })
})
