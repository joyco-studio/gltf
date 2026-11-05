/**
 * UV-space coverage: which texels of a texture can ever be sampled, derived
 * from the triangles that map onto it. Pure and DOM-free so it runs in the
 * advisory worker and in node tests alike.
 */

const WRAP_CLAMP = 33071
const WRAP_MIRROR = 33648
const WRAP_REPEAT = 10497

/** A triangle covering more tiles than this is treated as covering all of them. */
const MAX_TILES_PER_TRIANGLE = 16
/**
 * Overshoot past a tile edge (in UV units) still treated as inside the tile.
 * Exported islands routinely end at 1.0004 and similar.
 */
const TILE_EPSILON = 1e-3
/** Half a cell, minus a sliver of float tolerance. */
const CONSERVATIVE_OFFSET = 0.5 - 1e-3

/**
 * One primitive's UVs as seen by one texture binding. `transform` is the
 * KHR_texture_transform matrix as `[a, b, c, d, e, f]`:
 * `u' = a·u + b·v + c`, `v' = d·u + e·v + f`.
 */
interface UvLayer {
  uv: Float32Array
  index: Uint32Array | null
  transform: readonly number[] | null
  wrapS: number
  wrapT: number
}

interface CoverageInput {
  width: number
  height: number
  /** Gutter (in mask cells) that mip filtering needs around every island. */
  padding: number
  layers: UvLayer[]
}

/** Normalized UV-space rectangle (0..1, v down, like glTF image space). */
interface UvRect {
  minU: number
  minV: number
  maxU: number
  maxV: number
}

interface CoverageResult {
  /** 1 = sampled (after padding), 0 = never sampled. Row-major, v down. */
  mask: Uint8Array
  width: number
  height: number
  /** Fraction of mask cells that are sampled. */
  coverage: number
  bounds: UvRect | null
  /** Some triangle straddles a tile seam on a repeating axis. */
  tiling: boolean
}

type TriangleVisitor = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) => void

/** KHR_texture_transform → affine matrix (translation · rotation · scale). */
function textureTransformMatrix(transform: {
  offset?: readonly number[]
  rotation?: number
  scale?: readonly number[]
}): number[] {
  const [ox, oy] = transform.offset ?? [0, 0]
  const [sx, sy] = transform.scale ?? [1, 1]
  const rotation = transform.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [cos * sx, sin * sy, ox, -sin * sx, cos * sy, oy]
}

function tileRange(min: number, max: number, wrap: number) {
  if (wrap === WRAP_CLAMP) return [0, 0]
  // A max sitting on (or just past) a tile edge belongs to the tile below it.
  const first = Math.floor(min + TILE_EPSILON)
  return [first, Math.max(first, Math.ceil(max - TILE_EPSILON) - 1)]
}

/** Fold a coordinate in tile `tile` back into 0..1 for the given wrap mode. */
function fold(value: number, tile: number, wrap: number) {
  if (wrap === WRAP_CLAMP) return value
  const local = value - tile
  return wrap === WRAP_MIRROR && Math.abs(tile % 2) === 1 ? 1 - local : local
}

/**
 * Visit every triangle of a layer in mask-cell space, with UVs transformed
 * and wrapped tiles folded back over the texture. Returns whether the layer
 * tiles (some triangle crosses a tile seam) and whether some triangle spans so many tiles
 * that the whole texture must be treated as covered.
 */
function forEachFoldedTriangle(
  layer: UvLayer,
  width: number,
  height: number,
  visit: TriangleVisitor
): { tiling: boolean; saturated: boolean } {
  const { uv, index, transform, wrapS, wrapT } = layer
  const vertexCount = uv.length / 2
  const triangleCount = Math.floor((index ? index.length : vertexCount) / 3)
  const [a, b, c, d, e, f] = transform ?? [1, 0, 0, 0, 1, 0]
  const us = [0, 0, 0]
  const vs = [0, 0, 0]
  let tiling = false
  let saturated = false

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    let minU = Infinity
    let minV = Infinity
    let maxU = -Infinity
    let maxV = -Infinity
    let valid = true
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = index ? index[triangle * 3 + corner] : triangle * 3 + corner
      if (vertex >= vertexCount) {
        valid = false
        break
      }
      const u0 = uv[vertex * 2]
      const v0 = uv[vertex * 2 + 1]
      const u = a * u0 + b * v0 + c
      const v = d * u0 + e * v0 + f
      if (!Number.isFinite(u) || !Number.isFinite(v)) {
        valid = false
        break
      }
      us[corner] = u
      vs[corner] = v
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    if (!valid) continue

    const [tu0, tu1] = tileRange(minU, maxU, wrapS)
    const [tv0, tv1] = tileRange(minV, maxV, wrapT)
    // Islands merely offset into another tile fold back exactly; a triangle
    // straddling a seam means the sampler's wrap is genuinely in use.
    if (tu1 > tu0 || tv1 > tv0) tiling = true
    if ((tu1 - tu0 + 1) * (tv1 - tv0 + 1) > MAX_TILES_PER_TRIANGLE) {
      saturated = true
      continue
    }

    for (let tu = tu0; tu <= tu1; tu += 1) {
      for (let tv = tv0; tv <= tv1; tv += 1) {
        visit(
          fold(us[0], tu, wrapS) * width,
          fold(vs[0], tv, wrapT) * height,
          fold(us[1], tu, wrapS) * width,
          fold(vs[1], tv, wrapT) * height,
          fold(us[2], tu, wrapS) * width,
          fold(vs[2], tv, wrapT) * height
        )
      }
    }
  }

  return { tiling, saturated }
}

