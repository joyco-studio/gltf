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

export async function POST(request: Request) {
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

  try {
    return json(validateGltf(await request.json()))
  } catch {
    return requestError(
      'Invalid JSON request body',
      'Expected the request body to contain a valid glTF JSON document.'
    )
  }
}
