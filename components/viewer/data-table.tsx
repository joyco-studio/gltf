'use client'

import * as React from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface ColumnDef<Row> {
  key: string
  header: string
  cell: (row: Row) => React.ReactNode
  /** Comparable value for ordering. Omit to make the column unsortable. */
  sortValue?: (row: Row) => string | number
  className?: string
  headerClassName?: string
  align?: 'left' | 'right'
}

interface SortState {
  key: string
  direction: 'asc' | 'desc'
}

function compareValues(a: string | number, b: string | number) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
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
  onRowClick,
}: {
  data: Row[]
  columns: ColumnDef<Row>[]
  rowId: (row: Row) => string
  selectedId?: string | null
  onRowClick?: (row: Row) => void
}) {
  const [sort, setSort] = React.useState<SortState | null>(null)
  const selectedRowRef = React.useRef<HTMLTableRowElement>(null)

  const sorted = React.useMemo(() => {
    if (!sort) return data
    const column = columns.find(({ key }) => key === sort.key)
    if (!column?.sortValue) return data
    const { sortValue } = column
    const factor = sort.direction === 'asc' ? 1 : -1
    return [...data].sort(
      (a, b) => compareValues(sortValue(a), sortValue(b)) * factor
    )
  }, [data, columns, sort])

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: 'asc' }
      if (current.direction === 'asc') return { key, direction: 'desc' }
      return null
    })
  }

  React.useEffect(() => {
    if (selectedId) {
      selectedRowRef.current?.scrollIntoView({ block: 'center' })
    }
  }, [selectedId])

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead
              key={column.key}
              className={cn(
                'whitespace-nowrap font-mono text-xs uppercase tracking-wide',
                column.align === 'right' && 'text-right',
                column.headerClassName
              )}
            >
              {column.sortValue ? (
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  className={cn(
                    'inline-flex items-center gap-1 uppercase tracking-wide outline-none hover:text-foreground focus-visible:text-foreground',
                    sort?.key === column.key && 'text-foreground'
                  )}
                >
                  {column.header}
                  {sort?.key === column.key ? (
                    sort.direction === 'asc' ? (
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
        {sorted.map((row) => {
          const id = rowId(row)
          const selected = id === selectedId
          return (
            <TableRow
              key={id}
              ref={selected ? selectedRowRef : undefined}
              data-state={selected ? 'selected' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                onRowClick && 'cursor-pointer',
                selected && 'bg-primary/10 hover:bg-primary/15'
              )}
            >
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    'align-top font-mono text-xs',
                    column.align === 'right' && 'text-right',
                    column.className
                  )}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export { DataTable }
export type { ColumnDef }
