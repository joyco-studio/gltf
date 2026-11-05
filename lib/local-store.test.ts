import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { createLocalStore } from './local-store'

function installStorage(storage: Partial<Storage>) {
  Object.assign(globalThis, {
    window: { localStorage: storage, addEventListener() {}, removeEventListener() {} },
  })
}

describe('createLocalStore', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('round-trips through localStorage', () => {
    const data = new Map<string, string>()
    installStorage({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    })
    const store = createLocalStore('k', (raw) => (raw ? JSON.parse(raw) : 0), 0)
    store.set(3)
    assert.equal(store.get(), 3)
    assert.equal(data.get('k'), '3')
  })

  it('keeps working in memory once writes fail (quota exceeded)', () => {
    installStorage({
      getItem: () => '1',
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    const store = createLocalStore('k', (raw) => (raw ? JSON.parse(raw) : 0), 0)
    assert.equal(store.get(), 1)
    store.set(5)
    assert.equal(store.get(), 5)
  })
})
