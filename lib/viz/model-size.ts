interface ModelResources {
  buffers?: { uri?: string }[]
  images?: { uri?: string }[]
}

/**
 * File bytes, including external assets once; embedded assets are in the
 * root. Measured external sizes are recorded in `resourceSizes` by raw `uri`.
 */
async function getRemoteModelSize(
  json: ModelResources,
  rootSize: number | null,
  baseUrl: string,
  resourceSizes?: Map<string, number>
): Promise<number | null> {
  if (rootSize === null) return null

  const urisByUrl = new Map<string, string[]>()
  for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (resource.uri && !resource.uri.startsWith('data:')) {
      const url = new URL(resource.uri, baseUrl).href
      urisByUrl.set(url, [...(urisByUrl.get(url) ?? []), resource.uri])
    }
  }
  const urls = [...urisByUrl.keys()]

  const sizes = await Promise.all(
    urls.map(async (url) => {
      try {
        // Inspect metadata without downloading model resources a second time.
        const response = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(3000),
        })
        const length = response.headers.get('content-length')
        const encoding = response.headers.get('content-encoding')
        const size = length?.trim() ? Number(length) : NaN
        return response.ok &&
          (!encoding || encoding === 'identity') &&
          Number.isSafeInteger(size) && size >= 0
          ? size
          : null
      } catch {
        return null
      }
    })
  )

  sizes.forEach((size, index) => {
    if (size === null) return
    for (const uri of urisByUrl.get(urls[index]) ?? []) resourceSizes?.set(uri, size)
  })

  // Never label a partial sum as the total.
  return sizes.reduce<number | null>(
    (total, size) => (total === null || size === null ? null : total + size),
    rootSize
  )
}

export { getRemoteModelSize }
