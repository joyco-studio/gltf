# gltf

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
