import { exec, type JsonValue, type Path } from 'jsonpath-rfc9535'
import parseJsonPath from 'jsonpath-rfc9535/parser'
import { RE2JS } from 're2js'

import {
  GltfValidationSchemaDefinition,
  MAX_REGEX_LENGTH,
  VALIDATION_SCHEMA_VERSION,
  type GltfValidationRule,
  type GltfValidationSchema,
} from './validation-schema-definition'
import type {
  GltfValidationReference,
  GltfValidationResult,
} from './validate'

const MAX_REPORTED_VALUES = 5
const REGEX_FLAGS = {
  i: RE2JS.CASE_INSENSITIVE,
  m: RE2JS.MULTILINE,
  s: RE2JS.DOTALL,
  u: 0,
} as const

type ParseValidationSchemaResult =
  | { ok: true; schema: GltfValidationSchema }
  | { ok: false; errors: string[] }
type ValidationOperator = GltfValidationRule['operator']

interface ResolvedValue {
  value: unknown
  reference?: GltfValidationReference
}

interface RuleFailure {
  description: string
  matches?: ResolvedValue[]
}

const REFERENCE_KINDS = {
  nodes: 'node',
  meshes: 'mesh',
  materials: 'material',
  textures: 'texture',
  animations: 'animation',
} as const

const EXAMPLE_VALIDATION_SCHEMA: GltfValidationSchema = {
  $schema: 'https://gltf.joyco.studio/validation-schema.json',
  version: 1,
  rules: [
    {
      id: 'required-code-meshes',
      path: '$.meshes[*].name',
      operator: 'includesAll',
      value: ['Body', 'Frame', 'Glass', 'Screen'],
      level: 'error',
      title: 'Required meshes are missing',
      message: 'The model must expose every mesh targeted by the application.',
    },
  ],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return `“${value}”`
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatResolvedValues(matches: ResolvedValue[]): string {
  const reported = matches.slice(0, MAX_REPORTED_VALUES).map(({ value, reference }) => {
    const location = reference ? ` (${reference.kind} ${reference.label})` : ''
    return `${formatValue(value)}${location}`
  })
  const remaining = matches.length - reported.length
  return `${reported.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''}`
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    )
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return (
      valuesEqual(leftKeys, rightKeys) &&
      leftKeys.every((key) => valuesEqual(left[key], right[key]))
    )
  }
  return false
}

function isValidJsonPath(path: string) {
  try {
    parseJsonPath(path)
    return true
  } catch {
    return false
  }
}

function compileRegex(pattern: string, flags = '') {
  if (pattern.length > MAX_REGEX_LENGTH) {
    throw new Error(`patterns cannot exceed ${MAX_REGEX_LENGTH} characters`)
  }

  let compiledFlags = 0
  const seenFlags = new Set<string>()
  for (const flag of flags) {
    if (!(flag in REGEX_FLAGS)) {
      throw new Error('only the “i”, “m”, “s”, and “u” flags are supported')
    }
    if (seenFlags.has(flag)) throw new Error(`flag “${flag}” cannot be repeated`)
    seenFlags.add(flag)
    compiledFlags |= REGEX_FLAGS[flag as keyof typeof REGEX_FLAGS]
  }

  return RE2JS.compile(RE2JS.translateRegExp(pattern), compiledFlags)
}

function referenceForPath(segments: Path): GltfValidationReference | undefined {
  const kind = REFERENCE_KINDS[segments[0] as keyof typeof REFERENCE_KINDS]
  const id = segments[1]
  return kind && typeof id === 'number' && Number.isInteger(id) && id >= 0
    ? { kind, id, label: `#${id}` }
    : undefined
}

/** Resolves an RFC 9535 JSONPath while retaining paths for inspectable findings. */
function resolvePath(source: unknown, path: string): ResolvedValue[] {
  const resolved: ResolvedValue[] = []
  exec(source as JsonValue, path, (value, segments) => {
    resolved.push({ value, reference: referenceForPath(segments) })
  })
  return resolved
}

function sentence(message: string) {
  return /[.!?]$/.test(message) ? message : `${message}.`
}

