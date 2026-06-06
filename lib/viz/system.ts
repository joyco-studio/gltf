import type { Viewer } from './viewer'

/**
 * Contract every viz system implements. The Viewer owns the lifecycle and
 * calls into systems in registration order — systems never reach into each
 * other directly except through the Viewer context handed to `init`.
 */
interface System {
  /** Called once after every system is constructed and registered. */
  init?(viewer: Viewer): void
  /** Called every frame with the elapsed delta in seconds. */
  update?(dt: number): void
  /** Called when the drawing surface size changes (CSS pixels). */
  resize?(width: number, height: number, dpr: number): void
  /** Tear down GPU resources, listeners, observers. */
  dispose?(): void
}

export type { System }
