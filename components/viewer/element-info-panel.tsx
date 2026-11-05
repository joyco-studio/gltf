'use client'

import * as React from 'react'
import { Box, Group } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Cluster, Filler } from '@/components/ui/cluster'
import { cn } from '@/lib/utils'
import type { GltfCameraInfo } from '@/lib/viz/inspect'
import type {
  ElementTransform,
  ElementTransformInfo,
  Vector3Tuple,
} from '@/lib/viz/systems/model-system'
import type { InspectTarget } from '@/lib/viz/controls/control-system'

import { useCameraPreview, useControlsState } from './viz-hooks'
import { NODE_TYPE_LABELS } from './node-type'
import { useViewer, type HierarchySelection } from './viewer-provider'

const AXES = ['X', 'Y', 'Z'] as const
const REFRESH_INTERVAL = 100

function formatNumber(value: number, unit = '') {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value
  return `${normalized.toFixed(3)}${unit}`
}

const toDegrees = (radians: number) => (radians * 180) / Math.PI

interface FieldCell {
  prefix?: string
  value: React.ReactNode
  /** Columns spanned out of three. */
  span?: 1 | 2 | 3
}

const SPAN_CLASSES = { 1: '', 2: 'col-span-2', 3: 'col-span-3' }

/** A labelled row of up to three cells, each with an optional muted prefix. */
function FieldRow({ label, cells }: { label: string; cells: FieldCell[] }) {
  return (
    <div className="grid grid-cols-[4.25rem_repeat(3,minmax(0,1fr))] items-center gap-x-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      {cells.map(({ prefix, value, span = 1 }, index) => (
        <span
          key={index}
          className={cn('min-w-0 truncate tabular-nums', SPAN_CLASSES[span])}
        >
          {prefix ? (
            <span className="mr-1 text-muted-foreground">{prefix}</span>
          ) : null}
          {value}
        </span>
      ))}
    </div>
  )
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
    <FieldRow
      label={label}
      cells={value.map((axisValue, index) => ({
        prefix: AXES[index],
        value: formatNumber(axisValue, unit),
      }))}
    />
  )
}

/** Full field of view (degrees) for a half-angle tangent. */
const fovFromTan = (halfTan: number) => toDegrees(2 * Math.atan(halfTan))

/**
 * The camera's authored projection, plus the live preview zoom and the
 * field of view / magnification it effectively renders with.
 */
