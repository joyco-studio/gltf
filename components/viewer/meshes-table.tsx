'use client'

import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { formatBytes, formatNumber } from '@/lib/format'
import type { GltfMeshInfo } from '@/lib/viz/inspect'

import { DataTable, type ColumnDef } from './data-table'
import { useViewer } from './viewer-provider'

const columns: ColumnDef<GltfMeshInfo>[] = [
  {
    key: 'id',
    header: 'ID',
    cell: (mesh) => mesh.id,
    sortValue: (mesh) => mesh.id,
  },
  {
    key: 'name',
    header: 'Name',
    cell: (mesh) => <span className="text-foreground">{mesh.name}</span>,
    sortValue: (mesh) => mesh.name,
  },
  {
    key: 'mode',
    header: 'Mode',
    cell: (mesh) => mesh.mode,
    sortValue: (mesh) => mesh.mode,
  },
  {
    key: 'vertices',
    header: 'Vertices',
    align: 'right',
    cell: (mesh) => formatNumber(mesh.vertexCount),
    sortValue: (mesh) => mesh.vertexCount,
  },
  {
    key: 'indices',
    header: 'Indices',
    cell: (mesh) => mesh.indexType ?? '—',
    sortValue: (mesh) => mesh.indexType ?? '',
  },
  {
    key: 'attributes',
    header: 'Attributes',
    className: 'max-w-72 whitespace-normal',
    cell: (mesh) =>
      mesh.attributes
        .map(({ name, type }) => `${name}:${type}`)
        .join(', '),
  },
  {
    key: 'instances',
    header: 'Instances',
    align: 'right',
    cell: (mesh) => formatNumber(mesh.instances),
    sortValue: (mesh) => mesh.instances,
  },
  {
    key: 'size',
    header: 'Size',
    align: 'right',
    cell: (mesh) => formatBytes(mesh.size),
    sortValue: (mesh) => mesh.size,
  },
  {
    key: 'material',
    header: 'Material',
    sortValue: (mesh) => mesh.materialNames.join(', '),
    cell: (mesh) =>
      mesh.materialNames.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {mesh.materialNames.map((name, index) => (
            <Badge key={mesh.materialIds[index]} variant="muted" size="sm">
              {name}
            </Badge>
          ))}
        </span>
      ) : (
        '—'
      ),
  },
]

function MeshesTable({ meshes }: { meshes: GltfMeshInfo[] }) {
  const { selection, select, setTab } = useViewer()

  return (
    <DataTable
      data={meshes}
      columns={columns}
      rowId={(mesh) => `mesh-${mesh.id}`}
      selectedId={
        selection?.kind === 'mesh' ? `mesh-${selection.id}` : null
      }
      onRowClick={(mesh) => {
        // Clicking a mesh's material chip area still selects the mesh row;
        // jumping to the material happens through search or the material table.
        setTab('contents')
        select({ kind: 'mesh', id: mesh.id })
      }}
    />
  )
}

export { MeshesTable }