/**
 * Conservative rasterization: marks every cell the triangle touches, not
 * just cells whose centers it covers, so thin slivers are never lost.
 */
function rasterizeTriangle(
  mask: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
  if (area === 0) return

  const startX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
  const endX = Math.min(width - 1, Math.floor(Math.max(x0, x1, x2)))
  const startY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
  const endY = Math.min(height - 1, Math.floor(Math.max(y0, y1, y2)))
  if (startX > endX || startY > endY) return

  // Edge functions oriented so the interior is positive. Each is widened by
  // (just under) half a cell along its normal — the conservative offset —
  // so cells merely touching an edge on a texel boundary stay out.
  const sign = area > 0 ? 1 : -1
  const edges = [
    [x0, y0, x1, y1],
    [x1, y1, x2, y2],
    [x2, y2, x0, y0],
  ].map(([ax, ay, bx, by]) => {
    const dx = (ay - by) * sign
    const dy = (bx - ax) * sign
    const offset =
      -(dx * ax + dy * ay) + CONSERVATIVE_OFFSET * (Math.abs(dx) + Math.abs(dy))
    return [dx, dy, offset]
  })
  const [[ax, ay, ac], [bx, by, bc], [cx, cy, cc]] = edges

  for (let y = startY; y <= endY; y += 1) {
    const py = y + 0.5
    const row = y * width
    for (let x = startX; x <= endX; x += 1) {
      const px = x + 0.5
      if (
        ax * px + ay * py + ac >= 0 &&
        bx * px + by * py + bc >= 0 &&
        cx * px + cy * py + cc >= 0
      ) {
        mask[row + x] = 1
      }
    }
  }
}

/** Square (Chebyshev) dilation via two separable sliding-window passes. */
function dilate(mask: Uint8Array, width: number, height: number, radius: number) {
  if (radius <= 0) return mask
  const horizontal = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    let count = 0
    for (let x = 0; x < Math.min(radius, width); x += 1) count += mask[row + x]
    for (let x = 0; x < width; x += 1) {
      const enter = x + radius
      const leave = x - radius - 1
      if (enter < width) count += mask[row + enter]
      if (leave >= 0) count -= mask[row + leave]
      horizontal[row + x] = count > 0 ? 1 : 0
    }
  }
  const result = new Uint8Array(mask.length)
  for (let x = 0; x < width; x += 1) {
    let count = 0
    for (let y = 0; y < Math.min(radius, height); y += 1) {
      count += horizontal[y * width + x]
    }
    for (let y = 0; y < height; y += 1) {
      const enter = y + radius
      const leave = y - radius - 1
      if (enter < height) count += horizontal[enter * width + x]
      if (leave >= 0) count -= horizontal[leave * width + x]
      result[y * width + x] = count > 0 ? 1 : 0
    }
  }
  return result
}

function computeCoverage({
  width,
  height,
  padding,
  layers,
}: CoverageInput): CoverageResult {
  let mask: Uint8Array = new Uint8Array(width * height)
  let tiling = false
  let saturated = false

  for (const layer of layers) {
    const result = forEachFoldedTriangle(layer, width, height, (...corners) =>
      rasterizeTriangle(mask, width, height, ...corners)
    )
    tiling ||= result.tiling
    saturated ||= result.saturated
  }

  if (saturated) mask.fill(1)
  else mask = dilate(mask, width, height, padding)

  let used = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue
      used += 1
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  return {
    mask,
    width,
    height,
    coverage: mask.length ? used / mask.length : 0,
    bounds:
      used > 0
        ? {
            minU: minX / width,
            minV: minY / height,
            maxU: (maxX + 1) / width,
            maxV: (maxY + 1) / height,
          }
        : null,
    tiling,
  }
}

export {
  WRAP_CLAMP,
  WRAP_MIRROR,
  WRAP_REPEAT,
  computeCoverage,
  dilate,
  forEachFoldedTriangle,
  textureTransformMatrix,
}
export type { CoverageInput, CoverageResult, UvLayer, UvRect }
