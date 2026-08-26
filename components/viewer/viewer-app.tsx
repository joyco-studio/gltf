"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { fetchValidationSchema } from "@/lib/viz/fetch-validation-schema";

import { ControlsToolbar } from "./controls-toolbar";
import { EmptyState } from "./empty-state";
import { EXAMPLE_MODEL } from "./example-model";
import { FileDropZone, parseHttpUrl } from "./file-drop-zone";
import { resolveSharePath } from "./share-path";
import { InspectBanner } from "./inspect-banner";
import { InspectorPanel } from "./inspector-panel";
import { SearchCommand } from "./search-command";
import { ViewerCanvas } from "./viewer-canvas";
import { ViewerHeader } from "./viewer-header";
import { ViewerProvider, useViewer } from "./viewer-provider";

/**
 * Consumes the initial deep link: loads `?url=` and `?schemaUrl=` once the
 * viewer is attached, then jumps to `?path=` (e.g. `materials.mat_1`) once
 * that document is parsed.
 * The active `?tab=` is owned by nuqs in ViewerProvider; it is captured here
 * only so an explicit tab wins while restoring a path.
 *
 * The model URL, schema URL, and selection path are read *once* at first load;
 * later writes must not feed back here as reloads. The tab is intentionally
 * live so direct links and browser navigation update the UI.
 */
function UrlParamLoader() {
  const {
    viewer,
    snapshot,
    openUrl,
    jumpTo,
    tab,
    setTab,
    setValidationSchema,
    getValidationSchemaRevision,
    setValidationSchemaError,
  } = useViewer();
  const searchParams = useSearchParams();
  const startedRef = React.useRef(false);
  // captured at first load, before openUrl clears ?path; applied to the first
  // parsed document only (a later paste must not re-jump to the deep-link path)
  const initialPathRef = React.useRef<string | null>(null);
  const initialTabRef = React.useRef<typeof tab | null>(null);
  const jumpedDocRef = React.useRef<typeof snapshot.document>(null);

  React.useEffect(() => {
    if (!viewer || startedRef.current) return;
    // consume the one-shot the moment the viewer is ready, even with no ?url —
    // otherwise the first paste's ?url= write would re-enter here and double-load
    startedRef.current = true;
    const schemaUrl = searchParams.get("schemaUrl");
    if (schemaUrl) {
      const schemaRevision = getValidationSchemaRevision();
      void fetchValidationSchema(schemaUrl).then((result) => {
        if (getValidationSchemaRevision() !== schemaRevision) return;
        if (result.ok) setValidationSchema(result.schema, result.url);
        else setValidationSchemaError(result.error);
      });
    }

    const url = parseHttpUrl(searchParams.get("url") ?? "");
    if (!url) return;
    initialPathRef.current = searchParams.get("path");
    initialTabRef.current = searchParams.get("tab") === tab ? tab : null;
    // honour the example's placement when shared via ?url=
    const transform =
      url === EXAMPLE_MODEL.url
        ? { position: EXAMPLE_MODEL.position, scale: EXAMPLE_MODEL.scale }
        : undefined;
    openUrl(url, transform);
  }, [
    viewer,
    searchParams,
    tab,
    openUrl,
    setValidationSchema,
    getValidationSchemaRevision,
    setValidationSchemaError,
  ]);

  React.useEffect(() => {
    const { document } = snapshot;
    if (!document || jumpedDocRef.current === document) return;
    jumpedDocRef.current = document;
    const path = initialPathRef.current;
    const initialTab = initialTabRef.current;
    initialPathRef.current = null; // deep-link path applies to the first model
    initialTabRef.current = null;
    if (!path) return;
    const resolved = resolveSharePath(document, path);
    if (!resolved) return;
    jumpTo(resolved.selection, resolved.name);
    // `path` selects an entity and its natural tab, but an explicit `tab`
    // represents what the sharer actually had open and therefore wins.
    if (initialTab) setTab(initialTab);
  }, [snapshot, jumpTo, setTab]);

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
