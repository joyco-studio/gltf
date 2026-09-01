import { Scene, Timer } from 'three/webgpu'

import { ControlSystem } from './controls/control-system'
import { Disposer } from './disposer'
import { AnimationSystem } from './systems/animation-system'
import { AxesSystem } from './systems/axes-system'
import { EventEmitter } from './event-emitter'
import { inspectGltf, type GltfDocumentInfo } from './inspect'
import type { System } from './system'
import { validateGltf } from './validate'
import type { GltfValidationSchema } from './validation-schema'
import { BoundsSystem } from './systems/bounds-system'
import { CameraHelperSystem } from './systems/camera-helper-system'
import { CameraSystem } from './systems/camera-system'
import { EnvironmentSystem } from './systems/environment-system'
import { GridSystem } from './systems/grid-system'
import { HighlightSystem } from './systems/highlight-system'
import {
  ModelSystem,
  type LoadedModel,
  type ModelTransform,
} from './systems/model-system'
import { PickSystem } from './systems/pick-system'
import { RenderSystem } from './systems/render-system'

type ViewerStatus = 'empty' | 'loading' | 'ready' | 'error'

interface ViewerSnapshot {
  status: ViewerStatus
  document: GltfDocumentInfo | null
  error: string | null
}

interface ViewerEvents extends Record<string, unknown> {
  change: ViewerSnapshot
  /** A scene node was picked directly in the viewport (⌘-click). */
  pick: { kind: 'node'; id: number; name: string }
}

const EMPTY_SNAPSHOT: ViewerSnapshot = {
  status: 'empty',
  document: null,
  error: null,
}

/**
 * Orchestrates the viz: owns the scene, the system registry, the frame loop
 * and the resize observer. UI layers subscribe through `on('change')` and
 * read immutable snapshots — they never touch three.js state directly.
 */
class Viewer extends EventEmitter<ViewerEvents> {
  readonly scene = new Scene()
  readonly render: RenderSystem
  readonly camera: CameraSystem
  readonly controls: ControlSystem
  readonly environment: EnvironmentSystem
  readonly grid: GridSystem
  readonly bounds: BoundsSystem
  readonly cameraHelper: CameraHelperSystem
  readonly model: ModelSystem
  readonly highlight: HighlightSystem
  readonly pick: PickSystem
  readonly axes: AxesSystem
  readonly animations: AnimationSystem

  private systems: System[]
  private disposer = new Disposer()
  private timer = new Timer()
  private frameHandle: number | null = null
  private resizeObserver: ResizeObserver
  private snapshot: ViewerSnapshot = EMPTY_SNAPSHOT
  private validationSchema: GltfValidationSchema | null = null
  private validationSource: unknown = null

  constructor(canvas: HTMLCanvasElement) {
    super()

    this.render = new RenderSystem(canvas)
    this.camera = new CameraSystem()
    this.controls = new ControlSystem(canvas)
    this.environment = new EnvironmentSystem()
    this.grid = new GridSystem()
    this.bounds = new BoundsSystem()
    this.cameraHelper = new CameraHelperSystem()
    this.model = new ModelSystem()
    this.highlight = new HighlightSystem()
    this.pick = new PickSystem(canvas)
    this.axes = new AxesSystem()
    this.animations = new AnimationSystem()

    // update order: controls (navigation) → animations (pose) → render last
    this.systems = [
      this.camera,
      this.controls,
      this.environment,
      this.grid,
      this.bounds,
      this.model,
      this.cameraHelper,
      this.highlight,
      this.pick,
      this.axes,
      this.animations,
      this.render,
    ]

    // Render is last in update order but must be last to dispose: scene-owned
    // GPU resources need a live renderer backend while they tear down.
    this.disposer.add(this.render)
    for (const system of this.systems) {
      system.init?.(this)
      if (system !== this.render) {
        this.disposer.add(() => system.dispose?.())
      }
    }

    this.resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const dpr = Math.min(window.devicePixelRatio, 2)
      for (const system of this.systems) system.resize?.(width, height, dpr)
    })
    this.resizeObserver.observe(canvas.parentElement ?? canvas)
    this.disposer.add(() => this.resizeObserver.disconnect())
    this.timer.connect(document)
    this.disposer.add(this.timer)
  }

  getSnapshot(): ViewerSnapshot {
    return this.snapshot
  }

  private setSnapshot(partial: Partial<ViewerSnapshot>) {
    if (this.disposer.disposed) return
    this.snapshot = { ...this.snapshot, ...partial }
    this.emit('change', this.snapshot)
  }

  start() {
    if (this.frameHandle !== null) return
    this.timer.reset()
    const tick = (timestamp: number) => {
      this.frameHandle = requestAnimationFrame(tick)
      this.timer.update(timestamp)
      const dt = this.timer.getDelta()
      for (const system of this.systems) system.update?.(dt)
    }
    this.frameHandle = requestAnimationFrame(tick)
  }

  stop() {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle)
      this.frameHandle = null
    }
  }

  /**
   * Frame a glTF entity for close inspection: a node or mesh directly, a
   * material via every mesh using it, a texture via every mesh whose
   * materials sample it. Transform-only nodes remain inspectable without
   * moving the camera; invalid or non-renderable resource targets clear an
   * earlier inspection.
   */
  inspectItem(
    kind: 'node' | 'mesh' | 'material' | 'texture',
    id: number,
    name: string
  ) {
    const target = { kind, id, name }
    const meshes = this.model.getMeshesForTarget(target)

    const box = this.model.getWorldBoxOfMeshes(meshes)
    if (
      !box &&
      (kind !== 'node' || !this.model.getElementTransformInfo({ kind, id }))
    ) {
      this.controls.exitInspect()
      return
    }
    this.controls.inspect(target, box)
  }

  async loadFiles(files: File[]) {
    await this.load(() => this.model.loadFiles(files))
  }

  async loadUrl(url: string, transform?: ModelTransform) {
    await this.load(() => this.model.loadUrl(url, transform))
  }

  /** Applies one portable rule schema to the current and all future models. */
  setValidationSchema(schema: GltfValidationSchema | null) {
    this.validationSchema = schema
    if (!this.validationSource || !this.snapshot.document) return
    this.setSnapshot({
      document: {
        ...this.snapshot.document,
        validationIssues: validateGltf(this.validationSource, schema),
      },
    })
  }

  private async load(loadModel: () => Promise<LoadedModel | null>) {
    this.setSnapshot({ status: 'loading', error: null })
    try {
      const loaded = await loadModel()
      if (!loaded || this.disposer.disposed) return // superseded or unmounted

      const source = loaded.gltf.parser.json as unknown
      const document = await inspectGltf(loaded.gltf, loaded.fileName)
      if (this.disposer.disposed || this.model.current !== loaded) return
      // The schema may have changed while texture inspection was awaiting;
      // derive findings from the latest applied rules at commit time.
      document.validationIssues = validateGltf(source, this.validationSchema)
      this.validationSource = source
      this.setSnapshot({ status: 'ready', document })
    } catch (error) {
      if (this.disposer.disposed) return
      this.setSnapshot({
        status: this.snapshot.document ? 'ready' : 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // idle showcase only while nothing is loaded
      if (!this.disposer.disposed) {
        this.controls.setIdle(this.snapshot.document === null)
      }
    }
  }

  dispose() {
    this.stop()
    try {
      this.disposer.dispose()
    } finally {
      this.scene.clear()
      this.clear()
    }
  }
}

export { Viewer, EMPTY_SNAPSHOT }
export type { ViewerSnapshot, ViewerStatus, ModelTransform }
