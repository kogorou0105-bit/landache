import { createInterface } from "node:readline/promises"

// Keep behavior aligned with schemas/runtime/discovery-policy-fixtures.json and the Rust Runtime tests.
const SENSITIVE_COMPONENTS = new Set([".aws", ".azure", ".git", ".gnupg", ".ssh"])
const SENSITIVE_NAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
])

export function isSensitiveReadPath(path: string): boolean {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean)
  const lowerParts = parts.map((part) => part.toLowerCase())
  const basename = lowerParts.at(-1) ?? ""
  return lowerParts.some((part) => SENSITIVE_COMPONENTS.has(part))
    || basename.startsWith(".env")
    || SENSITIVE_NAMES.has(basename)
    || basename.endsWith(".key")
    || basename.endsWith(".pem")
    || basename.endsWith(".p12")
    || basename.endsWith(".pfx")
}

export async function approveReadFile(path: string): Promise<void> {
  await approveReadOperation("read_file", path)
}

export async function approveReadOperation(toolName: string, path: string): Promise<void> {
  if (isSensitiveReadPath(path)) {
    throw new Error(`${toolName} denied for sensitive path: ${path}`)
  }
  if (process.env.LANDACHE_APPROVE_READ_FILE === "1") return
  if (process.stdin.isTTY !== true || process.stderr.isTTY !== true) {
    throw new Error(
      `${toolName} requires interactive approval; set LANDACHE_APPROVE_READ_FILE=1 to approve non-sensitive reads for this run`,
    )
  }

  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await prompt.question(
      `[approval] Allow ${toolName} ${JSON.stringify(path)}? Its result will be sent to and may be stored by the model provider. [y/N] `,
    )
    if (!/^(?:y|yes)$/i.test(answer.trim())) {
      throw new Error(`${toolName} was not approved: ${path}`)
    }
  } finally {
    prompt.close()
  }
}
