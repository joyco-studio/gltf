'use client'

import * as React from 'react'
import {
  ChevronDown,
  LoaderCircle,
  RotateCcw,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Cluster, Filler } from '@/components/ui/cluster'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  ENVIRONMENT_FILE_EXTENSIONS,
  ENVIRONMENT_PRESETS,
  isEnvironmentPresetId,
} from '@/lib/viz/environment-presets'
import {
  MAX_INTENSITY,
  MIN_INTENSITY,
  type EnvironmentSource,
} from '@/lib/viz/systems/environment-system'
import {
  MAX_EXPOSURE,
  MIN_EXPOSURE,
  TONE_MAPPING_MODES,
  isToneMappingMode,
} from '@/lib/viz/systems/tone-mapping-system'

import { resetRendererSettings, useRendererPanelOpen } from './renderer-settings'
import { useViewer } from './viewer-provider'
import { useEnvironmentState, useToneMappingState } from './viz-hooks'

/** Select value standing in for an uploaded (non-preset) environment. */
const FILE_VALUE = '__file'

const sourceValue = (source: EnvironmentSource) =>
  source.kind === 'preset' ? source.id : FILE_VALUE

function sourceLabel(source: EnvironmentSource) {
  return source.kind === 'preset'
    ? (ENVIRONMENT_PRESETS.find(({ id }) => id === source.id)?.label ??
        source.id)
    : source.name
}

/** Label column + control, on the same grid rhythm as the inspect panel. */
function SettingRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-x-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <SettingRow label={label}>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        onValueChange={([next]) => onChange(next)}
      />
      <span
        className={cn(
          'w-10 shrink-0 text-right tabular-nums',
          disabled && 'text-muted-foreground'
        )}
      >
        {format(value)}
      </span>
    </SettingRow>
  )
}

const selectTriggerClass =
  'h-7 w-full min-w-0 rounded-none border-0 bg-muted px-2 font-mono text-[10px] shadow-none data-[size=sm]:h-7'

function EnvironmentSection() {
  const { viewer } = useViewer()
  const environment = useEnvironmentState()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const { load } = environment
  const shown = load.phase === 'ready' ? environment.active : load.source

  return (
    <section className="bg-background/85 px-3 py-2 font-mono text-[10px] backdrop-blur-md">
      <h3 className="mb-1 flex items-center text-xs font-medium uppercase tracking-wide">
        Environment
        <Filler />
        {load.phase === 'loading' ? (
          <LoaderCircle
            className="size-3 animate-spin text-muted-foreground"
            aria-label="Loading environment"
          />
        ) : null}
      </h3>

      <SettingRow label="Map">
        <Select
          value={sourceValue(shown)}
          onValueChange={(value) => {
            if (isEnvironmentPresetId(value)) {
              viewer?.environment.setPreset(value)
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className={selectTriggerClass}
            aria-label="Environment map"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENVIRONMENT_PRESETS.map((preset) => (
              <SelectItem
                key={preset.id}
                value={preset.id}
                className="font-mono text-xs"
              >
                {preset.label}
              </SelectItem>
            ))}
            {shown.kind === 'file' ? (
              <>
                <SelectSeparator />
                <SelectItem value={FILE_VALUE} className="font-mono text-xs">
                  <span className="max-w-48 truncate">{shown.name}</span>
                </SelectItem>
              </>
            ) : null}
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="accent"
              size="icon-sm"
              className="size-7 shrink-0"
              onClick={() => inputRef.current?.click()}
            >
              <Upload />
              <span className="sr-only">Upload environment map</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Upload {ENVIRONMENT_FILE_EXTENSIONS.join(' / ')} (or drop it)
          </TooltipContent>
        </Tooltip>
        <input
          ref={inputRef}
          type="file"
          accept={ENVIRONMENT_FILE_EXTENSIONS.join(',')}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) viewer?.environment.loadFile(file)
            event.target.value = ''
          }}
        />
      </SettingRow>

      {load.phase === 'error' ? (
        <p className="py-1 leading-relaxed text-destructive">
          Couldn&apos;t load {sourceLabel(load.source)}: {load.message}. Still
          lit by {sourceLabel(environment.active)}.
        </p>
      ) : null}

      <SliderRow
        label="Intensity"
        value={environment.intensity}
        min={MIN_INTENSITY}
        max={MAX_INTENSITY}
        step={0.05}
        format={(value) => value.toFixed(2)}
        onChange={(value) => viewer?.environment.setIntensity(value)}
      />
      <SliderRow
        label="Rotation"
        value={environment.rotation}
        min={0}
        max={359}
        step={1}
        format={(value) => `${Math.round(value)}°`}
        onChange={(value) => viewer?.environment.setRotation(value)}
      />
    </section>
  )
}

function ToneMappingSection() {
  const { viewer } = useViewer()
  const toneMapping = useToneMappingState()

  return (
    <section className="bg-background/85 px-3 py-2 font-mono text-[10px] backdrop-blur-md">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide">
        Tone mapping
      </h3>
      <SettingRow label="Curve">
        <Select
          value={toneMapping.mode}
          onValueChange={(value) => {
            if (isToneMappingMode(value)) viewer?.toneMapping.setMode(value)
          }}
        >
          <SelectTrigger
            size="sm"
            className={selectTriggerClass}
            aria-label="Tone mapping curve"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TONE_MAPPING_MODES.map((mode) => (
              <SelectItem
                key={mode.id}
                value={mode.id}
                className="font-mono text-xs"
              >
                {mode.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SliderRow
        label="Exposure"
        value={toneMapping.exposure}
        min={MIN_EXPOSURE}
        max={MAX_EXPOSURE}
        step={0.05}
        format={(value) => value.toFixed(2)}
        disabled={toneMapping.mode === 'none'}
        onChange={(value) => viewer?.toneMapping.setExposure(value)}
      />
    </section>
  )
}

/**
 * Global renderer configuration — lighting and tone mapping. Lives in the
 * top-right slot the inspect panel uses, shown only while nothing is
 * inspected; collapsed it's a single header bar.
 */
function RendererSettingsPanel() {
  const { viewer } = useViewer()
  const [open, setOpen] = useRendererPanelOpen()
  const environment = useEnvironmentState()
  const toneMapping = useToneMappingState()
  const toneLabel =
    TONE_MAPPING_MODES.find(({ id }) => id === toneMapping.mode)?.label ??
    toneMapping.mode

  return (
    <Cluster
      direction="col"
      align="stretch"
      className="pointer-events-auto absolute top-0 right-4 z-50 max-h-full w-80 max-w-[calc(100%-2rem)] overflow-y-auto"
    >
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        className="h-8 w-full justify-start gap-2 rounded-none bg-background/85 px-2 backdrop-blur-md"
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs font-medium">Renderer</span>
        <Filler />
        <Badge variant="muted" size="sm" className="min-w-0 max-w-32 justify-start">
          <span className="truncate">{sourceLabel(environment.active)}</span>
        </Badge>
        <Badge variant="muted" size="sm">
          {toneLabel}
        </Badge>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
      </Button>

      {open ? (
        <>
          <EnvironmentSection />
          <ToneMappingSection />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start gap-2 rounded-none bg-background/85 px-3 font-mono text-[10px] text-muted-foreground backdrop-blur-md"
            onClick={() => viewer && resetRendererSettings(viewer)}
          >
            <RotateCcw className="size-3" />
            Reset to defaults
          </Button>
        </>
      ) : null}
    </Cluster>
  )
}

export { RendererSettingsPanel }
