import { parseGlbHeader, parseGlbJsonChunk } from './parse-glb'

const GLB_HEADER_LENGTH = 20
const MAX_JSON_CHUNK_LENGTH = 4 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 10_000

type FetchGlbJsonResult =
  | { ok: true; json: unknown }
  | { ok: false; title: string; description: string; status: number }

class RemoteGlbChangedError extends Error {}

function failure(
  title: string,
  description: string,
  status: number
): FetchGlbJsonResult {
  return { ok: false, title, description, status }
}

function allowedHosts() {
  return (process.env.GLTF_VALIDATION_REMOTE_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

function hostMatches(hostname: string, pattern: string) {
  if (!pattern.startsWith('*.')) return hostname === pattern
  return hostname.endsWith(pattern.slice(1))
}

function parseRemoteUrl(source: string): URL | FetchGlbJsonResult {
  let url: URL

  try {
    url = new URL(source)
  } catch {
    return failure(
      'Invalid remote GLB URL',
      'Expected “url” to contain an absolute HTTPS URL.',
      400
    )
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    return failure(
      'Invalid remote GLB URL',
      'Remote GLB URLs must use HTTPS and cannot include credentials.',
      400
    )
  }

  const hostname = url.hostname.toLowerCase()
  if (!allowedHosts().some((pattern) => hostMatches(hostname, pattern))) {
    return failure(
      'Remote GLB host is not allowed',
      'Configure GLTF_VALIDATION_REMOTE_HOSTS to allow this R2 hostname.',
      403
    )
  }

  return url
}

async function readWindow(
  response: Response,
  offset: number,
  length: number
): Promise<ArrayBuffer> {
  if (!response.body) throw new Error('The remote response did not have a body.')

  const reader = response.body.getReader()
  const output = new Uint8Array(length)
  let position = 0
  let written = 0

  try {
    while (written < length) {
      const { done, value } = await reader.read()
      if (done) break

      const chunkStart = Math.max(0, offset - position)
      const chunkEnd = Math.min(value.length, offset + length - position)

      if (chunkEnd > chunkStart) {
        const slice = value.subarray(chunkStart, chunkEnd)
        output.set(slice, written)
        written += slice.length
      }

      position += value.length
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  if (written !== length) {
    throw new Error('The remote GLB ended before the requested bytes arrived.')
  }

  return output.buffer
}

function contentRange(response: Response) {
  const contentRange = response.headers.get('content-range')
  const match = contentRange?.match(/^bytes (\d+)-\d+\/(\d+|\*)$/i)
  return match
    ? {
        start: Number(match[1]),
        byteLength: match[2] === '*' ? null : Number(match[2]),
      }
    : null
}

function strongEtag(response: Response) {
  const etag = response.headers.get('etag')
  return etag && !/^W\//i.test(etag) ? etag : null
}

async function fetchBytes(
  url: URL,
  start: number,
  length: number,
  expectedEtag?: string
) {
  const headers: Record<string, string> = {
    'Accept-Encoding': 'identity',
    Range: `bytes=${start}-${start + length - 1}`,
  }
  if (expectedEtag) headers['If-Range'] = expectedEtag

  const response = await fetch(url, {
    headers,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const etag = strongEtag(response)
  if (expectedEtag && etag !== expectedEtag) {
    await response.body?.cancel().catch(() => undefined)
    throw new RemoteGlbChangedError()
  }

  if (response.status === 206) {
    const range = contentRange(response)
    if (range?.start !== start) {
      throw new Error('The remote server returned an unexpected byte range.')
    }
    return {
      bytes: await readWindow(response, 0, length),
      byteLength: range.byteLength,
      etag,
    }
  }

  if (response.status === 200) {
    const contentLength = response.headers.get('content-length')
    return {
      bytes: await readWindow(response, start, length),
      byteLength:
        contentLength && /^\d+$/.test(contentLength)
          ? Number(contentLength)
          : null,
      etag,
    }
  }

  throw new Error(`The remote server returned HTTP ${response.status}.`)
}

async function fetchGlbJson(source: string): Promise<FetchGlbJsonResult> {
  const parsedUrl = parseRemoteUrl(source)
  if (!(parsedUrl instanceof URL)) return parsedUrl

  try {
    const remoteHeader = await fetchBytes(parsedUrl, 0, GLB_HEADER_LENGTH)
    const header = parseGlbHeader(remoteHeader.bytes)
    if (!header.ok) {
      return failure('Invalid remote GLB', header.error, 422)
    }

    if (!remoteHeader.etag) {
      return failure(
        'Remote GLB cannot be validated safely',
        'The remote server must return a strong ETag for ranged requests.',
        502
      )
    }

    if (
      remoteHeader.byteLength !== null &&
      header.byteLength !== remoteHeader.byteLength
    ) {
      return failure(
        'Invalid remote GLB',
        'The GLB header length does not match the remote object length.',
        422
      )
    }

    if (header.jsonLength > MAX_JSON_CHUNK_LENGTH) {
      return failure(
        'Remote GLB metadata is too large',
        `The GLB JSON chunk exceeds the ${MAX_JSON_CHUNK_LENGTH / 1024 / 1024} MiB limit.`,
        413
      )
    }

    const remoteJson = await fetchBytes(
      parsedUrl,
      GLB_HEADER_LENGTH,
      header.jsonLength,
      remoteHeader.etag
    )
    if (
      remoteJson.byteLength !== null &&
      header.byteLength !== remoteJson.byteLength
    ) {
      return failure(
        'Invalid remote GLB',
        'The remote object changed while it was being validated.',
        409
      )
    }

    const parsed = parseGlbJsonChunk(remoteJson.bytes)
    return parsed.ok
      ? parsed
      : failure('Invalid remote GLB', parsed.error, 422)
  } catch (reason) {
    if (reason instanceof RemoteGlbChangedError) {
      return failure(
        'Remote GLB changed during validation',
        'Retry validation after the object has finished updating.',
        409
      )
    }

    const timedOut =
      reason instanceof DOMException && reason.name === 'TimeoutError'
    return failure(
      timedOut ? 'Remote GLB request timed out' : 'Unable to fetch remote GLB',
      timedOut
        ? 'The R2 object did not respond within 10 seconds.'
        : reason instanceof Error
          ? reason.message
          : 'The R2 object could not be downloaded.',
      timedOut ? 504 : 502
    )
  }
}

export { fetchGlbJson }
export type { FetchGlbJsonResult }
