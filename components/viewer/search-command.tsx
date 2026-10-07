"use client";

import * as React from "react";
import { Box, Image as ImageIcon, Palette, Play } from "lucide-react";

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
import { NODE_TYPE_ICONS, NODE_TYPE_LABELS } from "./node-type";

/**
 * ⌘K fuzzy search across every named entity in the glTF document. Selecting
 * a result jumps the contents browser to the matching tab and row.
 */
function SearchCommand() {
  const { snapshot, jumpTo, searchOpen, setSearchOpen } = useViewer();
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

  const handleSelect = (selection: Selection, name: string) => {
    jumpTo(selection, name);
    setSearchOpen(false);
  };

  return (
    <CommandDialog
      open={searchOpen}
      onOpenChange={setSearchOpen}
      title="Search glTF contents"
      description="Fuzzy search nodes, meshes, materials, textures and animations by name"
      className="sm:min-w-sm sm:max-w-sm"
    >
      <Command>
        <CommandInput placeholder="Search nodes, meshes, materials..." />
        <CommandList>
          <CommandEmpty>
            {document ? "No results found." : "Load a glTF file first."}
          </CommandEmpty>

          {document && document.nodes.length > 0 ? (
            <CommandGroup heading="Nodes">
              {document.nodes.map((node) => {
                const Icon = NODE_TYPE_ICONS[node.objectType];
                return (
                  <CommandItem
                    key={`node-${node.id}`}
                    value={`node ${node.name} ${node.id}`}
                    keywords={[NODE_TYPE_LABELS[node.objectType]]}
                    onSelect={() => handleSelect({ kind: "node", id: node.id }, node.name)}
                  >
                    <Icon />
                    {node.name}
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      #{node.id}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {document && document.meshes.length > 0 ? (
            <CommandGroup heading="Meshes">
              {document.meshes.map((mesh) => (
                <CommandItem
                  key={`mesh-${mesh.id}`}
                  value={`mesh ${mesh.name} ${mesh.id}`}
                  onSelect={() => handleSelect({ kind: "mesh", id: mesh.id }, mesh.name)}
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
                  onSelect={() =>
                    handleSelect(
                      { kind: "material", id: material.id },
                      material.name,
                    )
                  }
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
                  onSelect={() =>
                    handleSelect(
                      { kind: "texture", id: texture.id },
                      texture.name,
                    )
                  }
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

          {document && document.animations.length > 0 ? (
            <CommandGroup heading="Animations">
              {document.animations.map((animation) => (
                <CommandItem
                  key={`animation-${animation.id}`}
                  value={`animation ${animation.name} ${animation.id}`}
                  onSelect={() =>
                    handleSelect(
                      { kind: "animation", id: animation.id },
                      animation.name,
                    )
                  }
                >
                  <Play />
                  {animation.name}
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    #{animation.id}
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
