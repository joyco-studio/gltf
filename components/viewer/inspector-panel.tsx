'use client'

import * as React from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { MaterialsTable } from './materials-table'
import { MeshesTable } from './meshes-table'
import { TexturesGrid } from './textures-grid'
import { useViewer, type InspectorTab } from './viewer-provider'

function SectionTitle({
  children,
  count,
}: {
  children: React.ReactNode
  count: number
}) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-2">
      <h2 className="font-heading text-sm font-semibold uppercase tracking-wide">
        {children}
      </h2>
      <Badge variant="muted" size="sm">
        {count}
      </Badge>
    </div>
  )
}

const DEFAULT_PANEL_WIDTH = 768 // px (48rem)
const MIN_PANEL_WIDTH = 360
/** Keep the panel from swallowing the 16px right margin. */
const PANEL_EDGE_MARGIN = 32

/**
 * The glTF contents browser: meshes & materials in one tab, textures in
 * another. Floats on the left, spaced from the screen edge and the header
 * by the same 16px padding the header uses. The right edge is a drag
 * handle for resizing (double-click resets).
 */
function InspectorPanel() {
  const { snapshot, tab, setTab } = useViewer()
  const [open, setOpen] = React.useState(true)
  const [width, setWidth] = React.useState(DEFAULT_PANEL_WIDTH)
  const [resizing, setResizing] = React.useState(false)
  const { document } = snapshot

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    const startX = event.clientX
    const startWidth = width
    handle.setPointerCapture(event.pointerId)
    setResizing(true)

    const handleMove = (move: PointerEvent) => {
      const max = window.innerWidth - PANEL_EDGE_MARGIN
      setWidth(
        Math.min(Math.max(startWidth + move.clientX - startX, MIN_PANEL_WIDTH), max)
      )
    }
    const handleUp = (up: PointerEvent) => {
      handle.releasePointerCapture(up.pointerId)
      handle.removeEventListener('pointermove', handleMove)
      handle.removeEventListener('pointerup', handleUp)
      setResizing(false)
    }
    handle.addEventListener('pointermove', handleMove)
    handle.addEventListener('pointerup', handleUp)
  }

  if (!document) return null

  if (!open) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setOpen(true)}
            className="pointer-events-auto absolute top-0 left-4 z-30"
          >
            <PanelLeftOpen />
            <span className="sr-only">Show contents browser</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Show contents</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <aside
      className="pointer-events-auto absolute top-0 bottom-4 left-4 z-40 flex max-w-[calc(100%-2rem)] flex-col border bg-background/85 backdrop-blur-md"
      style={{ width }}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as InspectorTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* tight header: no padding, same h-8 rhythm as the app header */}
        <div className="flex h-8 items-center justify-between border-b">
          <TabsList className="h-8 gap-0">
            <TabsTrigger value="contents" className="h-8">
              Instances
            </TabsTrigger>
            <TabsTrigger value="textures" className="h-8">
              Textures
              <Badge variant="muted" size="sm">
                {document.textures.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen(false)}
              >
                <PanelLeftClose />
                <span className="sr-only">Hide contents browser</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Hide contents</TooltipContent>
          </Tooltip>
        </div>

        <TabsContent value="contents" className="min-h-0">
          <ScrollArea className="h-full">
            <SectionTitle count={document.meshes.length}>Meshes</SectionTitle>
            <MeshesTable meshes={document.meshes} />
            <Separator className="my-2" />
            <SectionTitle count={document.materials.length}>
              Materials
            </SectionTitle>
            <MaterialsTable materials={document.materials} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="textures" className="min-h-0">
          <ScrollArea className="h-full">
            <TexturesGrid textures={document.textures} />
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* resize handle on the floating right edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize contents browser"
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(DEFAULT_PANEL_WIDTH)}
        className={cn(
          'absolute top-0 -right-1 bottom-0 w-2 cursor-col-resize touch-none select-none',
          'after:absolute after:inset-y-0 after:right-1 after:w-px after:bg-transparent after:transition-colors hover:after:bg-primary/60',
          resizing && 'after:bg-primary'
        )}
      />
    </aside>
  )
}

export { InspectorPanel }
