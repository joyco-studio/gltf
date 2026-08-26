import {
  parseGltfValidationSchema,
  type GltfValidationSchema,
} from './validation-schema'

type FetchValidationSchemaResult =
  | { ok: true; schema: GltfValidationSchema; url: string }
  | { ok: false; error: string }

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
  fetcher: typeof fetch = fetch
): Promise<FetchValidationSchemaResult> {
  const url = parseSchemaUrl(source)
  if (!url) {
    return {
      ok: false,
      error: 'Enter an absolute HTTP or HTTPS schema URL.',
    }
  }

  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    if (!response.ok) {
      return {
        ok: false,
        error: `The schema URL returned HTTP ${response.status}.`,
      }
    }

    let source: unknown
    try {
      source = await response.json()
    } catch {
      return { ok: false, error: 'The loaded schema is not valid JSON.' }
    }

    const parsed = parseGltfValidationSchema(source)
    return parsed.ok
      ? { ok: true, schema: parsed.schema, url: url.href }
      : { ok: false, error: parsed.errors.join(' ') }
  } catch {
    return {
      ok: false,
      error:
        'The schema could not be loaded. Check that the URL is reachable and allows cross-origin requests.',
    }
  }
}

export { fetchValidationSchema }
export type { FetchValidationSchemaResult }
