import type { Material, Mesh, Node, NodeMaterial } from 'three/webgpu'
import {
  abs,
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
 * Marks the item under inspection by augmenting the emissive channel of the
 * meshes' OWN materials: each classic material is promoted to its node
 * pendant (the same conversion the renderer applies internally) with an
 * extra emissive node — no duplicate geometry, no z-fighting. Originals are
 * restored untouched on exit.
 */
class HighlightSystem implements System {
  private viewer!: Viewer
  private highlightNode = createHighlightNode()
  private swaps: MaterialSwap[] = []
  /** Cache per source material so shared materials convert once per inspect. */
  private converted = new Map<Material, NodeMaterial>()

  init(viewer: Viewer) {
    this.viewer = viewer
    // stay in sync with the inspect state — fully event-driven
    viewer.controls.on('change', ({ inspecting }) => {
      this.apply(inspecting)
    })
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

  private apply(target: InspectTarget | null) {
    this.restore()
    if (target === null) return

    const model = this.viewer.model
    const meshes =
      target.kind === 'mesh'
        ? model.getMeshObjects(target.id)
        : target.kind === 'material'
          ? model.getMeshesUsingMaterial(target.id)
          : model.getMeshesUsingTexture(target.id)

    // for material/texture targets only the matching materials light up —
    // other primitives of the same mesh stay untouched
    const matches = (material: Material) =>
      target.kind === 'mesh'
        ? true
        : target.kind === 'material'
          ? model.getMaterialId(material) === target.id
          : model.materialUsesTexture(material, target.id)

    for (const mesh of meshes) {
      const original = mesh.material
      mesh.material = Array.isArray(original)
        ? original.map((entry) =>
            matches(entry) ? this.promote(entry) : entry
          )
        : matches(original)
          ? this.promote(original)
          : original
      this.swaps.push({ mesh, original })
    }
  }

  private restore() {
    for (const { mesh, original } of this.swaps) {
      mesh.material = original
    }
    this.swaps = []
    for (const material of this.converted.values()) material.dispose()
    this.converted.clear()
  }

  dispose() {
    this.restore()
  }
}

export { HighlightSystem }
