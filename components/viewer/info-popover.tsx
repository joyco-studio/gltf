"use client";

import * as React from "react";
import { Globe, Info } from "lucide-react";
import { REVISION } from "three/webgpu";

import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

function XLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

function GithubLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function InfoLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 px-2 py-1.5 font-mono text-xs transition-colors hover:bg-accent hover:text-foreground"
    >
      {icon}
      {children}
    </a>
  );
}

function InfoPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="accent" size="icon-sm">
          <Info />
          <span className="sr-only">About</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-64 p-0">
        <div className="flex flex-col gap-2 p-3">
          <Logo className="h-5 self-start" />
          <p className="font-mono text-xs">
            glTF visualizer — made by JOYCO Studio
          </p>
        </div>

        <div className="flex items-center justify-between px-3 py-2">
          <span className="font-mono text-xs uppercase tracking-wide">
            Engine
          </span>
          <Badge variant="muted" size="sm">
            three.js r{REVISION} · WebGPU
          </Badge>
        </div>

        <div className="flex flex-col p-1">
          <InfoLink
            href="https://joyco.studio"
            icon={<Globe className="size-3.5" />}
          >
            joyco.studio
          </InfoLink>
          <InfoLink
            href="https://x.com/joyco_studio"
            icon={<XLogo className="size-3" />}
          >
            @joyco_studio
          </InfoLink>
          <InfoLink
            href="https://github.com/joyco-studio/gltf"
            icon={<GithubLogo className="size-3.5" />}
          >
            joyco-studio/gltf
          </InfoLink>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { InfoPopover };
