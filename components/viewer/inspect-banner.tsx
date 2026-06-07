'use client'

import * as React from 'react'
import { ScanSearch, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Cluster } from '@/components/ui/cluster'
import { Kbd } from '@/components/ui/kbd'

import { useViewer } from './viewer-provider'
import { useControlsState } from './viz-hooks'

/**
 * Flags the active inspection (entered via ⌘K) and owns its ESC exit.
 * Mounted unconditionally so the key listener is always armed.
 */
function InspectBanner() {
  const { viewer } = useViewer()
  const controls = useControlsState()
  const inspecting = controls.inspecting

  React.useEffect(() => {
    if (!viewer || !inspecting) return
    const handleKeyDown = (event: KeyboardEvent) => {
      // defaultPrevented → ESC was consumed elsewhere (dialog close,
      // pointer-lock release); don't double-act on it
      if (event.key === 'Escape' && !event.defaultPrevented) {
        viewer.controls.exitInspect()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewer, inspecting])

  if (!viewer || !inspecting) return null

  return (
    <div className="pointer-events-auto absolute top-0 left-1/2 z-30 -translate-x-1/2">
      <Cluster bg="accent">
        <p className="flex h-8 items-center gap-2 px-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          <ScanSearch className="size-3.5" />
          Inspecting
          <span className="max-w-56 truncate normal-case text-foreground">
            {inspecting.name}
          </span>
          · <Kbd>ESC</Kbd> to exit
        </p>
        <Button
          variant="accent"
          size="icon-sm"
          onClick={() => viewer.controls.exitInspect()}
        >
          <X />
          <span className="sr-only">Exit inspection</span>
        </Button>
      </Cluster>
    </div>
  )
}

export { InspectBanner }
