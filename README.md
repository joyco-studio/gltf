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
