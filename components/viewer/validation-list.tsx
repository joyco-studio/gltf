import { Badge } from '@/components/ui/badge'
import type {
  GltfValidationIssue,
  GltfValidationTier,
} from '@/lib/viz/validate'

const TIER_LABELS: Record<GltfValidationTier, string> = {
  error: 'Errors',
  warning: 'Warnings',
}

function ValidationSection({
  tier,
  issues,
}: {
  tier: GltfValidationTier
  issues: GltfValidationIssue[]
}) {
  return (
    <section>
      <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide">
          {TIER_LABELS[tier]}
        </h2>
        <Badge variant={tier === 'error' ? 'destructive' : 'muted'} size="sm">
          {issues.length}
        </Badge>
      </div>

      {issues.length > 0 ? (
        <ul>
          {issues.map((issue, index) => (
            <li
              key={`${issue.tier}-${issue.title}-${index}`}
              className="border-b px-4 py-3 last:border-b-0"
            >
              <h3 className="text-sm font-medium text-foreground">
                {issue.title}
              </h3>
              <p className="mt-1 max-w-prose text-sm leading-5 text-muted-foreground">
                {issue.description}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-b px-4 py-3 font-mono text-xs text-muted-foreground">
          No {TIER_LABELS[tier].toLowerCase()} found.
        </p>
      )}
    </section>
  )
}

function ValidationList({ issues }: { issues: GltfValidationIssue[] }) {
  const errors = issues.filter((issue) => issue.tier === 'error')
  const warnings = issues.filter((issue) => issue.tier === 'warning')

  return (
    <div>
      <ValidationSection tier="error" issues={errors} />
      <ValidationSection tier="warning" issues={warnings} />
    </div>
  )
}

export { ValidationList }
