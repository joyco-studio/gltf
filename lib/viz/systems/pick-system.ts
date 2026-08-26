import { Raycaster, Vector2 } from 'three/webgpu'

import type { InspectTarget } from '../controls/control-system'
import type { System } from '../system'
import type { Viewer } from '../viewer'

/**
 * Direct picking in the viewport: while ⌘ (Cmd) is held, the mesh under the
 * cursor lights up as a preview (HighlightSystem), and clicking it inspects
 * its exact owning node — the same effect as picking that instance from the
 * hierarchy. The currently inspected node is intentionally skipped, so the
 * gesture only ever moves focus to *other* nodes.
 *
 * Raycasting is gated behind ⌘ so it never competes with plain orbit/fly
 * navigation, and only runs on actual pointer movement (or when ⌘ is first
 * pressed), never per frame.
 */
class PickSystem implements System {
  private viewer!: Viewer
  private readonly canvas: HTMLCanvasElement
  private raycaster = new Raycaster()
  private pointer = new Vector2()

  /** Last cursor position, so pressing ⌘ can preview without a move. */
  private last: { x: number; y: number } | null = null
  /** Whether the cursor is currently over the canvas. */
  private inside = false
  private metaActive = false
  private hovered: InspectTarget | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  init(viewer: Viewer) {
    this.viewer = viewer

    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointerleave', this.onPointerLeave)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  /** Resolve the frontmost glTF mesh under a viewport point, if any. */
  private pickAt(
    clientX: number,
    clientY: number
  ): (InspectTarget & { kind: 'node' }) | null {
    const model = this.viewer.model
    const meshes = model.getAllMeshes()
    if (meshes.length === 0) return null

    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(this.pointer, this.viewer.camera.camera)

    // sorted near→far; the first hit that maps to a document node wins
    for (const hit of this.raycaster.intersectObjects(meshes, false)) {
      const target = model.getNodeTargetForObject(hit.object)
      if (target) return target
    }
    return null
  }

  /** glTF node currently framed for inspection, if it is a node target. */
  private get inspectedNodeId(): number | null {
    const inspecting = this.viewer.controls.getSnapshot().inspecting
    return inspecting?.kind === 'node' ? inspecting.id : null
  }

  /** Re-evaluate the hover preview against the last known cursor position. */
  private updateHover() {
    if (!this.metaActive || !this.inside || this.last === null) {
      this.clearHover()
      return
    }

    const pick = this.pickAt(this.last.x, this.last.y)
    // never preview the node that's already framed — ⌘-hover only ever
    // points at another node to switch to
    const target =
      pick && pick.id !== this.inspectedNodeId ? pick : null

    this.setHover(target)
    this.canvas.style.cursor = target ? 'pointer' : ''
  }

  private setHover(target: InspectTarget | null) {
    this.hovered = target
    this.viewer.highlight.setHovered(target)
  }

  private clearHover() {
    if (this.hovered) this.setHover(null)
    this.canvas.style.cursor = ''
  }

  private onPointerMove = (event: PointerEvent) => {
    this.last = { x: event.clientX, y: event.clientY }
    this.inside = true
    this.metaActive = event.metaKey
    this.updateHover()
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.metaKey) return
    this.last = { x: event.clientX, y: event.clientY }
    this.metaActive = true

    const pick = this.pickAt(event.clientX, event.clientY)
    if (!pick || pick.id === this.inspectedNodeId) return

    // claim the gesture: this is an inspect, not the start of an orbit drag
    event.preventDefault()
    this.clearHover()
    this.viewer.inspectItem(pick.kind, pick.id, pick.name)
    this.viewer.emit('pick', pick)
  }

  private onPointerLeave = () => {
    this.inside = false
    this.clearHover()
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!event.metaKey) return
    this.metaActive = true
    this.updateHover()
  }

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.metaKey) return
    this.metaActive = false
    this.clearHover()
  }

  private onBlur = () => {
    this.metaActive = false
    this.clearHover()
  }

  dispose() {
    this.clearHover()
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }
}

export { PickSystem }
