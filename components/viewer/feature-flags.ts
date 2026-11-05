'use client'

import { createLocalStore, parseRecord, useLocalStore } from '@/lib/local-store'

/**
 * Experimental features, off by default. Activation is stored locally; a
 * `?flags=<id>,<id>` search param turns flags on (and persists them) so a
 * link can be shared with the features enabled.
 */
const FEATURE_FLAGS = [
  {
    id: 'uv-coverage',
    label: 'UV Coverage',
    description:
      'Find texels no UV ever samples, flag wasteful textures and project download savings. Adds a UV Coverage tab.',
  },
] as const

type FeatureFlagId = (typeof FEATURE_FLAGS)[number]['id']
type FeatureFlags = Readonly<Record<FeatureFlagId, boolean>>

const FLAGS_PARAM = 'flags'
const FLAG_IDS = FEATURE_FLAGS.map((flag) => flag.id) as FeatureFlagId[]
const ALL_OFF = Object.fromEntries(FLAG_IDS.map((id) => [id, false])) as FeatureFlags

const store = createLocalStore<FeatureFlags>(
  'gltf.feature-flags',
  (raw) => {
    const value = parseRecord(raw)
    return Object.fromEntries(
      FLAG_IDS.map((id) => [id, value[id] === true])
    ) as FeatureFlags
  },
  ALL_OFF
)

function urlFlags(): FeatureFlagId[] {
  const value = new URLSearchParams(window.location.search).get(FLAGS_PARAM)
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id): id is FeatureFlagId => FLAG_IDS.includes(id as FeatureFlagId))
}

/** Flags named in the URL, captured once per page load. */
let requested: FeatureFlagId[] | null = null
let merged: { stored: FeatureFlags; value: FeatureFlags } | null = null
let persisted = false

/** Stored flags, plus any the URL asks for — pure, so safe during render. */
function getFlags(): FeatureFlags {
  requested ??= typeof window !== 'undefined' ? urlFlags() : []
  const stored = store.get()
  if (requested.every((id) => stored[id])) return stored
  if (merged?.stored !== stored) {
    merged = {
      stored,
      value: { ...stored, ...Object.fromEntries(requested.map((id) => [id, true])) },
    }
  }
  return merged.value
}

function subscribe(listener: () => void) {
  // Persist URL-requested flags so they stay on once the param is gone.
  if (!persisted) {
    persisted = true
    const flags = getFlags()
    if (flags !== store.get()) store.set(flags)
  }
  return store.subscribe(listener)
}

function setFeatureFlag(id: FeatureFlagId, enabled: boolean) {
  store.set({ ...getFlags(), [id]: enabled })
  // A flag switched off must not come back on reload from the shared link.
  if (!enabled) {
    requested = (requested ?? []).filter((flag) => flag !== id)
    const params = new URLSearchParams(window.location.search)
    const remaining = urlFlags().filter((flag) => flag !== id)
    if (remaining.length) params.set(FLAGS_PARAM, remaining.join(','))
    else params.delete(FLAGS_PARAM)
    const query = params.toString()
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
  }
}

/** The current URL with `?flags=` naming every enabled flag. */
function shareUrlWithFlags(flags: FeatureFlags) {
  const url = new URL(window.location.href)
  const enabled = FLAG_IDS.filter((id) => flags[id])
  if (enabled.length) url.searchParams.set(FLAGS_PARAM, enabled.join(','))
  else url.searchParams.delete(FLAGS_PARAM)
  return url.toString()
}

const flagsStore = { ...store, get: getFlags, subscribe }

function useFeatureFlags(): FeatureFlags {
  return useLocalStore(flagsStore)
}

function useFeatureFlag(id: FeatureFlagId): boolean {
  return useFeatureFlags()[id]
}

export {
  FEATURE_FLAGS,
  setFeatureFlag,
  shareUrlWithFlags,
  useFeatureFlag,
  useFeatureFlags,
}
export type { FeatureFlagId, FeatureFlags }
