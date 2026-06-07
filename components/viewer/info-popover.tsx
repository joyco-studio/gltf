'use client'

import * as React from 'react'
import { Globe, Info } from 'lucide-react'
import { REVISION } from 'three/webgpu'

import { Logo } from '@/components/logo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'

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
  )
}

function InfoLink({
  href,
  icon,
  children,
}: {
  href: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 px-2 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {icon}
      {children}
    </a>
  )
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
          <p className="font-mono text-xs text-muted-foreground">
            glTF visualizer — made by JOYCO Studio
          </p>
        </div>

        <Separator />

        <div className="flex items-center justify-between px-3 py-2">
          <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Engine
          </span>
          <Badge variant="muted" size="sm">
            three.js r{REVISION} · WebGPU
          </Badge>
        </div>

        <Separator />

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
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { InfoPopover }
