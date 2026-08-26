'use client'

import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  GltfValidationReference,
  GltfValidationResult,
  GltfValidationType,
} from '@/lib/viz/validate'

import { useViewer } from './viewer-provider'

const TYPE_LABELS: Record<GltfValidationType, string> = {
  error: 'Errors',
  warning: 'Warnings',
}

function ValidationDescription({ result }: { result: GltfValidationResult }) {
  const { snapshot, jumpTo } = useViewer()
  const references = result.references ?? []

  if (references.length === 0) return result.description

  const parts: React.ReactNode[] = []
  let cursor = 0

  for (const reference of references) {
    const index = result.description.indexOf(reference.label, cursor)
    if (index < 0) continue
    parts.push(result.description.slice(cursor, index))
    parts.push(
      <ValidationReferenceLink
        key={`${reference.kind}-${reference.id}`}
        reference={reference}
        onJump={(name) =>
          jumpTo({ kind: reference.kind, id: reference.id }, name)
        }
        nodeName={snapshot.document?.nodes.find(
          (node) => node.id === reference.id,
        )?.name}
      />,
    )
    cursor = index + reference.label.length
  }
  parts.push(result.description.slice(cursor))

  return parts
}

function ValidationReferenceLink({
  reference,
  nodeName,
  onJump,
}: {
  reference: GltfValidationReference
  nodeName: string | undefined
  onJump: (name: string) => void
}) {
  if (!nodeName) return reference.label

  return (
    <Button
      variant="link"
      className="h-auto p-0 align-baseline font-mono text-sm font-normal"
      onClick={() => onJump(nodeName)}
      aria-label={`Inspect node ${reference.label}`}
    >
      {reference.label}
    </Button>
  )
}

function ValidationSection({
  type,
  results,
}: {
  type: GltfValidationType
  results: GltfValidationResult[]
}) {
  return (
    <section>
      <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide">
          {TYPE_LABELS[type]}
        </h2>
        <Badge variant={type === 'error' ? 'destructive' : 'muted'} size="sm">
          {results.length}
        </Badge>
      </div>

      {results.length > 0 ? (
        <ul>
          {results.map((result, index) => (
            <li
              key={`${result.type}-${result.title}-${index}`}
              className="border-b px-4 py-3 last:border-b-0"
            >
              <h3 className="text-sm font-medium text-foreground">
                {result.title}
              </h3>
              <p className="mt-1 max-w-prose text-sm leading-5 text-muted-foreground">
                <ValidationDescription result={result} />
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-b px-4 py-3 font-mono text-xs text-muted-foreground">
          No {TYPE_LABELS[type].toLowerCase()} found.
        </p>
      )}
    </section>
  )
}

function ValidationList({ issues }: { issues: GltfValidationResult[] }) {
  const errors = issues.filter((result) => result.type === 'error')
  const warnings = issues.filter((result) => result.type === 'warning')

  return (
    <div>
      <ValidationSection type="error" results={errors} />
      <ValidationSection type="warning" results={warnings} />
    </div>
  )
}

export { ValidationList }
