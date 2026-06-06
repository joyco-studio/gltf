import {
  BackSide,
  Box3,
  BoxGeometry,
  Color,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three'

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

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColorFar;
  uniform vec3 uColorNear;
  uniform vec3 uCameraPos;
  uniform float uFadeRange;
  uniform float uStripePx;
  uniform float uLinePx;
  uniform float uBasePeriod;

  varying vec3 vWorldPos;
  varying vec3 vNormal;

  // crisp line of widthPx pixels around each multiple of period
  float stripeMask(float coord, float period, float unitsPerPx, float widthPx) {
    float distPx =
      abs(fract(coord / period - 0.5) - 0.5) * period / unitsPerPx;
    return 1.0 - smoothstep(widthPx * 0.5, widthPx, distPx);
  }

  void main() {
    // fade the wall in as the camera approaches this fragment
    float dist = distance(uCameraPos, vWorldPos);
    float proximity = 1.0 - smoothstep(uFadeRange * 0.2, uFadeRange, dist);
    if (proximity <= 0.001) discard;

    // 45° diagonal coordinate in the wall plane (world-anchored — stripes
    // parallax with the wall). The normal axis is constant, mask it out.
    vec3 nrm = abs(vNormal);
    vec2 planeUV = nrm.x > 0.5
      ? vWorldPos.yz
      : (nrm.y > 0.5 ? vWorldPos.xz : vWorldPos.xy);
    float diag = (planeUV.x + planeUV.y) * 0.7071;

    // adaptive LOD: pick the power-of-2 world period that lands closest to
    // the target pixel rhythm, cross-fading finer stripes in on approach
    float unitsPerPx = max(fwidth(diag), 1e-6);
    float t = log2(uStripePx * unitsPerPx / uBasePeriod);
    float lod = ceil(t);
    float periodCoarse = uBasePeriod * exp2(lod);
    float refine = clamp(lod - t, 0.0, 1.0);

    float line = max(
      stripeMask(diag, periodCoarse, unitsPerPx, uLinePx),
      stripeMask(diag, periodCoarse * 0.5, unitsPerPx, uLinePx) * refine
    );

    // grid-gray at the fade horizon, mixing to warning red on approach
    vec3 color = mix(uColorFar, uColorNear, proximity);
    float alpha = proximity * mix(0.04, 0.9, line);
    gl_FragColor = vec4(color, alpha);
  }
`

/**
 * The navigable world bounds. Navigation modes clamp the camera against
 * `clampBox` (inset by WALL_CLEARANCE); the visual walls at ±15 render as
 * proximity-fading 45° stripes that heat from grid-gray to red as you near
 * the limit.
 */
class BoundsSystem implements System {
  /** Visual wall box. */
  readonly box = new Box3(
    new Vector3(-WORLD_HALF_EXTENT, -WORLD_HALF_EXTENT, -WORLD_HALF_EXTENT),
    new Vector3(WORLD_HALF_EXTENT, WORLD_HALF_EXTENT, WORLD_HALF_EXTENT)
  )
  /** Camera clamp box — the wall box inset so the near plane never culls it. */
  readonly clampBox = this.box.clone().expandByScalar(-WALL_CLEARANCE)

  private viewer!: Viewer
  private mesh!: Mesh
  private material!: ShaderMaterial

  init(viewer: Viewer) {
    this.viewer = viewer

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColorFar: { value: new Color(GRID_COLOR) },
        uColorNear: { value: new Color(WARN_COLOR) },
        uCameraPos: { value: new Vector3() },
        uFadeRange: { value: FADE_RANGE },
        uStripePx: { value: STRIPE_SPACING_PX },
        uLinePx: { value: STRIPE_WIDTH_PX },
        uBasePeriod: { value: STRIPE_BASE_PERIOD },
      },
      transparent: true,
      depthWrite: false,
      side: BackSide, // walls face inward — visible from inside the box
      fog: false, // proximity drives visibility, not scene fog
    })

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
  }

  update() {
    const uniform = this.material.uniforms.uCameraPos.value as Vector3
    uniform.copy(this.viewer.camera.camera.position)
  }

  resize(_width: number, _height: number, dpr: number) {
    // gl_FragCoord is in device pixels — keep the rhythm in CSS pixels
    this.material.uniforms.uStripePx.value = STRIPE_SPACING_PX * dpr
    this.material.uniforms.uLinePx.value = STRIPE_WIDTH_PX * dpr
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}

export { BoundsSystem }
