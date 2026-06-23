import {
  MeshBasicNodeMaterial,
  type Material,
  type Mesh,
  type Node,
  type NodeMaterial,
} from 'three/webgpu'
import {
  abs,
  color,
  float,
  fract,
  materialEmissive,
  screenCoordinate,
  screenDPR,
  smoothstep,
  vec3,
} from 'three/tsl'

import type { InspectTarget } from '../controls/control-system'
import type { System } from '../system'
import type { Viewer } from '../viewer'

/** Screen-space stripe rhythm, in CSS pixels. */
const STRIPE_SPACING_PX = 10
const STRIPE_WIDTH_PX = 1
/** Constant white wash over the inspected surface. */
const TINT_STRENGTH = 0.05
/** Extra glow on the diagonal lines. */
const LINE_STRENGTH = 0.18

/** Faint wash over everything else, so it reads as context, not occlusion. */
const GHOST_COLOR = '#8a8a8a'
const GHOST_OPACITY = 0.05

/**
 * Subtle white tint + fixed-pixel 45° screen-space stripes, expressed as an
 * emissive contribution on top of the material's own emissive.
 */
function createHighlightNode(): Node {
  const stripePx = float(STRIPE_SPACING_PX).mul(screenDPR)
  const linePx = float(STRIPE_WIDTH_PX).mul(screenDPR)

  const diag = screenCoordinate.x.add(screenCoordinate.y)
  const distToLine = abs(fract(diag.div(stripePx).sub(0.5)).sub(0.5))
    .mul(stripePx)
    .mul(0.7071)
  const line = smoothstep(linePx.mul(0.5), linePx, distToLine).oneMinus()

  const glow = line.mul(LINE_STRENGTH).add(TINT_STRENGTH)
  // keep the material's own emissive (typed loosely upstream) underneath
  const baseEmissive = materialEmissive as unknown as Node<'vec3'>
  return vec3(1).mul(glow).add(baseEmissive)
}

interface MaterialSwap {
  mesh: Mesh
  original: Material | Material[]
}

/**
 * Owns the visual state of inspection across the WHOLE model in one coherent
 * pass: the inspected meshes get a striped emissive highlight (their own
 * materials promoted to node pendants, no duplicate geometry); every other
 * mesh is ghosted (a single faint, depth-write-off material) so nothing
 * occludes the focus while the rest lingers as context.
 *
 * One system, one restore→apply, one captured-originals map. Splitting
 * highlight and ghosting into two listeners would let each capture the
 * other's swapped material as the "original" — across consecutive inspects
 * (a mesh ghosted now, focused next) that corrupts restore and churns
 * disposed materials through the renderer. Keeping it unified avoids that.
 */
class HighlightSystem implements System {
  private viewer!: Viewer
  private highlightNode = createHighlightNode()
  private ghost!: MeshBasicNodeMaterial
  private swaps: MaterialSwap[] = []
  /** Cache per source material so shared materials convert once per inspect. */
  private converted = new Map<Material, NodeMaterial>()
  /** The framed target (⌘K / table / pick), ghosting everything else. */
  private inspecting: InspectTarget | null = null
  /** A transient pick preview (ctrl-hover), lit without ghosting. */
  private hovered: InspectTarget | null = null
  /** Composite of both targets currently applied, so redundant calls no-op. */
  private appliedKey: string | null = null

  init(viewer: Viewer) {
    this.viewer = viewer

    // depthWrite off so ghosts never occlude; one instance covers all of them
    this.ghost = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
    })
    this.ghost.colorNode = color(GHOST_COLOR)
    this.ghost.opacityNode = float(GHOST_OPACITY)

    // stay in sync with the inspect state — fully event-driven
    viewer.controls.on('change', ({ inspecting }) => {
      this.inspecting = inspecting
      this.refresh()
    })
  }

  /**
   * Spotlight a mesh under the cursor (ctrl-hover pick preview) without
   * ghosting the rest — `null` clears it. The framed inspection, if any,
   * always wins, so its meshes never get a redundant hover swap.
   */
  setHovered(target: InspectTarget | null) {
    this.hovered = target
    this.refresh()
  }

  private keyOf(target: InspectTarget | null) {
    return target ? `${target.kind}:${target.id}` : '-'
  }

  /** Only touch materials when one of the two targets actually changes. */
  private refresh() {
    const key = `${this.keyOf(this.inspecting)}|${this.keyOf(this.hovered)}`
    if (key === this.appliedKey) return
    this.appliedKey = key
    this.apply()
  }

  private promote(material: Material): Material {
    const cached = this.converted.get(material)
    if (cached) return cached

    // the renderer's own classic→node conversion (property copy); node
    // materials come back as-is, so clone those before augmenting
    const library = this.viewer.render.renderer.library
    let nodeMaterial = library.fromMaterial(material) as NodeMaterial | null
    if (!nodeMaterial) return material
    if (nodeMaterial === (material as unknown as NodeMaterial)) {
      nodeMaterial = nodeMaterial.clone()
    }

    // emissiveNode lives on the standard/physical node classes
    ;(
      nodeMaterial as NodeMaterial & { emissiveNode: Node | null }
    ).emissiveNode = this.highlightNode
    this.converted.set(material, nodeMaterial)
    return nodeMaterial
  }

  /** Promote whichever primitives a predicate accepts; leave the rest as-is. */
  private highlight(
    original: Material | Material[],
    matches: (material: Material) => boolean
  ): Material | Material[] {
    return Array.isArray(original)
      ? original.map((entry) => (matches(entry) ? this.promote(entry) : entry))
      : matches(original)
        ? this.promote(original)
        : original
  }

  private apply() {
    this.restore()
    const { inspecting, hovered } = this
    if (!inspecting && !hovered) return

    const model = this.viewer.model
    const focused = inspecting
      ? new Set(model.getMeshesForTarget(inspecting))
      : null
    const preview = hovered
      ? new Set(model.getMeshesForTarget(hovered))
      : null

    // for material/texture inspects only the matching primitives light up —
    // other primitives of the same mesh stay untouched
    const matchesInspect = (material: Material) =>
      !inspecting || inspecting.kind === 'mesh'
        ? true
        : inspecting.kind === 'material'
          ? model.getMaterialId(material) === inspecting.id
          : model.materialUsesTexture(material, inspecting.id)

    // single pass over the whole model: every mesh starts from its true
    // original (restore ran first), so each captured `original` is genuine
    for (const mesh of model.getAllMeshes()) {
      const original = mesh.material
      if (focused?.has(mesh)) {
        mesh.material = this.highlight(original, matchesInspect)
      } else if (preview?.has(mesh)) {
        // a hovered pick preview always lights up whole
        mesh.material = this.highlight(original, () => true)
      } else if (inspecting) {
        // something is framed → everything else recedes into context
        mesh.material = this.ghost
      } else {
        // hover only, nothing framed: leave the rest of the model untouched
        continue
      }
      this.swaps.push({ mesh, original })
    }
  }

  private restore() {
    for (const { mesh, original } of this.swaps) mesh.material = original
    this.swaps = []
    for (const material of this.converted.values()) material.dispose()
    this.converted.clear()
  }

  dispose() {
    this.restore()
    this.ghost.dispose()
  }
}

export { HighlightSystem }
