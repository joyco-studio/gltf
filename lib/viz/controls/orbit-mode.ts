import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import type { CameraControlContext, CameraControlMode } from './types'

/**
 * The typical orbit navigation: polar rotation around the focus point with
 * dolly on wheel (and pan, which moves the shared target).
 */
class OrbitMode implements CameraControlMode {
  readonly id = 'orbit' as const

  private context!: CameraControlContext
  private controls!: OrbitControls

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

  setMaxDistance(distance: number) {
    this.controls.maxDistance = distance
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

  syncWithCamera() {
    // The active camera may have been swapped (projection toggle).
    if (this.controls.object !== this.context.camera) {
      this.controls.object = this.context.camera
    }
    this.controls.update()
  }

  dispose() {
    this.controls.dispose()
  }
}

export { OrbitMode }
