import { Badge } from '@/components/ui/badge'
import type {
  GltfValidationResult,
  GltfValidationType,
} from '@/lib/viz/validate'

const TYPE_LABELS: Record<GltfValidationType, string> = {
  error: 'Errors',
  warning: 'Warnings',
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
                {result.description}
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
