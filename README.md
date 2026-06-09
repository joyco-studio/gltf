# gltf

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
- **Shareable selections** — the inspected element is encoded in the URL
  (`?path=materials.mat_1`) so links open straight to it.
- **Local & private** — files are resolved in the browser; nothing leaves the
  machine.

## Architecture

The 3D layer is plain three.js (no react-three-fiber), built as a set of
composable systems:

- `lib/viz/viewer.ts` — the `Viewer` orchestrator. Owns the scene, the system
  registry, the frame loop, and the resize observer.
- `lib/viz/systems/*` — individual `System` classes (render, camera,
  environment, grid, bounds, model, highlight, axes, animation).
- `lib/viz/controls/*` — orbit and fly control modes.
- `lib/viz/inspect.ts` — normalizes a loaded glTF document into the immutable
  snapshots the UI reads.

React is strictly a UI layer. Components subscribe to the `Viewer` through an
event emitter and read immutable snapshots via `useSyncExternalStore`
(`components/viewer/viewer-provider.tsx`) — they never touch three.js objects
directly. UI is built on shadcn primitives in `components/ui/*`.

## Getting Started

```bash
pnpm install
pnpm dev
```

Then open [gltf.joyco.studio](https://gltf.joyco.studio/) and drop in a model.