function formatSchemaIssue(issue: {
  path: PropertyKey[]
  message: string
}) {
  const [root, index, ...rest] = issue.path
  if (root === 'rules' && typeof index === 'number') {
    const property = rest.length > 0 ? ` “${rest.join('.')}”` : ''
    return `Rule ${index + 1}${property}: ${sentence(issue.message)}`
  }
  const property = issue.path.length > 0 ? `“${issue.path.join('.')}”: ` : ''
  return `${property}${sentence(issue.message)}`
}

function collectSemanticErrors(source: unknown) {
  if (!isRecord(source) || !Array.isArray(source.rules)) return []

  const errors: string[] = []
  const ids = new Set<string>()
  source.rules.forEach((candidate, index) => {
    if (!isRecord(candidate)) return
    const prefix = `Rule ${index + 1}`

    if (typeof candidate.id === 'string' && candidate.id.trim()) {
      const id = candidate.id.trim()
      if (ids.has(id)) errors.push(`${prefix} repeats the id “${id}”.`)
      ids.add(id)
    }

    if (
      typeof candidate.path === 'string' &&
      candidate.path.startsWith('$') &&
      !isValidJsonPath(candidate.path)
    ) {
      errors.push(`${prefix} must have a valid RFC 9535 JSONPath “path”.`)
    }

    if (
      candidate.operator === 'matches' &&
      typeof candidate.value === 'string' &&
      candidate.value.length <= MAX_REGEX_LENGTH &&
      (candidate.flags === undefined ||
        (typeof candidate.flags === 'string' && /^[imsu]*$/.test(candidate.flags)))
    ) {
      try {
        compileRegex(candidate.value, candidate.flags as string | undefined)
      } catch (error) {
        errors.push(
          `${prefix} operator “matches” contains an unsupported regular expression: ${error instanceof Error ? error.message : String(error)}.`
        )
      }
    }
  })
  return errors
}

function parseGltfValidationSchema(source: unknown): ParseValidationSchemaResult {
  const parsed = GltfValidationSchemaDefinition.safeParse(source)
  const structuralErrors = parsed.success
    ? []
    : parsed.error.issues.map(formatSchemaIssue)
  const errors = [...structuralErrors, ...collectSemanticErrors(source)]

  return parsed.success && errors.length === 0
    ? { ok: true, schema: parsed.data }
    : { ok: false, errors }
}

