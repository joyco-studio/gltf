import {
  InstancedMesh,
  Mesh,
  SkinnedMesh,
  Texture,
  type Material,
  type Object3D,
} from 'three/webgpu'

interface Disposable {
  dispose(): void
}

type Teardown = Disposable | (() => void)

function toCleanup(teardown: Teardown) {
  return typeof teardown === 'function'
    ? teardown
    : () => teardown.dispose()
}

/**
 * An owner-local teardown stack. Registrations unwind in reverse order so
 * dependants are detached before the resources they use. Disposal is
 * idempotent, and anything registered after teardown is disposed immediately
 * (important for async renderer/asset work that resolves after unmount).
 */
class Disposer implements Disposable {
  private cleanups: (() => void)[] = []
  private _disposed = false

  get disposed() {
    return this._disposed
  }

  add<T extends Teardown>(teardown: T): T {
    const cleanup = toCleanup(teardown)
    if (this._disposed) cleanup()
    else this.cleanups.push(cleanup)
    return teardown
  }

  listen<T extends Event>(
    target: EventTarget,
    type: string,
    listener: (event: T) => void,
    options?: AddEventListenerOptions | boolean
  ) {
    const eventListener = listener as EventListener
    target.addEventListener(type, eventListener, options)
    this.add(() => target.removeEventListener(type, eventListener, options))
  }

  dispose() {
    if (this._disposed) return
    this._disposed = true

    const errors: unknown[] = []
    for (let index = this.cleanups.length - 1; index >= 0; index -= 1) {
      try {
        this.cleanups[index]()
      } catch (error) {
        errors.push(error)
      }
    }
    this.cleanups = []

    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple errors occurred during teardown')
    }
  }
}

function collectUniformTextures(
  value: unknown,
  textures: Set<Texture>,
  visited: Set<object>
) {
  if (value instanceof Texture) {
    textures.add(value)
    return
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return

  visited.add(value)
  if (Array.isArray(value)) {
    for (const entry of value) collectUniformTextures(entry, textures, visited)
    return
  }
  for (const entry of Object.values(value)) {
    collectUniformTextures(entry, textures, visited)
  }
}

/**
 * Releases resources owned by a loaded scene graph. This intentionally covers
 * model-local resources only; scene environments, render targets and shared
 * caches must stay with their explicit owners.
 */
function disposeObject3D(root: Object3D) {
  const geometries = new Set<Disposable>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  const skeletons = new Set<Disposable>()
  const instances = new Set<InstancedMesh>()

  root.removeFromParent()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return

    geometries.add(object.geometry)
    const entries = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of entries) materials.add(material)

    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton)
    if (object instanceof InstancedMesh) instances.add(object)
  })

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) textures.add(value)
    }

    const uniforms = (material as Material & {
      uniforms?: Record<string, { value?: unknown }>
    }).uniforms
    if (uniforms) {
      const visited = new Set<object>()
      for (const uniform of Object.values(uniforms)) {
        collectUniformTextures(uniform.value, textures, visited)
      }
    }
  }

  for (const instance of instances) instance.dispose()
  for (const skeleton of skeletons) skeleton.dispose()
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) texture.dispose()
}

export { Disposer, disposeObject3D }
export type { Disposable, Teardown }
