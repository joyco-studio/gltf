"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { FileUp, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

import { ControlsToolbar } from "./controls-toolbar";
import { FileDropZone, parseHttpUrl, useFilePicker } from "./file-drop-zone";
import { resolveSharePath } from "./share-path";
import { InspectBanner } from "./inspect-banner";
import { InspectorPanel } from "./inspector-panel";
import { SearchCommand } from "./search-command";
import { ViewerCanvas } from "./viewer-canvas";
import { ViewerHeader } from "./viewer-header";
import { ViewerProvider, useViewer } from "./viewer-provider";

function EmptyState() {
  const { snapshot } = useViewer();
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
        {input}
      </div>
    </div>
  );
}

/**
 * Auto-loads a model from `?url=` once the viewer instance is attached, then
 * jumps to `?path=` (e.g. `materials.mat_1`) once the document is parsed.
 */
function UrlParamLoader() {
  const { viewer, snapshot, openUrl, jumpTo } = useViewer();
  const searchParams = useSearchParams();
  const url = parseHttpUrl(searchParams.get("url") ?? "");
  const path = searchParams.get("path");
  const loadedRef = React.useRef<string | null>(null);
  // guarded by document identity (one jump per loaded model), NOT by path:
  // in-app selections rewrite ?path and must not re-trigger the jump
  const jumpedDocRef = React.useRef<typeof snapshot.document>(null);

  React.useEffect(() => {
    if (!viewer || !url || loadedRef.current === url) return;
    loadedRef.current = url;
    openUrl(url);
  }, [viewer, url, openUrl]);

  React.useEffect(() => {
    const { document } = snapshot;
    if (!document || jumpedDocRef.current === document) return;
    jumpedDocRef.current = document;
    if (!path) return;
    const resolved = resolveSharePath(document, path);
    if (resolved) jumpTo(resolved.selection, resolved.name);
  }, [snapshot, path, jumpTo]);

  return null;
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
