import {
  NodeMaterial,
  NoBlending,
  NoColorSpace,
  QuadMesh,
  RenderTarget,
  WebGPUCoordinateSystem,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu'
import { texture, uv } from 'three/tsl'
import { canvasToBlob } from './canvas-to-blob'

/** Read a thumbnail through the same backend that decoded the model's textures. */
async function renderGpuTexturePreview(
  source: Texture,
  renderer: WebGPURenderer,
  maxSize: number
): Promise<Blob | null> {
  const image = source.image as { width?: number; height?: number } | undefined
  if (!image?.width || !image.height) return null

  const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null

  const target = new RenderTarget(width, height, { depthBuffer: false })
  const material = new NodeMaterial()
  // Explicit UVs show the entire image, independent of material UV transforms.
  const sample = texture(source, uv())
  // Undo color-texture decoding for the PNG; data maps retain their raw values.
  material.fragmentNode =
    source.colorSpace === NoColorSpace
      ? sample
      : sample.workingToColorSpace(source.colorSpace)
  material.blending = NoBlending
  material.depthTest = false
  material.depthWrite = false
  const quad = new QuadMesh(material)
  const previousTarget = renderer.getRenderTarget()
  const previousFace = renderer.getActiveCubeFace()
  const previousLevel = renderer.getActiveMipmapLevel()

  try {
    try {
      renderer.setRenderTarget(target)
      quad.render(renderer)
    } finally {
      // Restore synchronously: the viewer keeps rendering during async readback.
      renderer.setRenderTarget(previousTarget, previousFace, previousLevel)
    }
    const pixels = await renderer.readRenderTargetPixelsAsync(
      target, 0, 0, width, height
    )
    const rgba = context.createImageData(width, height)
    const webgpu = renderer.coordinateSystem === WebGPUCoordinateSystem
    // WebGPU pads readback rows to 256 bytes; WebGL returns bottom-up rows.
    const stride = webgpu ? Math.ceil((width * 4) / 256) * 256 : width * 4
    for (let y = 0; y < height; y++) {
      const offset = (webgpu ? y : height - 1 - y) * stride
      rgba.data.set(pixels.subarray(offset, offset + width * 4), y * width * 4)
    }
    context.putImageData(rgba, 0, 0)
    return canvasToBlob(canvas)
  } finally {
    target.dispose()
    material.dispose()
    // QuadMesh geometry is shared by Three.js; the model owns the source texture.
  }
}

export { renderGpuTexturePreview }
