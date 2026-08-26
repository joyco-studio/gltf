"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { InspectContextMenu } from "./inspect-context-menu";
import type { Selection } from "./viewer-provider";

interface ColumnDef<Row> {
  key: string;
  header: string;
  cell: (row: Row) => React.ReactNode;
  /** Comparable value for ordering. Omit to make the column unsortable. */
  sortValue?: (row: Row) => string | number;
  className?: string;
  headerClassName?: string;
  align?: "left" | "right";
}

interface SortState {
  key: string;
  direction: "asc" | "desc";
}

/**
 * Turns the table into an outliner: `data` must already be in depth-first
 * order, each row reporting its `depth` and whether it `hasChildren`. Sorting
 * is disabled in this mode (it would scramble the hierarchy); the tree column
 * gets indentation and a collapse toggle. A collapsed row hides the contiguous
 * run of deeper rows that follow it.
 */
interface TreeConfig<Row> {
  depth: (row: Row) => number;
  hasChildren: (row: Row) => boolean;
  /** Column that carries the indent + toggle. Defaults to the first column. */
  columnKey?: string;
}

const INDENT_PER_DEPTH = 14; // px

function compareValues(a: string | number, b: string | number) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * Generic order-by-column table over the ui/table primitives. Owns its sort
 * state; selection/highlight stays controlled by the caller.
 */
function DataTable<Row>({
  data,
  columns,
  rowId,
  selectedId,
  isSelected,
  onRowClick,
  inspectRow,
  tree,
}: {
  data: Row[];
  columns: ColumnDef<Row>[];
  rowId: (row: Row) => string;
  selectedId?: string | null;
  /** Custom selection test — overrides `selectedId` when a row id can't carry
   * the selection (e.g. several nodes sharing one mesh in tree mode). */
  isSelected?: (row: Row) => boolean;
  onRowClick?: (row: Row) => void;
  /** Adds a right-click "Inspect" action to each row (same effect as ⌘K).
   * Return null for rows with nothing to inspect (e.g. group nodes). */
  inspectRow?: (row: Row) => { selection: Selection; name: string } | null;
  /** Render as a collapsible hierarchy instead of a flat list. */
  tree?: TreeConfig<Row>;
}) {
  const [sort, setSort] = React.useState<SortState | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(
    () => new Set(),
  );
  const selectedRowRef = React.useRef<HTMLTableRowElement>(null);

  const sorted = React.useMemo(() => {
    // tree order is meaningful — never reorder it
    if (tree || !sort) return data;
    const column = columns.find(({ key }) => key === sort.key);
    if (!column?.sortValue) return data;
    const { sortValue } = column;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...data].sort(
      (a, b) => compareValues(sortValue(a), sortValue(b)) * factor,
    );
  }, [data, columns, sort, tree]);

  const treeColumnKey = tree ? (tree.columnKey ?? columns[0]?.key) : null;

  // A jump from elsewhere in the inspector may target a node hidden under a
  // collapsed ancestor. Derive an open path without erasing the user's saved
  // collapse state; it returns when selection moves elsewhere.
  const visibleCollapsed = React.useMemo(() => {
    if (!tree || !selectedId) return collapsed;
    const selectedIndex = sorted.findIndex(
      (row) => rowId(row) === selectedId,
    );
    if (selectedIndex < 0) return collapsed;

    const next = new Set(collapsed);
    let depth = tree.depth(sorted[selectedIndex]);

    for (let index = selectedIndex - 1; index >= 0 && depth > 0; index--) {
      const row = sorted[index];
      if (tree.depth(row) !== depth - 1) continue;
      next.delete(rowId(row));
      depth--;
    }

    return next;
  }, [collapsed, selectedId, sorted, rowId, tree]);

  // Walk the DFS list, dropping every row that sits under a collapsed ancestor.
  const visibleRows = React.useMemo(() => {
    if (!tree) return sorted;
    const rows: Row[] = [];
    let hideBelow = Infinity;
    for (const row of sorted) {
      const depth = tree.depth(row);
      if (depth > hideBelow) continue;
      hideBelow = Infinity;
      rows.push(row);
      if (tree.hasChildren(row) && visibleCollapsed.has(rowId(row))) {
        hideBelow = depth;
      }
    }
    return rows;
  }, [tree, sorted, visibleCollapsed, rowId]);

  const toggleCollapse = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  const selectedVisible = selectedId
    ? visibleRows.some((row) =>
        isSelected ? isSelected(row) : rowId(row) === selectedId,
      )
    : false;

  React.useEffect(() => {
    if (selectedId && selectedVisible) {
      selectedRowRef.current?.scrollIntoView({ block: "center" });
    }
  }, [selectedId, selectedVisible]);

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead
              key={column.key}
              className={cn(
                "whitespace-nowrap font-mono text-xs uppercase tracking-wide",
                column.align === "right" && "text-right",
                column.headerClassName,
              )}
            >
              {column.sortValue && !tree ? (
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  className={cn(
                    "inline-flex items-center gap-1 uppercase tracking-wide outline-none hover:text-foreground focus-visible:text-foreground",
                    sort?.key === column.key && "text-foreground",
                  )}
                >
                  {column.header}
                  {sort?.key === column.key ? (
                    sort.direction === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    )
                  ) : (
                    <ChevronsUpDown className="size-3 opacity-40" />
                  )}
                </button>
              ) : (
                column.header
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {visibleRows.map((row) => {
          const id = rowId(row);
          const selected = isSelected ? isSelected(row) : id === selectedId;
          const tableRow = (
            <TableRow
              ref={selected ? selectedRowRef : undefined}
              data-state={selected ? "selected" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                onRowClick && "cursor-pointer",
                selected && "bg-primary/10 hover:bg-primary/15",
              )}
            >
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    "align-top font-mono text-xs",
                    column.align === "right" && "text-right",
                    column.className,
                  )}
                >
                  {tree && column.key === treeColumnKey ? (
                    <span
                      className="flex items-center gap-1"
                      style={{
                        paddingLeft: tree.depth(row) * INDENT_PER_DEPTH,
                      }}
                    >
                      {tree.hasChildren(row) ? (
                        <button
                          type="button"
                          aria-label={
                            visibleCollapsed.has(id) ? "Expand" : "Collapse"
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleCollapse(id);
                          }}
                          className="-ml-0.5 shrink-0 text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
                        >
                          <ChevronRight
                            className={cn(
                              "size-3 transition-transform",
                              !visibleCollapsed.has(id) && "rotate-90",
                            )}
                          />
                        </button>
                      ) : (
                        <span className="inline-block size-3 shrink-0" />
                      )}
                      {column.cell(row)}
                    </span>
                  ) : (
                    column.cell(row)
                  )}
                </TableCell>
              ))}
            </TableRow>
          );

          const inspect = inspectRow?.(row);
          return inspect ? (
            <InspectContextMenu key={id} {...inspect}>
              {tableRow}
            </InspectContextMenu>
          ) : (
            <React.Fragment key={id}>{tableRow}</React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

export { DataTable };
export type { ColumnDef };
