"use client";

import * as React from "react";
import { Box, Image as ImageIcon, Palette } from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import { useViewer, type Selection } from "./viewer-provider";

/**
 * ⌘K fuzzy search across every named entity in the glTF document. Selecting
 * a result jumps the contents browser to the matching tab and row.
 */
function SearchCommand() {
  const { viewer, snapshot, setTab, select, searchOpen, setSearchOpen } =
    useViewer();
  const { document } = snapshot;

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchOpen]);

  const jumpTo = (selection: Selection, name?: string) => {
    setTab(selection.kind === "texture" ? "textures" : "contents");
    select(selection);
    // meshes get framed for close inspection (ESC exits)
    if (selection.kind === "mesh" && name !== undefined) {
      viewer?.inspectMesh(selection.id, name);
    }
    setSearchOpen(false);
  };

  return (
    <CommandDialog
      open={searchOpen}
      onOpenChange={setSearchOpen}
      title="Search glTF contents"
      description="Fuzzy search meshes, materials and textures by name"
      className="sm:min-w-sm sm:max-w-sm"
    >
      <Command>
        <CommandInput placeholder="Search meshes, materials, textures..." />
        <CommandList>
          <CommandEmpty>
            {document ? "No results found." : "Load a glTF file first."}
          </CommandEmpty>

          {document && document.meshes.length > 0 ? (
            <CommandGroup heading="Meshes">
              {document.meshes.map((mesh) => (
                <CommandItem
                  key={`mesh-${mesh.id}`}
                  value={`mesh ${mesh.name} ${mesh.id}`}
                  onSelect={() => jumpTo({ kind: "mesh", id: mesh.id }, mesh.name)}
                >
                  <Box />
                  {mesh.name}
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    #{mesh.id}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {document && document.materials.length > 0 ? (
            <CommandGroup heading="Materials">
              {document.materials.map((material) => (
                <CommandItem
                  key={`material-${material.id}`}
                  value={`material ${material.name} ${material.id}`}
                  onSelect={() => jumpTo({ kind: "material", id: material.id })}
                >
                  <Palette />
                  {material.name}
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    #{material.id}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {document && document.textures.length > 0 ? (
            <CommandGroup heading="Textures">
              {document.textures.map((texture) => (
                <CommandItem
                  key={`texture-${texture.id}`}
                  value={`texture ${texture.name} ${texture.id}`}
                  onSelect={() => jumpTo({ kind: "texture", id: texture.id })}
                >
                  <ImageIcon />
                  {texture.name}
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    #{texture.id}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export { SearchCommand };
