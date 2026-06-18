"use client";

import * as React from "react";
import { FileUp, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

import { GltfWordmark } from "./gltf-wordmark";
import { useFilePicker } from "./file-drop-zone";
import { useViewer } from "./viewer-provider";

/** Faint diagonal hatch behind the secondary action, drawn from the border colour. */
const hatchStyle: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, color-mix(in oklab, var(--border) 55%, transparent) 0 1px, transparent 1px 8px)",
};

/** Small ©/bracket mark that sits in the card's top-right corner. */
function JoycoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 50.6278 20.7114"
      fill="none"
      aria-hidden="true"
      className={cn("h-3.5 w-auto text-muted-foreground/60", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M47.1759 13.8076L40.2721 20.7114H0V5.75316H25.3139V16.1089H27.6152V3.4519H0V0H50.6278V3.4519H47.1759V13.8076Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Landing card shown over the empty/error canvas — a faithful build of the
 * Figma "OG" composition: framed sections divided by hairline rails, the GLTF
 * wordmark, and the two load actions.
 *
 * Layout rules baked in: vertical rails sit 32px from the frame, and every
 * inner section aligns to them (`mx-8` / `px-8`) so centred content keeps at
 * least 32px of breathing room from the frame edges.
 */
function EmptyState() {
  const { snapshot, openExample } = useViewer();
  const { input, openPicker } = useFilePicker();

  if (snapshot.status === "loading") {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (snapshot.status !== "empty" && snapshot.status !== "error") return null;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
      {/* outer frame — 32px padding all around the inner container */}
      <div className="pointer-events-auto relative w-full max-w-[560px] border bg-background/90 p-8 font-mono backdrop-blur-xs">
        {/* cut-lines: the inner container's edges, extended to the frame tips.
            Top line hugs the header; the buttons' own bottom line (line 6) closes
            the stack, so there is no separate bottom frame line. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-8 h-px bg-border/50" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-8 w-px bg-border/50" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-8 w-px bg-border/50" />

        {/* inner container. 7 horizontal lines total: the two absolute frame
            lines above (top-8 / bottom-8) plus the five below. Each group is
            delimited by a line top & bottom; empty gap bands sit between groups.
            Divider lines use -mx-8 so they bleed past the rails to the frame tips. */}
        <div className="relative">
          {/* group 1 — header (joyco + logo), flush between lines 1 and 2 */}
          <div className="flex h-8 items-stretch justify-between">
            <span className="flex w-[62%] items-center whitespace-nowrap bg-foreground/[0.05] px-3 text-[14px] uppercase tracking-[0.12em] text-muted-foreground">
              by joyco.studio ↗
            </span>
            <JoycoMark className="h-full w-auto shrink-0 text-muted-foreground/60" />
          </div>

          {/* line 2 */}
          <div aria-hidden className="-mx-8 h-px bg-border/50" />

          {/* line 3 — mt-8 (half the outer padding) is the gap between groups 1 and 2 */}
          <div aria-hidden className="-mx-8 mt-8 h-px bg-border/50" />

          {/* group 2 — GLTF logo (panel delimited by lines 3 & 4) */}
          <div className="bg-foreground/[0.05] px-4 py-6">
            <GltfWordmark className="mx-auto w-full max-w-[460px] text-foreground/45" />
          </div>

          {/* line 4 */}
          <div aria-hidden className="-mx-8 h-px bg-border/50" />

          {/* line 5 — mt-8 (half the outer padding) is the gap between groups 2 and 3 */}
          <div aria-hidden className="-mx-8 mt-8 h-px bg-border/50" />

          {/* group 3 — text + buttons are one element (no divider between them),
              delimited by lines 5 & 6; no bottom padding so the buttons reach line 6 */}
          <div className="flex flex-col">
            <div className="flex flex-col items-center gap-2 px-8 py-8 text-center">
              <p className="text-[14px] font-medium uppercase tracking-[0.1em] text-foreground">
                Drop a .glb / .gltf file
              </p>
              <p className="text-[14px] leading-relaxed text-muted-foreground">
                or paste a URL to inspect meshes
                <br />
                and materials
              </p>
              {snapshot.status === "error" && snapshot.error ? (
                <p className="mt-1 max-w-sm text-[14px] text-destructive">
                  {snapshot.error}
                </p>
              ) : null}
            </div>

            {/* line hugging the top of the buttons */}
            <div aria-hidden className="-mx-8 h-px bg-border/50" />

            <div className="grid grid-cols-2">
              <button
                type="button"
                onClick={openPicker}
                className="flex items-center justify-center gap-2 bg-primary px-4 py-4 text-[16px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <FileUp className="size-4" />
                upload 3D file
              </button>
              <button
                type="button"
                onClick={openExample}
                style={hatchStyle}
                className="flex items-center justify-center border-l px-4 py-4 text-[16px] text-muted-foreground underline decoration-from-font underline-offset-4 transition-colors hover:text-foreground"
              >
                Try sample model
              </button>
            </div>
          </div>

          {/* line 6 */}
          <div aria-hidden className="-mx-8 h-px bg-border/50" />
        </div>
        {input}
      </div>
    </div>
  );
}

export { EmptyState };
