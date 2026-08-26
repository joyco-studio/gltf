import { fetchGlbJson } from '@/lib/viz/fetch-glb-json'
import { parseGlbJson } from '@/lib/viz/parse-glb'
import { validateGltf, type GltfValidationResult } from '@/lib/viz/validate'

const JSON_CONTENT_TYPES = new Set(['application/json', 'model/gltf+json'])
const GLB_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'model/gltf-binary',
])

function json(results: GltfValidationResult[], status = 200) {
  return Response.json(results, { status })
}

function requestError(title: string, description: string, status = 400) {
  return json([{ type: 'error', title, description }], status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function validateJsonRequest(request: Request) {
  let source: unknown

  try {
    source = await request.json()
  } catch {
    return requestError(
      'Invalid JSON request body',
      'Expected the request body to contain a valid glTF JSON document or remote GLB URL.'
    )
  }

  if (isRecord(source) && 'url' in source) {
    if (typeof source.url !== 'string' || !source.url) {
      return requestError(
        'Invalid remote GLB URL',
        'Expected “url” to contain an absolute HTTPS URL.'
      )
    }

    const remote = await fetchGlbJson(source.url)
    return remote.ok
      ? json(validateGltf(remote.json))
      : requestError(remote.title, remote.description, remote.status)
  }

  return json(validateGltf(source))
}

async function validateRequest(request: Request) {
  const contentType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase()

  if (!contentType || !JSON_CONTENT_TYPES.has(contentType)) {
    if (contentType && GLB_CONTENT_TYPES.has(contentType)) {
      const parsed = parseGlbJson(await request.arrayBuffer())
      return parsed.ok
        ? json(validateGltf(parsed.json))
        : requestError('Invalid GLB request body', parsed.error)
    }

    return requestError(
      'Unsupported content type',
      'Send glTF JSON as application/json or model/gltf+json, or a GLB as model/gltf-binary.',
      415
    )
  }

  return validateJsonRequest(request)
}

function withCors(response: Response) {
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return response
}

export async function POST(request: Request) {
  return withCors(await validateRequest(request))
}

export function OPTIONS() {
  return withCors(new Response(null, { status: 204 }))
}
