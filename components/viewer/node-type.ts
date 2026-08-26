import type { GltfNodeType } from '@/lib/viz/inspect'

const NODE_TYPE_LABELS = {
  mesh: 'Mesh',
  'skinned-mesh': 'Skinned mesh',
  'instanced-mesh': 'Instanced mesh',
  camera: 'Camera',
  light: 'Light',
  joint: 'Joint',
  group: 'Group',
  empty: 'Empty',
} satisfies Record<GltfNodeType, string>

export { NODE_TYPE_LABELS }
