import {
  BackSide,
  Color,
  Fog,
  Mesh,
  MeshBasicNodeMaterial,
  PMREMGenerator,
  SphereGeometry,
  SRGBColorSpace,
} from 'three/webgpu'
import { uniform } from 'three/tsl'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

import type { System } from '../system'
import type { Viewer } from '../viewer'

// Fog spans most of the world bounds (±15): close work stays crisp, the
// far half of the world melts into the page background.
const FOG_NEAR = 9
const FOG_FAR = 33

/**
 * Resolve any CSS color (incl. oklch custom-property themes) to a three.js
 * Color by letting the 2D canvas rasterizer parse it.
 */
function cssColorToThree(css: string): Color | null {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = css
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  // canvas pixels are sRGB — declare it so three converts to working space
  return new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
}

/**
 * Image-based lighting (procedural room environment) plus distance fog. The
 * environment is generated once the async renderer backend is ready. The
 * fog color tracks the page background across theme switches so geometry
 * melts into the page instead of hitting a visible color seam.
 */
class EnvironmentSystem implements System {
  private pmrem: PMREMGenerator | null = null
  private fog = new Fog('#ffffff', FOG_NEAR, FOG_FAR)
  private background = uniform(new Color('#ffffff'))
  private themeObserver: MutationObserver | null = null
  private disposed = false
  private disposables: { dispose(): void }[] = []

  init(viewer: Viewer) {
    // Background dome — with NoToneMapping its color (and the fog color)
    // displays exactly as sampled from the page theme.
    const material = new MeshBasicNodeMaterial({
      side: BackSide,
      fog: false,
      depthWrite: false,
    })
    material.colorNode = this.background
    // radius safely beyond the ±15 bounds box, inside every far plane
    const dome = new Mesh(new SphereGeometry(30, 16, 16), material)
    dome.name = 'background-dome'
    dome.renderOrder = -1
    dome.frustumCulled = false
    viewer.scene.add(dome)
    this.disposables.push(dome.geometry, material)
    // PMREM needs an initialized backend — defer until the renderer is up
    void viewer.render.whenReady.then(() => {
      if (this.disposed) return
      this.pmrem = new PMREMGenerator(viewer.render.renderer)
      const environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04)
      viewer.scene.environment = environment.texture
    })

    viewer.scene.fog = this.fog
    this.syncFogToTheme()
    this.themeObserver = new MutationObserver(() => this.syncFogToTheme())
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
  }

  private syncFogToTheme() {
    const background = getComputedStyle(document.body).backgroundColor
    const color = cssColorToThree(background)
    if (!color) return
    this.background.value.copy(color)
    this.fog.color.copy(color)
  }

  dispose() {
    this.disposed = true
    this.themeObserver?.disconnect()
    this.pmrem?.dispose()
    for (const disposable of this.disposables) disposable.dispose()
  }
}

export { EnvironmentSystem }