function evaluateRule(rule: GltfValidationRule, matches: ResolvedValue[]): RuleFailure | null {
  const values = matches.map(({ value }) => value)
  const expected = 'value' in rule ? rule.value : undefined

  switch (rule.operator) {
    case 'exists': {
      const passed = expected ? matches.length > 0 : matches.length === 0
      return passed
        ? null
        : {
            description: expected
              ? `Path “${rule.path}” did not resolve any values.`
              : `Path “${rule.path}” resolved ${matches.length} value${matches.length === 1 ? '' : 's'} but should not exist: ${formatResolvedValues(matches)}.`,
            matches,
          }
    }
    case 'count':
      return matches.length === expected
        ? null
        : {
            description: `Path “${rule.path}” resolved ${matches.length} value${matches.length === 1 ? '' : 's'}; expected ${expected}.`,
          }
    case 'includesAll': {
      const missing = (expected as unknown[]).filter(
        (item) => !values.some((value) => valuesEqual(value, item))
      )
      return missing.length === 0
        ? null
        : {
            description: `Path “${rule.path}” is missing expected value${missing.length === 1 ? '' : 's'}: ${missing.map(formatValue).join(', ')}.`,
          }
    }
    case 'includesAny':
      return (expected as unknown[]).some((item) =>
        values.some((value) => valuesEqual(value, item))
      )
        ? null
        : {
            description: `Path “${rule.path}” must include at least one of: ${(expected as unknown[]).map(formatValue).join(', ')}.${matches.length > 0 ? ` Resolved values: ${formatResolvedValues(matches)}.` : ' It did not resolve any values.'}`,
            matches,
          }
    case 'unique': {
      const duplicates = matches.filter((match, index) =>
        matches.some(
          (other, otherIndex) =>
            otherIndex !== index && valuesEqual(other.value, match.value)
        )
      )
      return duplicates.length === 0
        ? null
        : {
            description: `Path “${rule.path}” contains duplicate values: ${formatResolvedValues(duplicates)}.`,
            matches: duplicates,
          }
    }
    case 'equals': {
      const failures = matches.filter(({ value }) => !valuesEqual(value, expected))
      return failures.length === 0 && matches.length > 0
        ? null
        : {
            description:
              matches.length === 0
                ? `Path “${rule.path}” did not resolve any values to compare.`
                : `Path “${rule.path}” has ${failures.length} value${failures.length === 1 ? '' : 's'} that do not equal ${formatValue(expected)}: ${formatResolvedValues(failures)}.`,
            matches: failures,
          }
    }
    case 'notEquals': {
      const failures = matches.filter(({ value }) => valuesEqual(value, expected))
      return failures.length === 0
        ? null
        : {
            description: `Path “${rule.path}” has ${failures.length} value${failures.length === 1 ? '' : 's'} equal to forbidden ${formatValue(expected)}: ${formatResolvedValues(failures)}.`,
            matches: failures,
          }
    }
    case 'matches': {
      const expression = compileRegex(expected as string, rule.flags)
      const failures = matches.filter(
        ({ value }) => typeof value !== 'string' || !expression.test(value)
      )
      return failures.length === 0 && matches.length > 0
        ? null
        : {
            description:
              matches.length === 0
                ? `Path “${rule.path}” did not resolve any strings to match.`
                : `Path “${rule.path}” has ${failures.length} value${failures.length === 1 ? '' : 's'} that do not match /${expected}/${rule.flags ?? ''}: ${formatResolvedValues(failures)}.`,
            matches: failures,
          }
    }
    case 'lessThan':
    case 'lessThanOrEqual':
    case 'greaterThan':
    case 'greaterThanOrEqual': {
      const compare = {
        lessThan: (value: number) => value < (expected as number),
        lessThanOrEqual: (value: number) => value <= (expected as number),
        greaterThan: (value: number) => value > (expected as number),
        greaterThanOrEqual: (value: number) => value >= (expected as number),
      }[rule.operator]
      const failures = matches.filter(
        ({ value }) => typeof value !== 'number' || !compare(value)
      )
      return failures.length === 0 && matches.length > 0
        ? null
        : {
            description:
              matches.length === 0
                ? `Path “${rule.path}” did not resolve any numbers to compare.`
                : `Path “${rule.path}” has ${failures.length} value${failures.length === 1 ? '' : 's'} that fail “${rule.operator} ${expected}”: ${formatResolvedValues(failures)}.`,
            matches: failures,
          }
    }
  }
}

function uniqueReferences(matches: ResolvedValue[] = []) {
  const references = new Map<string, GltfValidationReference>()
  matches.forEach(({ reference }) => {
    if (reference) references.set(`${reference.kind}-${reference.id}`, reference)
  })
  return [...references.values()]
}

function validateWithSchema(
  source: unknown,
  schema: GltfValidationSchema
): GltfValidationResult[] {
  return schema.rules.flatMap((rule) => {
    let matches: ResolvedValue[]
    try {
      matches = resolvePath(source, rule.path)
    } catch (error) {
      return [
        {
          type: 'error' as const,
          title: `Validation rule “${rule.id}” could not run`,
          description: `JSONPath “${rule.path}” could not be evaluated: ${error instanceof Error ? error.message : String(error)}`,
          ruleId: rule.id,
        },
      ]
    }

    const failure = evaluateRule(rule, matches)
    if (!failure) return []

    const references = uniqueReferences(failure.matches)
    const referenceText = references.length
      ? ` Affected: ${references.map(({ label }) => label).join(', ')}.`
      : ''

    return [
      {
        type: rule.level,
        title: rule.title ?? `Validation rule “${rule.id}” failed`,
        description: `${rule.message ? `${rule.message} ` : ''}${failure.description}${referenceText}`,
        ...(references.length > 0 && { references }),
        ruleId: rule.id,
      },
    ]
  })
}

export {
  EXAMPLE_VALIDATION_SCHEMA,
  VALIDATION_SCHEMA_VERSION,
  parseGltfValidationSchema,
  resolvePath,
  validateWithSchema,
}
export type {
  GltfValidationRule,
  GltfValidationSchema,
  ParseValidationSchemaResult,
  ValidationOperator,
}
