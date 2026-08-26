import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

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
