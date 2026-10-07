import { Bone, Box, Boxes, Camera, Crosshair, Group, Lightbulb, type LucideIcon } from 'lucide-react'

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

const NODE_TYPE_ICONS = {
  mesh: Box,
  'skinned-mesh': Box,
  'instanced-mesh': Boxes,
  camera: Camera,
  light: Lightbulb,
  joint: Bone,
  group: Group,
  empty: Crosshair,
} satisfies Record<GltfNodeType, LucideIcon>

export { NODE_TYPE_ICONS, NODE_TYPE_LABELS }
