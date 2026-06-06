import {
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  type Vector3,
} from 'three'

import { EventEmitter } from '../event-emitter'
import type { System } from '../system'

type ProjectionMode = 'perspective' | 'orthographic'
type ViewerCamera = PerspectiveCamera | OrthographicCamera

/**
 * Owns both projections and keeps them in sync with the drawing surface.
 * Switching preserves the apparent framing: persp → ortho matches the
 * frustum height seen at the focus distance; ortho → persp converts the
 * effective zoom back into a camera distance. Navigation lives in the
 * ControlSystem — this system never *navigates* the camera.
 */
class CameraSystem
  extends EventEmitter<{ change: ProjectionMode }>
  implements System
{
  readonly perspective: PerspectiveCamera
  readonly orthographic: OrthographicCamera

  private projection: ProjectionMode = 'perspective'
  private aspect = 1
  private orthoHalfHeight = 5

  constructor() {
    super()
    this.perspective = new PerspectiveCamera(50, 1, 0.01, 1000)
    // idle vantage: ~8 units out, ~35° above the horizon
    this.perspective.position.set(4.6, 4.6, 4.6)
    this.orthographic = new OrthographicCamera(-5, 5, 5, -5, 0.01, 1000)
  }

  /** The active camera — consumers must read this per frame, not cache it. */
  get camera(): ViewerCamera {
    return this.projection === 'perspective'
      ? this.perspective
      : this.orthographic
  }

  get mode(): ProjectionMode {
    return this.projection
  }

  private get halfFovTan() {
    return Math.tan(MathUtils.degToRad(this.perspective.fov / 2))
  }

  /** Camera distance that fits `size` vertically in the perspective view. */
  fitDistance(size: number) {
    return size / (2 * this.halfFovTan)
  }

  setProjection(mode: ProjectionMode, target: Vector3) {
    if (this.projection === mode) return

    if (mode === 'orthographic') {
      const from = this.perspective
      // match the frustum height seen at the focus distance
      const distance = from.position.distanceTo(target)
      this.orthoHalfHeight = this.halfFovTan * Math.max(distance, 0.001)
      this.orthographic.zoom = 1
      this.orthographic.near = from.near
      this.orthographic.far = from.far
      this.orthographic.position.copy(from.position)
      this.orthographic.quaternion.copy(from.quaternion)
      this.applyOrthoFrustum()
    } else {
      const from = this.orthographic
      // ortho dolly zooms instead of moving — fold zoom back into distance
      const effectiveHalfHeight = this.orthoHalfHeight / from.zoom
      const distance = effectiveHalfHeight / this.halfFovTan
      const direction = from.position.clone().sub(target)
      if (direction.lengthSq() === 0) direction.set(1, 0.6, 1)
      this.perspective.position
        .copy(target)
        .addScaledVector(direction.normalize(), distance)
      this.perspective.quaternion.copy(from.quaternion)
    }

    this.projection = mode
    this.emit('change', mode)
  }

  /** Applied on model reframe — keeps both projections sized to the scene. */
  setFrame(distance: number) {
    const near = Math.max(distance / 100, 0.001)
    const far = distance * 100

    this.perspective.near = near
    this.perspective.far = far
    this.perspective.updateProjectionMatrix()

    this.orthoHalfHeight = this.halfFovTan * distance
    this.orthographic.zoom = 1
    this.orthographic.near = near
    this.orthographic.far = far
    this.applyOrthoFrustum()
  }

  private applyOrthoFrustum() {
    const halfHeight = this.orthoHalfHeight
    this.orthographic.top = halfHeight
    this.orthographic.bottom = -halfHeight
    this.orthographic.left = -halfHeight * this.aspect
    this.orthographic.right = halfHeight * this.aspect
    this.orthographic.updateProjectionMatrix()
  }

  resize(width: number, height: number) {
    this.aspect = width / Math.max(height, 1)
    this.perspective.aspect = this.aspect
    this.perspective.updateProjectionMatrix()
    this.applyOrthoFrustum()
  }

  dispose() {
    this.clear()
  }
}

export { CameraSystem }
export type { ProjectionMode, ViewerCamera }
