# gltf

## 0.2.0

### Minor Changes

- 5267af7: Expand inspected object details with local and world transforms, world bounds, runtime object types, and user data. Viewport picks now resolve to their owning glTF nodes, empty nodes remain inspectable, and inspected elements can be revealed in the hierarchy.
- 5267af7: Add custom glTF validation with RFC 9535 JSONPath rules. Validation schemas can be pasted, uploaded, loaded from a URL, shared through deep links, or supplied to the validation API, and validation findings can link directly to referenced nodes in the inspector.

### Patch Changes

- a473ea5: Set up Changesets version tracking and show the viewer version with a link to the changelog in the About popover.

## 0.1.0

### Minor Changes

- Initial tracked release of the glTF viewer.
