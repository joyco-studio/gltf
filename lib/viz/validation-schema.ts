import { exec, type JsonValue, type Path } from 'jsonpath-rfc9535'
import parseJsonPath from 'jsonpath-rfc9535/parser'

import type {
  GltfValidationReference,
  GltfValidationResult,
  GltfValidationType,
} from './validate'

const VALIDATION_SCHEMA_VERSION = 1 as const
const MAX_REPORTED_VALUES = 5

const OPERATORS = [
  'exists',
  'count',
  'includesAll',
  'includesAny',
  'unique',
  'equals',
  'notEquals',
  'matches',
  'lessThan',
  'lessThanOrEqual',
  'greaterThan',
  'greaterThanOrEqual',
] as const

type ValidationOperator = (typeof OPERATORS)[number]

interface GltfValidationRule {
  id: string
  path: string
  operator: ValidationOperator
  value?: unknown
  flags?: string
  level: GltfValidationType
  title?: string
  message?: string
}

interface GltfValidationSchema {
  $schema?: string
  version: typeof VALIDATION_SCHEMA_VERSION
  rules: GltfValidationRule[]
}

type ParseValidationSchemaResult =
  | { ok: true; schema: GltfValidationSchema }
  | { ok: false; errors: string[] }

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

const VALUE_OPERATORS = new Set<ValidationOperator>([
  'exists',
  'count',
  'includesAll',
  'includesAny',
  'equals',
  'notEquals',
  'matches',
  'lessThan',
  'lessThanOrEqual',
  'greaterThan',
  'greaterThanOrEqual',
])

const NUMBER_OPERATORS = new Set<ValidationOperator>([
  'lessThan',
  'lessThanOrEqual',
  'greaterThan',
  'greaterThanOrEqual',
])

const SCHEMA_KEYS = new Set(['$schema', 'version', 'rules'])
const RULE_KEYS = new Set([
  'id',
  'path',
  'operator',
  'value',
  'flags',
  'level',
  'title',
  'message',
])

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

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key)
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

function parseGltfValidationSchema(source: unknown): ParseValidationSchemaResult {
  if (!isRecord(source)) {
    return { ok: false, errors: ['Expected the validation schema to be a JSON object.'] }
  }

  const errors: string[] = []
  Object.keys(source).forEach((key) => {
    if (!SCHEMA_KEYS.has(key)) errors.push(`Unsupported schema property “${key}”.`)
  })
  if (source.$schema !== undefined && typeof source.$schema !== 'string') {
    errors.push('Expected “$schema” to be a string when present.')
  }
  if (source.version !== VALIDATION_SCHEMA_VERSION) {
    errors.push(`Expected “version” to be ${VALIDATION_SCHEMA_VERSION}.`)
  }
  if (!Array.isArray(source.rules)) {
    errors.push('Expected “rules” to be an array.')
    return { ok: false, errors }
  }

  const rules: GltfValidationRule[] = []
  const ids = new Set<string>()

  source.rules.forEach((candidate, index) => {
    const prefix = `Rule ${index + 1}`
    if (!isRecord(candidate)) {
      errors.push(`${prefix} must be an object.`)
      return
    }

    Object.keys(candidate).forEach((key) => {
      if (!RULE_KEYS.has(key)) errors.push(`${prefix} has unsupported property “${key}”.`)
    })

    const id = candidate.id
    const path = candidate.path
    const operator = candidate.operator
    const level = candidate.level ?? 'error'

    if (typeof id !== 'string' || !id.trim()) {
      errors.push(`${prefix} must have a non-empty string “id”.`)
    } else if (ids.has(id)) {
      errors.push(`${prefix} repeats the id “${id}”.`)
    } else {
      ids.add(id)
    }

    if (typeof path !== 'string' || !isValidJsonPath(path)) {
      errors.push(`${prefix} must have a valid RFC 9535 JSONPath “path”.`)
    }

    if (typeof operator !== 'string' || !(OPERATORS as readonly string[]).includes(operator)) {
      errors.push(`${prefix} has an unsupported “operator”.`)
    }

    if (level !== 'error' && level !== 'warning') {
      errors.push(`${prefix} “level” must be “error” or “warning”.`)
    }
    if (candidate.title !== undefined && typeof candidate.title !== 'string') {
      errors.push(`${prefix} “title” must be a string when present.`)
    }
    if (candidate.message !== undefined && typeof candidate.message !== 'string') {
      errors.push(`${prefix} “message” must be a string when present.`)
    }

    if (typeof operator === 'string' && (OPERATORS as readonly string[]).includes(operator)) {
      const typedOperator = operator as ValidationOperator
      if (VALUE_OPERATORS.has(typedOperator) && !hasOwn(candidate, 'value')) {
        errors.push(`${prefix} operator “${operator}” requires “value”.`)
      }
      if (typedOperator === 'unique' && hasOwn(candidate, 'value')) {
        errors.push(`${prefix} operator “unique” does not accept “value”.`)
      }
      if (typedOperator === 'exists' && typeof candidate.value !== 'boolean') {
        errors.push(`${prefix} operator “exists” requires a boolean “value”.`)
      }
      if (
        typedOperator === 'count' &&
        (!Number.isInteger(candidate.value) || (candidate.value as number) < 0)
      ) {
        errors.push(`${prefix} operator “count” requires a non-negative integer “value”.`)
      }
      if (
        (typedOperator === 'includesAll' || typedOperator === 'includesAny') &&
        (!Array.isArray(candidate.value) || candidate.value.length === 0)
      ) {
        errors.push(`${prefix} operator “${operator}” requires a non-empty array “value”.`)
      }
      if (NUMBER_OPERATORS.has(typedOperator) && typeof candidate.value !== 'number') {
        errors.push(`${prefix} operator “${operator}” requires a number “value”.`)
      }
      if (typedOperator === 'matches') {
        if (typeof candidate.value !== 'string') {
          errors.push(`${prefix} operator “matches” requires a string “value”.`)
        } else {
          try {
            new RegExp(candidate.value, candidate.flags as string | undefined)
          } catch {
            errors.push(`${prefix} operator “matches” contains an invalid regular expression.`)
          }
        }
        if (candidate.flags !== undefined && typeof candidate.flags !== 'string') {
          errors.push(`${prefix} “flags” must be a string when present.`)
        }
      } else if (candidate.flags !== undefined) {
        errors.push(`${prefix} “flags” is only supported by the “matches” operator.`)
      }
    }

    if (
      typeof id === 'string' &&
      typeof path === 'string' &&
      typeof operator === 'string' &&
      (OPERATORS as readonly string[]).includes(operator) &&
      (level === 'error' || level === 'warning')
    ) {
      rules.push({
        id,
        path,
        operator: operator as ValidationOperator,
        ...(hasOwn(candidate, 'value') && { value: candidate.value }),
        ...(typeof candidate.flags === 'string' && { flags: candidate.flags }),
        level,
        ...(typeof candidate.title === 'string' && { title: candidate.title }),
        ...(typeof candidate.message === 'string' && { message: candidate.message }),
      })
    }
  })

  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        schema: {
          ...(typeof source.$schema === 'string' && { $schema: source.$schema }),
          version: VALIDATION_SCHEMA_VERSION,
          rules,
        },
      }
}

function evaluateRule(rule: GltfValidationRule, matches: ResolvedValue[]): RuleFailure | null {
  const values = matches.map(({ value }) => value)
  const expected = rule.value

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
      const expression = new RegExp(expected as string, rule.flags)
      const failures = matches.filter(({ value }) => {
        expression.lastIndex = 0
        return typeof value !== 'string' || !expression.test(value)
      })
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
