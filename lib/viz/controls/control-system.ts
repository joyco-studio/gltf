import { Box3, Vector3, type Object3D } from 'three/webgpu'

import { EventEmitter } from '../event-emitter'
import type { System } from '../system'
import type { ProjectionMode } from '../systems/camera-system'
import type { Viewer } from '../viewer'
import { FlyMode } from './fly-mode'
import { OrbitMode } from './orbit-mode'
import {
  AXIS_VECTORS,
  type Axis,
  type CameraControlContext,
  type CameraControlMode,
  type ControlModeId,
} from './types'

interface InspectTarget {
  kind: 'node' | 'mesh' | 'material' | 'texture'
  id: number
  name: string
}

interface AxisAlignment {
  axis: Axis
  sign: 1 | -1
}

interface ControlsSnapshot {
  mode: ControlModeId
  /** True while fly mode owns the pointer (mouse look engaged). */
  pointerLocked: boolean
  projection: ProjectionMode
  /** Item currently framed for close inspection, if any. */
  inspecting: InspectTarget | null
  /** Axis the camera currently sits on (relative to the focus), if any. */
  alignedAxis: AxisAlignment | null
}

const DEFAULT_SNAPSHOT: ControlsSnapshot = {
  mode: 'orbit',
  pointerLocked: false,
  projection: 'perspective',
  inspecting: null,
  alignedAxis: null,
}

const ALIGNMENT_THRESHOLD = 0.9995

/** How far past the framing distance the camera may dolly out. */
const MAX_ZOOM_OUT_FACTOR = 2.5

/** Breathing room around the fitted bounding sphere, per framing kind. */
const FRAME_MARGIN = 1.2
const INSPECT_MARGIN = 1.1

