import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { bleedUnusedTexels } from './edge-bleed'

function pixel(pixels: Uint8ClampedArray, width: number, x: number, y: number) {
  return [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
}

describe('bleedUnusedTexels', () => {
  it('fills unused texels with nearby island colors, never black', () => {
    const width = 8
    const height = 8
    const pixels = new Uint8ClampedArray(width * height * 4)
    const mask = new Uint8Array(width * height)
    // a red island in the top-left 2×2; everything else is leftover noise
    for (let index = 0; index < width * height; index += 1) {
      pixels.set([index * 7, 255 - index, index * 3, 255], index * 4)
    }
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      mask[y * width + x] = 1
      pixels.set([200, 10, 10, 255], (y * width + x) * 4)
    }

    bleedUnusedTexels(pixels, width, height, mask, width, height)

    // islands keep their texels; every filled texel takes the island color
    assert.deepEqual(pixel(pixels, width, 0, 0), [200, 10, 10, 255])
    assert.deepEqual(pixel(pixels, width, 7, 7), [200, 10, 10, 255])
    assert.deepEqual(pixel(pixels, width, 3, 0), [200, 10, 10, 255])
  })

  it('scales a lower-resolution mask onto the image', () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(0)
    // left half used (green), right half unused (noise)
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        pixels.set(x < 2 ? [0, 255, 0, 255] : [9, 9, 9, 255], (y * 4 + x) * 4)
      }
    }
    bleedUnusedTexels(pixels, 4, 4, new Uint8Array([1, 0]), 2, 1)
    assert.deepEqual(pixel(pixels, 4, 3, 2), [0, 255, 0, 255])
  })

  it('leaves the image alone when nothing is used', () => {
    const pixels = new Uint8ClampedArray([1, 2, 3, 4])
    bleedUnusedTexels(pixels, 1, 1, new Uint8Array([0]), 1, 1)
    assert.deepEqual([...pixels], [1, 2, 3, 4])
  })
})
