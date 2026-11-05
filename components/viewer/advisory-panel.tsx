'use client'

import * as React from 'react'
import { ChevronDown, FileDown, Image as ImageIcon, LoaderCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Cluster, Filler } from '@/components/ui/cluster'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { GltfTextureInfo } from '@/lib/viz/inspect'
import {
  imageKey,
  isFlagged,
  projectedSavings,
  usageOf,
  type AdvisorySnapshot,
  type DownloadProjection,
  type TextureAdvice,
} from '@/lib/viz/advisory/texture-advisor'

import {
  useAdvisorySettings,
  type AdvisoryOverlay,
} from './advisory-settings'
import { useViewer } from './viewer-provider'
import { useAdvisoryState } from './viz-hooks'

type SortKey = 'savings' | 'usage' | 'name'

const OVERLAY_OPTIONS: { id: AdvisoryOverlay; label: string }[] = [
  { id: 'unused', label: 'Unused' },
  { id: 'wire', label: 'UV wire' },
  { id: 'off', label: 'Off' },
]

const PENDING: TextureAdvice = { status: 'pending' }

const CHECKERBOARD =
  'bg-[length:12px_12px] bg-[image:repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)]'

const HATCH: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, color-mix(in oklch, var(--destructive) 80%, transparent) 0 2px, color-mix(in oklch, var(--destructive) 35%, transparent) 2px 5px)',
}

function adviceFor(state: AdvisorySnapshot, id: number) {
  return state.status === 'idle' ? PENDING : (state.textures[id] ?? PENDING)
}

/** Flagged texture count for the tab badge, or null before analysis. */
function useFlaggedCount() {
  const state = useAdvisoryState()
  const [{ threshold }] = useAdvisorySettings()
  if (state.status === 'idle') return null
  return state.textures.filter((advice) => isFlagged(advice, threshold)).length
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function hintFor(advice: TextureAdvice, flagged: boolean) {
  if (advice.status === 'unused') {
    return advice.reason === 'unreferenced'
      ? 'No material references this texture. Remove it from the file.'
      : 'Only bound by materials that no mesh draws. Remove it, or the materials.'
  }
  if (advice.status === 'failed') return `Analysis failed: ${advice.message}`
  if (advice.status !== 'analyzed') return null
  if (advice.tiling) {
    return 'UVs tile past 0–1, so the texture repeats. Coverage is folded and cropping does not apply.'
  }
  if (!flagged) return null
  if (advice.offset) {
    return 'Some islands sit outside the 0–1 tile (they repeat back onto the texture), so no crop is offered. Move them into 0–1 to make cropping possible, or fill the unused area by extending the island edge colors outward.'
  }
  if (advice.crop) {
    return `Crop to ${advice.crop.width}×${advice.crop.height} and remap with KHR_texture_transform (offset/scale), or repack the islands to fill the space.`
  }
  return 'The unused space sits between UV islands, so cropping can’t remove it. Repack the UVs to use it, or fill it by extending the island edge colors outward: nothing samples it, the smooth fill compresses to almost nothing, and distant mip levels keep their colors.'
}

function DownloadLine({ download }: { download: DownloadProjection }) {
  if (download.status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <LoaderCircle className="size-3 animate-spin" />
        measuring
      </span>
    )
  }
  if (download.status === 'unavailable') {
    return <span className="text-muted-foreground">—</span>
  }
  const best = Math.min(
    download.cleared ?? download.original,
    download.cropped ?? download.original
  )
  return (
    <span>
      {formatBytes(download.original)}
      {best < download.original ? <> → {formatBytes(best)}</> : null}
      {download.status === 'estimated' ? (
        <span className="text-muted-foreground"> est.</span>
      ) : null}
    </span>
  )
}

