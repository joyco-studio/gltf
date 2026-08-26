import {
  parseGltfValidationSchema,
  type GltfValidationSchema,
} from './validation-schema'

const MAX_VALIDATION_SCHEMA_BYTES = 1024 * 1024
const VALIDATION_SCHEMA_TIMEOUT_MS = 10_000

type FetchValidationSchemaResult =
  | { ok: true; schema: GltfValidationSchema; url: string }
  | { ok: false; error: string }

interface FetchValidationSchemaOptions {
  fetcher?: typeof fetch
  maxBytes?: number
  signal?: AbortSignal
  timeoutMs?: number
}

class ValidationSchemaTooLargeError extends Error {}

function parseSchemaUrl(source: string) {
  try {
    const url = new URL(source.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

async function fetchValidationSchema(
  source: string,
  {
    fetcher = fetch,
    maxBytes = MAX_VALIDATION_SCHEMA_BYTES,
    signal,
    timeoutMs = VALIDATION_SCHEMA_TIMEOUT_MS,
  }: FetchValidationSchemaOptions = {}
): Promise<FetchValidationSchemaResult> {
  const url = parseSchemaUrl(source)
  if (!url) {
    return {
      ok: false,
      error: 'Enter an absolute HTTP or HTTPS schema URL.',
    }
  }

  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
    timeoutMs
  )

  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        ok: false,
        error: `The schema URL returned HTTP ${response.status}.`,
      }
    }

    const text = await readResponseText(response, maxBytes)
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(text)
    } catch {
      return { ok: false, error: 'The loaded schema is not valid JSON.' }
    }

    const parsed = parseGltfValidationSchema(parsedJson)
    return parsed.ok
      ? { ok: true, schema: parsed.schema, url: url.href }
      : { ok: false, error: parsed.errors.join(' ') }
  } catch (reason) {
    if (reason instanceof ValidationSchemaTooLargeError) {
      return {
        ok: false,
        error: `The validation schema exceeds the ${maxBytes / 1024 / 1024} MiB limit.`,
      }
    }
    if (controller.signal.aborted) {
      return {
        ok: false,
        error:
          controller.signal.reason instanceof DOMException &&
          controller.signal.reason.name === 'TimeoutError'
            ? 'The validation schema request timed out.'
            : 'The validation schema request was cancelled.',
      }
    }
    return {
      ok: false,
      error:
        'The schema could not be loaded. Check that the URL is reachable and allows cross-origin requests.',
    }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

async function readResponseText(response: Response, maxBytes: number) {
  const contentLength = response.headers.get('content-length')
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > maxBytes
  ) {
    await response.body?.cancel().catch(() => undefined)
    throw new ValidationSchemaTooLargeError()
  }

  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maxBytes) {
        await reader.cancel()
        throw new ValidationSchemaTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export { fetchValidationSchema }
export {
  MAX_VALIDATION_SCHEMA_BYTES,
  VALIDATION_SCHEMA_TIMEOUT_MS,
}
export type { FetchValidationSchemaOptions, FetchValidationSchemaResult }
