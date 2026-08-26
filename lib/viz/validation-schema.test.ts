import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { validateGltf } from './validate'
import { createGltfValidationJsonSchema } from './validation-schema-definition'
import {
  EXAMPLE_VALIDATION_SCHEMA,
  parseGltfValidationSchema,
  resolvePath,
  type GltfValidationSchema,
} from './validation-schema'

function schema(
  rules: GltfValidationSchema['rules']
): GltfValidationSchema {
  return { version: 1, rules }
}

describe('parseGltfValidationSchema', () => {
  it('keeps the published JSON Schema generated from Zod', () => {
    const published = JSON.parse(
      readFileSync(
        new URL('../../public/validation-schema.json', import.meta.url),
        'utf8'
      )
    )

    assert.deepEqual(published, createGltfValidationJsonSchema())
  })

  it('accepts the portable example schema', () => {
    const parsed = parseGltfValidationSchema(EXAMPLE_VALIDATION_SCHEMA)

    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.schema.rules[0].level, 'error')
  })

  it('normalizes an omitted level to error', () => {
    const parsed = parseGltfValidationSchema({
      version: 1,
      rules: [
        {
          id: 'unique-mesh-names',
          path: '$.meshes[*].name',
          operator: 'unique',
        },
      ],
    })

    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.schema.rules[0].level, 'error')
  })

  it('returns all actionable schema errors as data', () => {
    const parsed = parseGltfValidationSchema({
      version: 2,
      rules: [
        {
          id: 'same',
          path: '/meshes/*',
          operator: 'count',
          value: -1,
          severity: 'warning',
        },
        { id: 'same', path: '$.meshes[*].name', operator: 'matches', value: '[' },
      ],
    })

    assert.equal(parsed.ok, false)
    if (!parsed.ok) {
      assert.ok(parsed.errors.some((error) => error.includes('version')))
      assert.ok(parsed.errors.some((error) => error.includes('JSONPath')))
      assert.ok(parsed.errors.some((error) => error.includes('non-negative')))
      assert.ok(parsed.errors.some((error) => error.includes('severity')))
      assert.ok(parsed.errors.some((error) => error.includes('repeats the id')))
      assert.ok(parsed.errors.some((error) => error.includes('regular expression')))
    }
  })

  it('rejects regex syntax and flags that cannot run in linear time', () => {
    const parsed = parseGltfValidationSchema({
      version: 1,
      rules: [
        {
          id: 'backreference',
          path: '$.meshes[*].name',
          operator: 'matches',
          value: '(mesh)\\1',
        },
        {
          id: 'unsupported-flags',
          path: '$.meshes[*].name',
          operator: 'matches',
          value: 'mesh',
          flags: 'g',
        },
      ],
    })

    assert.equal(parsed.ok, false)
    if (!parsed.ok) {
      assert.ok(parsed.errors.some((error) => error.includes('invalid escape sequence')))
      assert.ok(parsed.errors.some((error) => error.includes('only the “i”, “m”, “s”, and “u”')))
    }
  })
})

