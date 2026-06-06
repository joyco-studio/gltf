type Listener<T> = (payload: T) => void

/**
 * Minimal typed event emitter used by viz instances so the React layer
 * (or any other consumer) can subscribe without coupling to three.js.
 */
class EventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>()

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener<never>)
    return () => this.off(event, listener)
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
    this.listeners.get(event)?.delete(listener as Listener<never>)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]) {
    this.listeners.get(event)?.forEach((listener) => {
      ;(listener as Listener<Events[K]>)(payload)
    })
  }

  clear() {
    this.listeners.clear()
  }
}

export { EventEmitter }
