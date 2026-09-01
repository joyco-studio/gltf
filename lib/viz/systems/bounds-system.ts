import {
  BackSide,
  Box3,
  BoxGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  Vector3,
  type Node,
} from 'three/webgpu'
import {
  abs,
  cameraPosition,
  ceil,
  clamp,
  color,
  exp2,
  float,
  fract,
  fwidth,
  log2,
  max,
  normalLocal,
  positionWorld,
  screenDPR,
  select,
  smoothstep,
} from 'three/tsl'

import { Disposer } from '../disposer'
import type { System } from '../system'
import type { Viewer } from '../viewer'
import { GRID_COLOR } from './grid-system'

/** Half-extent of the visible bounds box on every axis, centered at origin. */
const WORLD_HALF_EXTENT = 15
/**
 * The navigable clamp stops slightly inside the visual wall, so the camera
 * near-plane can never reach (and cull) the wall it is being stopped by.
 */
const WALL_CLEARANCE = 0.75
/** How close (world units) the camera must get before a wall fades in. */
const FADE_RANGE = 6
/** Target on-screen stripe rhythm in CSS pixels. */
const STRIPE_SPACING_PX = 28
const STRIPE_WIDTH_PX = 1.75
/** Smallest world-space stripe period (the LOD ladder is ×2 steps of this). */
const STRIPE_BASE_PERIOD = 0.5
const WARN_COLOR = '#ff3b30'

/**
 * TSL build of the wall shader: proximity fade, world-anchored 45° stripes
 * with adaptive power-of-2 LOD pinned to a fixed pixel rhythm, heating from
 * grid-gray to red on approach. cameraPosition/screenDPR are builtins, so
 * the material needs no per-frame uniform updates.
 */
function createWallMaterial() {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: BackSide, // walls face inward — visible from inside the box
    fog: false, // proximity drives visibility, not scene fog
  })

  // fade the wall in as the camera approaches this fragment
  const dist = positionWorld.sub(cameraPosition).length()
  const proximity = smoothstep(
    float(FADE_RANGE * 0.2),
    float(FADE_RANGE),
    dist
  ).oneMinus()

  // 45° diagonal coordinate in the wall plane (world-anchored — stripes
  // parallax with the wall). The normal axis is constant, mask it out.
  const nrm = abs(normalLocal)
  const planeUV = select(
    nrm.x.greaterThan(0.5),
    positionWorld.yz,
    select(nrm.y.greaterThan(0.5), positionWorld.xz, positionWorld.xy)
  )
  const diag = planeUV.x.add(planeUV.y).mul(0.7071)

  // adaptive LOD: pick the power-of-2 world period that lands closest to
  // the target pixel rhythm, cross-fading finer stripes in on approach
  const stripePx = float(STRIPE_SPACING_PX).mul(screenDPR)
  const linePx = float(STRIPE_WIDTH_PX).mul(screenDPR)
  const unitsPerPx = max(fwidth(diag), 1e-6)
  const t = log2(stripePx.mul(unitsPerPx).div(STRIPE_BASE_PERIOD))
  const lod = ceil(t)
  const periodCoarse = exp2(lod).mul(STRIPE_BASE_PERIOD)
  const refine = clamp(lod.sub(t), 0, 1)

  // crisp line of linePx pixels around each multiple of period
  const stripeMask = (period: Node<'float'>) => {
    const distPx = abs(fract(diag.div(period).sub(0.5)).sub(0.5))
      .mul(period)
      .div(unitsPerPx)
    return smoothstep(linePx.mul(0.5), linePx, distPx).oneMinus()
  }

  const line = max(
    stripeMask(periodCoarse),
    stripeMask(periodCoarse.mul(0.5)).mul(refine)
  )

  // grid-gray at the fade horizon, mixing to warning red on approach
  material.colorNode = color(GRID_COLOR)
    .mul(proximity.oneMinus())
    .add(color(WARN_COLOR).mul(proximity))
  material.opacityNode = proximity.mul(line.mul(0.86).add(0.04))
  return material
}

/**
 * The navigable world bounds. Navigation modes clamp the camera against
 * `clampBox` (inset by WALL_CLEARANCE); the visual walls at ±15 render as
 * proximity-fading 45° stripes that heat from grid-gray to red.
 */
class BoundsSystem implements System {
  /** Visual wall box. */
  readonly box = new Box3(
    new Vector3(-WORLD_HALF_EXTENT, -WORLD_HALF_EXTENT, -WORLD_HALF_EXTENT),
    new Vector3(WORLD_HALF_EXTENT, WORLD_HALF_EXTENT, WORLD_HALF_EXTENT)
  )
  /** Camera clamp box — the wall box inset so the near plane never culls it. */
  readonly clampBox = this.box.clone().expandByScalar(-WALL_CLEARANCE)

  private mesh!: Mesh
  private material!: MeshBasicNodeMaterial
  private disposer = new Disposer()

  init(viewer: Viewer) {
    this.material = createWallMaterial()
    this.mesh = new Mesh(
      new BoxGeometry(
        WORLD_HALF_EXTENT * 2,
        WORLD_HALF_EXTENT * 2,
        WORLD_HALF_EXTENT * 2
      ),
      this.material
    )
    this.mesh.name = 'world-bounds'
    this.mesh.renderOrder = 2
    this.mesh.frustumCulled = false
    viewer.scene.add(this.mesh)
    this.disposer.add(this.material)
    this.disposer.add(this.mesh.geometry)
    this.disposer.add(() => this.mesh.removeFromParent())

    // The walls only constrain (and so only matter visually in) fly mode —
    // orbit never reaches them. Track the active mode and show them to match.
    const sync = (mode: string) => {
      this.mesh.visible = mode === 'fly'
    }
    sync(viewer.controls.getSnapshot().mode)
    this.disposer.add(viewer.controls.on('change', ({ mode }) => sync(mode)))
  }

  dispose() {
    this.disposer.dispose()
  }
}

export { BoundsSystem }
