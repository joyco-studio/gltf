import {
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three/webgpu'
import { color, float } from 'three/tsl'

import { Disposer } from '../disposer'
import { EventEmitter } from '../event-emitter'
import type { System } from '../system'
import type { Viewer } from '../viewer'

const GRID_COLOR = '#bbbbbb'
// keep the grid a quiet backdrop — it blends toward the page bg in both themes
const GRID_OPACITY = 0.28
const GRID_SIZE = 100
const GRID_DIVISIONS = 100
// wide enough to survive AA coverage at the idle viewing distance — quad
// lines thin with perspective, unlike the constant-1px raster of GridHelper
const GRID_LINE_WIDTH = 0.01
// crosses sit at every other grid intersection, skipping the origin
const CROSS_COUNT = 23
const CROSS_LINE_WIDTH = 0.026
const CROSS_HEIGHT = 0.5

const FLAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
const UNIT = new Vector3(1, 1, 1)

/** Lay a plane flat on the ground, spun by `roll` within the ground plane. */
function flatQuaternion(roll: number) {
  return new Quaternion()
    .setFromAxisAngle(new Vector3(0, 0, 1), roll)
    .premultiply(FLAT)
}

/**
 * Floor grid ported from the joyco scissor-clip experiment's FloorGrid:
 * grid lines + instanced "+" crosses at every other intersection, with the
 * very center kept clear. Both lines and crosses are instanced thin quads —
 * line primitives are unreliable across WebGPU/WebGL backends, planes are
 * not. Shown by default; the UI toggles it through the same snapshot/event
 * pattern as the other systems.
 */
class GridSystem extends EventEmitter<{ change: boolean }> implements System {
  private group = new Group()
  private disposer = new Disposer()

  init(viewer: Viewer) {
    this.group.name = 'floor-grid'
    this.group.add(this.buildLines(), this.buildCrosses())
    viewer.scene.add(this.group)
    this.disposer.add(() => this.group.removeFromParent())
  }

  get isVisible() {
    return this.group.visible
  }

  setVisible(visible: boolean) {
    if (this.group.visible === visible) return
    this.group.visible = visible
    this.emit('change', visible)
  }

  toggle() {
    this.setVisible(!this.group.visible)
  }

  /** Scale the grid so it stays useful for models of any size. */
  fit(worldRadius: number) {
    this.group.scale.setScalar(Math.max(worldRadius / 8, 1))
  }

  private createMaterial() {
    // explicit node slots — classic-material opacity conversion proved
    // unreliable across backends
    const material = new MeshBasicNodeMaterial({
      depthWrite: false,
      transparent: true,
    })
    material.colorNode = color(GRID_COLOR)
    material.opacityNode = float(GRID_OPACITY)
    return this.disposer.add(material)
  }

  private buildLines() {
    const geometry = new PlaneGeometry(GRID_SIZE, GRID_LINE_WIDTH)
    const count = (GRID_DIVISIONS + 1) * 2
    const mesh = new InstancedMesh(geometry, this.createMaterial(), count)

    const matrix = new Matrix4()
    const step = GRID_SIZE / GRID_DIVISIONS
    let index = 0

    for (let i = 0; i <= GRID_DIVISIONS; i += 1) {
      const offset = -GRID_SIZE / 2 + i * step
      // line along X at z = offset
      matrix.compose(new Vector3(0, -0.02, offset), flatQuaternion(0), UNIT)
      mesh.setMatrixAt(index++, matrix)
      // line along Z at x = offset
      matrix.compose(
        new Vector3(offset, -0.02, 0),
        flatQuaternion(Math.PI / 2),
        UNIT
      )
      mesh.setMatrixAt(index++, matrix)
    }

    mesh.instanceMatrix.needsUpdate = true
    mesh.renderOrder = 0
    this.disposer.add(geometry)
    this.disposer.add(mesh)
    return mesh
  }

  private buildCrosses() {
    const geometry = new PlaneGeometry(CROSS_LINE_WIDTH, CROSS_HEIGHT)
    const center = Math.floor(CROSS_COUNT / 2)
    const count = (CROSS_COUNT * CROSS_COUNT - 1) * 2 // 2 planes per "+"
    const mesh = new InstancedMesh(geometry, this.createMaterial(), count)

    const matrix = new Matrix4()
    let index = 0

    for (let y = 0; y < CROSS_COUNT; y += 1) {
      for (let x = 0; x < CROSS_COUNT; x += 1) {
        // keep the very center clear, matching the source
        if (x === center && y === center) continue
        const position = new Vector3(
          x * 2 - center * 2,
          -0.01,
          y * 2 - center * 2
        )
        for (const roll of [0, Math.PI / 2]) {
          matrix.compose(position, flatQuaternion(roll), UNIT)
          mesh.setMatrixAt(index++, matrix)
        }
      }
    }

    mesh.instanceMatrix.needsUpdate = true
    mesh.renderOrder = 1
    this.disposer.add(geometry)
    this.disposer.add(mesh)
    return mesh
  }

  dispose() {
    try {
      this.disposer.dispose()
    } finally {
      this.clear()
    }
  }
}

export { GridSystem, GRID_COLOR }
