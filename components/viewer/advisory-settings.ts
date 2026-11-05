'use client'

import { createLocalStore, parseRecord, useLocalStore } from '@/lib/local-store'

type AdvisoryOverlay = 'unused' | 'wire' | 'off'

interface AdvisorySettings {
  /** Utilization (0–100) below which a texture is flagged. */
  threshold: number
  overlay: AdvisoryOverlay
}

const DEFAULT_ADVISORY_SETTINGS: AdvisorySettings = {
  threshold: 85,
  overlay: 'unused',
}
const OVERLAYS: readonly AdvisoryOverlay[] = ['unused', 'wire', 'off']

const store = createLocalStore<AdvisorySettings>(
  'gltf.advisory.settings',
  (raw) => {
    const value = parseRecord(raw)
    const threshold = Number(value.threshold)
    return {
      threshold: Number.isFinite(threshold)
        ? Math.min(100, Math.max(0, Math.round(threshold)))
        : DEFAULT_ADVISORY_SETTINGS.threshold,
      overlay: OVERLAYS.includes(value.overlay as AdvisoryOverlay)
        ? (value.overlay as AdvisoryOverlay)
        : DEFAULT_ADVISORY_SETTINGS.overlay,
    }
  },
  DEFAULT_ADVISORY_SETTINGS
)

function updateAdvisorySettings(patch: Partial<AdvisorySettings>) {
  store.set({ ...store.get(), ...patch })
}

/** Advisory preferences, persisted in localStorage and synced across tabs. */
function useAdvisorySettings() {
  return [useLocalStore(store), updateAdvisorySettings] as const
}

export { DEFAULT_ADVISORY_SETTINGS, useAdvisorySettings }
export type { AdvisoryOverlay, AdvisorySettings }
