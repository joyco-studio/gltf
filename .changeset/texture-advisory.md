---
"gltf": minor
---

Add feature flags: a Feature flags dialog (from the About popover) toggles experimental features, saved on this device, and `?flags=<id>` links turn them on for whoever opens them.

Add a UV Coverage tab behind the `uv-coverage` flag. It projects each texture's UVs to find texels no triangle ever samples, flags textures under a configurable usage threshold (saved locally), overlays unused space or the UV wireframe on the preview, and projects download savings from filling or cropping the unused area. A Report button exports the findings as Markdown + JSON, ready to hand to an agent working in Blender.
