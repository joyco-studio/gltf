'use client'

import * as React from 'react'

import {
  DEFAULT_CONTROLS_SNAPSHOT,
  type ControlsSnapshot,
} from '@/lib/viz/controls/control-system'
import {
  EMPTY_ANIMATIONS_SNAPSHOT,
  type AnimationsSnapshot,
} from '@/lib/viz/systems/animation-system'

import { useViewer } from './viewer-provider'

const noopSubscribe = () => () => {}
const getDefaultSnapshot = () => DEFAULT_CONTROLS_SNAPSHOT

/** React's view into the ControlSystem instance. */
function useControlsState(): ControlsSnapshot {
  const { viewer } = useViewer()

  return React.useSyncExternalStore(
    React.useMemo(
      () =>
        viewer
          ? (onStoreChange: () => void) =>
              viewer.controls.on('change', onStoreChange)
          : noopSubscribe,
      [viewer]
    ),
    viewer ? () => viewer.controls.getSnapshot() : getDefaultSnapshot,
    getDefaultSnapshot
  )
}

/** React's view into the GridSystem visibility. */
function useGridVisible(): boolean {
  const { viewer } = useViewer()

  return React.useSyncExternalStore(
    React.useMemo(
      () =>
        viewer
          ? (onStoreChange: () => void) =>
              viewer.grid.on('change', onStoreChange)
          : noopSubscribe,
      [viewer]
    ),
    viewer ? () => viewer.grid.isVisible : () => true,
    () => true
  )
}

const getEmptyAnimations = () => EMPTY_ANIMATIONS_SNAPSHOT

/** React's view into the AnimationSystem playback state. */
function useAnimationsState(): AnimationsSnapshot {
  const { viewer } = useViewer()

  return React.useSyncExternalStore(
    React.useMemo(
      () =>
        viewer
          ? (onStoreChange: () => void) =>
              viewer.animations.on('change', onStoreChange)
          : noopSubscribe,
      [viewer]
    ),
    viewer ? () => viewer.animations.getSnapshot() : getEmptyAnimations,
    getEmptyAnimations
  )
}

export { useAnimationsState, useControlsState, useGridVisible }
