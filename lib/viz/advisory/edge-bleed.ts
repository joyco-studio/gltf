/**
 * Fill never-sampled texels by bleeding the surrounding island colors
 * outward (push-pull, as texture bakers do), instead of painting them a
 * solid color. Mip levels average blocks of texels, so a flat black fill
 * would darken island edges at a distance; bleeding keeps every level's
 * averages close to the islands' own colors, and the smooth result still
 * compresses far better than leftover detail.
 */

interface Level {
  width: number
  height: number
  rgba: Uint8ClampedArray
  /** 1 where the texel holds real (or already filled) color. */
  known: Uint8Array
}

/** Pull: average each 2×2 block's known texels into the next, coarser level. */
function downsample(level: Level): Level {
  const width = Math.max(1, Math.ceil(level.width / 2))
  const height = Math.max(1, Math.ceil(level.height / 2))
  const rgba = new Uint8ClampedArray(width * height * 4)
  const known = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0
      for (let dy = 0; dy < 2; dy += 1) {
        const sy = y * 2 + dy
        if (sy >= level.height) continue
        for (let dx = 0; dx < 2; dx += 1) {
          const sx = x * 2 + dx
          if (sx >= level.width) continue
          const source = sy * level.width + sx
          if (!level.known[source]) continue
          r += level.rgba[source * 4]
          g += level.rgba[source * 4 + 1]
          b += level.rgba[source * 4 + 2]
          a += level.rgba[source * 4 + 3]
          count += 1
        }
      }
      if (count === 0) continue
      const target = y * width + x
      rgba[target * 4] = r / count
      rgba[target * 4 + 1] = g / count
      rgba[target * 4 + 2] = b / count
      rgba[target * 4 + 3] = a / count
      known[target] = 1
    }
  }
  return { width, height, rgba, known }
}

/** Push: give every unknown texel its (already filled) parent's color. */
function fillFromParent(level: Level, parent: Level) {
  for (let y = 0; y < level.height; y += 1) {
    for (let x = 0; x < level.width; x += 1) {
      const target = y * level.width + x
      if (level.known[target]) continue
      const source = (y >> 1) * parent.width + (x >> 1)
      if (!parent.known[source]) continue
      level.rgba.set(parent.rgba.subarray(source * 4, source * 4 + 4), target * 4)
      level.known[target] = 1
    }
  }
}

/**
 * Bleeds colors into every texel the mask marks unused (0), in place.
 * `mask` may be lower resolution than the image; it is scaled nearest.
 */
function bleedUnusedTexels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number
) {
  const known = new Uint8Array(width * height)
  let any = false
  for (let y = 0; y < height; y += 1) {
    const maskRow = Math.min(maskHeight - 1, Math.floor((y * maskHeight) / height)) * maskWidth
    for (let x = 0; x < width; x += 1) {
      const used = mask[maskRow + Math.min(maskWidth - 1, Math.floor((x * maskWidth) / width))]
      known[y * width + x] = used
      any ||= used === 1
    }
  }
  if (!any) return pixels

  const levels: Level[] = [{ width, height, rgba: pixels, known }]
  while (levels.at(-1)!.width > 1 || levels.at(-1)!.height > 1) {
    levels.push(downsample(levels.at(-1)!))
  }
  for (let index = levels.length - 2; index >= 0; index -= 1) {
    fillFromParent(levels[index], levels[index + 1])
  }
  return pixels
}

export { bleedUnusedTexels }
