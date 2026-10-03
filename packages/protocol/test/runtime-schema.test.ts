import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { RUNTIME_ERROR_CODES, RUNTIME_PROTOCOL_VERSION } from "../dist/index.js"

test("runtime TypeScript constants match the canonical JSON schema", async () => {
  const schemaPath = new URL("../../../schemas/runtime/protocol.schema.json", import.meta.url)
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
    $defs: {
      request: { properties: { version: { const: number } } }
      response: { properties: { error: { properties: { code: { enum: string[] } } } } }
    }
  }

  assert.equal(schema.$defs.request.properties.version.const, RUNTIME_PROTOCOL_VERSION)
  assert.deepEqual(schema.$defs.response.properties.error.properties.code.enum, RUNTIME_ERROR_CODES)
})
