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
import {
  EMPTY_SKELETON_SNAPSHOT,
  type SkeletonSnapshot,
} from '@/lib/viz/systems/skeleton-system'
import type { CameraPreview } from '@/lib/viz/systems/camera-preview-system'
import { EMPTY_VISIBILITY_SNAPSHOT } from '@/lib/viz/systems/visibility-system'

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

/** React's view into the coordinate helper's visibility. */
function useAxesVisible(): boolean {
  const { viewer } = useViewer()

  return React.useSyncExternalStore(
    React.useMemo(
      () =>
        viewer
          ? (onStoreChange: () => void) =>
              viewer.axes.on('change', onStoreChange)
          : noopSubscribe,
      [viewer]
    ),
    viewer ? () => viewer.axes.isVisible : () => false,
    () => false
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

const getEmptySkeleton = () => EMPTY_SKELETON_SNAPSHOT

/** React's view into the SkeletonSystem overlay state. */
function useSkeletonState(): SkeletonSnapshot {
  const { viewer } = useViewer()

  return React.useSyncExternalStore(
    React.useMemo(
      () =>
        viewer
          ? (onStoreChange: () => void) =>
              viewer.skeleton.on('change', onStoreChange)
          : noopSubscribe,
      [viewer]
    ),
    viewer ? () => viewer.skeleton.getSnapshot() : getEmptySkeleton,
    getEmptySkeleton
  )
}

const getEmptyVisibility = () => EMPTY_VISIBILITY_SNAPSHOT

/** React's view into the glTF node indices the user hid. */
function useHiddenNodes(): ReadonlySet<number> {
  const { viewer } = useViewer()

  return React.useSyncExternalStore(
    React.useMemo(
      () =>
        viewer
          ? (onStoreChange: () => void) =>
              viewer.visibility.on('change', onStoreChange)
          : noopSubscribe,
      [viewer]
    ),
    viewer ? () => viewer.visibility.getSnapshot() : getEmptyVisibility,
    getEmptyVisibility
  )
}

const getNoPreview = () => null

/** React's view into the camera the viewport is looking through, if any. */
function useCameraPreview(): CameraPreview | null {
  const { viewer } = useViewer()

  return React.useSyncExternalStore(
    React.useMemo(
      () =>
        viewer
          ? (onStoreChange: () => void) =>
              viewer.cameraPreview.on('change', onStoreChange)
          : noopSubscribe,
      [viewer]
    ),
    viewer ? () => viewer.cameraPreview.getSnapshot() : getNoPreview,
    getNoPreview
  )
}

export {
  useAnimationsState,
  useCameraPreview,
  useAxesVisible,
  useControlsState,
  useGridVisible,
  useSkeletonState,
  useHiddenNodes,
}
