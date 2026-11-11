# gltf

## 0.7.0

### Minor Changes

- 492f9c9: Add a Renderer settings panel (top right, shown while nothing is inspected): pick an environment map from built-in presets or upload/drop your own `.hdr` / `.exr`, tweak its intensity and rotation, and choose a tone-mapping curve with exposure. Tone mapping applies to the model only, so the background and grid keep matching the page theme. Settings are remembered per device.

### Patch Changes

- 0a8d93b: Fix a render crash (`Cannot read properties of undefined (reading 'r')`) when inspecting or hovering meshes with unlit materials. The inspect highlight is now blended over the material's final shaded color instead of injected as emissive light, so it looks consistent across every material type.

## 0.6.0

### Minor Changes

- 9bc6f35: Look through the model's cameras: right-click a camera node in the hierarchy and choose Preview camera to render the viewport from it (following its animation, masked to its authored frame). Scrolling zooms the preview; clicking the viewport or pressing ESC returns to the viewer camera; the UI stays usable while previewing. The details panel gains a Camera section for camera nodes (projection, field of view, aspect, clip planes and the live preview zoom).
- d6888ce: Add feature flags: a Feature flags dialog (from the About popover) toggles experimental features, saved on this device, and `?flags=<id>` links turn them on for whoever opens them.
  
  Add a UV Coverage tab behind the `uv-coverage` flag. It projects each texture's UVs to find texels no triangle ever samples, flags textures under a configurable usage threshold (saved locally), overlays unused space or the UV wireframe on the preview, and projects download savings from filling the unused area (bleeding island colors outward) or cropping it. A Report button exports the findings as Markdown + JSON, ready to hand to an agent working in Blender.

## 0.5.0

### Minor Changes

- 99c5577: Hide and show scene nodes from the hierarchy: an eye toggle on each row and a Hide/Show action in the right-click menu toggle the node's visibility in the viewport.

### Patch Changes

- 0f4e30c: Update three.js from 0.186.1 to 0.187.0.

## 0.4.0

### Minor Changes

- e8f9f7a: Show the bone structure of rigged models: a skeleton toggle appears in the viewport toolbar for skinned models and draws Blender-style bones with joint spheres over the mesh, following animation playback. Inspecting a joint reveals the skeleton and tints the inspected joint and the bones it heads.

## 0.3.0

### Minor Changes

- 9859f4f: Add hierarchy validation to the glTF viewer and validation API using the existing version 1 rule format. Use `hasChildren` for required direct children, `hasDescendants` for nested nodes, `hasPath` for scene-rooted named paths, and `matchesTree` for exact unordered subtrees. Rules resolve original node names across glTF references, report inspectable findings, and detect malformed node graphs. The published validation schema and documentation now describe each operator's value format.
  
  Match wide sets of duplicate siblings without recursive reassignment, and return a clear schema error for expected trees deeper than 128 node levels.
- 42f172f: Add a download action on texture hover and in the right-click menu to save the original image at full resolution, including compressed textures.

### Patch Changes

- 69681fd: Update three.js from 0.186.0 to 0.186.1.
- dbb9a66: Show KTX2 texture previews in the inspector using the existing GPU renderer, preserving image colors, transparency, and aspect ratio. Generate previews as PNG Blobs with at most two concurrent GPU jobs, and release preview URLs when their document is replaced or discarded.

## 0.2.0

### Minor Changes

- 5267af7: Expand inspected object details with local and world transforms, world bounds, runtime object types, and user data. Viewport picks now resolve to their owning glTF nodes, empty nodes remain inspectable, and inspected elements can be revealed in the hierarchy.
- 5267af7: Add custom glTF validation with RFC 9535 JSONPath rules. Validation schemas can be pasted, uploaded, loaded from a URL, shared through deep links, or supplied to the validation API, and validation findings can link directly to referenced nodes in the inspector.

### Patch Changes

- a473ea5: Set up Changesets version tracking and show the viewer version with a link to the changelog in the About popover.

## 0.1.0

### Minor Changes

- Initial tracked release of the glTF viewer.
