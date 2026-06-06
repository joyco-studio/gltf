import type { Box3, Vector3 } from 'three'

import type { ViewerCamera } from '../systems/camera-system'

type ControlModeId = 'orbit' | 'fly'

type Axis = 'x' | 'y' | 'z'

interface AxisLock {
  axis: Axis
  /** Which side of the axis the camera looks from (+x vs −x, ...). */
  sign: 1 | -1
}

/**
 * Shared state handed to every control mode. `target` is the scene focus
 * point — a single Vector3 instance owned by the ControlSystem so modes stay
 * in agreement when the user switches between them.
 */
interface CameraControlContext {
  /** The ACTIVE camera — a live getter; projection toggles swap it. */
  readonly camera: ViewerCamera
  domElement: HTMLCanvasElement
  target: Vector3
  /** Rough world radius of the loaded model, for scale-aware speeds. */
  worldRadius: number
  /** Navigable world bounds — free-movement modes clamp the camera inside. */
  worldBounds: Box3
  /** Modes call this whenever externally visible state changes. */
  notifyChange: () => void
}

/**
 * Contract every camera navigation mode implements. The ControlSystem owns
 * activation, per-frame updates and axis-lock state; modes translate those
 * into their own navigation semantics — no camera overrides, no special
 * cases at the call site.
 */
interface CameraControlMode {
  readonly id: ControlModeId

  init(context: CameraControlContext): void
  /** Mode became active. Adopt the current camera pose, attach listeners. */
  enable(): void
  /** Mode deactivated. Detach listeners, leave the camera where it is. */
  disable(): void
  update(dt: number): void
  /**
   * Honor (or release, when null) an axis lock. Each mode decides what
   * locking means for its navigation: orbit pins the view onto the axis and
   * freezes rotation; fly fixes the look direction but keeps translation.
   */
  applyAxisLock(lock: AxisLock | null): void
  /** Re-assert pose-dependent state after the camera was reframed. */
  syncWithCamera(): void
  /**
   * Idle showcase state (no document loaded). Modes that support it can
   * adapt — e.g. orbit slowly auto-rotates around the focus point.
   */
  setIdle?(idle: boolean): void
  dispose(): void
}

const AXIS_VECTORS: Record<Axis, [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}

export { AXIS_VECTORS }
export type {
  Axis,
  AxisLock,
  CameraControlContext,
  CameraControlMode,
  ControlModeId,
}
