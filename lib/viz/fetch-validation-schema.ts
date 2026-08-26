type FetchValidationSchemaResult =
  | { ok: true; text: string }
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

    return { ok: true, text: await response.text() }
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
