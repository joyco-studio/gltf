import * as z from 'zod'

const VALIDATION_SCHEMA_VERSION = 1 as const
const MAX_REGEX_LENGTH = 256

const level = z.enum(['error', 'warning']).default('error')
const ruleBase = {
  id: z.string().trim().min(1).regex(/\S/),
  path: z
    .string()
    .min(1)
    .startsWith('$', { error: 'Expected an RFC 9535 JSONPath starting with “$”' })
    .meta({ description: 'RFC 9535 JSONPath expression.' }),
  level,
  title: z.string().optional(),
  message: z.string().optional(),
}

const GltfValidationRuleSchema = z.discriminatedUnion('operator', [
  z.strictObject({
    ...ruleBase,
    operator: z.literal('exists'),
    value: z.boolean(),
  }),
  z.strictObject({
    ...ruleBase,
    operator: z.literal('count'),
    value: z
      .number()
      .int({ error: 'Expected a non-negative integer' })
      .nonnegative({ error: 'Expected a non-negative integer' }),
  }),
  z.strictObject({
    ...ruleBase,
    operator: z.enum(['includesAll', 'includesAny']),
    value: z.array(z.unknown()).min(1),
  }),
  z.strictObject({
    ...ruleBase,
    operator: z.literal('unique'),
  }),
  z.strictObject({
    ...ruleBase,
    operator: z.enum(['equals', 'notEquals']),
    value: z.unknown(),
  }),
  z.strictObject({
    ...ruleBase,
    operator: z.literal('matches'),
    value: z.string().max(MAX_REGEX_LENGTH).meta({
      description: 'A linear-time RE2-compatible regular expression.',
    }),
    flags: z
      .string()
      .max(4)
      .regex(/^[imsu]*$/, {
        error: 'only the “i”, “m”, “s”, and “u” flags are supported',
      })
      .optional()
      .meta({
        description:
          'Linear-time regular expression flags: case-insensitive (i), multiline (m), dot-all (s), and Unicode (u).',
      }),
  }),
  z.strictObject({
    ...ruleBase,
    operator: z.enum([
      'lessThan',
      'lessThanOrEqual',
      'greaterThan',
      'greaterThanOrEqual',
    ]),
    value: z.number(),
  }),
])

const GltfValidationSchemaDefinition = z.strictObject({
  $schema: z.url().optional(),
  version: z.literal(VALIDATION_SCHEMA_VERSION),
  rules: z.array(GltfValidationRuleSchema),
})

function createGltfValidationJsonSchema() {
  return {
    ...z.toJSONSchema(GltfValidationSchemaDefinition, {
      target: 'draft-2020-12',
      io: 'input',
      reused: 'ref',
    }),
    $id: 'https://gltf.joyco.studio/validation-schema.json',
    title: 'glTF custom validation schema',
  }
}

type GltfValidationRule = z.output<typeof GltfValidationRuleSchema>
type GltfValidationSchema = z.output<typeof GltfValidationSchemaDefinition>

export {
  createGltfValidationJsonSchema,
  GltfValidationSchemaDefinition,
  MAX_REGEX_LENGTH,
  VALIDATION_SCHEMA_VERSION,
}
export type { GltfValidationRule, GltfValidationSchema }
