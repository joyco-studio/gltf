'use client'

import * as React from 'react'

import { createLocalStore, parseRecord, useLocalStore } from '@/lib/local-store'
import {
  DEFAULT_ENVIRONMENT_PRESET,
  isEnvironmentPresetId,
  type EnvironmentPresetId,
} from '@/lib/viz/environment-presets'
import { DEFAULT_ENVIRONMENT_SNAPSHOT } from '@/lib/viz/systems/environment-system'
import {
  DEFAULT_TONE_MAPPING,
  isToneMappingMode,
  type ToneMappingMode,
} from '@/lib/viz/systems/tone-mapping-system'
import type { Viewer } from '@/lib/viz/viewer'

import { useViewer } from './viewer-provider'

/**
 * Renderer preferences that survive reloads. An uploaded environment can't
 * be persisted, so only the last chosen preset is remembered.
 */
interface RendererSettings {
  environment: EnvironmentPresetId
  intensity: number
  rotation: number
  toneMapping: ToneMappingMode
  exposure: number
}

const DEFAULT_RENDERER_SETTINGS: RendererSettings = {
  environment: DEFAULT_ENVIRONMENT_PRESET,
  intensity: DEFAULT_ENVIRONMENT_SNAPSHOT.intensity,
  rotation: DEFAULT_ENVIRONMENT_SNAPSHOT.rotation,
  toneMapping: DEFAULT_TONE_MAPPING.mode,
  exposure: DEFAULT_TONE_MAPPING.exposure,
}

const finiteOr = (value: unknown, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const settingsStore = createLocalStore<RendererSettings>(
  'gltf.renderer.settings',
  (raw) => {
    const value = parseRecord(raw)
    const defaults = DEFAULT_RENDERER_SETTINGS
    return {
      environment: isEnvironmentPresetId(value.environment)
        ? value.environment
        : defaults.environment,
      intensity: finiteOr(value.intensity, defaults.intensity),
      rotation: finiteOr(value.rotation, defaults.rotation),
      toneMapping: isToneMappingMode(value.toneMapping)
        ? value.toneMapping
        : defaults.toneMapping,
      exposure: finiteOr(value.exposure, defaults.exposure),
    }
  },
  DEFAULT_RENDERER_SETTINGS
)

const panelOpenStore = createLocalStore<boolean>(
  'gltf.renderer.panel-open',
  (raw) => raw === 'true',
  false
)

/** Whether the renderer settings panel is expanded, remembered per device. */
function useRendererPanelOpen() {
  return [useLocalStore(panelOpenStore), panelOpenStore.set] as const
}

function applyRendererSettings(viewer: Viewer, settings: RendererSettings) {
  // compare against what's lighting the scene *or* already on its way
  const { active, load } = viewer.environment.getSnapshot()
  const requested = load.phase === 'loading' ? load.source : active
  if (
    load.phase === 'error' ||
    requested.kind !== 'preset' ||
    requested.id !== settings.environment
  ) {
    viewer.environment.setPreset(settings.environment)
  }
  viewer.environment.setIntensity(settings.intensity)
  viewer.environment.setRotation(settings.rotation)
  viewer.toneMapping.setMode(settings.toneMapping)
  viewer.toneMapping.setExposure(settings.exposure)
}

/** Restore every renderer setting (and the default lighting) at once. */
function resetRendererSettings(viewer: Viewer) {
  applyRendererSettings(viewer, DEFAULT_RENDERER_SETTINGS)
}

/**
 * The viewer systems own the live renderer state; this mirrors it into
 * localStorage and replays it once when a viewer attaches.
 */
function RendererSettingsPersistence() {
  const { viewer } = useViewer()

  React.useEffect(() => {
    if (!viewer) return
    applyRendererSettings(viewer, settingsStore.get())

    const save = () => {
      const environment = viewer.environment.getSnapshot()
      const toneMapping = viewer.toneMapping.getSnapshot()
      settingsStore.set({
        environment:
          environment.active.kind === 'preset'
            ? environment.active.id
            : settingsStore.get().environment,
        intensity: environment.intensity,
        rotation: environment.rotation,
        toneMapping: toneMapping.mode,
        exposure: toneMapping.exposure,
      })
    }
    const offEnvironment = viewer.environment.on('change', save)
    const offToneMapping = viewer.toneMapping.on('change', save)
    return () => {
      offEnvironment()
      offToneMapping()
    }
  }, [viewer])

  return null
}

export { RendererSettingsPersistence, resetRendererSettings, useRendererPanelOpen }
