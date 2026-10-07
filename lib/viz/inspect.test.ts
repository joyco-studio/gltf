import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { CompressedTexture } from 'three/webgpu'

import { inspectGltf } from './inspect'

describe('inspectGltf node types', () => {
  it('classifies each scene-node role', async () => {
    const gltf = {
      parser: {
        json: {
          accessors: [{ componentType: 5126, count: 4, type: 'VEC3' }],
          meshes: [{ name: 'Geometry', primitives: [] }],
          nodes: [
            { name: 'Mesh', mesh: 0 },
            { name: 'Skinned', mesh: 0, skin: 0 },
            {
              name: 'Instanced',
              mesh: 0,
              extensions: {
                EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 0 } },
              },
            },
            { name: 'Camera', camera: 0 },
            {
              name: 'Light',
              extensions: { KHR_lights_punctual: { light: 0 } },
            },
            { name: 'Joint' },
            { name: 'Group', children: [7] },
            { name: 'Empty' },
          ],
          skins: [{ joints: [5] }],
          scenes: [{ nodes: [0, 1, 2, 3, 4, 5, 6] }],
        },
      },
    } as unknown as GLTF

    const document = await inspectGltf(gltf, 'types.gltf')

    assert.deepEqual(
      document.nodes.map(({ objectType }) => objectType),
      [
        'mesh',
        'skinned-mesh',
        'instanced-mesh',
        'camera',
        'light',
        'joint',
        'group',
        'empty',
      ]
    )
  })
})

describe('texture previews', () => {
  function compressedGltf(count = 1) {
    const textures = Array.from({ length: count }, (_, id) => {
      const texture = new CompressedTexture([], 2048, 1024)
      texture.name = String(id)
      return texture
    })
    const gltf = {
      parser: {
        json: {
          textures: textures.map(() => ({
            extensions: { KHR_texture_basisu: { source: 0 } },
          })),
          images: [{ name: 'Compressed', mimeType: 'image/ktx2', bufferView: 0 }],
          bufferViews: [{ byteLength: 128 }],
        },
        getDependency: async (_type: string, id: number) => textures[id],
      },
    } as unknown as GLTF
    return { texture: textures[0], gltf }
  }

  it('uses the decoded KTX2 texture for a bounded GPU thumbnail', async () => {
    const { texture, gltf } = compressedGltf()
    const document = await inspectGltf(gltf, 'compressed.glb', async (source, maxSize) => {
      assert.equal(source, texture)
      assert.equal(maxSize, 256)
      return 'data:image/png;base64,preview'
    })

    assert.equal(document.textures[0].previewUrl, 'data:image/png;base64,preview')
    assert.equal(document.textures[0].mimeType, 'image/ktx2')
    assert.equal(document.textures[0].width, 2048)
    assert.equal(document.textures[0].height, 1024)
    assert.equal(document.textures[0].bufferView, 0)
  })

  it('keeps texture metadata when GPU preview generation fails', async () => {
    const { gltf } = compressedGltf()
    const document = await inspectGltf(gltf, 'compressed.glb', async () => {
      throw new Error('Readback failed')
    })

    assert.equal(document.textures[0].previewUrl, null)
    assert.equal(document.textures[0].width, 2048)
    assert.equal(document.textures[0].name, 'Compressed')
    assert.equal(document.textures[0].size, 128)
  })

  for (const failure of ['sync', 'async']) {
    it(`limits GPU previews to two and continues after a ${failure} failure`, async () => {
      const { gltf } = compressedGltf(12)
      const started: string[] = []
      let active = 0
      let peak = 0

      const document = await inspectGltf(gltf, 'many-textures.glb', (source) => {
        started.push(source.name)
        if (source.name === '1' && failure === 'sync') {
          throw new Error('Render failed')
        }
        active++
        peak = Math.max(peak, active)
        return new Promise<string>((resolve, reject) => {
          setImmediate(() => {
            active--
            if (source.name === '1') reject(new Error('Readback failed'))
            else resolve(`preview-${source.name}`)
          })
        })
      })

      assert.equal(peak, 2)
      assert.equal(active, 0)
      assert.equal(new Set(started).size, 12)
      assert.deepEqual(
        document.textures.map(({ id, previewUrl }) => ({ id, previewUrl })),
        Array.from({ length: 12 }, (_, id) => ({
          id,
          previewUrl: id === 1 ? null : `preview-${id}`,
        }))
      )
    })
  }
})
