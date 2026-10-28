import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Quaternion,
  Vector3,
} from 'three/webgpu'
import { color } from 'three/tsl'

import type { InspectTarget } from '../controls/control-system'
import { Disposer } from '../disposer'
import { EventEmitter } from '../event-emitter'
import type { System } from '../system'
import type { Viewer } from '../viewer'

// red / green / blue for X / Y / Z — the universal gizmo convention
const AXIS_COLORS: Record<'x' | 'y' | 'z', string> = {
  x: '#ff3b53',
  y: '#37d067',
  z: '#2f7bff',
}
const AXIS_DIRECTIONS: Record<'x' | 'y' | 'z', Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
}

// Arrow built at unit length; the group scales it to the element's extent.
const SHAFT_RADIUS = 0.012
const HEAD_RADIUS = 0.035
const HEAD_LENGTH = 0.14
// Span relative to the model or inspected element's largest dimension.
const LENGTH_FACTOR = 0.28
// Drawn on top of everything while inspecting, like a navigation gizmo.
const RENDER_ORDER = 999

const UP = new Vector3(0, 1, 0)

/**
 * One reusable RGB triad for the world origin or an inspected element's frame.
 * Resources without one exact transform use their representative bounds.
 * Leaving element inspection falls back to world axes so the helper persists.
 */
class AxesSystem extends EventEmitter<{ change: boolean }> implements System {
  private viewer!: Viewer
  private group = new Group()
  private disposer = new Disposer()
  private enabled = false
  private worldLength = 1
  /** Whether an inspected element is currently positioned. */
  private hasTarget = false
  private inspecting: InspectTarget | null = null

  init(viewer: Viewer) {
    this.viewer = viewer
    this.group.name = 'element-axes'
    this.group.visible = false
    for (const axis of ['x', 'y', 'z'] as const)
      this.group.add(this.buildArrow(AXIS_DIRECTIONS[axis], AXIS_COLORS[axis]))
    viewer.scene.add(this.group)
    this.disposer.add(() => this.group.removeFromParent())

    // stay in sync with the inspect state — fully event-driven
    this.disposer.add(
      viewer.controls.on('change', ({ inspecting }) => this.sync(inspecting))
    )
  }

  get isVisible() {
    return this.enabled
  }

  setVisible(visible: boolean) {
    if (this.enabled === visible) return
    this.enabled = visible
    this.refresh()
    this.emit('change', visible)
  }

  toggle() {
    this.setVisible(!this.enabled)
  }

  /** Keep world axes useful across model scales, independently of inspection. */
  fit(worldRadius: number) {
    this.worldLength = Math.max(worldRadius * 2 * LENGTH_FACTOR, 0.001)
    this.refresh()
  }

  /** Use the inspected element's local frame, or the world origin otherwise. */
  private sync(inspecting: InspectTarget | null) {
    const newInspection = inspecting !== this.inspecting
    this.inspecting = inspecting
    const model = this.viewer.model
    const meshes = inspecting ? model.getMeshesForTarget(inspecting) : []
    const box = inspecting ? model.getInspectBox(inspecting) : null

    if (!box) {
      this.hasTarget = false
      this.refresh()
      return
    }

    const size = box.getSize(new Vector3())
    const maxSize = Math.max(size.x, size.y, size.z, 0.001)
    const transform =
      inspecting?.kind === 'node'
        ? model.getElementWorldTransform({
            kind: 'node',
            id: inspecting.id,
          })
        : null
    this.group.position.copy(
      transform?.position ?? box.getCenter(new Vector3())
    )
    this.group.quaternion.copy(
      transform?.quaternion ??
        model.getWorldOrientationOfMeshes(meshes) ??
        new Quaternion()
    )
    this.group.scale.setScalar(maxSize * LENGTH_FACTOR)
    this.hasTarget = true
    // Give invisible nodes a reference on entry, while allowing the user to
    // hide it for the rest of this inspection as camera changes are published.
    if (newInspection && meshes.length === 0) this.setVisible(true)
    this.refresh()
  }

  private refresh() {
    if (!this.inspecting) {
      this.group.position.set(0, 0, 0)
      this.group.quaternion.identity()
      this.group.scale.setScalar(this.worldLength)
    }
    this.group.visible = this.enabled && (!this.inspecting || this.hasTarget)
  }

  /** A colored shaft + head, with +Y rotated onto `dir`. */
  private buildArrow(dir: Vector3, hex: string): Group {
    const material = new MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    material.colorNode = color(hex)
    this.disposer.add(material)

    const shaftLength = 1 - HEAD_LENGTH
    const shaftGeometry = new CylinderGeometry(
      SHAFT_RADIUS,
      SHAFT_RADIUS,
      shaftLength,
      12
    )
    const shaft = new Mesh(shaftGeometry, material)
    shaft.position.y = shaftLength / 2
    shaft.renderOrder = RENDER_ORDER

    const headGeometry = new ConeGeometry(HEAD_RADIUS, HEAD_LENGTH, 16)
    const head = new Mesh(headGeometry, material)
    head.position.y = shaftLength + HEAD_LENGTH / 2
    head.renderOrder = RENDER_ORDER

    const arrow = new Group()
    arrow.add(shaft, head)
    arrow.quaternion.setFromUnitVectors(UP, dir)

    this.disposer.add(shaftGeometry)
    this.disposer.add(headGeometry)
    return arrow
  }

  dispose() {
    try {
      this.disposer.dispose()
    } finally {
      this.clear()
    }
  }
}

export { AxesSystem }
