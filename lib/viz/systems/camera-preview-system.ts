import { MathUtils, OrthographicCamera, PerspectiveCamera } from 'three/webgpu'

import { Disposer } from '../disposer'
import { EventEmitter } from '../event-emitter'
import type { System } from '../system'
import type { Viewer } from '../viewer'

interface CameraPreview {
  nodeId: number
  name: string
  /**
   * Authored frame aspect (width / height), or null when the camera adopts
   * the viewport's — glTF perspective cameras without `aspectRatio`.
   */
  aspect: number | null
}

type PreviewSnapshot = CameraPreview | null

interface GltfCameraJson {
  nodes?: { camera?: number }[]
  cameras?: { type?: string; perspective?: { aspectRatio?: number } }[]
}

/** Viewport input that ends a preview — UI overlays never reach the canvas. */
const CANVAS_DETACH_EVENTS = ['pointerdown', 'wheel'] as const

/**
 * Looks through a glTF camera node. Rendering swaps to a proxy that copies
 * the source camera's world transform and projection every frame (so
 * animated cameras play back exactly), without mutating the model's camera.
 * Where the authored frame aspect differs from the viewport, the proxy
 * widens to contain the whole frame and the UI masks the overflow.
 *
 * Previews are transient: a press or wheel on the viewport, or any key press,
 * detaches back to the untouched viewer camera. Clicks on the UI are ignored.
 */
class CameraPreviewSystem
  extends EventEmitter<{ change: PreviewSnapshot }>
  implements System
{
  private viewer!: Viewer
  private disposer = new Disposer()
  private readonly canvas: HTMLCanvasElement
  private readonly perspective = new PerspectiveCamera()
  private readonly orthographic = new OrthographicCamera()
  private source: PerspectiveCamera | OrthographicCamera | null = null
  private snapshot: PreviewSnapshot = null
  private viewportAspect = 1
  private startedAt = 0

  constructor(canvas: HTMLCanvasElement) {
    super()
    this.canvas = canvas
  }

  init(viewer: Viewer) {
    this.viewer = viewer
    // Capture phase: detach before the canvas' own handlers (orbit drag,
    // picking) see the input, so the gesture continues on the restored
    // viewer camera.
    for (const type of CANVAS_DETACH_EVENTS) {
      this.disposer.listen(this.canvas, type, this.onInput, { capture: true })
    }
    this.disposer.listen(window, 'keydown', this.onInput, { capture: true })
    this.disposer.add(
      viewer.on('change', ({ status }) => {
        if (status === 'loading') this.stop()
      })
    )
  }

  getSnapshot(): PreviewSnapshot {
    return this.snapshot
  }

  /** The camera to render through while previewing, else null. */
  get camera(): PerspectiveCamera | OrthographicCamera | null {
    if (!this.source) return null
    return this.source instanceof PerspectiveCamera
      ? this.perspective
      : this.orthographic
  }

  /** Start looking through a glTF camera node. Returns false if it has none. */
  start(nodeId: number, name: string): boolean {
    const source = this.viewer.model.getCameraForNode(nodeId)
    if (
      !(source instanceof PerspectiveCamera) &&
      !(source instanceof OrthographicCamera)
    ) {
      return false
    }

    this.source = source
    // The triggering input (menu pointerup, Enter keydown) was created
    // before now — ignore it so the preview doesn't end on arrival.
    this.startedAt = performance.now()
    this.snapshot = { nodeId, name, aspect: this.authoredAspect(nodeId) }
    this.sync()
    this.emit('change', this.snapshot)
    return true
  }

  stop() {
    if (!this.source) return
    this.source = null
    this.snapshot = null
    this.emit('change', null)
  }

  private onInput = (event: Event) => {
    if (!this.source || event.timeStamp < this.startedAt) return
    // ESC is consumed by the detach — don't also exit a running inspection
    if ((event as KeyboardEvent).key === 'Escape') {
      event.preventDefault()
    }
    this.stop()
  }

  private authoredAspect(nodeId: number): number | null {
    const source = this.source
    if (source instanceof OrthographicCamera) {
      return (source.right - source.left) / (source.top - source.bottom)
    }
    const json = this.viewer.model.current?.gltf.parser.json as
      | GltfCameraJson
      | undefined
    const cameraId = json?.nodes?.[nodeId]?.camera
    const aspect =
      cameraId === undefined
        ? undefined
        : json?.cameras?.[cameraId]?.perspective?.aspectRatio
    return aspect && aspect > 0 ? aspect : null
  }

  /** Copy the source camera's world pose and projection onto the proxy. */
  private sync() {
    const source = this.source
    const camera = this.camera
    if (!source || !camera) return

    source.updateWorldMatrix(true, false)
    source.matrixWorld.decompose(
      camera.position,
      camera.quaternion,
      camera.scale
    )
    camera.near = source.near
    camera.far = source.far
    camera.zoom = source.zoom

    const viewport = this.viewportAspect
    const frame = this.snapshot?.aspect ?? viewport
    // Viewport narrower than the frame → fit the frame's width instead of
    // its height; the overflow above/below is masked by the UI.
    const widen = viewport < frame ? frame / viewport : 1

    if (
      source instanceof PerspectiveCamera &&
      camera instanceof PerspectiveCamera
    ) {
      const halfTan = Math.tan(MathUtils.degToRad(source.fov) / 2) * widen
      camera.fov = MathUtils.radToDeg(2 * Math.atan(halfTan))
      camera.aspect = viewport
      camera.filmGauge = source.filmGauge
      camera.filmOffset = source.filmOffset
      camera.focus = source.focus
    } else if (
      source instanceof OrthographicCamera &&
      camera instanceof OrthographicCamera
    ) {
      const centerX = (source.left + source.right) / 2
      const centerY = (source.top + source.bottom) / 2
      const halfHeight = ((source.top - source.bottom) / 2) * widen
      const halfWidth = halfHeight * viewport
      camera.left = centerX - halfWidth
      camera.right = centerX + halfWidth
      camera.top = centerY + halfHeight
      camera.bottom = centerY - halfHeight
    }
    camera.updateProjectionMatrix()
  }

  resize(width: number, height: number) {
    this.viewportAspect = width / Math.max(height, 1)
  }

  /** Runs after animations/skeleton so the pose matches this frame. */
  update() {
    this.sync()
  }

  dispose() {
    this.disposer.dispose()
    this.source = null
    this.snapshot = null
    this.clear()
  }
}

export { CameraPreviewSystem }
export type { CameraPreview }