/** Home vantage direction (focus → camera): ~35° above the horizon. */
const HOME_DIRECTION = new Vector3(1, 0.6, 1).normalize()

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
  private inspecting: InspectTarget | null = null
  private alignedAxis: AxisAlignment | null = null
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
    this.publish()
  }

  /**
   * One-shot view snap: position the camera on the axis at the current
   * focus distance, looking at the target. Never locks anything — the user
   * keeps full control immediately after. Pressing again flips to the
   * opposite side of the axis.
   */
  snapToAxis(axis: Axis) {
    const { camera, target } = this.context
    const offset = camera.position.clone().sub(target)
    const distance = Math.max(offset.length(), 0.01)

    // already looking from the + side? flip to the − side
    const alignment = offset.normalize().dot(new Vector3(...AXIS_VECTORS[axis]))
    const sign = alignment > 0.999 ? -1 : 1

    camera.position
      .copy(target)
      .addScaledVector(new Vector3(...AXIS_VECTORS[axis]), sign * distance)
    camera.lookAt(target)
    this.active.syncWithCamera()
  }

  /** Swap projection, preserving the apparent framing around the target. */
  setProjection(mode: ProjectionMode) {
    this.viewer.camera.setProjection(mode, this.context.target)
    // rebind the active mode to the swapped camera
    this.active.syncWithCamera()
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

    const { maxSize, distance } = this.moveToBox(
      box,
      HOME_DIRECTION,
      FRAME_MARGIN
    )
    // The dolly cap is a whole-model guard set here and left untouched by
    // inspection — so it stays relative to the root, not a (possibly tiny)
    // inspected element.
    this.capDolly(distance)
    this.context.worldRadius = Math.max(maxSize / 2, 0.001)
    this.viewer.grid.fit(this.context.worldRadius)
    this.viewer.environment.fit(this.context.worldRadius)
    this.active.syncWithCamera()
  }

  /**
   * Enter inspection: orbit the given item, focus its world box and fit the
   * camera to an inspect radius computed from the item's own extents.
   */
  inspect(target: InspectTarget, box: Box3) {
    this.setMode('orbit')
    // Keep the current viewing angle (Blender's Frame Selected) — the user
    // already has a clear sightline to the item; just recenter and fit. The
    // dolly cap is intentionally left as the whole-model guard from frame(),
    // so inspecting a small part doesn't trap the camera inside larger geometry.
    this.moveToBox(box, this.currentDirection(), INSPECT_MARGIN)
    this.active.syncWithCamera()
    this.inspecting = target
    this.publish()
  }

  /** Unit direction focus → camera right now, falling back to the home angle. */
  private currentDirection(): Vector3 {
    const offset = this.context.camera.position.clone().sub(this.context.target)
    if (offset.lengthSq() < 1e-8) return HOME_DIRECTION
    return offset.normalize()
  }

  /**
   * Quick view reset for any mode: pivot back to the world origin and the
   * camera back to its home vantage — the whole-model framing when a model
   * is loaded, or the idle position otherwise.
   */
  resetView() {
    // a reset supersedes any running inspection
    if (this.inspecting) {
      this.inspecting = null
      this.publish()
    }

    const model = this.viewer.model.current
    if (model) {
      this.frame(model.root)
    } else {
      this.context.target.set(0, 0, 0)
      this.context.camera.position.set(4.6, 4.6, 4.6)
      this.context.camera.lookAt(this.context.target)
      this.active.syncWithCamera()
    }
  }

  /**
   * Leave inspection (ESC). Stay exactly where the camera is — reframing the
   * whole model would yank the view and cost the user their visual reference
   * to the item. The dolly cap is already the whole-model guard, so there's
   * nothing to restore.
   */
  exitInspect() {
    if (!this.inspecting) return
    this.inspecting = null
    this.publish()
  }

  /**
   * Focus the shared target on a box and fit the camera to it along
   * `direction` (a unit focus → camera vector). Distance fits the box's
   * bounding sphere, so the framing is angle-independent and never clips as
   * the camera orbits.
   */
  private moveToBox(box: Box3, direction: Vector3, margin: number) {
    const { camera, target } = this.context
    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3())
    const maxSize = Math.max(size.x, size.y, size.z, 0.001)
    const radius = Math.max(size.length() / 2, 0.001)

    const distance = this.viewer.camera.fitSphereDistance(radius) * margin

    this.viewer.camera.setFrame(distance)
    camera.position.copy(center).addScaledVector(direction, distance)
    camera.lookAt(center)
    target.copy(center)

    return { maxSize, distance }
  }

  /**
   * Cap how far every mode may dolly out from a framing distance, so the
   * subject can't shrink away.
   */
  private capDolly(distance: number) {
    const cap = distance * MAX_ZOOM_OUT_FACTOR
    for (const mode of this.modes.values()) mode.setMaxDistance?.(cap)
  }

  update(dt: number) {
    this.active.update(dt)

    // track camera↔axis alignment; publish only on transitions so the UI
    // can light the axis buttons up while aligned and drop them on movement
    const aligned = this.computeAlignment()
    if (
      aligned?.axis !== this.alignedAxis?.axis ||
      aligned?.sign !== this.alignedAxis?.sign
    ) {
      this.alignedAxis = aligned
      this.publish()
    }
  }

  private computeAlignment(): AxisAlignment | null {
    const { camera, target } = this.context
    const offset = camera.position.clone().sub(target)
    const length = offset.length()
    if (length < 1e-6) return null
    offset.divideScalar(length)

    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      if (offset[axis] > ALIGNMENT_THRESHOLD) return { axis, sign: 1 }
      if (offset[axis] < -ALIGNMENT_THRESHOLD) return { axis, sign: -1 }
    }
    return null
  }

  private publish() {
    const fly = this.modes.get('fly') as FlyMode | undefined
    this.snapshot = {
      mode: this.active.id,
      pointerLocked: fly?.isPointerLocked ?? false,
      projection: this.viewer.camera.mode,
      inspecting: this.inspecting,
      alignedAxis: this.alignedAxis,
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
