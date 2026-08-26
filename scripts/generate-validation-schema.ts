import { readFileSync, writeFileSync } from 'node:fs'

import { createGltfValidationJsonSchema } from '../lib/viz/validation-schema-definition'

const target = new URL('../public/validation-schema.json', import.meta.url)
const output = `${JSON.stringify(createGltfValidationJsonSchema(), null, 2)}\n`

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) {
    console.error(
      'public/validation-schema.json is stale. Run “pnpm generate:validation-schema”.'
    )
    process.exitCode = 1
  }
} else {
  writeFileSync(target, output)
}
