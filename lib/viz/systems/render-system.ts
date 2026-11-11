import {
  NoToneMapping,
  SRGBColorSpace,
  WebGPURenderer,
  type Camera,
} from 'three/webgpu'

import type { System } from '../system'
import type { Viewer } from '../viewer'

/**
 * WebGPU-backed renderer (auto-falls back to a WebGL2 backend where WebGPU
 * is unavailable). Initialization is async — frames are skipped until the
 * backend is ready, and `whenReady` lets other systems defer GPU work
 * (PMREM generation, KTX2 support detection).
 */
class RenderSystem implements System {
  readonly renderer: WebGPURenderer
  readonly whenReady: Promise<void>

  private ready = false
  private disposed = false
  private viewer!: Viewer
  private lastCamera: Camera | null = null

  constructor(canvas: HTMLCanvasElement) {
    // opaque canvas: transparent-canvas compositing mangles low-alpha
    // fragments (straight vs premultiplied) across backends — instead the
    // clear color tracks the page theme (see EnvironmentSystem)
    this.renderer = new WebGPURenderer({
      canvas,
      antialias: true,
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    // exact colors end-to-end: the background dome, fog and grid must land
    // precisely on the page theme color — a fullscreen curve would shift
    // them. User tone mapping is applied to the model only, in-material
    // (see ToneMappingSystem / EnvironmentSystem's scene output node).
    this.renderer.toneMapping = NoToneMapping

    this.whenReady = this.renderer
      .init()
      .then(() => {
        if (this.disposed) {
          this.renderer.dispose()
          return
        }
        this.ready = true
      })
      .catch((error: unknown) => {
        if (!this.disposed) {
          console.error('viz: renderer failed to initialize', error)
        }
      })
  }

  init(viewer: Viewer) {
    this.viewer = viewer
  }

  resize(width: number, height: number, dpr: number) {
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)
  }

  /**
   * The camera behind the pixels on screen — a camera preview when one is
   * attached. Screen-space queries (picking) must use this, not the viewer
   * camera: a click detaches the preview before picking, yet the user aimed
   * at what was rendered.
   */
  get camera(): Camera {
    return this.lastCamera ?? this.viewer.camera.camera
  }

  update() {
    if (!this.ready) return
    this.lastCamera =
      this.viewer.cameraPreview.camera ?? this.viewer.camera.camera
    this.renderer.render(this.viewer.scene, this.lastCamera)
  }

  dispose() {
    this.disposed = true
    this.ready = false
    this.renderer.dispose()
  }
}

export { RenderSystem }
