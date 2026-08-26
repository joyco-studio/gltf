"use client";

import * as React from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { AnimationsTable } from "./animations-table";
import { HierarchyTable } from "./hierarchy-table";
import { MaterialsTable } from "./materials-table";
import { TexturesGrid } from "./textures-grid";
import { ValidationList } from "./validation-list";
import { useViewer, type InspectorTab } from "./viewer-provider";

function SectionTitle({
  children,
  count,
}: {
  children: React.ReactNode;
  count: number;
}) {
  return (
    <div className="flex items-center bg-muted/50 gap-2 px-4 p-2">
      <h2 className="font-heading text-sm font-semibold uppercase tracking-wide">
        {children}
      </h2>
      <Badge variant="muted" size="sm">
        {count}
      </Badge>
    </div>
  );
}

const DEFAULT_PANEL_WIDTH = 600; // px
const MIN_PANEL_WIDTH = 360;
/** Keep the panel from swallowing the 16px right margin. */
const PANEL_EDGE_MARGIN = 32;

/**
 * The glTF contents browser: meshes & materials in one tab, textures in
 * another. Floats on the left, spaced from the screen edge and the header
 * by the same 16px padding the header uses. The right edge is a drag
 * handle for resizing (double-click resets).
 */
function InspectorPanel() {
  const {
    snapshot,
    tab,
    setTab,
    sidebarOpen: open,
    setSidebarOpen: setOpen,
  } = useViewer();
  const [width, setWidth] = React.useState(DEFAULT_PANEL_WIDTH);
  const [resizing, setResizing] = React.useState(false);
  const { document } = snapshot;

  // ⌃B / ⌘B toggles the sidebar (the editor-familiar binding)
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "b" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setOpen]);

  const asideRef = React.useRef<HTMLElement>(null);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const aside = asideRef.current;
    if (!aside) return;

    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = aside.offsetWidth;
    handle.setPointerCapture(event.pointerId);
    setResizing(true);

    // Drag writes the width straight to the DOM (rAF-coalesced) — going
    // through setState would re-render the whole table subtree on every
    // pointermove, which is what made resizing laggy. React state gets a
    // single commit on release.
    let nextWidth = startWidth;
    let frame = 0;

    const clampWidth = (value: number) =>
      Math.min(
        Math.max(value, MIN_PANEL_WIDTH),
        window.innerWidth - PANEL_EDGE_MARGIN,
      );

    const handleMove = (move: PointerEvent) => {
      nextWidth = clampWidth(startWidth + move.clientX - startX);
      if (frame) return; // at most one layout per frame
      frame = requestAnimationFrame(() => {
        frame = 0;
        aside.style.width = `${nextWidth}px`;
      });
    };
    const handleUp = (up: PointerEvent) => {
      handle.releasePointerCapture(up.pointerId);
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", handleUp);
      if (frame) cancelAnimationFrame(frame);
      aside.style.width = `${nextWidth}px`;
      setWidth(nextWidth); // single commit
      setResizing(false);
    };
    handle.addEventListener("pointermove", handleMove);
    handle.addEventListener("pointerup", handleUp);
  };

  if (!document) return null;

  if (!open) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon-sm"
            onClick={() => setOpen(true)}
            className="pointer-events-auto absolute top-0 left-4 z-30"
          >
            <PanelLeftOpen />
            <span className="sr-only">Show contents browser</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Show contents · ⌃B</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <aside
      ref={asideRef}
      className="pointer-events-auto absolute top-0 bottom-4 left-4 z-40 flex max-w-[calc(100%-2rem)] flex-col border bg-background/85 backdrop-blur-md"
      style={{ width }}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as InspectorTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* tight header: no padding, same h-8 rhythm as the app header */}
        <div className="flex h-8 items-center justify-between border-b">
          <TabsList className="h-8 gap-0">
            <TabsTrigger value="contents" className="h-8">
              Instances
            </TabsTrigger>
            <TabsTrigger value="textures" className="h-8">
              Textures
              <Badge variant="muted" size="sm">
                {document.textures.length}
              </Badge>
            </TabsTrigger>
            {document.animations.length > 0 ? (
              <TabsTrigger value="animations" className="h-8">
                Animations
                <Badge variant="muted" size="sm">
                  {document.animations.length}
                </Badge>
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="validation" className="h-8">
              Validation
              <Badge variant="muted" size="sm">
                {document.validationIssues.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen(false)}
              >
                <PanelLeftClose />
                <span className="sr-only">Hide contents browser</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Hide contents · ⌃B</TooltipContent>
          </Tooltip>
        </div>

        <TabsContent value="contents" className="min-h-0">
          {/* radix's viewport wrapper is display:table (inline style), which
              lets wide tables blow past the panel instead of x-scrolling in
              their own containers — force it back to block */}
          <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
            <SectionTitle count={document.nodes.length}>Hierarchy</SectionTitle>
            <HierarchyTable nodes={document.nodes} meshes={document.meshes} />
            <SectionTitle count={document.materials.length}>
              Materials
            </SectionTitle>
            <MaterialsTable materials={document.materials} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="textures" className="min-h-0">
          <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
            <TexturesGrid textures={document.textures} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="animations" className="min-h-0">
          <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
            <AnimationsTable animations={document.animations} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="validation" className="min-h-0">
          <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
            <ValidationList issues={document.validationIssues} />
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* resize handle on the floating right edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize contents browser"
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(DEFAULT_PANEL_WIDTH)}
        className={cn(
          "absolute top-0 -right-1 bottom-0 w-2 cursor-col-resize touch-none select-none",
          // right-[3px] (not 4) — absolute children anchor to the padding
          // box, so the extra 1px lands the line on the border itself
          "after:absolute after:inset-y-0 after:right-[3px] after:w-px after:bg-transparent after:transition-colors hover:after:bg-foreground/60",
          resizing && "after:bg-foreground",
        )}
      />
    </aside>
  );
}

export { InspectorPanel };
