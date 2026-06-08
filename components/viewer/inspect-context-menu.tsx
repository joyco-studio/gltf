'use client'

import * as React from 'react'
import { ScanSearch } from 'lucide-react'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

import { useViewer, type Selection } from './viewer-provider'

/**
 * Wraps a row/card with a right-click "Inspect" action that mirrors picking
 * the item in ⌘K search (frames + highlights it, opens the right tab, updates
 * the share URL) via the shared `jumpTo`.
 */
function InspectContextMenu({
  selection,
  name,
  children,
}: {
  selection: Selection
  name: string
  children: React.ReactNode
}) {
  const { jumpTo } = useViewer()

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => jumpTo(selection, name)}>
          <ScanSearch />
          Inspect
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export { InspectContextMenu }
