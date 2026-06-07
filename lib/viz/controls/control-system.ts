import { Box3, Vector3, type Object3D } from 'three/webgpu'

import { EventEmitter } from '../event-emitter'
import type { System } from '../system'
import type { ProjectionMode } from '../systems/camera-system'
import type { Viewer } from '../viewer'
import { FlyMode } from './fly-mode'
import { OrbitMode } from './orbit-mode'
import type {
  Axis,
  AxisLock,
  CameraControlContext,
  CameraControlMode,
  ControlModeId,
} from './types'

interface InspectTarget {
  kind: 'mesh'
  id: number
  name: string
}

interface ControlsSnapshot {
  mode: ControlModeId
  axisLock: AxisLock | null
  /** True while fly mode owns the pointer (mouse look engaged). */
  pointerLocked: boolean
  projection: ProjectionMode
  /** Item currently framed for close inspection, if any. */
  inspecting: InspectTarget | null
}

const DEFAULT_SNAPSHOT: ControlsSnapshot = {
  mode: 'orbit',
  axisLock: null,
  pointerLocked: false,
  projection: 'perspective',
  inspecting: null,
}

/**
 * Pluggable camera navigation. Owns the shared focus target, the mode
 * registry and the axis-lock state; every mode implements the same
 * CameraControlMode contract, so switching navigation or adding a new mode
 * never touches the call sites.
 */
class ControlSystem
  extends EventEmitter<{ change: ControlsSnapshot }>
  implements System
{
  private viewer!: Viewer
  private context!: CameraControlContext
  private modes = new Map<ControlModeId, CameraControlMode>()
  private active!: CameraControlMode
  private axisLock: AxisLock | null = null
  private inspecting: InspectTarget | null = null
  private snapshot: ControlsSnapshot = DEFAULT_SNAPSHOT

  private readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    super()
    this.canvas = canvas
  }

  init(viewer: Viewer) {
    this.viewer = viewer
    this.context = {
      // live getter — the projection toggle swaps the active camera
      get camera() {
        return viewer.camera.camera
      },
      domElement: this.canvas,
      target: new Vector3(),
      worldRadius: 5,
      worldBounds: viewer.bounds.clampBox,
      notifyChange: () => this.publish(),
    }

    this.register(new OrbitMode())
    this.register(new FlyMode())
    this.active = this.modes.get('orbit')!
    this.active.enable()
    // nothing loaded yet — start in the idle showcase state
    this.setIdle(true)
  }

  /** Idle showcase (no document): modes adapt, e.g. orbit auto-rotates. */
  setIdle(idle: boolean) {
    for (const mode of this.modes.values()) mode.setIdle?.(idle)
  }

  private register(mode: CameraControlMode) {
    mode.init(this.context)
    this.modes.set(mode.id, mode)
  }

  getSnapshot(): ControlsSnapshot {
    return this.snapshot
  }

  setMode(id: ControlModeId) {
    if (this.active.id === id) return
    const next = this.modes.get(id)
    if (!next) throw new Error(`Unknown control mode: ${id}`)

    this.active.disable()
    this.active = next
    // The new mode adopts the camera exactly where the old one left it.
    this.active.enable()
    this.active.applyAxisLock(this.axisLock)
    this.publish()
  }

  /**
   * Cycle an axis lock the typical way: off → look from +axis → look from
   * −axis → off. Locking a different axis switches directly to its + side.
   */
  toggleAxisLock(axis: Axis) {
    if (this.axisLock?.axis !== axis) {
      this.axisLock = { axis, sign: 1 }
    } else if (this.axisLock.sign === 1) {
      this.axisLock = { axis, sign: -1 }
    } else {
      this.axisLock = null
    }

    this.active.applyAxisLock(this.axisLock)
    this.publish()
  }

  /** Swap projection, preserving the apparent framing around the target. */
  setProjection(mode: ProjectionMode) {
    this.viewer.camera.setProjection(mode, this.context.target)
    // rebind the active mode to the swapped camera (+ re-assert axis lock)
    this.active.syncWithCamera()
    this.active.applyAxisLock(this.axisLock)
    this.publish()
  }

  /** Frame an object: refocus the shared target and reposition the camera. */
  frame(object: Object3D) {
    const box = new Box3().setFromObject(object)
    if (box.isEmpty()) return

    // a fresh frame (e.g. new model) supersedes any running inspection
    if (this.inspecting) {
      this.inspecting = null
      this.publish()
    }

    const maxSize = this.moveToBox(box)
    this.context.worldRadius = Math.max(maxSize / 2, 0.001)
    this.viewer.grid.fit(this.context.worldRadius)
    this.active.syncWithCamera()
  }

  /**
   * Enter inspection: orbit the given item, focus its world box and fit the
   * camera to an inspect radius computed from the item's own extents.
   */
  inspect(target: InspectTarget, box: Box3) {
    this.setMode('orbit')
    this.moveToBox(box, 1.6)
    this.active.syncWithCamera()
    this.inspecting = target
    this.publish()
  }

  /** Leave inspection (ESC) and restore the whole-model framing. */
  exitInspect() {
    if (!this.inspecting) return
    this.inspecting = null
    const model = this.viewer.model.current
    if (model) this.frame(model.root)
    this.publish()
  }

  /** Focus the shared target on a box and fit the camera to it. */
  private moveToBox(box: Box3, fitFactor = 1.5) {
    const { camera, target } = this.context
    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3())
    const maxSize = Math.max(size.x, size.y, size.z, 0.001)

    const distance = this.viewer.camera.fitDistance(maxSize) * fitFactor

    this.viewer.camera.setFrame(distance)
    camera.position
      .copy(center)
      .add(new Vector3(1, 0.6, 1).normalize().multiplyScalar(distance))
    camera.lookAt(center)
    target.copy(center)

    return maxSize
  }

  update(dt: number) {
    this.active.update(dt)
  }

  private publish() {
    const fly = this.modes.get('fly') as FlyMode | undefined
    this.snapshot = {
      mode: this.active.id,
      axisLock: this.axisLock,
      pointerLocked: fly?.isPointerLocked ?? false,
      projection: this.viewer.camera.mode,
      inspecting: this.inspecting,
    }
    this.emit('change', this.snapshot)
  }

  dispose() {
    this.active.disable()
    for (const mode of this.modes.values()) mode.dispose()
    this.clear()
  }
}

export { ControlSystem, DEFAULT_SNAPSHOT as DEFAULT_CONTROLS_SNAPSHOT }
export type { ControlsSnapshot, InspectTarget }
