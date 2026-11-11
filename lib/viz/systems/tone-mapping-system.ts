import type { Node } from 'three/webgpu'
import {
  acesFilmicToneMapping,
  agxToneMapping,
  cineonToneMapping,
  Fn,
  If,
  linearToneMapping,
  neutralToneMapping,
  reinhardToneMapping,
  renderGroup,
  uniform,
  vec3,
} from 'three/tsl'

import { EventEmitter } from '../event-emitter'
import type { System } from '../system'

const TONE_MAPPING_MODES = [
  { id: 'none', label: 'None' },
  { id: 'linear', label: 'Linear' },
  { id: 'reinhard', label: 'Reinhard' },
  { id: 'cineon', label: 'Cineon' },
  { id: 'aces', label: 'ACES Filmic' },
  { id: 'agx', label: 'AgX' },
  { id: 'neutral', label: 'Khronos Neutral' },
] as const

type ToneMappingMode = (typeof TONE_MAPPING_MODES)[number]['id']

interface ToneMappingSnapshot {
  mode: ToneMappingMode
  exposure: number
}

const DEFAULT_TONE_MAPPING: ToneMappingSnapshot = {
  mode: 'none',
  exposure: 1,
}

const MIN_EXPOSURE = 0
const MAX_EXPOSURE = 4

function isToneMappingMode(value: unknown): value is ToneMappingMode {
  return TONE_MAPPING_MODES.some(({ id }) => id === value)
}

const OPERATORS = {
  linear: linearToneMapping,
  reinhard: reinhardToneMapping,
  cineon: cineonToneMapping,
  aces: acesFilmicToneMapping,
  agx: agxToneMapping,
  neutral: neutralToneMapping,
}

/**
 * Model-only tone mapping. The renderer's own `toneMapping` is a fullscreen
 * output pass that would also curve the background dome, fog and grid off
 * the exact page theme color — so instead this exposes a TSL node that the
 * scene output (EnvironmentSystem's fog node) applies to tone-mapped
 * materials only, *before* fog blends them into the page background.
 *
 * Mode and exposure are uniforms branched on in-shader: switching never
 * recompiles a single material.
 */
class ToneMappingSystem
  extends EventEmitter<{ change: ToneMappingSnapshot }>
  implements System
{
  private snapshot = DEFAULT_TONE_MAPPING
  // renderGroup, not the default per-object group: these reach materials
  // through the scene, and three only re-uploads per-object uniforms when
  // the object or its material changed — plain glTF materials would keep
  // the values they compiled with. renderGroup refreshes every render.
  private mode = uniform(0, 'int').setGroup(renderGroup)
  private exposure = uniform(DEFAULT_TONE_MAPPING.exposure).setGroup(
    renderGroup
  )

  /** Tone-map a linear HDR color (vec3) with the current settings. */
  readonly apply = Fn(([color]: [Node<'vec3'>]) => {
    const result = vec3(color).toVar()
    // index 0 is `none` → pass-through
    for (const [index, { id }] of TONE_MAPPING_MODES.entries()) {
      if (id === 'none') continue
      If(this.mode.equal(index), () => {
        result.assign(OPERATORS[id](color, this.exposure))
      })
    }
    return result
  })

  getSnapshot(): ToneMappingSnapshot {
    return this.snapshot
  }

  setMode(mode: ToneMappingMode) {
    this.mode.value = TONE_MAPPING_MODES.findIndex(({ id }) => id === mode)
    this.set({ mode })
  }

  setExposure(exposure: number) {
    const clamped = Math.min(Math.max(exposure, MIN_EXPOSURE), MAX_EXPOSURE)
    this.exposure.value = clamped
    this.set({ exposure: clamped })
  }

  private set(partial: Partial<ToneMappingSnapshot>) {
    const next = { ...this.snapshot, ...partial }
    if (
      next.mode === this.snapshot.mode &&
      next.exposure === this.snapshot.exposure
    ) {
      return
    }
    this.snapshot = next
    this.emit('change', next)
  }

  dispose() {
    this.clear()
  }
}

export {
  DEFAULT_TONE_MAPPING,
  MAX_EXPOSURE,
  MIN_EXPOSURE,
  TONE_MAPPING_MODES,
  ToneMappingSystem,
  isToneMappingMode,
}
export type { ToneMappingMode, ToneMappingSnapshot }
