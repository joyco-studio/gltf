import { Vector3 } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import {
  AXIS_VECTORS,
  type AxisLock,
  type CameraControlContext,
  type CameraControlMode,
} from './types'

/**
 * The typical orbit navigation: polar rotation around the focus point with
 * dolly on wheel (and pan, which moves the shared target). Axis lock snaps
 * the camera onto the axis at the current distance and freezes rotation —
 * dolly/pan stay live.
 */
class OrbitMode implements CameraControlMode {
  readonly id = 'orbit' as const

  private context!: CameraControlContext
  private controls!: OrbitControls
  private lock: AxisLock | null = null

  init(context: CameraControlContext) {
    this.context = context
    this.controls = new OrbitControls(context.camera, context.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.autoRotateSpeed = 0.75 // slow horizontal drift while idle
    // Share the focus point: panning mutates it for every mode.
    this.controls.target = context.target
    this.controls.enabled = false
  }

  setIdle(idle: boolean) {
    this.controls.autoRotate = idle
  }

  enable() {
    this.controls.enabled = true
    this.controls.update()
  }

  disable() {
    this.controls.enabled = false
  }

  update() {
    if (this.controls.enabled) this.controls.update()
  }

  applyAxisLock(lock: AxisLock | null) {
    this.lock = lock
    this.controls.enableRotate = lock === null
    if (lock) this.snapToAxis(lock)
  }

  syncWithCamera() {
    // The active camera may have been swapped (projection toggle).
    if (this.controls.object !== this.context.camera) {
      this.controls.object = this.context.camera
    }
    // Reframing moved the camera/target; re-assert the lock pose if any.
    if (this.lock) this.snapToAxis(this.lock)
    this.controls.update()
  }

  private snapToAxis(lock: AxisLock) {
    const { camera, target } = this.context
    const distance = camera.position.distanceTo(target)
    const direction = new Vector3(...AXIS_VECTORS[lock.axis]).multiplyScalar(
      lock.sign
    )
    camera.position.copy(target).addScaledVector(direction, distance)
    camera.lookAt(target)
    this.controls.update()
  }

  dispose() {
    this.controls.dispose()
  }
}

export { OrbitMode }
