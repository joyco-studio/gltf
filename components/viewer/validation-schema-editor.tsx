'use client'

import * as React from 'react'
import { Braces, FileUp, LoaderCircle, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fetchValidationSchema } from '@/lib/viz/fetch-validation-schema'
import {
  EXAMPLE_VALIDATION_SCHEMA,
  parseGltfValidationSchema,
} from '@/lib/viz/validation-schema'

import { useViewer } from './viewer-provider'

function formatSchema(schema: unknown) {
  return JSON.stringify(schema, null, 2)
}

function ValidationSchemaEditor() {
  const { validationSchema, setValidationSchema } = useViewer()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(() =>
    formatSchema(EXAMPLE_VALIDATION_SCHEMA)
  )
  const [schemaUrl, setSchemaUrl] = React.useState('')
  const [loadingUrl, setLoadingUrl] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      setDraft(formatSchema(validationSchema ?? EXAMPLE_VALIDATION_SCHEMA))
      setSchemaUrl('')
      setLoadingUrl(false)
      setError(null)
    }
  }

  const applySource = (source: unknown) => {
    const parsed = parseGltfValidationSchema(source)
    if (!parsed.ok) {
      setError(parsed.errors.join(' '))
      return
    }

    setValidationSchema(parsed.schema)
    setOpen(false)
  }

  const apply = () => {
    try {
      applySource(JSON.parse(draft))
    } catch {
      setError('The schema is not valid JSON.')
    }
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setDraft(await file.text())
      setError(null)
    } catch {
      setError('The selected schema file could not be read.')
    }
  }

  const importUrl = async () => {
    setLoadingUrl(true)
    setError(null)
    const result = await fetchValidationSchema(schemaUrl)
    setLoadingUrl(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    try {
      applySource(JSON.parse(result.text))
    } catch {
      setError('The loaded schema is not valid JSON.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Braces />
          Validation schema
          {validationSchema ? (
            <Badge variant="accent" size="sm">
              {validationSchema.rules.length}
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Custom validation schema</DialogTitle>
          <DialogDescription>
            Paste, upload, or load a version 1 schema from a URL. Paths use RFC
            9535 JSONPath, such as <code>$.meshes[*].name</code>. Custom
            findings join the built-in errors and warnings.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void importUrl()
          }}
        >
          <Input
            type="url"
            value={schemaUrl}
            onChange={(event) => {
              setSchemaUrl(event.target.value)
              setError(null)
            }}
            aria-label="Validation schema URL"
            placeholder="https://example.com/validation-schema.json"
            disabled={loadingUrl}
          />
          <Button type="submit" variant="secondary" disabled={loadingUrl}>
            {loadingUrl ? <LoaderCircle className="animate-spin" /> : null}
            {loadingUrl ? 'Loading' : 'Load URL'}
          </Button>
        </form>

        <Textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          aria-label="Validation schema JSON"
          aria-invalid={Boolean(error)}
          spellCheck={false}
          className="min-h-96 resize-y font-mono text-xs leading-5"
        />

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            void importFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />

        <DialogFooter>
          {validationSchema ? (
            <Button
              variant="destructive"
              onClick={() => {
                setValidationSchema(null)
                setOpen(false)
              }}
            >
              <Trash2 />
              Clear
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => inputRef.current?.click()}>
            <FileUp />
            Upload JSON
          </Button>
          <Button onClick={apply} disabled={loadingUrl}>
            Apply schema
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ValidationSchemaEditor }
