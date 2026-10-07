---
"gltf": minor
---

Add hierarchy validation to the glTF viewer and validation API using the existing version 1 rule format. Use `hasChildren` for required direct children, `hasDescendants` for nested nodes, `hasPath` for scene-rooted named paths, and `matchesTree` for exact unordered subtrees. Rules resolve original node names across glTF references, report inspectable findings, and detect malformed node graphs. The published validation schema and documentation now describe each operator's value format.
