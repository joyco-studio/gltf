"use client";

import * as React from "react";
import { FileUp, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

import { GltfGlyph } from "./gltf-wordmark";
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
 * Landing card shown over the empty/error canvas — the wide Figma layout:
 * a header row (joyco / ⌘K), a main row split into the GLTF glyph on a hatched
 * panel and the copy, and an actions row (try sample / upload).
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
      <div className="pointer-events-auto relative w-full max-w-[800px] border bg-background/90 p-8 font-mono backdrop-blur-xs">
        {/* frame cut-lines, extended to the tips */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-8 h-px bg-border/50" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-8 h-px bg-border/50" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-8 w-px bg-border/50" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-8 w-px bg-border/50" />

        <div className="relative">
          {/* header row — joyco | press ⌘K */}
          <div className="grid grid-cols-2">
            <div className="flex h-8 items-center justify-between gap-2 whitespace-nowrap bg-foreground/[0.05] px-3 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              by joyco.studio ↗
            </div>
            <div className="flex h-8 items-center gap-1.5 whitespace-nowrap border-l px-3 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70">
              press
              <KbdGroup>
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </KbdGroup>
              to search
            </div>
          </div>

          {/* logo mark, top-right corner */}
          <JoycoMark className="absolute right-0 top-0 h-8 w-auto text-muted-foreground/60" />

          {/* line under the header */}
          <div aria-hidden className="-mx-8 h-px bg-border/50" />

          {/* gap band (32px) then the line that opens the main row */}
          <div aria-hidden className="-mx-8 mt-8 h-px bg-border/50" />

          {/* main row — GLTF glyph on hatch | copy */}
          <div className="grid h-[220px] grid-cols-2">
            <div
              style={hatchStyle}
              className="relative flex items-center justify-center overflow-hidden"
            >
              {/* glyph band — horizontal guidelines hug the glyph top & bottom (full width) */}
              <div className="relative z-10 flex w-full justify-center border-y border-border/50">
                {/* glyph wrapper — vertical guidelines hug the glyph's left & right
                    edges and span the whole box (clipped by overflow-hidden) */}
                <div className="relative">
                  <GltfGlyph className="h-28 w-auto text-foreground" />
                  <div aria-hidden className="pointer-events-none absolute inset-y-[-999px] left-0 w-px bg-border/50" />
                  <div aria-hidden className="pointer-events-none absolute inset-y-[-999px] right-0 w-px bg-border/50" />
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center justify-center border-l px-8 py-12">
              <div className="flex flex-col gap-4 text-left">
                <p className="font-sans text-lg font-semibold tracking-tight text-foreground">
                  Drop a .GLB/.GLTF File
                </p>
                <p className="max-w-[231px] text-[14px] leading-relaxed text-muted-foreground">
                  or paste a URL to inspect meshes and materials
                </p>
                {snapshot.status === "error" && snapshot.error ? (
                  <p className="max-w-[231px] text-[14px] text-destructive">
                    {snapshot.error}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {/* line above the actions */}
          <div aria-hidden className="-mx-8 h-px bg-border/50" />

          {/* actions row — try sample | upload */}
          <div className="grid grid-cols-2">
            <button
              type="button"
              onClick={openExample}
              className="flex items-center justify-center px-3 py-3.5 text-[16px] text-muted-foreground underline decoration-from-font underline-offset-4 transition-colors hover:text-foreground"
            >
              Try sample model
            </button>
            <button
              type="button"
              onClick={openPicker}
              className="flex items-center justify-center gap-2 border-l bg-primary px-4 py-3.5 text-[16px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <FileUp className="size-4" />
              upload 3D file
            </button>
          </div>
        </div>
        {input}
      </div>
    </div>
  );
}

export { EmptyState };
