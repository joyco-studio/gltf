'use client'

import * as React from 'react'
import { Pause, Play } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatBytes, formatNumber } from '@/lib/format'
import type { GltfAnimationInfo } from '@/lib/viz/inspect'

import { DataTable, type ColumnDef } from './data-table'
import { useViewer } from './viewer-provider'
import { useAnimationsState } from './viz-hooks'

const PROGRESS_TINT = 'color-mix(in oklab, var(--foreground) 7%, transparent)'

function PlayToggle({ animation }: { animation: GltfAnimationInfo }) {
  const { viewer } = useViewer()
  const { playing } = useAnimationsState()
  const isPlaying = playing.includes(animation.id)
  const buttonRef = React.useRef<HTMLButtonElement>(null)

  // Paint clip progress as a dimmed bar behind the whole row. Driven
  // imperatively on the <tr> (rAF while playing) — progress ticks at frame
  // rate and must not re-render the table. Depends on the whole `playing`
  // snapshot (not just this row's flag): starting another clip stops this
  // one, and the bar must clear instead of going stale.
  React.useEffect(() => {
    const row = buttonRef.current?.closest('tr')
    if (!viewer || !row) return

    const paint = () => {
      const progress = viewer.animations.getProgress(animation.id)
      row.style.backgroundImage =
        progress > 0
          ? `linear-gradient(to right, ${PROGRESS_TINT} ${progress * 100}%, transparent ${progress * 100}%)`
          : ''
    }

    paint() // static frame for paused/stopped states
    if (!isPlaying) return

    let frame = requestAnimationFrame(function tick() {
      paint()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [viewer, animation.id, isPlaying, playing])

  return (
    <Button
      ref={buttonRef}
      variant={isPlaying ? 'default' : 'accent'}
      size="icon-sm"
      onClick={(event) => {
        event.stopPropagation()
        viewer?.animations.toggle(animation.id)
      }}
    >
      {isPlaying ? <Pause /> : <Play />}
      <span className="sr-only">
        {isPlaying ? `Pause ${animation.name}` : `Play ${animation.name}`}
      </span>
    </Button>
  )
}

const columns: ColumnDef<GltfAnimationInfo>[] = [
  {
    key: 'play',
    header: '',
    cell: (animation) => <PlayToggle animation={animation} />,
  },
  {
    key: 'id',
    header: 'ID',
    cell: (animation) => animation.id,
    sortValue: (animation) => animation.id,
  },
  {
    key: 'name',
    header: 'Name',
    cell: (animation) => (
      <span className="text-foreground">{animation.name}</span>
    ),
    sortValue: (animation) => animation.name,
  },
  {
    key: 'duration',
    header: 'Duration',
    align: 'right',
    cell: (animation) => `${animation.duration.toFixed(2)}s`,
    sortValue: (animation) => animation.duration,
  },
  {
    key: 'channels',
    header: 'Channels',
    align: 'right',
    cell: (animation) => formatNumber(animation.channels),
    sortValue: (animation) => animation.channels,
  },
  {
    key: 'samplers',
    header: 'Samplers',
    align: 'right',
    cell: (animation) => formatNumber(animation.samplers),
    sortValue: (animation) => animation.samplers,
  },
  {
    key: 'keyframes',
    header: 'Keyframes',
    align: 'right',
    cell: (animation) => formatNumber(animation.keyframes),
    sortValue: (animation) => animation.keyframes,
  },
  {
    key: 'size',
    header: 'Size',
    align: 'right',
    cell: (animation) => formatBytes(animation.size),
    sortValue: (animation) => animation.size,
  },
]

function AnimationsTable({ animations }: { animations: GltfAnimationInfo[] }) {
  const { selection, select } = useViewer()

  return (
    <DataTable
      data={animations}
      columns={columns}
      rowId={(animation) => `animation-${animation.id}`}
      selectedId={
        selection?.kind === 'animation' ? `animation-${selection.id}` : null
      }
      onRowClick={(animation) => select({ kind: 'animation', id: animation.id })}
    />
  )
}

export { AnimationsTable }
