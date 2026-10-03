import assert from "node:assert/strict"
import test from "node:test"

import { approveReadFile, isSensitiveReadPath } from "../dist/read-file-policy.js"

test("denies common credential paths", () => {
  for (const path of [
    ".env",
    ".env.local",
    ".envrc",
    ".git/config",
    "vendor/dependency/.git/config",
    ".ssh/id_rsa",
    "config/credentials",
    "certs/server.pem",
    "certs/server.key",
  ]) {
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

test("allows ordinary source and documentation paths", () => {
  for (const path of ["README.md", "src/index.ts", "docs/environment.md", "keys/README.md"]) {
    assert.equal(isSensitiveReadPath(path), false, path)
  }
})
