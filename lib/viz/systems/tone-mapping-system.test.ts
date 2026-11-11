import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_TONE_MAPPING,
  MAX_EXPOSURE,
  ToneMappingSystem,
  type ToneMappingSnapshot,
} from './tone-mapping-system'

describe('ToneMappingSystem', () => {
  it('starts untouched and emits one snapshot per actual change', () => {
    const system = new ToneMappingSystem()
    const changes: ToneMappingSnapshot[] = []
    system.on('change', (snapshot) => changes.push(snapshot))

    assert.deepEqual(system.getSnapshot(), DEFAULT_TONE_MAPPING)
    system.setMode('agx')
    system.setMode('agx') // no-op
    system.setExposure(1.5)

    assert.deepEqual(changes, [
      { mode: 'agx', exposure: 1 },
      { mode: 'agx', exposure: 1.5 },
    ])
    assert.equal(system.getSnapshot(), changes.at(-1))
  })

  it('clamps exposure into the supported range', () => {
    const system = new ToneMappingSystem()
    system.setExposure(99)
    assert.equal(system.getSnapshot().exposure, MAX_EXPOSURE)
    system.setExposure(-1)
    assert.equal(system.getSnapshot().exposure, 0)
  })
})
