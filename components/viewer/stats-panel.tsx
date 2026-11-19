"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GltfDocumentInfo } from "@/lib/viz/inspect";
import type { GltfStats, SizeCategory } from "@/lib/viz/stats";

import { selectionName } from "./share-path";
import { useViewer } from "./viewer-provider";

const CATEGORY_LABELS: Record<SizeCategory, { label: string; hint: string }> = {
  geometry: {
    label: "Geometry",
    hint: "Vertex positions and triangle indices (or Draco-compressed meshes).",
  },
  attributes: {
    label: "Vertex attributes",
    hint: "Extra per-vertex data: normals, tangents, UVs, colors, custom attributes.",
  },
  textures: {
    label: "Textures",
    hint: "Encoded image bytes, embedded or external.",
  },
  animation: {
    label: "Animation",
    hint: "Keyframe times and the values they drive.",
  },
  skinning: {
    label: "Skinning",
    hint: "Joint indices, weights and inverse bind matrices.",
  },
  morphs: {
    label: "Morph targets",
    hint: "Per-target vertex deltas (blend shapes).",
  },
  instancing: {
    label: "Instancing",
    hint: "EXT_mesh_gpu_instancing per-instance transforms.",
  },
  unreferenced: {
    label: "Unreferenced data",
    hint: "Buffer views nothing in the file points at (or only an extension this viewer does not break down) — usually safe to prune.",
  },
  overhead: {
    label: "JSON & container",
    hint: "Scene description JSON, GLB headers and alignment padding.",
  },
};

/** Categories whose lone sub-entry would just repeat the category name. */
const SINGLE_ENTRY_HIDDEN = new Set<SizeCategory>(["unreferenced", "overhead"]);

function swatch(category: SizeCategory) {
  return `var(--size-${category})`;
}

function formatShare(bytes: number, total: number) {
  if (total <= 0) return "—";
  const share = (bytes / total) * 100;
  return share > 0 && share < 0.1 ? "<0.1%" : `${share.toFixed(1)}%`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 bg-muted/50 p-2 px-4">
      <h2 className="font-heading text-sm font-semibold uppercase tracking-wide">
        {children}
      </h2>
    </div>
  );
}

