import {
  ACESFilmicToneMapping,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'

import type { System } from '../system'
import type { Viewer } from '../viewer'

class RenderSystem implements System {
  readonly renderer: WebGLRenderer

  private viewer!: Viewer

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
  }

  init(viewer: Viewer) {
    this.viewer = viewer
  }

  resize(width: number, height: number, dpr: number) {
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)
  }

  update() {
    this.renderer.render(this.viewer.scene, this.viewer.camera.camera)
  }

  dispose() {
    this.renderer.dispose()
  }
}

export { RenderSystem }
