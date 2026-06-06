'use client'

import * as React from 'react'
import { Image as ImageIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { formatBytes, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { GltfTextureInfo } from '@/lib/viz/inspect'

import { useViewer } from './viewer-provider'

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-right font-mono text-xs text-foreground">{value}</dd>
    </div>
  )
}

function TextureCard({
  texture,
  selected,
}: {
  texture: GltfTextureInfo
  selected: boolean
}) {
  const { select } = useViewer()
  const cardRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ block: 'center' })
  }, [selected])

  return (
    <div
      ref={cardRef}
      onClick={() => select({ kind: 'texture', id: texture.id })}
      className={cn(
        'flex cursor-pointer flex-col border bg-card/50',
        selected && 'border-primary ring-2 ring-primary/30'
      )}
    >
      {/* checkerboard backdrop so alpha textures read correctly */}
      <div className="flex aspect-square items-center justify-center border-b bg-[length:16px_16px] bg-[image:repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)]">
        {texture.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL preview generated client-side
          <img
            src={texture.previewUrl}
            alt={texture.name}
            className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImageIcon className="size-6" />
            <span className="font-mono text-[10px] uppercase">
              no preview
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span
            className="truncate font-mono text-xs text-foreground"
            title={texture.name}
          >
            {texture.name}
          </span>
          <Badge variant="muted" size="sm">
            #{texture.id}
          </Badge>
        </div>

        {texture.slots.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {texture.slots.map((slot) => (
              <Badge key={slot} variant="muted" size="sm" className="normal-case">
                {slot}
              </Badge>
            ))}
          </div>
        ) : null}

        <dl className="flex flex-col gap-1">
          <InfoRow label="Mime" value={texture.mimeType ?? '—'} />
          <InfoRow
            label="Resolution"
            value={
              texture.width && texture.height
                ? `${texture.width}×${texture.height}`
                : '—'
            }
          />
          <InfoRow label="Size" value={formatBytes(texture.size)} />
          <InfoRow label="GPU size" value={formatBytes(texture.gpuSize)} />
          <InfoRow label="Instances" value={formatNumber(texture.instances)} />
        </dl>
      </div>
    </div>
  )
}

function TexturesGrid({ textures }: { textures: GltfTextureInfo[] }) {
  const { selection } = useViewer()

  if (textures.length === 0) {
    return (
      <p className="px-4 py-8 text-center font-mono text-xs uppercase tracking-wide text-muted-foreground">
        No textures in this document
      </p>
    )
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-4">
      {textures.map((texture) => (
        <TextureCard
          key={texture.id}
          texture={texture}
          selected={
            selection?.kind === 'texture' && selection.id === texture.id
          }
        />
      ))}
    </div>
  )
}

export { TexturesGrid }
