import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  WRAP_CLAMP,
  WRAP_MIRROR,
  WRAP_REPEAT,
  computeCoverage,
  dilate,
  textureTransformMatrix,
  type UvLayer,
} from './uv-coverage'

/** Two triangles covering the UV rect [u0,v0]–[u1,v1]. */
function quad(u0: number, v0: number, u1: number, v1: number, extra: Partial<UvLayer> = {}): UvLayer {
  return {
    uv: new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]),
    index: new Uint32Array([0, 1, 2, 0, 2, 3]),
    transform: null,
    wrapS: WRAP_REPEAT,
    wrapT: WRAP_REPEAT,
    ...extra,
  }
}

describe('computeCoverage', () => {
  it('measures the share of texels a UV island covers', () => {
    const result = computeCoverage({
      width: 100,
      height: 100,
      padding: 0,
      layers: [quad(0, 0, 0.5, 0.5)],
    })
    assert.equal(result.coverage, 0.25)
    assert.deepEqual(result.bounds, { minU: 0, minV: 0, maxU: 0.5, maxV: 0.5 })
    assert.equal(result.tiling, false)
  })

  it('unions every layer and pads islands for mip filtering', () => {
    const result = computeCoverage({
      width: 100,
      height: 100,
      padding: 2,
      layers: [quad(0.1, 0.1, 0.2, 0.2), quad(0.6, 0.6, 0.7, 0.7)],
    })
    // each 10×10 island grows to 14×14
    assert.equal(result.coverage, (2 * 14 * 14) / 10000)
    assert.deepEqual(result.bounds, { minU: 0.08, minV: 0.08, maxU: 0.72, maxV: 0.72 })
  })

  it('keeps slivers thinner than a texel (conservative rasterization)', () => {
    const result = computeCoverage({
      width: 64,
      height: 64,
      padding: 0,
      layers: [
        {
          uv: new Float32Array([0.1, 0.5, 0.9, 0.5, 0.9, 0.5005]),
          index: null,
          transform: null,
          wrapS: WRAP_CLAMP,
          wrapT: WRAP_CLAMP,
        },
      ],
    })
    assert.ok(result.coverage > 0)
  })

  it('folds islands offset into another tile without calling it tiling', () => {
    const result = computeCoverage({
      width: 100,
      height: 100,
      padding: 0,
      // overshoots the tile's far edge by a hair, as exporters often do
      layers: [quad(1.0, 1.0, 1.5, 2.0005)],
    })
    assert.equal(result.tiling, false)
    assert.equal(result.coverage, 0.5)
    assert.deepEqual(result.bounds, { minU: 0, minV: 0, maxU: 0.5, maxV: 1 })
  })

  it('flags tiling when a triangle straddles a tile seam', () => {
    const result = computeCoverage({
      width: 100,
      height: 100,
      padding: 0,
      layers: [quad(0.75, 0, 1.25, 0.5)],
    })
    assert.equal(result.tiling, true)
    // the straddling quad wraps to both edges of the texture
    assert.deepEqual(result.bounds, { minU: 0, minV: 0, maxU: 1, maxV: 0.5 })
    assert.equal(result.coverage, 0.25)
  })

  it('mirrors odd tiles under MIRRORED_REPEAT', () => {
    const result = computeCoverage({
      width: 100,
      height: 100,
      padding: 0,
      layers: [quad(1.0, 0, 1.25, 1, { wrapS: WRAP_MIRROR })],
    })
    assert.deepEqual(result.bounds, { minU: 0.75, minV: 0, maxU: 1, maxV: 1 })
  })

  it('treats a triangle spanning many tiles as covering the whole texture', () => {
    const result = computeCoverage({
      width: 32,
      height: 32,
      padding: 0,
      layers: [quad(0, 0, 10, 10)],
    })
    assert.equal(result.coverage, 1)
    assert.equal(result.tiling, true)
  })

  it('clips clamped UVs instead of folding them', () => {
    const result = computeCoverage({
      width: 100,
      height: 100,
      padding: 0,
      layers: [quad(0.5, 0, 1.5, 1, { wrapS: WRAP_CLAMP, wrapT: WRAP_CLAMP })],
    })
    assert.equal(result.tiling, false)
    assert.equal(result.coverage, 0.5)
  })

  it('applies KHR_texture_transform before rasterizing', () => {
    const transform = textureTransformMatrix({ offset: [0.5, 0.5], scale: [0.5, 0.5] })
    const result = computeCoverage({
      width: 100,
      height: 100,
      padding: 0,
      layers: [quad(0, 0, 1, 1, { transform })],
    })
    assert.deepEqual(result.bounds, { minU: 0.5, minV: 0.5, maxU: 1, maxV: 1 })
  })

  it('reports no bounds when nothing is sampled', () => {
    const result = computeCoverage({ width: 8, height: 8, padding: 1, layers: [] })
    assert.equal(result.coverage, 0)
    assert.equal(result.bounds, null)
  })
})

describe('textureTransformMatrix', () => {
  it('rotates per the KHR_texture_transform spec', () => {
    const [a, b, , d, e] = textureTransformMatrix({ rotation: Math.PI / 2 })
    // u' = v, v' = -u
    assert.ok(Math.abs(a) < 1e-9 && Math.abs(b - 1) < 1e-9)
    assert.ok(Math.abs(d + 1) < 1e-9 && Math.abs(e) < 1e-9)
  })
})

describe('dilate', () => {
  it('grows a single cell into a square of the radius', () => {
    const mask = new Uint8Array(25)
    mask[12] = 1
    const grown = dilate(mask, 5, 5, 1)
    assert.equal(grown.reduce((total, value) => total + value, 0), 9)
    assert.equal(grown[0], 0)
    assert.equal(grown[6], 1)
  })
})
