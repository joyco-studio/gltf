import { Euler, MathUtils, Vector3 } from 'three'

import {
  AXIS_VECTORS,
  type AxisLock,
  type CameraControlContext,
  type CameraControlMode,
} from './types'

const LOOK_SENSITIVITY = 0.0022
const ACCELERATION = 10 // 1/s — how fast velocity converges on input
// Base speed in world-radii per second; sprint lands on the same total as
// before the base bump (0.7 × 2.5 = 1.75).
const BASE_SPEED = 0.7
const SPRINT_FACTOR = 2.5
const MAX_PITCH = Math.PI / 2 - 0.001

const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'Space',
])

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
}

/**
 * Free-flight navigation: pointer-lock mouse look with WASD translation
 * relative to the view (Q/E for down/up), Shift to sprint. Speed scales with
 * the loaded model's world radius, and the wheel trims it. Axis lock fixes
 * the look direction along the axis while translation stays free.
 */
class FlyMode implements CameraControlMode {
  readonly id = 'fly' as const

  private context!: CameraControlContext
  private enabled = false
  private lock: AxisLock | null = null
  private pointerLocked = false
  private yaw = 0
  private pitch = 0
  private speedTrim = 1
  private keys = new Set<string>()
  private velocity = new Vector3()

  get isPointerLocked() {
    return this.pointerLocked
  }

  init(context: CameraControlContext) {
    this.context = context
  }

  enable() {
    this.enabled = true
    this.syncWithCamera()

    const element = this.context.domElement
    element.addEventListener('click', this.handleClick)
    document.addEventListener('pointerlockchange', this.handlePointerLockChange)
    document.addEventListener('mousemove', this.handleMouseMove)
    element.addEventListener('wheel', this.handleWheel, { passive: false })
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
    window.addEventListener('blur', this.handleBlur)
  }

  disable() {
    this.enabled = false

    const element = this.context.domElement
    element.removeEventListener('click', this.handleClick)
    document.removeEventListener(
      'pointerlockchange',
      this.handlePointerLockChange
    )
    document.removeEventListener('mousemove', this.handleMouseMove)
    element.removeEventListener('wheel', this.handleWheel)
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    window.removeEventListener('blur', this.handleBlur)

    this.keys.clear()
    this.velocity.set(0, 0, 0)
    if (document.pointerLockElement === element) document.exitPointerLock()
  }

  update(dt: number) {
    if (!this.enabled) return

    const { camera } = this.context

    // orientation — yaw/pitch own the camera while flying
    camera.quaternion.setFromEuler(new Euler(this.pitch, this.yaw, 0, 'YXZ'))

    // translation — input is in view space, moved into world space
    const input = new Vector3(
      Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
      Number(this.keys.has('KeyE') || this.keys.has('Space')) -
        Number(this.keys.has('KeyQ')),
      Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW'))
    )

    const sprinting =
      this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const speed =
      Math.max(this.context.worldRadius, 1) *
      BASE_SPEED *
      this.speedTrim *
      (sprinting ? SPRINT_FACTOR : 1)

    const desired =
      input.lengthSq() > 0
        ? input.normalize().applyQuaternion(camera.quaternion).multiplyScalar(speed)
        : new Vector3()

    // critically-damped feel: velocity eases toward the desired vector
    this.velocity.lerp(desired, 1 - Math.exp(-ACCELERATION * dt))
    // deadband: settle to an exact stop instead of drifting asymptotically
    if (desired.lengthSq() === 0 && this.velocity.lengthSq() < (speed * 1e-3) ** 2) {
      this.velocity.set(0, 0, 0)
    }
    camera.position.addScaledVector(this.velocity, dt)
    // never fly past the world bounds
    this.context.worldBounds.clampPoint(camera.position, camera.position)
  }

  applyAxisLock(lock: AxisLock | null) {
    this.lock = lock
    if (!lock) return

    // Look along the axis toward the scene, as if standing on the `sign`
    // side. Translation stays free; only the view direction is pinned.
    const direction = new Vector3(...AXIS_VECTORS[lock.axis]).multiplyScalar(
      -lock.sign
    )
    this.pitch = Math.asin(MathUtils.clamp(direction.y, -1, 1))
    this.yaw = Math.atan2(-direction.x, -direction.z)
  }

  syncWithCamera() {
    if (this.lock) {
      this.applyAxisLock(this.lock)
      return
    }
    const euler = new Euler().setFromQuaternion(
      this.context.camera.quaternion,
      'YXZ'
    )
    this.yaw = euler.y
    this.pitch = euler.x
  }

  dispose() {
    if (this.enabled) this.disable()
  }

  private handleClick = () => {
    if (this.pointerLocked) return
    try {
      // Chromium returns a promise that rejects when pointer lock is
      // unavailable (e.g. headless) — swallow both sync and async failures;
      // WASD navigation still works without mouse look.
      const result = this.context.domElement.requestPointerLock() as
        | Promise<void>
        | undefined
      result?.catch?.(() => {})
    } catch {
      // pointer lock unsupported — same fallback
    }
  }

  private handlePointerLockChange = () => {
    this.pointerLocked =
      document.pointerLockElement === this.context.domElement
    this.context.notifyChange()
  }

  private handleMouseMove = (event: MouseEvent) => {
    if (!this.pointerLocked || this.lock) return
    this.yaw -= event.movementX * LOOK_SENSITIVITY
    this.pitch = MathUtils.clamp(
      this.pitch - event.movementY * LOOK_SENSITIVITY,
      -MAX_PITCH,
      MAX_PITCH
    )
  }

  private handleWheel = (event: WheelEvent) => {
    // trim cruise speed instead of dollying — flying has no focus distance
    event.preventDefault()
    this.speedTrim = MathUtils.clamp(
      this.speedTrim * (event.deltaY > 0 ? 0.9 : 1.1),
      0.1,
      10
    )
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey) return
    if (MOVEMENT_KEYS.has(event.code) || event.code.startsWith('Shift')) {
      this.keys.add(event.code)
      if (MOVEMENT_KEYS.has(event.code)) event.preventDefault()
    }
  }

  private handleKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code)
  }

  private handleBlur = () => {
    this.keys.clear()
  }
}

export { FlyMode }
