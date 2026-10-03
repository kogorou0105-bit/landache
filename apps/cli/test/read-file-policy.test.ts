import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { approveReadFile, isSensitiveReadPath } from "../dist/read-file-policy.js"

type DiscoveryPolicyFixtures = {
  sensitivePaths: string[]
  ordinaryPaths: string[]
}

async function readPolicyFixtures(): Promise<DiscoveryPolicyFixtures> {
  const path = new URL("../../../schemas/runtime/discovery-policy-fixtures.json", import.meta.url)
  return JSON.parse(await readFile(path, "utf8")) as DiscoveryPolicyFixtures
}

test("denies every shared sensitive-path fixture", async () => {
  const fixtures = await readPolicyFixtures()
  for (const path of fixtures.sensitivePaths) {
    assert.equal(isSensitiveReadPath(path), true, path)
  }
})

test("explicit non-interactive approval never bypasses sensitive paths", async () => {
  const previous = process.env.LANDACHE_APPROVE_READ_FILE
  process.env.LANDACHE_APPROVE_READ_FILE = "1"
  try {
    await approveReadFile("README.md")
    await assert.rejects(approveReadFile(".env"), /sensitive path/)
  } finally {
    if (previous === undefined) delete process.env.LANDACHE_APPROVE_READ_FILE
    else process.env.LANDACHE_APPROVE_READ_FILE = previous
  }
})

test("allows every shared ordinary-path fixture", async () => {
  const fixtures = await readPolicyFixtures()
  for (const path of fixtures.ordinaryPaths) {
    assert.equal(isSensitiveReadPath(path), false, path)
  }
})