function UsageBar({
  usage,
  threshold,
  flagged,
}: {
  usage: number | null
  threshold: number
  flagged: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 bg-muted">
        {usage !== null ? (
          <div
            className={cn(
              'absolute inset-y-0 left-0 transition-[width]',
              flagged ? 'bg-destructive' : 'bg-foreground/70'
            )}
            style={{ width: `${usage * 100}%` }}
          />
        ) : (
          <div className="absolute inset-0 animate-pulse bg-foreground/10" />
        )}
        {/* threshold tick */}
        <div
          className="absolute -inset-y-0.5 w-px bg-foreground/50"
          style={{ left: `${threshold}%` }}
        />
      </div>
      <span
        className={cn(
          'w-16 text-right font-mono text-[10px] uppercase tabular-nums',
          flagged ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {usage === null ? '…' : `${percent(usage)} used`}
      </span>
    </div>
  )
}

function maskStyle(url: string): React.CSSProperties {
  const image = `url("${url}")`
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: '100% 100%',
    WebkitMaskSize: '100% 100%',
  }
}

/** The texture preview with the coverage / wireframe overlay and crop outline on top. */
function OverlayPreview({
  texture,
  advice,
  overlay,
  className,
}: {
  texture: GltfTextureInfo
  advice: TextureAdvice
  overlay: AdvisoryOverlay
  className?: string
}) {
  const aspect =
    texture.width && texture.height ? texture.width / texture.height : 1
  const analyzed = advice.status === 'analyzed' ? advice : null
  const overlayUrl =
    overlay === 'unused'
      ? analyzed?.overlays.unusedUrl
      : overlay === 'wire'
        ? analyzed?.overlays.wireUrl
        : null

  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center',
        CHECKERBOARD,
        className
      )}
    >
      <div
        className="relative max-h-full max-w-full"
        style={{
          aspectRatio: aspect,
          width: aspect >= 1 ? '100%' : 'auto',
          height: aspect >= 1 ? 'auto' : '100%',
        }}
      >
        {texture.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Blob URL preview generated client-side
          <img
            src={texture.previewUrl}
            alt={texture.name}
            className="block size-full"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <ImageIcon className="size-5" />
          </div>
        )}
        {advice.status === 'unused' && overlay !== 'off' ? (
          <div className="absolute inset-0" style={HATCH} />
        ) : null}
        {overlayUrl ? (
          <div
            className={cn(
              'absolute inset-0',
              overlay === 'wire' && 'bg-chart-2'
            )}
            style={{ ...(overlay === 'unused' ? HATCH : {}), ...maskStyle(overlayUrl) }}
          />
        ) : null}
        {analyzed?.crop && overlay !== 'off' ? (
          <div
            className="absolute border border-dashed border-foreground"
            style={{
              left: `${(analyzed.crop.x / texture.width) * 100}%`,
              top: `${(analyzed.crop.y / texture.height) * 100}%`,
              width: `${(analyzed.crop.width / texture.width) * 100}%`,
              height: `${(analyzed.crop.height / texture.height) * 100}%`,
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-right font-mono text-[10px] text-foreground">{value}</dd>
    </div>
  )
}

function AdvisoryRow({
  texture,
  advice,
  threshold,
  overlay,
  selected,
}: {
  texture: GltfTextureInfo
  advice: TextureAdvice
  threshold: number
  overlay: AdvisoryOverlay
  selected: boolean
}) {
  const { viewer, select } = useViewer()
  const [expanded, setExpanded] = React.useState(false)
  const usage = usageOf(advice)
  const flagged = isFlagged(advice, threshold)
  const savings = projectedSavings(advice)
  const hint = hintFor(advice, flagged)
  const analyzed = advice.status === 'analyzed' ? advice : null
  const download =
    advice.status === 'analyzed' || advice.status === 'unused'
      ? advice.download
      : null
  const sharedWith =
    advice.status === 'analyzed' || advice.status === 'unused'
      ? advice.sharedWith
      : []

  const inspect = (
    kind: 'texture' | 'material' | 'mesh',
    id: number,
    name: string
  ) => {
    select({ kind, id })
    viewer?.inspectItem(kind, id, name)
  }

  return (
    <div
      className={cn(
        'border-b',
        selected && 'bg-accent/40 ring-1 ring-foreground/30 ring-inset'
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => inspect('texture', texture.id, texture.name)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') inspect('texture', texture.id, texture.name)
        }}
        className="flex cursor-pointer gap-3 p-3 hover:bg-accent/30"
      >
        <OverlayPreview
          texture={texture}
          advice={advice}
          overlay={overlay}
          className="size-24 border"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className="truncate font-mono text-xs text-foreground"
              title={texture.name}
            >
              {texture.name}
            </span>
            <Badge variant="muted" size="sm">
              #{texture.id}
            </Badge>
            <Filler />
            {savings ? (
              <Badge variant={flagged ? 'destructive' : 'muted'} size="sm">
                −{formatBytes(savings)}
              </Badge>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              className="-my-1.5 size-6"
              aria-label={expanded ? 'Collapse details' : 'Expand details'}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation()
                setExpanded((value) => !value)
              }}
            >
              <ChevronDown
                className={cn('transition-transform', expanded && 'rotate-180')}
              />
            </Button>
          </div>

          <div className="flex flex-wrap gap-1">
            {advice.status === 'unused' ? (
              <Badge variant="destructive" size="sm">
                unused
              </Badge>
            ) : null}
            {analyzed?.tiling ? (
              <Badge variant="accent" size="sm">
                tiling
              </Badge>
            ) : null}
            {sharedWith.length ? (
              <Badge
                variant="accent"
                size="sm"
                title="Other textures read the same image; this advice covers all of them"
              >
                shared image · {sharedWith.map((id) => `#${id}`).join(' ')}
              </Badge>
            ) : null}
            {analyzed?.texCoords
              .filter((texCoord) => texCoord > 0)
              .map((texCoord) => (
                <Badge key={texCoord} variant="accent" size="sm">
                  uv{texCoord}
                </Badge>
              ))}
            {texture.slots.map((slot) => (
              <Badge key={slot} variant="muted" size="sm" className="normal-case">
                {slot}
              </Badge>
            ))}
          </div>

          <UsageBar usage={usage} threshold={threshold} flagged={flagged} />

          <dl className="flex flex-col gap-0.5">
            <InfoRow
              label="Resolution"
              value={
                texture.width && texture.height ? (
                  <>
                    {texture.width}×{texture.height}
                    {analyzed?.crop ? (
                      <>
                        {' '}
                        → {analyzed.crop.width}×{analyzed.crop.height}
                      </>
                    ) : null}
                  </>
                ) : (
                  '—'
                )
              }
            />
            <InfoRow
              label="Download"
              value={download ? <DownloadLine download={download} /> : '…'}
            />
          </dl>

          {hint ? (
            <p
              className={cn(
                'font-mono text-[10px] leading-relaxed',
                flagged ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {hint}
            </p>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <OverlayPreview
            texture={texture}
            advice={advice}
            overlay={overlay}
            className="aspect-square w-full border"
          />
          {download &&
          (download.status === 'measured' || download.status === 'estimated') ? (
            <dl className="flex flex-col gap-0.5">
              <InfoRow label="Original" value={formatBytes(download.original)} />
              {download.cleared !== null && download.cleared < download.original ? (
                <InfoRow
                  label="Unused filled (edge bleed)"
                  value={formatBytes(download.cleared)}
                />
              ) : null}
              {download.cropped !== null ? (
                <InfoRow
                  label={download.status === 'measured' ? 'Cropped + filled' : 'Crop (est.)'}
                  value={formatBytes(download.cropped)}
                />
              ) : null}
            </dl>
          ) : null}
          {analyzed && analyzed.users.length > 0 ? (
            <div className="flex flex-col gap-1">
              <h4 className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                Sampled by
              </h4>
              <ul className="flex flex-col">
                {analyzed.users.map((user) => (
                  <li
                    key={`${user.materialId}:${user.meshId}:${user.slot}`}
                    className="flex items-center gap-2 font-mono text-[10px]"
                  >
                    <button
                      type="button"
                      className="truncate hover:underline"
                      onClick={() =>
                        inspect('material', user.materialId, user.materialName)
                      }
                    >
                      {user.materialName}
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      type="button"
                      className="truncate hover:underline"
                      onClick={() => inspect('mesh', user.meshId, user.meshName)}
                    >
                      {user.meshName}
                    </button>
                    <Filler />
                    <span className="text-muted-foreground">
                      {user.slot} · uv{user.texCoord}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Exports the advisory as Markdown + JSON for an agent working in Blender. */
function ReportButton({
  threshold,
  onError,
}: {
  threshold: number
  onError: (message: string | null) => void
}) {
  const { viewer, snapshot } = useViewer()
  const state = useAdvisoryState()
  const [busy, setBusy] = React.useState(false)
  // While a replacement loads, the advisory still describes the old model;
  // export only once it matches what the rest of the UI shows.
  const ready = state.status === 'ready' && snapshot.status === 'ready'

  async function exportReport() {
    if (!viewer || !ready || busy) return
    setBusy(true)
    onError(null)
    try {
      // The advisor builds the report from the model it analyzed, never a
      // newer one, so advice and file data always agree.
      const report = await viewer.advisory.exportReport(threshold)
      if (!report) throw new Error('Analysis is no longer current')
      const base = report.fileName.replace(/\.(glb|gltf)$/i, '') || 'model'
      downloadText(report.text, `${base}.texture-advisory.md`)
    } catch {
      onError('Could not build the report. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span keeps the tooltip working while the button is disabled */}
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 font-mono text-xs"
            disabled={!ready || busy}
            onClick={() => void exportReport()}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <FileDown />}
            Report
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {ready
          ? 'Download a Markdown + JSON report for a Blender agent'
          : 'Available once analysis finishes'}
      </TooltipContent>
    </Tooltip>
  )
}

function ThresholdControl({
  threshold,
  onChange,
}: {
  threshold: number
  onChange: (threshold: number) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="font-mono text-xs">
          Flag &lt; {threshold}%
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-3 border p-3">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-xs uppercase tracking-wide">
            Usage threshold
          </span>
          <span className="font-mono text-xs tabular-nums">{threshold}%</span>
        </div>
        <Slider
          min={0}
          max={100}
          step={5}
          value={[threshold]}
          onValueChange={([value]) => onChange(value)}
        />
        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
          Textures whose UVs sample less than this share of their texels are
          flagged. Saved on this device.
        </p>
      </PopoverContent>
    </Popover>
  )
}

function AdvisoryPanel({ textures }: { textures: GltfTextureInfo[] }) {
  const { viewer, selection } = useViewer()
  const state = useAdvisoryState()
  const [settings, updateSettings] = useAdvisorySettings()
  const [sort, setSort] = React.useState<SortKey>('savings')
  const [reportError, setReportError] = React.useState<string | null>(null)

  // Analysis is lazy: it starts the first time this tab is shown per model.
  React.useEffect(() => {
    if (state.status === 'idle') viewer?.advisory.start()
  }, [viewer, state.status])

  const rows = React.useMemo(() => {
    const list = textures.map((texture) => {
      const advice = adviceFor(state, texture.id)
      return {
        texture,
        advice,
        savings: projectedSavings(advice) ?? -1,
        usage: usageOf(advice) ?? 2,
      }
    })
    return list.sort((a, b) => {
      if (sort === 'name') return a.texture.name.localeCompare(b.texture.name)
      if (sort === 'usage') return a.usage - b.usage
      return b.savings - a.savings || a.usage - b.usage
    })
  }, [textures, state, sort])

  if (textures.length === 0) {
    return (
      <p className="px-4 py-8 text-center font-mono text-xs uppercase tracking-wide text-muted-foreground">
        No textures in this document
      </p>
    )
  }

  const analyzed = rows.filter(({ advice }) => advice.status !== 'pending').length
  const measuring = rows.some(
    ({ advice }) =>
      (advice.status === 'analyzed' || advice.status === 'unused') &&
      advice.download.status === 'pending'
  )
  const flagged = rows.filter(({ advice }) =>
    isFlagged(advice, settings.threshold)
  )
  // Textures sharing an image share its savings: count each image once.
  const totalSavings = [
    ...new Map(
      flagged.map(({ texture, advice, savings }) => [
        imageKey(texture.id, advice),
        Math.max(0, savings),
      ])
    ).values(),
  ].reduce((total, savings) => total + savings, 0)

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex flex-col border-b bg-background/90 backdrop-blur-md">
        <Cluster className="h-8">
          {OVERLAY_OPTIONS.map((option) => (
            <Button
              key={option.id}
              variant={settings.overlay === option.id ? 'accent' : 'ghost'}
              size="sm"
              className="h-8 font-mono text-xs"
              aria-pressed={settings.overlay === option.id}
              onClick={() => updateSettings({ overlay: option.id })}
            >
              {option.label}
            </Button>
          ))}
          <Filler />
          <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
            <SelectTrigger
              size="sm"
              className="rounded-none border-0 font-mono text-xs shadow-none"
              aria-label="Sort textures"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="savings">Most savings</SelectItem>
              <SelectItem value="usage">Least used</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
          <ThresholdControl
            threshold={settings.threshold}
            onChange={(threshold) => updateSettings({ threshold })}
          />
          <ReportButton threshold={settings.threshold} onError={setReportError} />
        </Cluster>
        <p className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {analyzed < rows.length ? (
            <>
              <LoaderCircle className="size-3 animate-spin" />
              Analyzing UVs {analyzed}/{rows.length}
            </>
          ) : (
            <>
              {measuring ? <LoaderCircle className="size-3 animate-spin" /> : null}
              <span>
                <span className={cn(flagged.length > 0 && 'text-destructive')}>
                  {flagged.length}
                </span>{' '}
                of {rows.length} flagged
              </span>
              {totalSavings > 0 ? (
                <span>
                  · est. <span className="text-foreground">−{formatBytes(totalSavings)}</span>{' '}
                  download{measuring ? ' so far' : ''}
                </span>
              ) : null}
            </>
          )}
        </p>
        {reportError ? (
          <p role="alert" className="px-3 pb-1.5 font-mono text-[10px] text-destructive">
            {reportError}
          </p>
        ) : null}
      </div>

      {rows.map(({ texture, advice }) => (
        <AdvisoryRow
          key={texture.id}
          texture={texture}
          advice={advice}
          threshold={settings.threshold}
          overlay={settings.overlay}
          selected={selection?.kind === 'texture' && selection.id === texture.id}
        />
      ))}
    </div>
  )
}

export { AdvisoryPanel, useFlaggedCount }
