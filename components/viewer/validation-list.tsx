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
import { ValidationSchemaEditor } from './validation-schema-editor'

const TYPE_LABELS: Record<GltfValidationType, string> = {
  error: 'Errors',
  warning: 'Warnings',
}

function referenceName(
  document: ReturnType<typeof useViewer>['snapshot']['document'],
  reference: GltfValidationReference
) {
  if (!document) return undefined
  switch (reference.kind) {
    case 'node':
      return document.nodes.find(({ id }) => id === reference.id)?.name
    case 'mesh':
      return document.meshes.find(({ id }) => id === reference.id)?.name
    case 'material':
      return document.materials.find(({ id }) => id === reference.id)?.name
    case 'texture':
      return document.textures.find(({ id }) => id === reference.id)?.name
    case 'animation':
      return document.animations.find(({ id }) => id === reference.id)?.name
  }
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
        name={referenceName(snapshot.document, reference)}
      />,
    )
    cursor = index + reference.label.length
  }
  parts.push(result.description.slice(cursor))

  return parts
}

function ValidationReferenceLink({
  reference,
  name,
  onJump,
}: {
  reference: GltfValidationReference
  name: string | undefined
  onJump: (name: string) => void
}) {
  if (!name) return reference.label

  return (
    <Button
      variant="link"
      className="h-auto p-0 align-baseline font-mono text-sm font-normal text-foreground underline"
      onClick={() => onJump(name)}
      aria-label={`Inspect ${reference.kind} ${reference.label}`}
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
  const { validationSchemaError } = useViewer()
  const errors = issues.filter((result) => result.type === 'error')
  const warnings = issues.filter((result) => result.type === 'warning')

  return (
    <div>
      <div className="flex border-b bg-muted/50 px-2 py-1">
        <ValidationSchemaEditor />
      </div>
      {validationSchemaError ? (
        <p className="border-b px-4 py-3 text-sm text-destructive" role="alert">
          {validationSchemaError}
        </p>
      ) : null}
      <ValidationSection type="error" results={errors} />
      <ValidationSection type="warning" results={warnings} />
    </div>
  )
}

export { ValidationList }
