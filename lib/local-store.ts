import * as React from 'react'

/**
 * A typed value persisted in localStorage, shared by every component that
 * reads it and synced across tabs. Falls back to memory when storage is
 * blocked (private mode, sandboxed iframes).
 */
interface LocalStore<T> {
  get(): T
  set(next: T): void
  subscribe(listener: () => void): () => void
  /** Rendered on the server and during hydration. */
  initial: T
}

function createLocalStore<T>(
  key: string,
  parse: (raw: string | null) => T,
  initial: T
): LocalStore<T> {
  const listeners = new Set<() => void>()
  let cached: { raw: string | null; value: T } | null = null
  /** Set once a write fails (quota, blocked storage); reads then use it. */
  let fallbackRaw: string | null = null
  let storageFailed = false

  const readRaw = () => {
    if (storageFailed) return fallbackRaw
    try {
      return window.localStorage.getItem(key)
    } catch {
      storageFailed = true
      return fallbackRaw
    }
  }

  return {
    initial,
    get() {
      const raw = readRaw()
      // Stable identity per stored string, as useSyncExternalStore requires.
      if (!cached || cached.raw !== raw) cached = { raw, value: parse(raw) }
      return cached.value
    },
    set(next) {
      const raw = JSON.stringify(next)
      try {
        if (storageFailed) throw new Error('storage unavailable')
        window.localStorage.setItem(key, raw)
      } catch {
        // Keep working for this session even though nothing persists.
        storageFailed = true
        fallbackRaw = raw
      }
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      const onStorage = (event: StorageEvent) => {
        // a null key means another tab called localStorage.clear()
        if (event.key === null || event.key === key) listener()
      }
      window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(listener)
        window.removeEventListener('storage', onStorage)
      }
    },
  }
}

function useLocalStore<T>(store: LocalStore<T>): T {
  return React.useSyncExternalStore(store.subscribe, store.get, () => store.initial)
}

/** Parse stored JSON as an object, or an empty one when absent or corrupt. */
function parseRecord(raw: string | null): Record<string, unknown> {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export { createLocalStore, parseRecord, useLocalStore }
export type { LocalStore }
