"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { formatBytes, formatNumber } from "@/lib/format";
import type { GltfMeshInfo, GltfNodeInfo } from "@/lib/viz/inspect";

import { DataTable, type ColumnDef } from "./data-table";
import { useViewer } from "./viewer-provider";

/** A scene node joined to its mesh's stats (null for transform/group nodes). */
interface NodeRow extends GltfNodeInfo {
  mesh: GltfMeshInfo | null;
}

const columns: ColumnDef<NodeRow>[] = [
  {
    key: "name",
    header: "Name",
    cell: (node) => <span className="text-foreground">{node.name}</span>,
  },
  {
    key: "mode",
    header: "Mode",
    cell: (node) => node.mesh?.mode ?? "—",
  },
  {
    key: "vertices",
    header: "Vertices",
    align: "right",
    cell: (node) => (node.mesh ? formatNumber(node.mesh.vertexCount) : "—"),
  },
  {
    key: "indices",
    header: "Indices",
    cell: (node) => node.mesh?.indexType ?? "—",
  },
  {
    key: "attributes",
    header: "Attributes",
    className: "max-w-72 whitespace-normal",
    cell: (node) =>
      node.mesh
        ? node.mesh.attributes
            .map(({ name, type }) => `${name}:${type}`)
            .join(", ")
        : "—",
  },
  {
    key: "instances",
    header: "Instances",
    align: "right",
    cell: (node) => (node.mesh ? formatNumber(node.mesh.instances) : "—"),
  },
  {
    key: "size",
    header: "Size",
    align: "right",
    cell: (node) => (node.mesh ? formatBytes(node.mesh.size) : "—"),
  },
  {
    key: "material",
    header: "Material",
    cell: (node) =>
      node.mesh && node.mesh.materialNames.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {node.mesh.materialNames.map((name, index) => (
            <Badge
              key={node.mesh!.materialIds[index]}
              variant="muted"
              size="sm"
            >
              {name}
            </Badge>
          ))}
        </span>
      ) : (
        "—"
      ),
  },
];

/**
 * The scene graph as a collapsible outliner. Each row is a node, indented by
 * depth; nodes that reference a mesh carry its stats, transform/group nodes
 * render as empty parent rows. Rows select the exact glTF node so transform
 * information stays instance-specific; viewport picking remains mesh-based.
 */
function HierarchyTable({
  nodes,
  meshes,
}: {
  nodes: GltfNodeInfo[];
  meshes: GltfMeshInfo[];
}) {
  const { selection, select, setTab } = useViewer();

  const rows = React.useMemo<NodeRow[]>(() => {
    const meshById = new Map(meshes.map((mesh) => [mesh.id, mesh]));
    return nodes.map((node) => ({
      ...node,
      mesh: node.meshId !== null ? (meshById.get(node.meshId) ?? null) : null,
    }));
  }, [nodes, meshes]);

  return (
    <DataTable
      data={rows}
      columns={columns}
      rowId={(node) => `node-${node.id}`}
      tree={{
        depth: (node) => node.depth,
        hasChildren: (node) => node.hasChildren,
      }}
      selectedId={
        selection?.kind === "node" ? `node-${selection.id}` : null
      }
      isSelected={(node) =>
        selection?.kind === "node"
          ? node.id === selection.id
          : selection?.kind === "mesh" && node.meshId === selection.id
      }
      onRowClick={(node) => {
        setTab("contents");
        select({ kind: "node", id: node.id });
      }}
      inspectRow={(node) => ({
        selection: { kind: "node", id: node.id },
        name: node.name,
      })}
    />
  );
}

export { HierarchyTable };
