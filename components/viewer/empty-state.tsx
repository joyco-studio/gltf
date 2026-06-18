"use client";

import * as React from "react";
import { FileUp, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

import { GltfWordmark } from "./gltf-wordmark";
import { useFilePicker } from "./file-drop-zone";
import { useViewer } from "./viewer-provider";

/** Diagonal hatch fill used behind the secondary action, drawn from the border colour. */
const hatchStyle: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, var(--border) 0, var(--border) 1px, transparent 1px, transparent 7px)",
};

/** Small ©/bracket mark that sits in the card's top-right corner. */
function JoycoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 50.6278 20.7114"
      fill="none"
      aria-hidden="true"
      className={cn("h-3 w-auto text-muted-foreground/60", className)}
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
      <div className="pointer-events-auto relative w-full max-w-[560px] overflow-hidden border bg-background/90 font-mono backdrop-blur-xs">
        {/* vertical rails that cross the whole card */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-8 w-px bg-border"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-8 w-px bg-border"
        />

        {/* header */}
        <div className="flex h-9 items-center justify-between border-b bg-foreground/[0.03] px-8">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            by joyco.studio
          </span>
          <JoycoMark />
        </div>

        {/* wordmark */}
        <div className="border-b bg-foreground/[0.03] px-8 py-9">
          <GltfWordmark className="mx-auto w-[78%] text-foreground/45" />
        </div>

        {/* copy */}
        <div className="flex flex-col items-center gap-1.5 px-8 py-8 text-center">
          <p className="text-sm font-medium uppercase tracking-[0.12em] text-foreground">
            Drop a .glb / .gltf file
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            or paste a URL to inspect meshes and materials
          </p>
          {snapshot.status === "error" && snapshot.error ? (
            <p className="mt-1 max-w-sm text-xs text-destructive">
              {snapshot.error}
            </p>
          ) : null}
        </div>

        {/* actions */}
        <div className="grid grid-cols-2 border-t">
          <button
            type="button"
            onClick={openPicker}
            className="flex items-center justify-center gap-2 bg-primary px-4 py-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <FileUp className="size-4" />
            upload 3D file
          </button>
          <button
            type="button"
            onClick={openExample}
            style={hatchStyle}
            className="flex items-center justify-center border-l px-4 py-3.5 text-sm text-muted-foreground underline decoration-from-font underline-offset-4 transition-colors hover:text-foreground"
          >
            Try sample model
          </button>
        </div>
        {input}
      </div>
    </div>
  );
}

export { EmptyState };
