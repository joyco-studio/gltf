import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveTextureBindings } from './texture-bindings'
import { WRAP_CLAMP, WRAP_REPEAT } from './uv-coverage'

describe('resolveTextureBindings', () => {
  const json = {
    meshes: [
      { name: 'Body', primitives: [{ material: 0 }, { material: 1, mode: 1 }] },
      { name: 'Head', primitives: [{ material: 0 }] },
    ],
    materials: [
      {
        name: 'Skin',
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        occlusionTexture: {
          index: 1,
          texCoord: 1,
          extensions: {
            KHR_texture_transform: { offset: [0.5, 0], texCoord: 0 },
          },
        },
      },
      { name: 'Lines', emissiveTexture: { index: 2 } },
    ],
    textures: [{ sampler: 0 }, {}, {}, {}],
    samplers: [{ wrapS: WRAP_CLAMP, wrapT: WRAP_CLAMP }],
  }
  const [base, occlusion, linesOnly, orphan] = resolveTextureBindings(json)

  it('lists every primitive drawing a bound material', () => {
    assert.equal(base.referenced, true)
    assert.deepEqual(
      base.layers.map(({ meshId, primitiveIndex }) => [meshId, primitiveIndex]),
      [[0, 0], [1, 0]]
    )
    assert.deepEqual(
      base.users.map(({ meshName, materialName, slot }) => `${meshName}/${materialName}/${slot}`),
      ['Body/Skin/baseColorTexture', 'Head/Skin/baseColorTexture']
    )
    assert.equal(base.wrapS, WRAP_CLAMP)
  })

  it('lets KHR_texture_transform override the UV set and carries its matrix', () => {
    assert.deepEqual(occlusion.texCoords, [0])
    assert.deepEqual(occlusion.layers[0].transform, [1, -0, 0.5, 0, 1, 0])
    assert.equal(occlusion.wrapS, WRAP_REPEAT)
  })

  it('keeps line primitives, tagged with how they sample', () => {
    assert.equal(linesOnly.referenced, true)
    assert.deepEqual(
      linesOnly.layers.map(({ topology }) => topology),
      ['lines']
    )
    assert.equal(base.layers[0].topology, 'triangles')
  })

  it('resolves the image through source-moving extensions', () => {
    const [plain, basisu] = resolveTextureBindings({
      textures: [{ source: 2 }, { source: 0, extensions: { KHR_texture_basisu: { source: 5 } } }],
    })
    assert.equal(plain.imageIndex, 2)
    assert.equal(basisu.imageIndex, 5)
  })

  it('counts materials a primitive only uses through KHR_materials_variants', () => {
    const [variantOnly] = resolveTextureBindings({
      meshes: [
        {
          name: 'Shoe',
          primitives: [
            {
              material: 1,
              extensions: { KHR_materials_variants: { mappings: [{ material: 0 }] } },
            },
          ],
        },
      ],
      materials: [
        { name: 'Red', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
        { name: 'Default' },
      ],
      textures: [{ source: 0 }],
    })
    assert.equal(variantOnly.layers.length, 1)
    assert.deepEqual(
      variantOnly.users.map(({ materialName, meshName }) => `${meshName}/${materialName}`),
      ['Shoe/Red']
    )
  })

  it('marks textures no material binds', () => {
    assert.equal(orphan.referenced, false)
    assert.equal(orphan.users.length, 0)
  })
})
