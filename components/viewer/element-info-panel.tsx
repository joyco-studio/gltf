'use client'

import * as React from 'react'
import { Box, Group } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Cluster, Filler } from '@/components/ui/cluster'
import type {
  ElementTransform,
  ElementTransformInfo,
  Vector3Tuple,
} from '@/lib/viz/systems/model-system'
import type { InspectTarget } from '@/lib/viz/controls/control-system'

import { useControlsState } from './viz-hooks'
import { useViewer } from './viewer-provider'

const AXES = ['X', 'Y', 'Z'] as const
const REFRESH_INTERVAL = 100

function formatNumber(value: number, unit = '') {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value
  return `${normalized.toFixed(3)}${unit}`
}

function VectorRow({
  label,
  value,
  unit,
}: {
  label: string
  value: Vector3Tuple
  unit?: string
}) {
  return (
    <div className="grid grid-cols-[4.25rem_repeat(3,minmax(0,1fr))] items-center gap-x-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      {value.map((axisValue, index) => (
        <span key={AXES[index]} className="min-w-0 tabular-nums">
          <span className="mr-1 text-muted-foreground">{AXES[index]}</span>
          {formatNumber(axisValue, unit)}
        </span>
      ))}
    </div>
  )
}

function TransformSection({
  title,
  transform,
}: {
  title: string
  transform: ElementTransform
}) {
  const rotation = transform.rotation.map(
    (value) => (value * 180) / Math.PI
  ) as unknown as Vector3Tuple

  return (
    <section className="px-3 py-2 font-mono text-[10px]">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide">
        {title}
      </h3>
      <VectorRow label="Position" value={transform.position} />
      <VectorRow label="Rotation" value={rotation} unit="°" />
      <VectorRow label="Scale" value={transform.scale} />
    </section>
  )
}

function useElementTransform(target: InspectTarget | null) {
  const { viewer } = useViewer()
  const [state, setState] = React.useState<{
    key: string
    info: ElementTransformInfo | null
  } | null>(null)
  const key =
    target?.kind === 'node' || target?.kind === 'mesh'
      ? `${target.kind}-${target.id}`
      : null

  React.useEffect(() => {
    if (!viewer || (target?.kind !== 'node' && target?.kind !== 'mesh')) {
      return
    }

    const element = { kind: target.kind, id: target.id }
    const targetKey = `${element.kind}-${element.id}`
    const refresh = () => {
      const next = viewer.model.getElementTransformInfo(element)
      setState((current) =>
        current?.key === targetKey &&
        JSON.stringify(current.info) === JSON.stringify(next)
          ? current
          : { key: targetKey, info: next }
      )
    }

    const initial = window.setTimeout(refresh, 0)
    const interval = window.setInterval(refresh, REFRESH_INTERVAL)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [viewer, target])

  return state?.key === key ? state.info : null
}

/** Floating read-only transform inspector for the inspected scene element. */
function ElementInfoPanel() {
  const { snapshot } = useViewer()
  const inspecting = useControlsState().inspecting
  const transform = useElementTransform(inspecting)

  if (
    !snapshot.document ||
    !inspecting ||
    (inspecting.kind !== 'node' && inspecting.kind !== 'mesh') ||
    !transform
  ) {
    return null
  }

  const instances =
    inspecting.kind === 'mesh'
      ? snapshot.document.meshes.find(({ id }) => id === inspecting.id)
          ?.instances
      : undefined

  return (
    <Cluster
      direction="col"
      align="stretch"
      className="absolute top-0 right-4 z-50 w-80 max-w-[calc(100%-2rem)]"
    >
      <div className="flex h-8 items-center gap-2 bg-background/85 px-2 backdrop-blur-md">
        {inspecting.kind === 'node' ? (
          <Group className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Box className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <h2 className="truncate font-mono text-xs font-medium">
          {inspecting.name}
        </h2>
        <Filler />
        <Badge variant="muted" size="sm">
          {inspecting.kind} #{inspecting.id}
        </Badge>
      </div>

      {inspecting.kind === 'mesh' && instances && instances > 1 ? (
        <p className="bg-accent/85 px-3 py-2 font-mono text-[10px] text-muted-foreground backdrop-blur-md">
          Showing the first runtime transform · {instances} instances selected
        </p>
      ) : null}

      <div className="bg-background/85 backdrop-blur-md">
        <TransformSection title="World transform" transform={transform.world} />
      </div>

      {transform.local ? (
        <div className="bg-background/85 backdrop-blur-md">
          <TransformSection title="Local transform" transform={transform.local} />
        </div>
      ) : null}

      {transform.bounds ? (
        <section className="bg-background/85 px-3 py-2 font-mono text-[10px] backdrop-blur-md">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide">
            World bounds
          </h3>
          <VectorRow label="Center" value={transform.bounds.center} />
          <VectorRow label="Size" value={transform.bounds.size} />
        </section>
      ) : null}
    </Cluster>
  )
}

export { ElementInfoPanel }
