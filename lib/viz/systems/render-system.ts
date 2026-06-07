import { NoToneMapping, SRGBColorSpace, WebGPURenderer } from 'three/webgpu'

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
  private viewer!: Viewer

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
    // precisely on the page theme color — a filmic curve would shift them
    // (per-material/post tone mapping can be layered on the model later)
    this.renderer.toneMapping = NoToneMapping

    this.whenReady = this.renderer
      .init()
      .then(() => {
        this.ready = true
      })
      .catch((error: unknown) => {
        console.error('viz: renderer failed to initialize', error)
      })
  }

  init(viewer: Viewer) {
    this.viewer = viewer
  }

  resize(width: number, height: number, dpr: number) {
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)
  }

  update() {
    if (!this.ready) return
    this.renderer.render(this.viewer.scene, this.viewer.camera.camera)
  }

  dispose() {
    this.renderer.dispose()
  }
}

export { RenderSystem }
