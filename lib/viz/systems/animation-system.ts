import {
  AnimationMixer,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from 'three/webgpu'

import { EventEmitter } from '../event-emitter'
import type { System } from '../system'

interface AnimationsSnapshot {
  /** Clip indices that are actively advancing (running and not paused). */
  playing: number[]
}

const EMPTY_SNAPSHOT: AnimationsSnapshot = { playing: [] }

/**
 * Owns the AnimationMixer for the loaded model. Clips play as infinite
 * loops; toggling pauses in place (the pose freezes — handy for inspecting
 * a specific frame). Multiple clips may run concurrently.
 */
class AnimationSystem
  extends EventEmitter<{ change: AnimationsSnapshot }>
  implements System
{
  private mixer: AnimationMixer | null = null
  private actions: AnimationAction[] = []
  private snapshot: AnimationsSnapshot = EMPTY_SNAPSHOT

  getSnapshot(): AnimationsSnapshot {
    return this.snapshot
  }

  /** Adopt the clips of a freshly loaded model (replaces any previous). */
  bind(clips: AnimationClip[], root: Object3D) {
    this.mixer?.stopAllAction()
    this.mixer = clips.length > 0 ? new AnimationMixer(root) : null
    this.actions = clips.map((clip) => this.mixer!.clipAction(clip))
    this.publish()
  }

  /** Cycle a clip: stopped → playing → paused → resumed ... */
  toggle(id: number) {
    const action = this.actions[id]
    if (!action) return

    // note: isRunning() is false while paused — branch on paused first so
    // resuming continues from the frozen time instead of restarting
    if (action.paused) {
      action.paused = false
    } else if (action.isRunning()) {
      action.paused = true
    } else {
      // exclusive playback: starting a clip stops every other one
      for (const other of this.actions) {
        if (other !== action) other.stop()
      }
      action.reset().play()
    }
    this.publish()
  }

  /** Ensure a clip is actively playing (exclusive); no-op if it already is. */
  play(id: number) {
    const action = this.actions[id]
    if (!action || this.isPlaying(id)) return

    for (const other of this.actions) {
      if (other !== action) other.stop()
    }
    if (action.paused) {
      action.paused = false
    } else {
      action.reset().play()
    }
    this.publish()
  }

  isPlaying(id: number) {
    const action = this.actions[id]
    return Boolean(action && action.isRunning() && !action.paused)
  }

  /** Normalized clip progress (0..1); 0 when stopped. Holds while paused. */
  getProgress(id: number) {
    const action = this.actions[id]
    if (!action || (!action.isRunning() && !action.paused)) return 0
    const duration = action.getClip().duration
    return duration > 0 ? (action.time % duration) / duration : 0
  }

  update(dt: number) {
    this.mixer?.update(dt)
  }

  private publish() {
    this.snapshot = {
      playing: this.actions
        .map((action, id) => (this.isPlaying(id) ? id : -1))
        .filter((id) => id >= 0),
    }
    this.emit('change', this.snapshot)
  }

  dispose() {
    this.mixer?.stopAllAction()
    this.mixer = null
    this.actions = []
    this.clear()
  }
}

export { AnimationSystem, EMPTY_SNAPSHOT as EMPTY_ANIMATIONS_SNAPSHOT }
export type { AnimationsSnapshot }
