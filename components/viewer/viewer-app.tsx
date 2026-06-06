'use client'

import * as React from 'react'
import { FileUp, LoaderCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'

import { ControlsToolbar } from './controls-toolbar'
import { FileDropZone, useFilePicker } from './file-drop-zone'
import { InspectorPanel } from './inspector-panel'
import { SearchCommand } from './search-command'
import { ViewerCanvas } from './viewer-canvas'
import { ViewerHeader } from './viewer-header'
import { ViewerProvider, useViewer } from './viewer-provider'

function EmptyState() {
  const { snapshot } = useViewer()
  const { input, openPicker } = useFilePicker()

  if (snapshot.status === 'loading') {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (snapshot.status !== 'empty' && snapshot.status !== 'error') return null

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center">
      <div className="pointer-events-auto flex flex-col items-center gap-4 border border-dashed bg-background/85 px-12 py-10 text-center backdrop-blur-sm">
        <FileUp className="size-8 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="font-heading text-sm font-semibold uppercase tracking-wide">
            Drop a .glb / .gltf anywhere
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            or paste a URL — then browse its meshes, materials and textures,
            press{' '}
            <KbdGroup className="inline-flex">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>{' '}
            to search
          </p>
        </div>
        {snapshot.status === 'error' && snapshot.error ? (
          <p className="max-w-sm font-mono text-xs text-destructive">
            {snapshot.error}
          </p>
        ) : null}
        <Button onClick={openPicker}>
          <FileUp />
          Open file
        </Button>
        {input}
      </div>
    </div>
  )
}

/** Surfaces load errors that happen while a previous model stays on screen. */
function ErrorBanner() {
  const { snapshot } = useViewer()

  if (snapshot.status !== 'ready' || !snapshot.error) return null

  return (
    <div className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 border border-destructive/50 bg-background/90 px-4 py-2 backdrop-blur-sm">
      <p className="font-mono text-xs text-destructive">{snapshot.error}</p>
    </div>
  )
}

function ViewerApp() {
  return (
    <ViewerProvider>
      <div className="relative h-dvh overflow-hidden">
        <ViewerCanvas className="absolute inset-0" />
        <ViewerHeader />
        {/* pointer-events pass through to the canvas; interactive overlays opt back in.
            top-16 = header bottom (top-4 + h-8 cluster) + the same 16px gap */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-16">
          <div className="relative h-full">
            <EmptyState />
            <InspectorPanel />
            <ControlsToolbar />
            <ErrorBanner />
          </div>
        </div>
        <FileDropZone />
        <SearchCommand />
      </div>
    </ViewerProvider>
  )
}

export { ViewerApp }
