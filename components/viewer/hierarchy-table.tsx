"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { formatBytes, formatNumber } from "@/lib/format";
import type { GltfMeshInfo, GltfNodeInfo } from "@/lib/viz/inspect";

import { DataTable, type ColumnDef } from "./data-table";
import { NODE_TYPE_LABELS } from "./node-type";
import { useViewer } from "./viewer-provider";
import { useHiddenNodes } from "./viz-hooks";

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
    key: "type",
    header: "Type",
    cell: (node) => (
      <Badge variant="muted" size="sm">
        {NODE_TYPE_LABELS[node.objectType]}
      </Badge>
    ),
    sortValue: (node) => NODE_TYPE_LABELS[node.objectType],
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
 * information stays instance-specific, matching viewport picking.
 */
function HierarchyTable({
  nodes,
  meshes,
}: {
  nodes: GltfNodeInfo[];
  meshes: GltfMeshInfo[];
}) {
  const { viewer, hierarchyRevealRequest, selection, select, setTab } =
    useViewer();
  const hiddenNodes = useHiddenNodes();

  const rows = React.useMemo<NodeRow[]>(() => {
    const meshById = new Map(meshes.map((mesh) => [mesh.id, mesh]));
    return nodes.map((node) => ({
      ...node,
      mesh: node.meshId !== null ? (meshById.get(node.meshId) ?? null) : null,
    }));
  }, [nodes, meshes]);

  // Nodes the user hid directly, plus their descendants (hidden with them).
  const visibilityStates = React.useMemo(() => {
    const states = new Map<number, "hidden" | "inherited">();
    let hiddenDepth = Infinity;
    for (const node of rows) {
      if (node.depth <= hiddenDepth) hiddenDepth = Infinity;
      if (hiddenNodes.has(node.id)) {
        states.set(node.id, "hidden");
        hiddenDepth = Math.min(hiddenDepth, node.depth);
      } else if (node.depth > hiddenDepth) {
        states.set(node.id, "inherited");
      }
    }
    return states;
  }, [rows, hiddenNodes]);

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
        selection?.kind === "node"
          ? `node-${selection.id}`
          : selection?.kind === "mesh"
            ? `mesh-${selection.id}`
            : null
      }
      scrollRequest={hierarchyRevealRequest}
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
      visibility={{
        state: (node) => visibilityStates.get(node.id) ?? "visible",
        toggle: (node) => viewer?.visibility.toggle(node.id),
      }}
    />
  );
}

export { HierarchyTable };
