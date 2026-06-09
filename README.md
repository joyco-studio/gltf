![gltf](https://r2.joyco.studio/github-static/gltf-repo-banner.png)

A browser-based glTF visualizer and inspector. Drag in a `.glb`/`.gltf` (with
its sibling `.bin` and texture files) and get a real-time viewport plus a
browsable, searchable breakdown of everything inside the document — meshes,
materials, textures, and animations.

Everything runs client-side; no files are uploaded.

**Live at [gltf.joyco.studio](https://gltf.joyco.studio/).**

## Features

- **WebGPU viewport** — three.js rendering via `WebGPURenderer`, with a WebGL
  fallback. Orbit and fly camera modes, environment lighting, grid, bounds, and
  element axes.
- **Contents browser** — sortable tables for meshes, materials, and animations,
  plus a texture grid. Click any row to inspect and highlight it in the scene.
- **⌘K search** — fuzzy search across every element in the document.
- **Shareable selections** — both the loaded model and the inspected element are
  encoded in the URL search params (`?url=` + `?path=`), so a link opens the same
  model framed on the same element, e.g.
  `gltf.joyco.studio/?url=https://example.com/model.glb&path=materials.mat_1`.
- **Local & private** — files are resolved in the browser; nothing leaves the
  machine.

## Getting Started

```bash
pnpm install
pnpm dev
```

Then open [gltf.joyco.studio](https://gltf.joyco.studio/) and drop in a model.
