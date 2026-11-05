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
/** Float tolerance, in mask cells, for edges landing on cell boundaries. */
const CELL_EPSILON = 1e-3
/** Half a cell, minus a sliver of float tolerance. */
const CONSERVATIVE_OFFSET = 0.5 - CELL_EPSILON
/**
 * UVs beyond this magnitude carry no usable precision (and would stall tile
 * loops), so a triangle reaching them is treated as covering everything.
 */
const MAX_UV = 1e4
/** Upper bound on samples taken along a zero-area (segment) triangle. */
const MAX_SEGMENT_SAMPLES = 1e5

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
  /**
   * Some island lives in a repeat tile other than 0–1. It folds back onto the
   * texture exactly, but a crop remap would have to undo that offset.
   */
  offset: boolean
}

interface FoldStats {
  tiling: boolean
  saturated: boolean
  offset: boolean
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
 * and wrapped tiles folded back over the texture. Reports whether some
 * triangle crosses a tile seam (tiling), sits wholly in another tile
 * (offset), or spans so many tiles — or such extreme UVs — that the whole
 * texture must be treated as covered (saturated).
 */
function forEachFoldedTriangle(
  layer: UvLayer,
  width: number,
  height: number,
  visit: TriangleVisitor
): FoldStats {
  const { uv, index, transform, wrapS, wrapT } = layer
  const vertexCount = uv.length / 2
  const triangleCount = Math.floor((index ? index.length : vertexCount) / 3)
  const [a, b, c, d, e, f] = transform ?? [1, 0, 0, 0, 1, 0]
  const us = [0, 0, 0]
  const vs = [0, 0, 0]
  let tiling = false
  let saturated = false
  let offset = false

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
    if (Math.max(-minU, maxU, -minV, maxV) > MAX_UV) {
      saturated = true
      continue
    }

    const [tu0, tu1] = tileRange(minU, maxU, wrapS)
    const [tv0, tv1] = tileRange(minV, maxV, wrapT)
    // Islands merely offset into another tile fold back exactly; a triangle
    // straddling a seam means the sampler's wrap is genuinely in use.
    if (tu1 > tu0 || tv1 > tv0) tiling = true
    else if (tu0 !== 0 || tv0 !== 0) offset = true
    const tilesU = tu1 - tu0 + 1
    const tilesV = tv1 - tv0 + 1
    if (tilesU * tilesV > MAX_TILES_PER_TRIANGLE) {
      saturated = true
      continue
    }

    // Small relative counters: always terminate, whatever the tile index.
    for (let i = 0; i < tilesU; i += 1) {
      const tu = tu0 + i
      for (let j = 0; j < tilesV; j += 1) {
        const tv = tv0 + j
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

  return { tiling, saturated, offset }
}

type Point = readonly [number, number]

/** Sutherland–Hodgman clip of a convex polygon to one side of an axis line. */
function clipPolygon(polygon: Point[], axis: 0 | 1, at: number, keepBelow: boolean) {
  const inside = (point: Point) => (keepBelow ? point[axis] <= at : point[axis] >= at)
  const result: Point[] = []
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const previous = polygon[(index + polygon.length - 1) % polygon.length]
    if (inside(current) !== inside(previous)) {
      const t = (at - previous[axis]) / (current[axis] - previous[axis])
      result.push([
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
      ])
    }
    if (inside(current)) result.push(current)
  }
  return result
}

function clampCell(value: number, size: number) {
  return Math.min(size - 1, Math.max(0, Math.floor(value)))
}

/**
 * CLAMP_TO_EDGE samples the outermost texel row/column for every UV past the
 * edge. Mark, on each clamped side, the edge cells that the triangle's
 * outside part projects onto (corners fall out of the clamped ranges).
 */
function markClampedEdges(
  mask: Uint8Array,
  width: number,
  height: number,
  clampX: boolean,
  clampY: boolean,
  triangle: Point[]
) {
  const sides: [axis: 0 | 1, at: number, keepBelow: boolean][] = []
  if (clampX) sides.push([0, 0, true], [0, width, false])
  if (clampY) sides.push([1, 0, true], [1, height, false])

  for (const [axis, at, keepBelow] of sides) {
    const outside = clipPolygon(triangle, axis, at, keepBelow)
    if (outside.length === 0) continue
    const other = axis === 0 ? 1 : 0
    const along = outside.map((point) => point[other])
    const size = other === 0 ? width : height
    // a span ending exactly on a cell boundary doesn't reach the next cell
    const from = clampCell(Math.min(...along) + CELL_EPSILON, size)
    const to = clampCell(Math.max(...along) - CELL_EPSILON, size)
    const edge = keepBelow ? 0 : (axis === 0 ? width : height) - 1
    for (let cell = from; cell <= to; cell += 1) {
      mask[axis === 0 ? cell * width + edge : edge * width + cell] = 1
    }
  }
}

/**
 * A zero-area triangle still samples the texture along a segment (or at a
 * point) — a face whose UVs coincide shows that one color. Sample it densely
 * enough to touch every cell it crosses, clamping onto the grid.
 */
function markSegment(mask: Uint8Array, width: number, height: number, triangle: Point[]) {
  let [start, end] = [triangle[0], triangle[1]]
  let longest = -1
  for (let i = 0; i < 3; i += 1) {
    for (let j = i + 1; j < 3; j += 1) {
      const length = Math.hypot(
        triangle[j][0] - triangle[i][0],
        triangle[j][1] - triangle[i][1]
      )
      if (length > longest) {
        longest = length
        start = triangle[i]
        end = triangle[j]
      }
    }
  }
  const samples = Math.min(MAX_SEGMENT_SAMPLES, Math.ceil(longest * 2) + 1)
  for (let sample = 0; sample < samples; sample += 1) {
    const t = samples === 1 ? 0 : sample / (samples - 1)
    const x = clampCell(start[0] + (end[0] - start[0]) * t, width)
    const y = clampCell(start[1] + (end[1] - start[1]) * t, height)
    mask[y * width + x] = 1
  }
}

/**
 * Mark every cell a triangle (in cell space) can make the sampler read:
 * its conservative interior, its clamped-edge projections, and — when it has
 * no area — the segment or point it collapses to.
 */
function rasterize(
  mask: Uint8Array,
  width: number,
  height: number,
  clampX: boolean,
  clampY: boolean,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const triangle: Point[] = [
    [x0, y0],
    [x1, y1],
    [x2, y2],
  ]
  if ((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0) === 0) {
    markSegment(mask, width, height, triangle)
    return
  }
  rasterizeTriangle(mask, width, height, x0, y0, x1, y1, x2, y2)
  if (clampX || clampY) {
    markClampedEdges(mask, width, height, clampX, clampY, triangle)
  }
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

/**
 * One separable pass of a sliding-window max. On a wrapping axis the window
 * continues past the edge onto the opposite side, the way a REPEAT sampler's
 * filter footprint does.
 */
function dilateAxis(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
  wrap: boolean
) {
  const result = new Uint8Array(source.length)
  const lines = horizontal ? height : width
  const length = horizontal ? width : height
  // A window wider than the line already covers all of it.
  const reach = Math.min(radius, length)
  for (let line = 0; line < lines; line += 1) {
    const at = (index: number) => {
      if (index < 0 || index >= length) {
        if (!wrap) return 0
        index = ((index % length) + length) % length
      }
      return source[horizontal ? line * width + index : index * width + line]
    }
    let count = 0
    for (let index = -reach; index <= reach; index += 1) count += at(index)
    for (let index = 0; index < length; index += 1) {
      result[horizontal ? line * width + index : index * width + line] = count > 0 ? 1 : 0
      count += at(index + reach + 1) - at(index - reach)
    }
  }
  return result
}

/**
 * Square (Chebyshev) dilation via two separable sliding-window passes,
 * wrapping around the axes whose samplers repeat.
 */
function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  { wrapX = false, wrapY = false }: { wrapX?: boolean; wrapY?: boolean } = {}
) {
  if (radius <= 0) return mask
  const horizontal = dilateAxis(mask, width, height, radius, true, wrapX)
  return dilateAxis(horizontal, width, height, radius, false, wrapY)
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
  let offset = false

  for (const layer of layers) {
    const clampX = layer.wrapS === WRAP_CLAMP
    const clampY = layer.wrapT === WRAP_CLAMP
    const result = forEachFoldedTriangle(layer, width, height, (...corners) =>
      rasterize(mask, width, height, clampX, clampY, ...corners)
    )
    tiling ||= result.tiling
    saturated ||= result.saturated
    offset ||= result.offset
  }

  if (saturated) mask.fill(1)
  else {
    // Filtering near an edge of a REPEAT texture reads the opposite edge.
    // (Mirrored edges reflect onto texels the gutter already covers.)
    mask = dilate(mask, width, height, padding, {
      wrapX: layers.some((layer) => layer.wrapS === WRAP_REPEAT),
      wrapY: layers.some((layer) => layer.wrapT === WRAP_REPEAT),
    })
  }

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
    offset,
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
