import { Clock, Scene } from 'three/webgpu'

import { ControlSystem } from './controls/control-system'
import { EventEmitter } from './event-emitter'
import { inspectGltf, type GltfDocumentInfo } from './inspect'
import type { System } from './system'
import { BoundsSystem } from './systems/bounds-system'
import { CameraSystem } from './systems/camera-system'
import { EnvironmentSystem } from './systems/environment-system'
import { GridSystem } from './systems/grid-system'
import { HighlightSystem } from './systems/highlight-system'
import { ModelSystem, type LoadedModel } from './systems/model-system'
import { RenderSystem } from './systems/render-system'

type ViewerStatus = 'empty' | 'loading' | 'ready' | 'error'

interface ViewerSnapshot {
  status: ViewerStatus
  document: GltfDocumentInfo | null
  error: string | null
}

interface ViewerEvents extends Record<string, unknown> {
  change: ViewerSnapshot
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
  readonly model: ModelSystem
  readonly highlight: HighlightSystem

  private systems: System[]
  private clock = new Clock()
  private frameHandle: number | null = null
  private resizeObserver: ResizeObserver
  private snapshot: ViewerSnapshot = EMPTY_SNAPSHOT

  constructor(canvas: HTMLCanvasElement) {
    super()

    this.render = new RenderSystem(canvas)
    this.camera = new CameraSystem()
    this.controls = new ControlSystem(canvas)
    this.environment = new EnvironmentSystem()
    this.grid = new GridSystem()
    this.bounds = new BoundsSystem()
    this.model = new ModelSystem()
    this.highlight = new HighlightSystem()

    // update order: controls (navigation) → bounds (reads camera) → render last
    this.systems = [
      this.camera,
      this.controls,
      this.environment,
      this.grid,
      this.bounds,
      this.model,
      this.highlight,
      this.render,
    ]
    for (const system of this.systems) system.init?.(this)

    this.resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const dpr = Math.min(window.devicePixelRatio, 2)
      for (const system of this.systems) system.resize?.(width, height, dpr)
    })
    this.resizeObserver.observe(canvas.parentElement ?? canvas)
  }

  getSnapshot(): ViewerSnapshot {
    return this.snapshot
  }

  private setSnapshot(partial: Partial<ViewerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial }
    this.emit('change', this.snapshot)
  }

  start() {
    if (this.frameHandle !== null) return
    this.clock.start()
    const tick = () => {
      this.frameHandle = requestAnimationFrame(tick)
      const dt = this.clock.getDelta()
      for (const system of this.systems) system.update?.(dt)
    }
    tick()
  }

  stop() {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle)
      this.frameHandle = null
    }
    this.clock.stop()
  }

  /** Frame a glTF mesh for close inspection (no-op if it has no geometry). */
  inspectMesh(id: number, name: string) {
    const box = this.model.getMeshWorldBox(id)
    if (!box) return
    this.controls.inspect({ kind: 'mesh', id, name }, box)
  }

  async loadFiles(files: File[]) {
    await this.load(() => this.model.loadFiles(files))
  }

  async loadUrl(url: string) {
    await this.load(() => this.model.loadUrl(url))
  }

  private async load(loadModel: () => Promise<LoadedModel | null>) {
    this.setSnapshot({ status: 'loading', error: null })
    try {
      const loaded = await loadModel()
      if (!loaded) return // superseded by a newer load

      const document = await inspectGltf(loaded.gltf, loaded.fileName)
      this.setSnapshot({ status: 'ready', document })
    } catch (error) {
      this.setSnapshot({
        status: this.snapshot.document ? 'ready' : 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // idle showcase only while nothing is loaded
      this.controls.setIdle(this.snapshot.document === null)
    }
  }

  dispose() {
    this.stop()
    this.resizeObserver.disconnect()
    for (const system of [...this.systems].reverse()) system.dispose?.()
    this.clear()
  }
}

export { Viewer, EMPTY_SNAPSHOT }
export type { ViewerSnapshot, ViewerStatus }