function CameraSection({
  camera,
  zoom,
}: {
  camera: GltfCameraInfo
  /** Preview wheel zoom while looking through this camera, else null. */
  zoom: number | null
}) {
  const effectiveZoom = zoom ?? 1
  const clip: FieldCell[] = [
    { prefix: 'Near', value: formatNumber(camera.znear) },
    {
      prefix: 'Far',
      value: camera.zfar === null ? '∞' : formatNumber(camera.zfar),
    },
  ]
  const rows: { label: string; cells: FieldCell[] }[] =
    camera.type === 'perspective'
      ? [
          { label: 'Projection', cells: [{ value: 'Perspective', span: 3 }] },
          {
            label: 'FOV',
            cells: [
              { prefix: 'Y', value: formatNumber(toDegrees(camera.yfov), '°') },
              {
                prefix: 'X',
                value:
                  camera.aspectRatio === null
                    ? '—'
                    : formatNumber(
                        fovFromTan(
                          Math.tan(camera.yfov / 2) * camera.aspectRatio
                        ),
                        '°'
                      ),
              },
            ],
          },
          {
            label: 'Aspect',
            cells: [
              {
                value:
                  camera.aspectRatio === null
                    ? 'Viewport'
                    : formatNumber(camera.aspectRatio),
                span: 3,
              },
            ],
          },
          { label: 'Clip', cells: clip },
          {
            label: 'Zoom',
            cells: [
              { value: `${formatNumber(effectiveZoom)}×` },
              {
                prefix: 'FOV Y',
                value: formatNumber(
                  fovFromTan(Math.tan(camera.yfov / 2) / effectiveZoom),
                  '°'
                ),
                span: 2,
              },
            ],
          },
        ]
      : [
          { label: 'Projection', cells: [{ value: 'Orthographic', span: 3 }] },
          {
            label: 'Magnify',
            cells: [
              { prefix: 'X', value: formatNumber(camera.xmag) },
              { prefix: 'Y', value: formatNumber(camera.ymag) },
            ],
          },
          {
            label: 'Aspect',
            cells: [
              { value: formatNumber(camera.xmag / camera.ymag), span: 3 },
            ],
          },
          { label: 'Clip', cells: clip },
          {
            label: 'Zoom',
            cells: [
              { value: `${formatNumber(effectiveZoom)}×` },
              {
                prefix: 'Mag Y',
                value: formatNumber(camera.ymag / effectiveZoom),
                span: 2,
              },
            ],
          },
        ]

  return (
    <section className="bg-background/85 px-3 py-2 font-mono text-[10px] backdrop-blur-md">
      <h3 className="mb-1 flex items-center text-xs font-medium uppercase tracking-wide">
        Camera
        <Filler />
        {zoom !== null ? (
          <Badge variant="accent" size="sm">
            Previewing
          </Badge>
        ) : null}
      </h3>
      {rows.map((row) => (
        <FieldRow key={row.label} {...row} />
      ))}
    </section>
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
    toDegrees
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

function UserDataSection({ userData }: { userData: Record<string, unknown> }) {
  if (Object.keys(userData).length === 0) return null

  let formatted: string
  try {
    formatted = JSON.stringify(userData, null, 2)
  } catch {
    formatted = '[Unable to display non-serializable user data]'
  }

  return (
    <section className="pointer-events-auto flex min-h-0 flex-col bg-background/85 px-3 py-2 font-mono text-[10px] backdrop-blur-md">
      <h3 className="mb-1 shrink-0 text-xs font-medium uppercase tracking-wide">
        User data
      </h3>
      <pre className="max-h-64 min-h-0 overflow-auto whitespace-pre-wrap break-all text-muted-foreground">
        {formatted}
      </pre>
    </section>
  )
}

function transformsEqual(
  current: ElementTransformInfo | null,
  next: ElementTransformInfo | null
) {
  if (!current || !next) return current === next
  return (
    current.renderables === next.renderables &&
    JSON.stringify([current.local, current.world, current.bounds]) ===
      JSON.stringify([next.local, next.world, next.bounds])
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
        transformsEqual(current.info, next)
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

/**
 * Floating read-only details inspector for the inspected scene element —
 * or, with nothing inspected, the camera the viewport is looking through.
 */
function ElementInfoPanel() {
  const { revealInHierarchy, snapshot } = useViewer()
  const inspected = useControlsState().inspecting
  const preview = useCameraPreview()
  const previewNodeId = preview?.nodeId
  const previewName = preview?.name
  const inspecting = React.useMemo<InspectTarget | null>(
    () =>
      inspected ??
      (previewNodeId !== undefined && previewName !== undefined
        ? { kind: 'node', id: previewNodeId, name: previewName }
        : null),
    [inspected, previewNodeId, previewName]
  )
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
  const node =
    inspecting.kind === 'node'
      ? snapshot.document.nodes.find(({ id }) => id === inspecting.id)
      : undefined
  const objectType = node?.objectType
  const hierarchySelection: HierarchySelection = {
    kind: inspecting.kind,
    id: inspecting.id,
  }

  return (
    <Cluster
      direction="col"
      align="stretch"
      className="absolute top-0 right-4 z-50 max-h-full w-80 max-w-[calc(100%-2rem)]"
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Show ${inspecting.name} in hierarchy`}
        className="pointer-events-auto h-8 w-full justify-start gap-2 rounded-none bg-background/85 px-2 backdrop-blur-md"
        onClick={() => revealInHierarchy(hierarchySelection)}
      >
        {inspecting.kind === 'node' ? (
          <Group className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Box className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 truncate font-mono text-xs font-medium">
          {inspecting.name}
        </span>
        <Filler />
        {objectType ? (
          <Badge variant="accent" size="sm">
            {NODE_TYPE_LABELS[objectType]}
          </Badge>
        ) : null}
        <Badge variant="muted" size="sm">
          {inspecting.kind} #{inspecting.id}
        </Badge>
      </Button>

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

      {node?.camera ? (
        <CameraSection
          camera={node.camera}
          zoom={preview?.nodeId === node.id ? preview.zoom : null}
        />
      ) : null}

      <UserDataSection userData={transform.userData} />
    </Cluster>
  )
}

export { ElementInfoPanel }
