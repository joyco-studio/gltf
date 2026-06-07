"use client";

import * as React from "react";
import { Search, Upload } from "lucide-react";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cluster, Filler } from "@/components/ui/cluster";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { formatNumber } from "@/lib/format";

import { useFilePicker } from "./file-drop-zone";
import { useViewer } from "./viewer-provider";

function ViewerHeader() {
  const { snapshot, setSearchOpen } = useViewer();
  const { input, openPicker } = useFilePicker();
  const { document } = snapshot;

  return (
    <header className="absolute inset-x-4 top-4 z-30">
      <Cluster bg="accent">
        <div className="flex items-center gap-2.5 self-stretch px-3">
          <Logo className="h-4" />
          <h1 className="font-heading text-sm font-semibold uppercase tracking-wide">
            glTF
          </h1>
        </div>

        {document ? (
          <>
            <Separator
              orientation="vertical"
              className="h-auto self-stretch [--thickness:0.5px]"
            />
            <div className="flex min-w-0 items-center gap-2 self-stretch px-3 font-mono text-xs text-muted-foreground">
              <span className="max-w-48 truncate text-foreground">
                {document.fileName}
              </span>
              <Badge variant="card" size="sm">
                {formatNumber(document.scene.totalVertexCount)} verts
              </Badge>
              <Badge variant="card" size="sm">
                {document.meshes.length} meshes
              </Badge>
              <Badge variant="card" size="sm">
                {document.materials.length} materials
              </Badge>
              <Badge variant="card" size="sm">
                {document.textures.length} textures
              </Badge>
            </div>
          </>
        ) : null}

        <Filler />

        <Button
          variant="accent"
          size="sm"
          onClick={() => setSearchOpen(true)}
          disabled={!document}
          className="min-w-40 justify-between"
        >
          <div className="flex gap-x-2">
            <Search />
            Search
          </div>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        <Button variant="accent" size="sm" onClick={openPicker}>
          <Upload />
          Open
        </Button>
        <Separator
          orientation="vertical"
          className="h-auto self-stretch [--thickness:0.5px]"
        />
        <ThemeToggle variant="accent" size="icon-sm" />
        {input}
      </Cluster>
    </header>
  );
}

export { ViewerHeader };
