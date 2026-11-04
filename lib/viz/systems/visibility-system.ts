import type { Object3D } from 'three/webgpu'
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js'

import { EventEmitter } from '../event-emitter'
import type { System } from '../system'

interface VisibilityEvents extends Record<string, unknown> {
  change: ReadonlySet<number>
}

const EMPTY_SNAPSHOT: ReadonlySet<number> = new Set()

/** Whether an object and every ancestor are visible, i.e. it actually renders. */
function isWorldVisible(object: Object3D) {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
  }
  return true
}

/**
 * User-driven show/hide of glTF scene nodes. Toggles `Object3D.visible` on the
 * runtime object the parser created for each node, so its subtree hides with
 * it. The snapshot is the set of node indices the user hid.
 */
class VisibilitySystem extends EventEmitter<VisibilityEvents> implements System {
  private hidden = EMPTY_SNAPSHOT
  /** Runtime objects per node, with their authored visibility to restore. */
  private nodes = new Map<number, { object: Object3D; visible: boolean }[]>()

  getSnapshot(): ReadonlySet<number> {
    return this.hidden
  }

  setHidden(nodeId: number, hidden: boolean) {
    if (this.hidden.has(nodeId) === hidden) return
    const next = new Set(this.hidden)
    if (hidden) next.add(nodeId)
    else next.delete(nodeId)
    this.hidden = next
    for (const { object, visible } of this.nodes.get(nodeId) ?? []) {
      object.visible = visible && !hidden
    }
    this.emit('change', next)
  }

  toggle(nodeId: number) {
    this.setHidden(nodeId, !this.hidden.has(nodeId))
  }

  /** Adopt a freshly loaded model; hidden state never carries across models. */
  bind(root: Object3D, associations: GLTFParser['associations']) {
    this.nodes.clear()
    root.traverse((object) => {
      const nodeId = associations.get(object)?.nodes
      if (nodeId === undefined) return
      const entries = this.nodes.get(nodeId) ?? []
      entries.push({ object, visible: object.visible })
      this.nodes.set(nodeId, entries)
    })
    this.hidden = EMPTY_SNAPSHOT
    this.emit('change', this.hidden)
  }

  dispose() {
    this.nodes.clear()
    this.clear()
  }
}

export {
  VisibilitySystem,
  EMPTY_SNAPSHOT as EMPTY_VISIBILITY_SNAPSHOT,
  isWorldVisible,
}
