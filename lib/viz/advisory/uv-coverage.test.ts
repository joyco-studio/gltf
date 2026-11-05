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

  it('marks the edge texels clamped UVs outside the image sample', () => {
    // entirely past the right edge: every sample reads the last column
    const result = computeCoverage({
      width: 100,
      height: 100,
      padding: 0,
      layers: [quad(2, 0.2, 2.5, 0.4, { wrapS: WRAP_CLAMP, wrapT: WRAP_CLAMP })],
    })
    assert.equal(result.coverage, 20 / 10000)
    assert.deepEqual(result.bounds, { minU: 0.99, minV: 0.2, maxU: 1, maxV: 0.4 })
  })

  it('projects a clamped triangle that widens past the edge onto the whole edge span', () => {
    const result = computeCoverage({
      width: 100,
      height: 100,
      padding: 0,
      layers: [
        {
          uv: new Float32Array([0.9, 0.5, 2, 0, 2, 1]),
          index: null,
          transform: null,
          wrapS: WRAP_CLAMP,
          wrapT: WRAP_CLAMP,
        },
      ],
    })
    // the outside part spans v 0..1, so the entire last column is sampled
    for (let y = 0; y < 100; y += 1) assert.equal(result.mask[y * 100 + 99], 1)
  })

  it('keeps faces whose UVs collapse to a point or a line', () => {
    const point = computeCoverage({
      width: 10,
      height: 10,
      padding: 0,
      layers: [
        {
          uv: new Float32Array([0.55, 0.55, 0.55, 0.55, 0.55, 0.55]),
          index: null,
          transform: null,
          wrapS: WRAP_REPEAT,
          wrapT: WRAP_REPEAT,
        },
      ],
    })
    assert.equal(point.coverage, 1 / 100)
    assert.equal(point.mask[5 * 10 + 5], 1)

    const line = computeCoverage({
      width: 10,
      height: 10,
      padding: 0,
      layers: [
        {
          uv: new Float32Array([0.05, 0.55, 0.95, 0.55, 0.5, 0.55]),
          index: null,
          transform: null,
          wrapS: WRAP_REPEAT,
          wrapT: WRAP_REPEAT,
        },
      ],
    })
    assert.equal(line.coverage, 10 / 100)
  })

  it('terminates on extreme UVs and treats them as covering everything', () => {
    const result = computeCoverage({
      width: 16,
      height: 16,
      padding: 0,
      layers: [quad(1e20, 0, 1e20 + 1e5, 0.5)],
    })
    assert.equal(result.coverage, 1)
  })

  it('reports islands offset into another repeat tile', () => {
    const offset = computeCoverage({
      width: 10,
      height: 10,
      padding: 0,
      layers: [quad(0.1, 1.1, 0.4, 1.4)],
    })
    assert.equal(offset.offset, true)
    assert.equal(offset.tiling, false)
    const home = computeCoverage({
      width: 10,
      height: 10,
      padding: 0,
      layers: [quad(0.1, 0.1, 0.4, 0.4)],
    })
    assert.equal(home.offset, false)
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

describe('repeat-edge sampling', () => {
  it('carries the filter gutter across edges of a repeating texture', () => {
    const repeat = computeCoverage({
      width: 100,
      height: 100,
      padding: 2,
      layers: [quad(0.5, 0.4, 1, 0.6)],
    })
    // the island ends at U=1, so filtering also reads the first columns
    assert.equal(repeat.mask[50 * 100 + 0], 1)
    assert.equal(repeat.mask[50 * 100 + 1], 1)
    assert.equal(repeat.mask[50 * 100 + 2], 0)
    assert.equal(repeat.bounds?.minU, 0)

    const clamped = computeCoverage({
      width: 100,
      height: 100,
      padding: 2,
      layers: [quad(0.5, 0.4, 1, 0.6, { wrapS: WRAP_CLAMP, wrapT: WRAP_CLAMP })],
    })
    assert.equal(clamped.mask[50 * 100 + 0], 0)
  })
})

describe('dilate', () => {
  it('wraps around an axis when asked', () => {
    const mask = new Uint8Array(5)
    mask[4] = 1
    assert.deepEqual([...dilate(mask, 5, 1, 1, { wrapX: true })], [1, 0, 0, 1, 1])
    assert.deepEqual([...dilate(mask, 5, 1, 1)], [0, 0, 0, 1, 1])
  })

  it('grows a single cell into a square of the radius', () => {
    const mask = new Uint8Array(25)
    mask[12] = 1
    const grown = dilate(mask, 5, 5, 1)
    assert.equal(grown.reduce((total, value) => total + value, 0), 9)
    assert.equal(grown[0], 0)
    assert.equal(grown[6], 1)
  })
})
