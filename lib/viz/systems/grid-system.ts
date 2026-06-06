import {
  GridHelper,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type LineBasicMaterial,
} from 'three'

import { EventEmitter } from '../event-emitter'
import type { System } from '../system'
import type { Viewer } from '../viewer'

const GRID_COLOR = '#bbbbbb'
// keep the grid a quiet backdrop — it blends toward the page bg in both themes
const GRID_OPACITY = 0.28
const GRID_SIZE = 100
const GRID_DIVISIONS = 100
// crosses sit at every other grid intersection, skipping the origin
const CROSS_COUNT = 23
const CROSS_LINE_WIDTH = 0.026
const CROSS_HEIGHT = 0.5

/**
 * Floor grid ported from the joyco scissor-clip experiment's FloorGrid
 * (r3f/drei there, plain three.js here): a GridHelper backed by instanced
 * "+" crosses at every other intersection, with the very center kept clear.
 * Shown by default; the UI toggles it through the same snapshot/event
 * pattern as the other systems.
 */
class GridSystem extends EventEmitter<{ change: boolean }> implements System {
  private group = new Group()
  private disposables: { dispose(): void }[] = []

  init(viewer: Viewer) {
    this.group.name = 'floor-grid'
    this.group.add(this.buildLines(), this.buildCrosses())
    viewer.scene.add(this.group)
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

  private buildLines() {
    const grid = new GridHelper(
      GRID_SIZE,
      GRID_DIVISIONS,
      GRID_COLOR,
      GRID_COLOR
    )
    // GridHelper bakes colors into vertex colors — disable and drive the
    // material color directly, like the source experiment does.
    const material = grid.material as LineBasicMaterial
    material.vertexColors = false
    material.color.set(GRID_COLOR)
    material.transparent = true
    material.opacity = GRID_OPACITY
    material.needsUpdate = true
    grid.position.y = -0.02
    grid.renderOrder = 0
    this.disposables.push(grid.geometry, material)
    return grid
  }

  private buildCrosses() {
    const geometry = new PlaneGeometry(CROSS_LINE_WIDTH, CROSS_HEIGHT)
    const material = new MeshBasicMaterial({
      color: GRID_COLOR,
      depthWrite: false,
      transparent: true,
      opacity: GRID_OPACITY,
    })

    const center = Math.floor(CROSS_COUNT / 2)
    const count = (CROSS_COUNT * CROSS_COUNT - 1) * 2 // 2 planes per "+"
    const mesh = new InstancedMesh(geometry, material, count)

    const matrix = new Matrix4()
    const quaternion = new Quaternion()
    const flat = new Quaternion()
    const scale = new Vector3(1, 1, 1)
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
          // lay the plane flat, then spin it in-plane to form the "+"
          quaternion
            .setFromAxisAngle(new Vector3(0, 0, 1), roll)
            .premultiply(flat.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2))
          matrix.compose(position, quaternion, scale)
          mesh.setMatrixAt(index, matrix)
          index += 1
        }
      }
    }

    mesh.instanceMatrix.needsUpdate = true
    mesh.renderOrder = 1
    this.disposables.push(geometry, material, mesh)
    return mesh
  }

  dispose() {
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables = []
    this.clear()
  }
}

export { GridSystem, GRID_COLOR }
