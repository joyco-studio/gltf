import {
  BackSide,
  Color,
  EquirectangularReflectionMapping,
  Mesh,
  MeshBasicNodeMaterial,
  PMREMGenerator,
  SphereGeometry,
  SRGBColorSpace,
  type Node,
  type RenderTarget,
  type Scene,
  type Texture,
} from 'three/webgpu'
import {
  Fn,
  mix,
  output,
  rangeFogFactor,
  renderGroup,
  uniform,
  vec4,
} from 'three/tsl'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

import { Disposer } from '../disposer'
import {
  DEFAULT_ENVIRONMENT_PRESET,
  ENVIRONMENT_PRESETS,
  type EnvironmentPresetId,
} from '../environment-presets'
import { EventEmitter } from '../event-emitter'
import type { System } from '../system'
import type { Viewer } from '../viewer'

// Fog spans most of the world bounds (±15): close work stays crisp, the
// far half of the world melts into the page background.
const FOG_NEAR = 9
const FOG_FAR = 33

const MIN_INTENSITY = 0
const MAX_INTENSITY = 3

/** Where the image-based lighting comes from. */
type EnvironmentSource =
  | { kind: 'preset'; id: EnvironmentPresetId }
  | { kind: 'file'; name: string }

/** Loading lifecycle of the most recently requested source. */
type EnvironmentLoad =
  | { phase: 'ready' }
  | { phase: 'loading'; source: EnvironmentSource }
  | { phase: 'error'; source: EnvironmentSource; message: string }

interface EnvironmentSnapshot {
  /** The source currently lighting the scene (kept while a new one loads). */
  active: EnvironmentSource
  load: EnvironmentLoad
  intensity: number
  /** Rotation about the world Y axis, in degrees. */
  rotation: number
}

const DEFAULT_ENVIRONMENT_SNAPSHOT: EnvironmentSnapshot = {
  active: { kind: 'preset', id: DEFAULT_ENVIRONMENT_PRESET },
  load: { phase: 'ready' },
  intensity: 1,
  rotation: 0,
}

/** `scene.fogNode` exists at runtime but is missing from @types/three. */
type NodeScene = Scene & { fogNode: Node | null }

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

function loadEquirectangular(url: string, fileName: string): Promise<Texture> {
  const loader = fileName.toLowerCase().endsWith('.exr')
    ? new EXRLoader()
    : new HDRLoader()
  return loader.loadAsync(url)
}

/**
 * Image-based lighting (a selectable preset or an uploaded HDRI, prefiltered
 * through PMREM) plus the scene output stage: model-only tone mapping
 * followed by distance fog. The fog color tracks the page background across
 * theme switches so geometry melts into the page instead of hitting a
 * visible color seam.
 */
