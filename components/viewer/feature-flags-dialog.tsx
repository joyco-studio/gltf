'use client'

import * as React from 'react'
import { Check, Link } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'

import {
  FEATURE_FLAGS,
  setFeatureFlag,
  shareUrlWithFlags,
  useFeatureFlags,
} from './feature-flags'

function FeatureFlagsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const flags = useFeatureFlags()
  const [copied, setCopied] = React.useState(false)
  const anyEnabled = FEATURE_FLAGS.some(({ id }) => flags[id])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrlWithFlags(flags))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked — the link is still in the address bar after a reload
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wide">
            Feature flags
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Experimental features. Your choices are saved on this device.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col border-y">
          {FEATURE_FLAGS.map((flag) => (
            <li key={flag.id}>
              <label className="flex cursor-pointer items-start gap-3 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-mono text-xs uppercase tracking-wide">
                    {flag.label}
                  </span>
                  <span className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {flag.description}
                  </span>
                </div>
                <Switch
                  checked={flags[flag.id]}
                  onCheckedChange={(enabled) => setFeatureFlag(flag.id, enabled)}
                  aria-label={flag.label}
                />
              </label>
            </li>
          ))}
        </ul>

        <DialogFooter className="rounded-none sm:items-center sm:justify-between">
          <p className="font-mono text-[10px] text-muted-foreground">
            Links with <code>?flags=</code> turn these on for whoever opens them.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="rounded-none font-mono text-xs"
            disabled={!anyEnabled}
            onClick={() => void copyLink()}
          >
            {copied ? <Check /> : <Link />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { FeatureFlagsDialog }
