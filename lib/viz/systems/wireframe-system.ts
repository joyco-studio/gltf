import { Mesh, type Material, type Object3D } from 'three/webgpu'

import { Disposer } from '../disposer'
import { EventEmitter } from '../event-emitter'
import type { System } from '../system'
import type { Viewer } from '../viewer'

/** Keys typed into these never toggle the wireframe. */
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/** Point a material at the wireframe state, invalidating its pipeline only on change. */
function setWireframe(material: Material, enabled: boolean) {
  const target = material as Material & { wireframe?: boolean }
  if (target.wireframe === undefined || target.wireframe === enabled) return
  target.wireframe = enabled
  target.needsUpdate = true
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

/**
 * Whole-model wireframe view (Tab, or the toolbar toggle). Flips the
 * `wireframe` flag on the model's own materials instead of swapping them, so
 * each primitive keeps its color and the HighlightSystem's material swaps
 * stay untouched — the materials it hands out sync from `enabled` on use.
 * The state persists across model loads, like the grid toggle.
 */
class WireframeSystem extends EventEmitter<{ change: boolean }> implements System {
  private viewer!: Viewer
  private disposer = new Disposer()
  private enabled = false
  /** The loaded model's own materials, captured before any highlight swap. */
  private materials = new Set<Material>()

  init(viewer: Viewer) {
    this.viewer = viewer
    this.disposer.listen(window, 'keydown', this.onKeyDown)
  }

  get isEnabled() {
    return this.enabled
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return
    this.enabled = enabled
    for (const material of this.materials) setWireframe(material, enabled)
    // whatever is on screen right now, highlight/ghost swaps included
    for (const mesh of this.viewer.model.getAllMeshes()) {
      for (const material of materialsOf(mesh)) setWireframe(material, enabled)
    }
    this.emit('change', enabled)
  }

  toggle() {
    this.setEnabled(!this.enabled)
  }

  /** Sync a material handed out by another system (highlight, ghost). */
  sync(material: Material) {
    setWireframe(material, this.enabled)
  }

  /** Adopt a freshly loaded model, applying the current state to it. */
  bind(root: Object3D) {
    this.materials.clear()
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      for (const material of materialsOf(object)) {
        this.materials.add(material)
        setWireframe(material, this.enabled)
      }
    })
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (
      event.key !== 'Tab' ||
      event.defaultPrevented ||
      event.repeat ||
      event.shiftKey ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey ||
      !this.viewer.model.current
    ) {
      return
    }
    // leave Tab to focus navigation inside fields, dialogs and menus
    const target = event.target as Partial<Element> | null
    if (target?.closest?.(`${EDITABLE}, [role="dialog"], [role="menu"], [role="listbox"]`)) {
      return
    }
    event.preventDefault()
    this.toggle()
  }

  dispose() {
    this.materials.clear()
    this.disposer.dispose()
    this.clear()
  }
}

export { WireframeSystem }