/** One whole (the file) split into its parts; legend + table carry identity. */
function WeightBar({ stats, total }: { stats: GltfStats; total: number }) {
  return (
    <div
      role="img"
      aria-label={`File weight: ${stats.breakdown
        .map(
          ({ category, bytes }) =>
            `${CATEGORY_LABELS[category].label} ${formatBytes(bytes)} (${formatShare(bytes, total)})`,
        )
        .join(", ")}`}
      className="flex h-2 w-full gap-0.5"
    >
      {stats.breakdown.map(({ category, bytes }) => (
        <Tooltip key={category}>
          <TooltipTrigger asChild>
            {/* taller hit area than the 8px mark */}
            <div
              className="-my-1.5 h-5 min-w-0.5 py-1.5 transition-opacity hover:opacity-80"
              style={{ flexGrow: bytes, flexBasis: 0 }}
            >
              <div
                className="size-full"
                style={{ background: swatch(category) }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {CATEGORY_LABELS[category].label} · {formatBytes(bytes)} ·{" "}
            {formatShare(bytes, total)}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function BreakdownTable({ stats, total }: { stats: GltfStats; total: number }) {
  return (
    <table className="w-full font-mono text-xs">
      <thead className="sr-only">
        <tr>
          <th>Part</th>
          <th>Size</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {stats.breakdown.map(({ category, bytes, entries }) => {
          const { label, hint } = CATEGORY_LABELS[category];
          return (
            <React.Fragment key={category}>
              <tr className="border-t first:border-t-0">
                <th scope="row" className="py-1.5 pl-4 text-left font-normal">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-help items-center gap-2 uppercase tracking-wide text-foreground">
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0"
                          style={{ background: swatch(category) }}
                        />
                        {label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-64">
                      {hint}
                    </TooltipContent>
                  </Tooltip>
                </th>
                <td className="py-1.5 text-right tabular-nums text-foreground">
                  {formatBytes(bytes)}
                </td>
                <td className="w-20 py-1.5 pr-4 text-right tabular-nums text-foreground">
                  {formatShare(bytes, total)}
                </td>
              </tr>
              {entries.length > 1 || !SINGLE_ENTRY_HIDDEN.has(category)
                ? entries.map((entry) => (
                    <tr key={entry.key} className="text-muted-foreground">
                      <th
                        scope="row"
                        className="py-0.5 pl-[2.375rem] text-left font-normal"
                      >
                        {entry.key}
                      </th>
                      <td className="py-0.5 text-right tabular-nums">
                        {formatBytes(entry.bytes)}
                      </td>
                      <td className="py-0.5 pr-4 text-right tabular-nums">
                        {formatShare(entry.bytes, total)}
                      </td>
                    </tr>
                  ))
                : null}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The heaviest inspectable elements per category; each name jumps to the
 * element in the inspector (and frames it in the viewport).
 */
function TopOffenders({
  stats,
  document,
}: {
  stats: GltfStats;
  document: GltfDocumentInfo;
}) {
  const { jumpTo } = useViewer();
  const items = stats.breakdown.filter(({ offenders }) => offenders.length);
  if (!items.length) return null;

  return (
    <>
      <SectionTitle>Top offenders</SectionTitle>
      <table className="w-full table-fixed font-mono text-xs">
        {/* fixed layout so long names truncate instead of pushing the numbers */}
        <colgroup>
          <col />
          <col className="w-24" />
          <col className="w-20" />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th>Element</th>
            <th>Size</th>
            <th>Share of category</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ category, bytes: categoryBytes, offenders }) => (
            <React.Fragment key={category}>
              <tr className="border-t first:border-t-0">
                <th
                  scope="colgroup"
                  colSpan={3}
                  className="py-1.5 pl-4 text-left font-normal"
                >
                  <span className="inline-flex items-center gap-2 uppercase tracking-wide text-foreground">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0"
                      style={{ background: swatch(category) }}
                    />
                    {CATEGORY_LABELS[category].label}
                  </span>
                </th>
              </tr>
              {offenders.map((offender) => {
                const selection = { kind: offender.kind, id: offender.id };
                const name = selectionName(document, selection);
                return (
                  // The whole row is the hit target (same hover as the data
                  // tables); the name button keeps it keyboard-reachable.
                  <tr
                    key={`${offender.kind}-${offender.id}`}
                    onClick={name ? () => jumpTo(selection, name) : undefined}
                    className={cn(
                      "group/row text-muted-foreground transition-colors",
                      name && "cursor-pointer hover:bg-muted",
                    )}
                  >
                    <th
                      scope="row"
                      className="py-0.5 pl-[2.375rem] text-left font-normal"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {name ? (
                          <Button
                            variant="link"
                            className="h-auto min-w-0 shrink justify-start p-0 font-mono text-xs font-normal text-foreground hover:no-underline"
                            onClick={(event) => {
                              event.stopPropagation();
                              jumpTo(selection, name);
                            }}
                            aria-label={`Inspect ${offender.kind} ${name}`}
                          >
                            {/* underline on the truncating span itself — an offset
                                underline on the button gets clipped by overflow */}
                            <span className="truncate underline-offset-2 group-hover/row:underline">
                              {name}
                            </span>
                          </Button>
                        ) : (
                          <span className="truncate">
                            {offender.kind} {offender.id}
                          </span>
                        )}
                        <Badge variant="muted" size="sm" className="shrink-0">
                          {offender.kind}
                        </Badge>
                      </span>
                    </th>
                    <td className="py-0.5 text-right tabular-nums text-foreground">
                      {formatBytes(offender.bytes)}
                    </td>
                    <td className="py-0.5 pr-4 text-right tabular-nums group-hover/row:text-foreground">
                      {formatShare(offender.bytes, categoryBytes)}
                    </td>
                  </tr>
                );
              })}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}

function StatRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-1">
      <dt className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-right font-mono text-xs tabular-nums text-foreground">
        {value}
        {detail ? (
          <span className="ml-2 text-muted-foreground">{detail}</span>
        ) : null}
      </dd>
    </div>
  );
}

function StatsPanel({
  stats,
  document,
}: {
  stats: GltfStats | null;
  document: GltfDocumentInfo;
}) {
  if (!stats) {
    return (
      <p className="p-4 font-mono text-xs text-muted-foreground">
        Measuring file…
      </p>
    );
  }

  const measured = stats.breakdown.reduce((sum, item) => sum + item.bytes, 0);
  const total = stats.totalSize ?? measured;
  const { counts, gpu } = stats;
  const gpuTotal = gpu.geometry + gpu.textures;
  const required = new Set(stats.extensionsRequired);

  return (
    <div className="flex flex-col pb-4">
      <SectionTitle>File weight</SectionTitle>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Net weight
            </span>
            <span className="text-3xl font-semibold tabular-nums leading-none">
              {stats.totalSize !== null ? formatBytes(stats.totalSize) : "—"}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="muted" size="sm">
              {stats.container === "glb" ? "GLB" : "glTF + resources"}
            </Badge>
            {stats.generator ? (
              <span className="max-w-56 truncate font-mono text-[10px] text-muted-foreground">
                {stats.generator}
              </span>
            ) : null}
          </div>
        </div>
        {stats.totalSize === null ? (
          <p className="font-mono text-xs text-muted-foreground">
            Some external resources could not be measured — showing the{" "}
            {formatBytes(measured)} that could.
          </p>
        ) : null}
        {total > 0 ? <WeightBar stats={stats} total={total} /> : null}
      </div>
      <BreakdownTable stats={stats} total={total} />

      <TopOffenders stats={stats} document={document} />

      <SectionTitle>Scene</SectionTitle>
      <dl className="flex flex-col py-2">
        <StatRow label="Draw calls" value={formatNumber(counts.drawCalls)} />
        <StatRow
          label="Triangles"
          value={formatNumber(counts.triangles.rendered)}
          detail={
            counts.triangles.rendered !== counts.triangles.unique
              ? `${formatNumber(counts.triangles.unique)} unique`
              : undefined
          }
        />
        <StatRow
          label="Vertices"
          value={formatNumber(counts.vertices.rendered)}
          detail={
            counts.vertices.rendered !== counts.vertices.unique
              ? `${formatNumber(counts.vertices.unique)} unique`
              : undefined
          }
        />
        <StatRow
          label="Meshes"
          value={formatNumber(counts.meshes)}
          detail={`${formatNumber(counts.primitives)} primitives`}
        />
        <StatRow label="Nodes" value={formatNumber(counts.nodes)} />
        <StatRow label="Materials" value={formatNumber(counts.materials)} />
        <StatRow
          label="Textures"
          value={formatNumber(counts.textures)}
          detail={`${formatNumber(counts.images)} images`}
        />
        <StatRow label="Animations" value={formatNumber(counts.animations)} />
        <StatRow label="Skins" value={formatNumber(counts.skins)} />
      </dl>

      <SectionTitle>GPU memory (estimate)</SectionTitle>
      <dl className="flex flex-col py-2">
        <StatRow label="Geometry" value={formatBytes(gpu.geometry)} />
        <StatRow label="Textures" value={formatBytes(gpu.textures)} />
        <StatRow
          label="Total"
          value={formatBytes(gpuTotal)}
          detail={
            stats.totalSize
              ? `${(gpuTotal / stats.totalSize).toFixed(1)}× file`
              : undefined
          }
        />
        <p className="px-4 pt-1 font-mono text-[10px] text-muted-foreground">
          Decoded vertex/index buffers; textures as RGBA8 with mipmaps (GPU-
          compressed KTX2 uses less).
        </p>
      </dl>

      <SectionTitle>Extensions</SectionTitle>
      <div className="flex flex-wrap gap-1 px-4 py-2">
        {stats.extensionsUsed.length ? (
          stats.extensionsUsed.map((name) => (
            <Badge
              key={name}
              variant={required.has(name) ? "accent" : "muted"}
              size="sm"
              className="normal-case"
            >
              {name}
              {required.has(name) ? " · required" : ""}
            </Badge>
          ))
        ) : (
          <span className="font-mono text-xs text-muted-foreground">None</span>
        )}
      </div>
    </div>
  );
}

export { StatsPanel };
