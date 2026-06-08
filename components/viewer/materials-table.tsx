'use client'

import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { formatNumber } from '@/lib/format'
import type { GltfMaterialInfo } from '@/lib/viz/inspect'

import { DataTable, type ColumnDef } from './data-table'
import { useViewer } from './viewer-provider'

const columns: ColumnDef<GltfMaterialInfo>[] = [
  {
    key: 'id',
    header: 'ID',
    cell: (material) => material.id,
    sortValue: (material) => material.id,
  },
  {
    key: 'name',
    header: 'Name',
    cell: (material) => (
      <span className="text-foreground">{material.name}</span>
    ),
    sortValue: (material) => material.name,
  },
  {
    key: 'instances',
    header: 'Instances',
    align: 'right',
    cell: (material) => formatNumber(material.instances),
    sortValue: (material) => material.instances,
  },
  {
    key: 'textures',
    header: 'Textures',
    className: 'max-w-72 whitespace-normal',
    sortValue: (material) => material.textureSlots.length,
    cell: (material) =>
      material.textureSlots.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {material.textureSlots.map((slot) => (
            <Badge key={slot} variant="muted" size="sm" className="normal-case">
              {slot}
            </Badge>
          ))}
        </span>
      ) : (
        '—'
      ),
  },
  {
    key: 'alphaMode',
    header: 'Alpha mode',
    cell: (material) => material.alphaMode,
    sortValue: (material) => material.alphaMode,
  },
  {
    key: 'side',
    header: 'Side',
    cell: (material) => (material.doubleSided ? 'DOUBLE' : 'FRONT'),
    sortValue: (material) => (material.doubleSided ? 1 : 0),
  },
]

function MaterialsTable({ materials }: { materials: GltfMaterialInfo[] }) {
  const { selection, select } = useViewer()

  return (
    <DataTable
      data={materials}
      columns={columns}
      rowId={(material) => `material-${material.id}`}
      selectedId={
        selection?.kind === 'material' ? `material-${selection.id}` : null
      }
      onRowClick={(material) => select({ kind: 'material', id: material.id })}
      inspectRow={(material) => ({
        selection: { kind: 'material', id: material.id },
        name: material.name,
      })}
    />
  )
}

export { MaterialsTable }