class EnvironmentSystem
  extends EventEmitter<{ change: EnvironmentSnapshot }>
  implements System
{
  private viewer!: Viewer
  private snapshot = DEFAULT_ENVIRONMENT_SNAPSHOT
  // scene-level uniforms live in renderGroup so they refresh on every
  // render — see ToneMappingSystem for why the per-object group goes stale
  private background = uniform(new Color('#ffffff')).setGroup(renderGroup)
  private fogNear = uniform(FOG_NEAR).setGroup(renderGroup)
  private fogFar = uniform(FOG_FAR).setGroup(renderGroup)
  private disposer = new Disposer()
  private pmrem: PMREMGenerator | null = null
  private current: RenderTarget | null = null
  /** Bumped per request so a slow download can't override a newer pick. */
  private request = 0

  init(viewer: Viewer) {
    this.viewer = viewer

    // Background dome — fog off, and therefore outside the tone-mapping
    // stage too, so its color displays exactly as sampled from the theme.
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
    this.disposer.add(dome.geometry)
    this.disposer.add(material)
    this.disposer.add(() => dome.removeFromParent())

    this.installSceneOutput()
    this.applyIntensity()
    this.applyRotation()
    void this.loadSource(this.snapshot.active)

    this.disposer.add(() => {
      if (this.current && viewer.scene.environment === this.current.texture) {
        viewer.scene.environment = null
      }
      this.current?.dispose()
      this.current = null
    })

    this.syncToTheme()
    const themeObserver = new MutationObserver(() => this.syncToTheme())
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    this.disposer.add(() => themeObserver.disconnect())
  }

  /**
   * Every fogged material ends in this node: tone-map the lit color (only
   * for `toneMapped` materials — helpers opt out), then fog it towards the
   * page background. Fogging after the curve keeps fully fogged pixels on
   * the exact page color.
   */
  private installSceneOutput() {
    const toneMapping = this.viewer.toneMapping
    const sceneOutput = Fn((builder: { material: { toneMapped: boolean } }) => {
      const lit = builder.material.toneMapped
        ? toneMapping.apply(output.rgb)
        : output.rgb
      const factor = rangeFogFactor(this.fogNear, this.fogFar)
      return vec4(mix(lit, this.background, factor), output.a)
    })()

    const scene = this.viewer.scene as NodeScene
    scene.fogNode = sceneOutput
    this.disposer.add(() => {
      if (scene.fogNode === sceneOutput) scene.fogNode = null
    })
  }

  getSnapshot(): EnvironmentSnapshot {
    return this.snapshot
  }

  setPreset(id: EnvironmentPresetId) {
    void this.loadSource({ kind: 'preset', id })
  }

  /** Light the scene with an uploaded equirectangular `.hdr` / `.exr`. */
  loadFile(file: File) {
    void this.loadSource({ kind: 'file', name: file.name }, file)
  }

  setIntensity(intensity: number) {
    const clamped = Math.min(Math.max(intensity, MIN_INTENSITY), MAX_INTENSITY)
    this.setSnapshot({ intensity: clamped })
    this.applyIntensity()
  }

  setRotation(degrees: number) {
    const wrapped = ((degrees % 360) + 360) % 360
    this.setSnapshot({ rotation: wrapped })
    this.applyRotation()
  }

  /**
   * Scale the fog band to the framed model: the defaults suit the ±15
   * world, but a large model frames the camera far beyond them and would
   * be fogged into the background entirely.
   */
  fit(worldRadius: number) {
    this.fogNear.value = Math.max(FOG_NEAR, worldRadius * 4.5)
    this.fogFar.value = Math.max(FOG_FAR, worldRadius * 12)
  }

  private applyIntensity() {
    this.viewer.scene.environmentIntensity = this.snapshot.intensity
  }

  private applyRotation() {
    this.viewer.scene.environmentRotation.set(
      0,
      (this.snapshot.rotation * Math.PI) / 180,
      0
    )
  }

  private async loadSource(source: EnvironmentSource, file?: File) {
    const request = ++this.request
    this.setSnapshot({ load: { phase: 'loading', source } })
    const superseded = () =>
      this.disposer.disposed || request !== this.request

    let objectUrl: string | null = null
    try {
      // PMREM needs an initialized backend
      await this.viewer.render.whenReady
      if (superseded()) return

      let target: RenderTarget
      if (source.kind === 'preset' && source.id === 'room') {
        const room = new RoomEnvironment()
        try {
          target = this.getPmrem().fromScene(room, 0.04)
        } finally {
          room.dispose()
        }
      } else {
        let url: string
        let fileName: string
        if (source.kind === 'file') {
          if (!file) throw new Error('missing environment file')
          objectUrl = URL.createObjectURL(file)
          url = objectUrl
          fileName = file.name
        } else {
          const preset = ENVIRONMENT_PRESETS.find(({ id }) => id === source.id)
          if (!preset?.url) throw new Error(`unknown preset "${source.id}"`)
          url = preset.url
          fileName = preset.url
        }
        const texture = await loadEquirectangular(url, fileName)
        try {
          if (superseded()) return
          texture.mapping = EquirectangularReflectionMapping
          target = this.getPmrem().fromEquirectangular(texture)
        } finally {
          texture.dispose()
        }
      }

      if (superseded()) {
        target.dispose()
        return
      }
      const previous = this.current
      this.current = target
      this.viewer.scene.environment = target.texture
      previous?.dispose()
      this.setSnapshot({ active: source, load: { phase: 'ready' } })
    } catch (error) {
      if (superseded()) return
      const message = error instanceof Error ? error.message : String(error)
      console.error('viz: environment failed to load', error)
      this.setSnapshot({ load: { phase: 'error', source, message } })
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }

  private getPmrem() {
    if (!this.pmrem) {
      this.pmrem = this.disposer.add(
        new PMREMGenerator(this.viewer.render.renderer)
      )
    }
    return this.pmrem
  }

  private setSnapshot(partial: Partial<EnvironmentSnapshot>) {
    if (this.disposer.disposed) return
    this.snapshot = { ...this.snapshot, ...partial }
    this.emit('change', this.snapshot)
  }

  private syncToTheme() {
    const background = getComputedStyle(document.body).backgroundColor
    const color = cssColorToThree(background)
    if (!color) return
    this.background.value.copy(color)
  }

  dispose() {
    this.disposer.dispose()
    this.clear()
  }
}

export {
  DEFAULT_ENVIRONMENT_SNAPSHOT,
  EnvironmentSystem,
  MAX_INTENSITY,
  MIN_INTENSITY,
}
export type { EnvironmentLoad, EnvironmentSnapshot, EnvironmentSource }
