'use client'

import * as React from 'react'
import { Axis3d, Camera, Grid3x3, LocateFixed, Orbit, Plane } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Cluster } from '@/components/ui/cluster'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Axis, ControlModeId } from '@/lib/viz/controls/types'

import { useViewer } from './viewer-provider'
import { useAxesVisible, useControlsState, useGridVisible } from './viz-hooks'

const MODES: {
  id: ControlModeId
  label: string
  icon: React.ReactNode
  hint: string
}[] = [
  {
    id: 'orbit',
    label: 'Orbit',
    icon: <Orbit />,
    hint: 'Rotate around the model · wheel to dolly',
  },
  {
    id: 'fly',
    label: 'Fly',
    icon: <Plane />,
    hint: 'Click to look · WASD to move · Shift to run',
  },
]

const AXES: Axis[] = ['x', 'y', 'z']

function ControlsToolbar() {
  const { viewer, snapshot } = useViewer()
  const controls = useControlsState()
  const gridVisible = useGridVisible()
  const axesVisible = useAxesVisible()

  // no document → idle showcase: the viewer auto-orbits, controls stay hidden
  if (!viewer || !snapshot.document) return null

  return (
    <div className="pointer-events-auto absolute right-4 bottom-4 z-30 flex w-fit flex-col items-end gap-2">
      {controls.mode === 'fly' && !controls.pointerLocked ? (
        <Cluster bg="accent">
          <p className="flex items-center gap-1 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Click viewport to look · <Kbd>WASD</Kbd> move · <Kbd>␣</Kbd> up ·{' '}
            <Kbd>Q</Kbd> down · <Kbd>⇧</Kbd> run
          </p>
        </Cluster>
      ) : null}

      <div className="flex gap-2">
        <Cluster bg="accent">
          {MODES.map((mode) => (
            <Tooltip key={mode.id}>
              <TooltipTrigger asChild>
                <Button
                  variant={controls.mode === mode.id ? 'default' : 'accent'}
                  size="sm"
                  onClick={() => viewer.controls.setMode(mode.id)}
                >
                  {mode.icon}
                  {mode.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{mode.hint}</TooltipContent>
            </Tooltip>
          ))}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="accent"
                size="icon-sm"
                onClick={() => viewer.controls.resetView()}
              >
                <LocateFixed />
                <span className="sr-only">Reset view</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Reset view — re-center pivot and restore the home camera
            </TooltipContent>
          </Tooltip>
        </Cluster>

        <Separator orientation="vertical" className="h-auto self-stretch [--thickness:0.5px]" />

        <Cluster bg="accent">
          {AXES.map((axis) => {
            const aligned = controls.alignedAxis
            const isAligned = aligned?.axis === axis
            return (
              <Tooltip key={axis}>
                <TooltipTrigger asChild>
                  <Button
                    variant={isAligned ? 'default' : 'accent'}
                    size="sm"
                    className="font-mono uppercase"
                    onClick={() => viewer.controls.snapToAxis(axis)}
                  >
                    {isAligned ? `${aligned.sign === 1 ? '+' : '−'}${axis}` : axis}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  View from the {axis.toUpperCase()} axis — press again to flip
                </TooltipContent>
              </Tooltip>
            )
          })}
        </Cluster>

        <Separator orientation="vertical" className="h-auto self-stretch [--thickness:0.5px]" />

        <Cluster bg="accent">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="accent"
                size="sm"
                className="font-mono"
                onClick={() =>
                  viewer.controls.setProjection(
                    controls.projection === 'perspective'
                      ? 'orthographic'
                      : 'perspective'
                  )
                }
              >
                <Camera />
                {controls.projection === 'perspective' ? 'PERSP' : 'ORTHO'}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {controls.projection === 'perspective'
                ? 'Switch to orthographic projection'
                : 'Switch to perspective projection'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={gridVisible ? 'default' : 'accent'}
                size="icon-sm"
                onClick={() => viewer.grid.toggle()}
              >
                <Grid3x3 />
                <span className="sr-only">Toggle floor grid</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {gridVisible ? 'Hide floor grid' : 'Show floor grid'}
            </TooltipContent>
          </Tooltip>

          {controls.inspecting ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={axesVisible ? 'default' : 'accent'}
                  size="icon-sm"
                  onClick={() => viewer.axes.toggle()}
                >
                  <Axis3d />
                  <span className="sr-only">Toggle element axes</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {axesVisible ? 'Hide element axes' : 'Show element axes'}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </Cluster>
      </div>
    </div>
  )
}

export { ControlsToolbar }
