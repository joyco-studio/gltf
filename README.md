![gltf](https://r2.joyco.studio/github-static/gltf-repo-banner.png)

A browser-based glTF visualizer and inspector. Drag in a `.glb`/`.gltf` (with
its sibling `.bin` and texture files) and get a real-time viewport plus a
browsable, searchable breakdown of everything inside the document — meshes,
materials, textures, and animations.

The viewer runs client-side; no files are uploaded.

**Live at [gltf.joyco.studio](https://gltf.joyco.studio/).**

## Features

- **WebGPU viewport** — three.js rendering via `WebGPURenderer`, with a WebGL
  fallback. Orbit and fly camera modes, environment lighting, grid, bounds, and
  element axes.
- **Contents browser** — sortable tables for meshes, materials, and animations,
  plus a texture grid. Click any row to inspect and highlight it in the scene.
- **⌘K search** — fuzzy search across every element in the document.
- **Shareable viewer state** — the loaded model, inspected element, and active
  sidebar tab are encoded in the URL search params (`?url=`, `?path=`, and
  `?tab=`), so a link reopens the same view, e.g.
  `gltf.joyco.studio/?url=https://example.com/model.glb&tab=validation`.
- **Local & private** — files are resolved in the browser; nothing leaves the
  machine.

## Validation API

External services can validate a glTF JSON document without using the viewer:

```sh
curl -X POST https://gltf.joyco.studio/api/validate \
  -H 'Content-Type: model/gltf+json' \
  --data-binary @model.gltf
```

Binary `.glb` documents use the same endpoint:

```sh
curl -X POST https://gltf.joyco.studio/api/validate \
  -H 'Content-Type: model/gltf-binary' \
  --data-binary @model.glb
```

For GLBs larger than the hosting platform's request limit, send an HTTPS URL
to the object instead. The validator fetches only the GLB header and structured
JSON chunk, so embedded textures and binary buffers are not downloaded:

```sh
curl -X POST https://gltf.joyco.studio/api/validate \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://r2.joyco.studio/models/model.glb"}'
```

Remote validation is disabled until `GLTF_VALIDATION_REMOTE_HOSTS` contains a
comma-separated allowlist of R2 hostnames. Wildcard entries such as
`*.r2.dev` are supported. The object response must include a strong ETag so
both reads are pinned to the same object version.

The endpoint returns a JSON array. The browser inspector calls the same
environment-neutral validator, so both surfaces share one result contract and
one source of validation rules:

```json
[
  {
    "type": "warning",
    "title": "2 nodes share the name “Duplicate”",
    "description": "Nodes #0, #1 use the same name. …"
  }
]
```

Valid documents without findings return `[]`. Request and remote-fetch failures
return the same result shape with an appropriate non-2xx status. The viewer
itself remains client-side and does not call this API or upload models.

### Custom validation schemas

The Validation tab accepts a pasted or uploaded JSON schema and applies it to
the current model without uploading the asset. The same schema can be sent to
the API in a `{ "document", "schema" }` envelope:

```json
{
  "document": {
    "asset": { "version": "2.0" },
    "meshes": [
      { "name": "Body" },
      { "name": "Frame" },
      { "name": "Glass" }
    ]
  },
  "schema": {
    "$schema": "https://gltf.joyco.studio/validation-schema.json",
    "version": 1,
    "rules": [
      {
        "id": "required-code-meshes",
        "path": "$.meshes[*].name",
        "operator": "includesAll",
        "value": ["Body", "Frame", "Glass", "Screen"],
        "level": "error",
        "title": "Required meshes are missing",
        "message": "The model must expose every mesh targeted by the application."
      }
    ]
  }
}
```

This produces one error naming `Screen` as the missing value. To require
exactly four meshes as well, add a `count` rule using `"path": "$.meshes[*]"`
and `"value": 4`.

Paths are standard [RFC 9535 JSONPath](https://www.rfc-editor.org/rfc/rfc9535)
queries. For example, `$.materials[*].alphaMode` resolves every material's
alpha mode, and `$.meshes[?length(@.primitives) > 1].name` selects the names
of meshes with multiple primitives. Version 1 supports these operators:

- `exists` with a boolean value
- `count` with a non-negative integer value (the number of resolved matches)
- `includesAll` and `includesAny` with a non-empty array value
- `unique` (no value)
- `equals` and `notEquals` with any JSON value
- `matches` with a linear-time, RE2-compatible regular-expression string of up
  to 256 characters and optional `i`, `m`, `s`, or `u` flags. Backreferences
  and lookaround assertions are not supported.
- `lessThan`, `lessThanOrEqual`, `greaterThan`, and `greaterThanOrEqual` with a
  numeric value

Rules default to `"level": "error"`; set it to `"warning"` for advisory
checks. Optional `title` and `message` fields customize the resulting finding.
Failed rules are appended to the built-in findings and use the same errors,
warnings, and inspectable-reference UI.

Remote GLBs use the existing URL envelope with an added schema:

```json
{
  "url": "https://r2.example.com/model.glb",
  "schema": {
    "version": 1,
    "rules": [
      {
        "id": "four-meshes",
        "path": "$.meshes[*]",
        "operator": "count",
        "value": 4
      }
    ]
  }
}
```

The schema's own JSON Schema is published at
[`/validation-schema.json`](https://gltf.joyco.studio/validation-schema.json).
