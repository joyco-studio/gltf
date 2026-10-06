import { LoaderUtils } from 'three/webgpu'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

import type { GltfTextureInfo } from './inspect'

/** Read the encoded image, preserving its original resolution and format. */
async function getTextureBlob(
  texture: GltfTextureInfo,
  gltf: GLTF,
  files: File[] = []
): Promise<Blob> {
  if (texture.bufferView !== null) {
    const bytes = await gltf.parser.getDependency('bufferView', texture.bufferView)
    return new Blob([bytes], { type: texture.mimeType ?? '' })
  }

  if (!texture.uri) throw new Error('This texture has no image source.')

  if (!texture.uri.startsWith('data:')) {
    const name = decodeURIComponent(texture.uri.split('/').pop() ?? '')
    const file = files.find((file) => file.name === name)
    if (file) return file
  }

  const response = await fetch(
    LoaderUtils.resolveURL(texture.uri, gltf.parser.options.path),
    {
      headers: gltf.parser.options.requestHeader,
      credentials: gltf.parser.fileLoader.withCredentials
        ? 'include'
        : 'same-origin',
    }
  )
  if (!response.ok) throw new Error('Could not download this texture. Try again.')
  return response.blob()
}

function textureFileName(texture: GltfTextureInfo, blob: Blob): string {
  const extensions: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/ktx2': 'ktx2',
  }
  const extension = extensions[blob.type] ?? extensions[texture.mimeType ?? '']
  const name =
    texture.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() ||
    `texture_${texture.id}`
  if (!extension) return name
  return `${name.replace(/\.(png|jpe?g|webp|avif|ktx2)$/i, '')}.${extension}`
}

export { getTextureBlob, textureFileName }
