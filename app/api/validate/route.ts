import { validateGltf, type GltfValidationResult } from '@/lib/viz/validate'

const JSON_CONTENT_TYPES = new Set(['application/json', 'model/gltf+json'])

function json(results: GltfValidationResult[], status = 200) {
  return Response.json(results, { status })
}

function requestError(title: string, description: string) {
  return json([{ type: 'error', title, description }], 400)
}

export async function POST(request: Request) {
  const contentType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase()

  if (!contentType || !JSON_CONTENT_TYPES.has(contentType)) {
    return json(
      [
        {
          type: 'error',
          title: 'Unsupported content type',
          description:
            'Send a glTF JSON document as application/json or model/gltf+json.',
        },
      ],
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
