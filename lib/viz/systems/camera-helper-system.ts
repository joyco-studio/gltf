import { Camera, CameraHelper } from 'three/webgpu'

import type { InspectTarget } from '../controls/control-system'
import { Disposer } from '../disposer'
import type { System } from '../system'
import type { Viewer } from '../viewer'

const HELPER_NAME = 'inspected-camera-helper'
const RENDER_ORDER = 999

/** Displays the native Three.js frustum helper while a camera node is inspected. */
class CameraHelperSystem implements System {
  private viewer!: Viewer
  private camera: Camera | null = null
  private disposer = new Disposer()
  private helper = this.disposer.add(new CameraHelper(new Camera()))

  init(viewer: Viewer) {
    this.viewer = viewer
    this.helper.name = HELPER_NAME
    this.helper.renderOrder = RENDER_ORDER
    this.helper.visible = false
    const materials = Array.isArray(this.helper.material)
      ? this.helper.material
      : [this.helper.material]
    for (const material of materials) {
      material.depthTest = false
      material.depthWrite = false
    }
    viewer.scene.add(this.helper)
    this.disposer.add(() => this.helper.removeFromParent())
    this.disposer.add(
      viewer.controls.on('change', ({ inspecting }) => this.sync(inspecting))
    )
  }

  private sync(inspecting: InspectTarget | null) {
    const camera =
      inspecting?.kind === 'node'
        ? this.viewer.model.getCameraForNode(inspecting.id)
        : null
    if (camera === this.camera) return

    this.camera = camera
    this.helper.visible = camera !== null
    if (camera) {
      this.helper.camera = camera
      this.helper.matrix = camera.matrixWorld
      this.helper.update()
    }
  }

  dispose() {
    this.disposer.dispose()
    this.camera = null
  }
}

export { CameraHelperSystem, HELPER_NAME }
