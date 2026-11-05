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
  /** Wheel zoom on top of the authored projection (1 = as authored). */
  zoom: number
}

type PreviewSnapshot = CameraPreview | null

/** Wheel zoom feel, matching OrbitControls' dolly (0.95 per 100px notch). */
const ZOOM_BASE = 0.95
const ZOOM_RANGE = [0.2, 50] as const
/** Exponential approach rate toward the wheel target (1/s). */
const ZOOM_DAMPING = 12

interface GltfCameraJson {
  nodes?: { camera?: number }[]
  cameras?: { type?: string; perspective?: { aspectRatio?: number } }[]
}

/**
 * Looks through a glTF camera node. Rendering swaps to a proxy that copies
 * the source camera's world transform and projection every frame (so
 * animated cameras play back exactly), without mutating the model's camera.
 * Where the authored frame aspect differs from the viewport, the proxy
 * widens to contain the whole frame and the UI masks the overflow.
 *
 * The wheel zooms the preview (lerped, on top of the authored zoom) instead
 * of dollying the viewer camera. A press on the viewport detaches back to
 * the untouched viewer camera; UI clicks and keys leave the preview running.
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
  /** Wheel zoom multiplier: eased `zoom` chasing `zoomTarget`. */
  private zoom = 1
  private zoomTarget = 1

  constructor(canvas: HTMLCanvasElement) {
    super()
    this.canvas = canvas
  }

  init(viewer: Viewer) {
    this.viewer = viewer
    // Capture phase: detach before the canvas' own handlers (orbit drag,
    // picking) see the press, so the gesture continues on the restored
    // viewer camera. UI overlays never reach the canvas.
    this.disposer.listen(this.canvas, 'pointerdown', () => this.stop(), {
      capture: true,
    })
    this.disposer.listen(this.canvas, 'wheel', this.onWheel, {
      capture: true,
      passive: false,
    })
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
    this.zoom = this.zoomTarget = 1
    this.snapshot = {
      nodeId,
      name,
      aspect: this.authoredAspect(nodeId),
      zoom: 1,
    }
    this.sync()
    this.emit('change', this.snapshot)
    return true
  }

  /**
   * Zoom the preview instead of the viewer camera: capture phase on the
   * canvas runs before the orbit/fly wheel handlers, which never see it.
   */
  private onWheel = (event: WheelEvent) => {
    if (!this.source) return
    event.preventDefault()
    event.stopImmediatePropagation()

    // same delta normalization as OrbitControls
    let delta = event.deltaY
    if (event.deltaMode === 1) delta *= 16
    else if (event.deltaMode === 2) delta *= 100
    if (event.ctrlKey) delta *= 10 // trackpad pinch

    const zoom = MathUtils.clamp(
      this.zoomTarget * Math.pow(ZOOM_BASE, delta * 0.01),
      ...ZOOM_RANGE
    )
    if (zoom === this.zoomTarget || !this.snapshot) return
    this.zoomTarget = zoom
    // publish the destination, not every eased frame
    this.snapshot = { ...this.snapshot, zoom }
    this.emit('change', this.snapshot)
  }

  stop() {
    if (!this.source) return
    this.source = null
    this.snapshot = null
    this.emit('change', null)
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
    camera.zoom = source.zoom * this.zoom

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
  update(dt: number) {
    if (!this.source) return
    // ease in log space so zooming in and out feel symmetric
    const t = 1 - Math.exp(-ZOOM_DAMPING * dt)
    this.zoom = Math.exp(
      MathUtils.lerp(Math.log(this.zoom), Math.log(this.zoomTarget), t)
    )
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
