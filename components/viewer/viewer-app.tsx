"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { FileUp, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

import { ControlsToolbar } from "./controls-toolbar";
import { EXAMPLE_MODEL } from "./example-model";
import { FileDropZone, parseHttpUrl, useFilePicker } from "./file-drop-zone";
import { resolveSharePath } from "./share-path";
import { InspectBanner } from "./inspect-banner";
import { InspectorPanel } from "./inspector-panel";
import { SearchCommand } from "./search-command";
import { ViewerCanvas } from "./viewer-canvas";
import { ViewerHeader } from "./viewer-header";
import { ViewerProvider, useViewer } from "./viewer-provider";

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
    <div className="absolute inset-0 z-10 flex items-center justify-center">
      <div className="pointer-events-auto flex flex-col max-w-[calc(100%-2rem)] sm:max-w-md items-center gap-4 border border-dashed bg-background/85 px-12 py-10 text-center backdrop-blur-xs">
        <FileUp className="size-8 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="font-heading text-sm font-semibold uppercase tracking-wide">
            Drop a .glb / .gltf anywhere
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            or paste a URL — then browse its meshes, materials and textures,
            press{" "}
            <KbdGroup className="inline-flex">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>{" "}
            to search
          </p>
        </div>
        {snapshot.status === "error" && snapshot.error ? (
          <p className="max-w-sm font-mono text-xs text-destructive">
            {snapshot.error}
          </p>
        ) : null}
        <Button onClick={openPicker}>
          <FileUp />
          Open file
        </Button>
        <p className="font-mono text-xs text-muted-foreground">
          or{" "}
          <button
            type="button"
            onClick={openExample}
            className="underline underline-offset-2 transition-colors hover:text-foreground"
          >
            try example
          </button>
        </p>
        {input}
      </div>
    </div>
  );
}

/**
 * Consumes the initial deep link: loads `?url=` once the viewer is attached,
 * then jumps to `?path=` (e.g. `materials.mat_1`) once that document is parsed.
 *
 * The URL is read *once* (at first load) and is purely an output afterwards —
 * openUrl/openFiles/jumpTo rewrite it, but those rewrites must never feed back
 * here as a reload. So the load effect is a one-shot guarded by `startedRef`,
 * not a reaction to live searchParams.
 */
function UrlParamLoader() {
  const { viewer, snapshot, openUrl, jumpTo } = useViewer();
  const searchParams = useSearchParams();
  const startedRef = React.useRef(false);
  // captured at first load, before openUrl clears ?path; applied to the first
  // parsed document only (a later paste must not re-jump to the deep-link path)
  const initialPathRef = React.useRef<string | null>(null);
  const jumpedDocRef = React.useRef<typeof snapshot.document>(null);

  React.useEffect(() => {
    if (!viewer || startedRef.current) return;
    // consume the one-shot the moment the viewer is ready, even with no ?url —
    // otherwise the first paste's ?url= write would re-enter here and double-load
    startedRef.current = true;
    const url = parseHttpUrl(searchParams.get("url") ?? "");
    if (!url) return;
    initialPathRef.current = searchParams.get("path");
    // honour the example's placement when shared via ?url=
    const transform =
      url === EXAMPLE_MODEL.url
        ? { position: EXAMPLE_MODEL.position, scale: EXAMPLE_MODEL.scale }
        : undefined;
    openUrl(url, transform);
  }, [viewer, searchParams, openUrl]);

  React.useEffect(() => {
    const { document } = snapshot;
    if (!document || jumpedDocRef.current === document) return;
    jumpedDocRef.current = document;
    const path = initialPathRef.current;
    initialPathRef.current = null; // deep-link path applies to the first model
    if (!path) return;
    const resolved = resolveSharePath(document, path);
    if (resolved) jumpTo(resolved.selection, resolved.name);
  }, [snapshot, jumpTo]);

  return null;
}

/** Credits the bundled showcase model while it's the one on screen. */
function ModelCredit() {
  const { snapshot, isExample } = useViewer();

  if (!isExample || snapshot.status !== "ready") return null;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2 border bg-background/85 px-3 py-1.5 backdrop-blur-xs">
      <p className="font-mono text-xs text-muted-foreground">
        Model:{" "}
        <a
          href={EXAMPLE_MODEL.credit}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          {EXAMPLE_MODEL.name}
        </a>{" "}
        by {EXAMPLE_MODEL.artist}
      </p>
    </div>
  );
}

/** Surfaces load errors that happen while a previous model stays on screen. */
function ErrorBanner() {
  const { snapshot } = useViewer();

  if (snapshot.status !== "ready" || !snapshot.error) return null;

  return (
    <div className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 border border-destructive/50 bg-background/90 px-4 py-2 backdrop-blur-sm">
      <p className="font-mono text-xs text-destructive">{snapshot.error}</p>
    </div>
  );
}

function ViewerApp() {
  return (
    <ViewerProvider>
      <div className="relative h-dvh overflow-hidden">
        <ViewerCanvas className="absolute inset-0" />
        <ViewerHeader />
        {/* pointer-events pass through to the canvas; interactive overlays opt back in.
            top-16 = header bottom (top-4 + h-8 cluster) + the same 16px gap */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-16">
          <div className="relative h-full">
            <EmptyState />
            <InspectorPanel />
            <ControlsToolbar />
            <InspectBanner />
            <ModelCredit />
            <ErrorBanner />
          </div>
        </div>
        <FileDropZone />
        <SearchCommand />
        {/* useSearchParams needs a Suspense boundary on prerendered routes */}
        <React.Suspense>
          <UrlParamLoader />
        </React.Suspense>
      </div>
    </ViewerProvider>
  );
}

export { ViewerApp };
