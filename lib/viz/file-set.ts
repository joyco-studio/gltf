import { LoadingManager } from 'three/webgpu'

/**
 * Resolves a set of user-provided files (drag & drop or file picker) into a
 * loadable glTF source: the root .glb/.gltf plus a LoadingManager that
 * rewrites relative resource URIs (.bin buffers, texture images) to object
 * URLs of their sibling files.
 */

interface GltfFileSet {
  rootFile: File
  manager: LoadingManager
  /** Object URL of the root file — pass to GLTFLoader.load. */
  rootUrl: string
  /** Revoke every object URL created for this set. */
  revoke: () => void
}

function isGltfRoot(file: File) {
  return /\.(glb|gltf)$/i.test(file.name)
}

function createGltfFileSet(files: File[]): GltfFileSet | null {
  // Prefer .glb over .gltf if both are present (self-contained wins).
  const rootFile =
    files.find((file) => /\.glb$/i.test(file.name)) ??
    files.find((file) => /\.gltf$/i.test(file.name))

  if (!rootFile) return null

  const byName = new Map(files.map((file) => [file.name, file]))
  const objectUrls: string[] = []

  const createUrl = (file: File) => {
    const url = URL.createObjectURL(file)
    objectUrls.push(url)
    return url
  }

  const manager = new LoadingManager()
  manager.setURLModifier((url) => {
    if (url.startsWith('data:')) return url
    // Relative URIs inside the .gltf reference sibling files by name. The
    // loader resolves them against the (blob:) root URL, so match on the
    // last path segment rather than the full URL.
    const name = decodeURIComponent(url.split('/').pop() ?? '')
    const file = byName.get(name)
    return file ? createUrl(file) : url
  })

  return {
    rootFile,
    manager,
    rootUrl: createUrl(rootFile),
    revoke: () => {
      for (const url of objectUrls) URL.revokeObjectURL(url)
      objectUrls.length = 0
    },
  }
}

export { createGltfFileSet, isGltfRoot }
export type { GltfFileSet }
