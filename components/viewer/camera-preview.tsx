'use client'

import * as React from 'react'
import { Video, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Cluster } from '@/components/ui/cluster'

import { useViewer } from './viewer-provider'
import { useCameraPreview } from './viz-hooks'

/**
 * Masks the viewport outside the previewed camera's authored frame. The
 * engine widens the projection to contain the whole frame, so the gate is
 * simply the largest centered box of that aspect.
 */
function CameraPreviewFrame() {
  const preview = useCameraPreview()
  const aspect = preview?.aspect
  if (!aspect) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{ containerType: 'size' }}
    >
      <div
        className="shadow-[0_0_0_100vmax_color-mix(in_oklab,var(--background)_85%,transparent)]"
        style={{
          aspectRatio: aspect,
          width: `min(100cqw, ${aspect} * 100cqh)`,
        }}
      />
    </div>
  )
}

/** Flags the camera being looked through; any input exits. */
function CameraPreviewBanner() {
  const { viewer } = useViewer()
  const preview = useCameraPreview()
  if (!viewer || !preview) return null

  return (
    <div className="pointer-events-auto absolute top-0 left-1/2 z-30 -translate-x-1/2">
      <Cluster bg="accent">
        <p className="flex h-8 items-center gap-2 px-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          <Video className="size-3.5" />
          Viewing
          <span className="max-w-56 truncate normal-case text-foreground">
            {preview.name}
          </span>
          · click to exit
        </p>
        <Button
          variant="accent"
          size="icon-sm"
          onClick={() => viewer.cameraPreview.stop()}
        >
          <X />
          <span className="sr-only">Exit camera preview</span>
        </Button>
      </Cluster>
    </div>
  )
}

export { CameraPreviewBanner, CameraPreviewFrame }
