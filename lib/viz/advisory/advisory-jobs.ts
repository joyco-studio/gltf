import {
  computeCoverage,
  forEachFoldedTriangle,
  type CoverageInput,
  type CoverageResult,
} from './uv-coverage'

/**
 * The heavy advisory work — rasterizing UV coverage, drawing overlays and
 * re-encoding images — as plain async functions. The worker calls these;
 * environments without OffscreenCanvas get coverage only.
 */

interface TexelRect {
  x: number
  y: number
  width: number
  height: number
}

interface CoverageJobResult extends CoverageResult {
  /** Alpha mask PNG: opaque where texels are never sampled. */
  unusedOverlay: Blob | null
  /** Alpha mask PNG of the UV wireframe. */
  wireOverlay: Blob | null
}

interface DownloadJobInput {
  blob: Blob
  mimeType: string
  mask: Uint8Array
  maskWidth: number
  maskHeight: number
  crop: TexelRect | null
}

/** Re-encoded byte sizes, all from the same encoder so ratios are comparable. */
interface DownloadJobResult {
  full: number
  cleared: number
  croppedCleared: number | null
}

const ENCODE_QUALITY = 0.9
/** Encoders the browser can produce for a like-for-like re-encode. */
const REENCODABLE = new Set(['image/png', 'image/jpeg', 'image/webp'])

function hasOffscreenCanvas() {
  return typeof OffscreenCanvas !== 'undefined'
}

function maskToImageData(
  mask: Uint8Array,
  width: number,
  height: number,
  opaqueWhenUsed: boolean
) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < mask.length; index += 1) {
    const opaque = opaqueWhenUsed ? mask[index] === 1 : mask[index] === 0
    pixels[index * 4 + 3] = opaque ? 255 : 0
  }
  return new ImageData(pixels, width, height)
}

async function drawUnusedOverlay(result: CoverageResult) {
  const canvas = new OffscreenCanvas(result.width, result.height)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.putImageData(
    maskToImageData(result.mask, result.width, result.height, false),
    0,
    0
  )
  return canvas.convertToBlob({ type: 'image/png' })
}

async function drawWireOverlay(input: CoverageInput) {
  const canvas = new OffscreenCanvas(input.width, input.height)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.strokeStyle = '#fff'
  context.lineWidth = 1
  context.beginPath()
  for (const layer of input.layers) {
    forEachFoldedTriangle(layer, input.width, input.height, (x0, y0, x1, y1, x2, y2) => {
      context.moveTo(x0, y0)
      context.lineTo(x1, y1)
      context.lineTo(x2, y2)
      context.closePath()
    })
  }
  context.stroke()
  return canvas.convertToBlob({ type: 'image/png' })
}

async function runCoverageJob(input: CoverageInput): Promise<CoverageJobResult> {
  const result = computeCoverage(input)
  if (!hasOffscreenCanvas()) {
    return { ...result, unusedOverlay: null, wireOverlay: null }
  }
  const [unusedOverlay, wireOverlay] = await Promise.all([
    drawUnusedOverlay(result).catch(() => null),
    drawWireOverlay(input).catch(() => null),
  ])
  return { ...result, unusedOverlay, wireOverlay }
}

function canReencode(mimeType: string) {
  return (
    hasOffscreenCanvas() &&
    typeof createImageBitmap !== 'undefined' &&
    REENCODABLE.has(mimeType)
  )
}

async function encodedSize(canvas: OffscreenCanvas, mimeType: string) {
  const blob = await canvas.convertToBlob({
    type: mimeType,
    quality: ENCODE_QUALITY,
  })
  // Encoders the browser lacks silently fall back to PNG — not comparable.
  if (blob.type !== mimeType) throw new Error(`Cannot encode ${mimeType}`)
  return blob.size
}

/**
 * Measures how much smaller the image encodes once unused texels are
 * flattened (same resolution), and once it is also cropped to its used
 * bounds. Unused regions are painted flat black: nothing samples them, and
 * flat runs are what PNG/JPEG/WebP compress best.
 */
async function runDownloadJob({
  blob,
  mimeType,
  mask,
  maskWidth,
  maskHeight,
  crop,
}: DownloadJobInput): Promise<DownloadJobResult> {
  if (!canReencode(mimeType)) throw new Error(`Cannot re-encode ${mimeType}`)

  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  })
  try {
    const { width, height } = bitmap
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No 2D context')
    context.drawImage(bitmap, 0, 0)
    const full = await encodedSize(canvas, mimeType)

    const unused = new OffscreenCanvas(maskWidth, maskHeight)
    const unusedContext = unused.getContext('2d')
    if (!unusedContext) throw new Error('No 2D context')
    const unusedPixels = maskToImageData(mask, maskWidth, maskHeight, false)
    // black, opaque where unused
    unusedContext.putImageData(unusedPixels, 0, 0)
    context.imageSmoothingEnabled = false
    context.drawImage(unused, 0, 0, width, height)
    const cleared = await encodedSize(canvas, mimeType)

    let croppedCleared: number | null = null
    if (crop) {
      const cropped = new OffscreenCanvas(crop.width, crop.height)
      const croppedContext = cropped.getContext('2d')
      if (!croppedContext) throw new Error('No 2D context')
      croppedContext.drawImage(
        canvas,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height
      )
      croppedCleared = await encodedSize(cropped, mimeType)
    }

    return { full, cleared, croppedCleared }
  } finally {
    bitmap.close()
  }
}

export { canReencode, runCoverageJob, runDownloadJob }
export type {
  CoverageJobResult,
  DownloadJobInput,
  DownloadJobResult,
  TexelRect,
}