describe('custom glTF validation', () => {
  it('resolves JSONPath wildcards and quoted property names', () => {
    assert.deepEqual(
      resolvePath(
        { materials: [{ extras: { 'code/name': 'paint' } }] },
        "$.materials[*].extras['code/name']"
      ),
      [
        {
          value: 'paint',
          reference: { kind: 'material', id: 0, label: '#0' },
        },
      ]
    )
  })

  it('supports standard JSONPath filters', () => {
    assert.deepEqual(
      resolvePath(
        {
          meshes: [
            { name: 'simple', primitives: [{}] },
            { name: 'complex', primitives: [{}, {}] },
          ],
        },
        '$.meshes[?length(@.primitives) > 1].name'
      ),
      [
        {
          value: 'complex',
          reference: { kind: 'mesh', id: 1, label: '#1' },
        },
      ]
    )
  })

  it('merges required mesh findings with built-in warnings', () => {
    const results = validateGltf(
      {
        nodes: [{ name: 'duplicate' }, { name: 'duplicate' }],
        meshes: [{ name: 'Body' }, { name: 'Frame' }, { name: 'Glass' }],
      },
      EXAMPLE_VALIDATION_SCHEMA
    )

    assert.equal(results.length, 2)
    assert.equal(results[0].type, 'warning')
    assert.equal(results[1].type, 'error')
    assert.equal(results[1].ruleId, 'required-code-meshes')
    assert.match(results[1].description, /“Screen”/)
  })

  it('supports count, uniqueness, regex, and numeric comparisons', () => {
    const results = validateGltf(
      {
        meshes: [
          { name: 'part_bad' },
          { name: 'other' },
          { name: 'part_bad' },
        ],
        accessors: [{ count: 20 }, { count: 150 }, { count: 80 }],
      },
      schema([
        {
          id: 'four-meshes',
          path: '$.meshes[*]',
          operator: 'count',
          value: 4,
          level: 'error',
        },
        {
          id: 'unique-mesh-names',
          path: '$.meshes[*].name',
          operator: 'unique',
          level: 'warning',
        },
        {
          id: 'mesh-name-format',
          path: '$.meshes[*].name',
          operator: 'matches',
          value: '^part_',
          level: 'warning',
        },
        {
          id: 'primitive-limit',
          path: '$.accessors[*].count',
          operator: 'lessThanOrEqual',
          value: 100,
          level: 'error',
        },
      ])
    )

    assert.deepEqual(
      results.map(({ ruleId }) => ruleId),
      ['four-meshes', 'unique-mesh-names', 'mesh-name-format', 'primitive-limit']
    )
    assert.deepEqual(results[1].references, [
      { kind: 'mesh', id: 0, label: '#0' },
      { kind: 'mesh', id: 2, label: '#2' },
    ])
    assert.deepEqual(results[2].references, [
      { kind: 'mesh', id: 1, label: '#1' },
    ])
    assert.match(results[1].description, /“part_bad” \(mesh #0\)/)
    assert.match(results[1].description, /“part_bad” \(mesh #2\)/)
    assert.match(results[2].description, /“other” \(mesh #1\)/)
    assert.match(results[3].description, /150/)
  })

  it('identifies exact values that fail list-based rules', () => {
    const results = validateGltf(
      {
        meshes: [
          { name: 'Body' },
          { name: 'Front Wheel' },
          { name: 'Rear Wheel' },
        ],
      },
      schema([
        {
          id: 'mesh-name-format',
          path: '$.meshes[*].name',
          operator: 'matches',
          value: '^\\S+$',
          level: 'error',
        },
      ])
    )

    assert.equal(results.length, 1)
    assert.match(results[0].description, /“Front Wheel” \(mesh #1\)/)
    assert.match(results[0].description, /“Rear Wheel” \(mesh #2\)/)
    assert.deepEqual(results[0].references, [
      { kind: 'mesh', id: 1, label: '#1' },
      { kind: 'mesh', id: 2, label: '#2' },
    ])
  })

  it('evaluates nested quantifiers without catastrophic backtracking', () => {
    const poisonedName = `${'a'.repeat(10_000)}!`
    const results = validateGltf(
      { meshes: [{ name: poisonedName }] },
      schema([
        {
          id: 'safe-regex',
          path: '$.meshes[*].name',
          operator: 'matches',
          value: '(a+)+$',
          level: 'error',
        },
      ])
    )

    assert.equal(results.length, 1)
    assert.equal(results[0].ruleId, 'safe-regex')
  })

  it('reports resolved values when none match an allowed list', () => {
    const results = validateGltf(
      { materials: [{ alphaMode: 'BLEND' }] },
      schema([
        {
          id: 'supported-alpha-mode',
          path: '$.materials[*].alphaMode',
          operator: 'includesAny',
          value: ['OPAQUE', 'MASK'],
          level: 'error',
        },
      ])
    )

    assert.match(results[0].description, /Resolved values: “BLEND” \(material #0\)/)
    assert.deepEqual(results[0].references, [
      { kind: 'material', id: 0, label: '#0' },
    ])
  })

  it('supports existence, equality, inclusion, and every comparison direction', () => {
    const results = validateGltf(
      {
        materials: [{ alphaMode: 'OPAQUE', roughness: 0.2 }],
      },
      schema([
        {
          id: 'missing-required-property',
          path: '$.materials[*].name',
          operator: 'exists',
          value: true,
          level: 'error',
        },
        {
          id: 'unexpected-property',
          path: '$.materials[*].alphaMode',
          operator: 'exists',
          value: false,
          level: 'warning',
        },
        {
          id: 'one-supported-mode',
          path: '$.materials[*].alphaMode',
          operator: 'includesAny',
          value: ['OPAQUE', 'MASK'],
          level: 'error',
        },
        {
          id: 'only-mask',
          path: '$.materials[*].alphaMode',
          operator: 'equals',
          value: 'MASK',
          level: 'error',
        },
        {
          id: 'not-opaque',
          path: '$.materials[*].alphaMode',
          operator: 'notEquals',
          value: 'OPAQUE',
          level: 'error',
        },
        {
          id: 'roughness-less-than',
          path: '$.materials[*].roughness',
          operator: 'lessThan',
          value: 0.1,
          level: 'error',
        },
        {
          id: 'roughness-greater-than',
          path: '$.materials[*].roughness',
          operator: 'greaterThan',
          value: 0.2,
          level: 'error',
        },
        {
          id: 'roughness-at-least',
          path: '$.materials[*].roughness',
          operator: 'greaterThanOrEqual',
          value: 0.3,
          level: 'error',
        },
      ])
    )

    assert.deepEqual(
      results.map(({ ruleId }) => ruleId),
      [
        'missing-required-property',
        'unexpected-property',
        'only-mask',
        'not-opaque',
        'roughness-less-than',
        'roughness-greater-than',
        'roughness-at-least',
      ]
    )
  })
})
