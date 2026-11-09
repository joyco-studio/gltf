---
"gltf": patch
---

Fix a render crash (`Cannot read properties of undefined (reading 'r')`) when inspecting or hovering meshes with unlit materials. The inspect highlight is now blended over the material's final shaded color instead of injected as emissive light, so it looks consistent across every material type.
