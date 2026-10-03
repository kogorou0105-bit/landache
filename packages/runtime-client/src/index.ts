import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"

import {
  RUNTIME_PROTOCOL_VERSION,
  RUNTIME_ERROR_CODES,
  type DirectoryEntry,
  type ListDirectoryRuntimeRequest,
  type ReadFileRuntimeRequest,
  type RuntimeRequest,
  type RuntimeErrorCode,
  type RuntimeResponse,
  type SearchTextMatch,
  type SearchTextRuntimeRequest,
} from "@landache/protocol"

export type RuntimeClientOptions = {
  workspaceRoot: string
  executable: string
  executableArgs?: readonly string[]
  createRequestId?: () => string
}

export class RuntimeCallError extends Error {
  readonly code: RuntimeErrorCode

  constructor(code: RuntimeErrorCode, message: string) {
    super(message)
    this.name = "RuntimeCallError"
    this.code = code
  }
}

export class RuntimeClient {
  readonly #options: RuntimeClientOptions

  constructor(options: RuntimeClientOptions) {
    this.#options = options
  }

  async readFile(path: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const id = this.#options.createRequestId?.() ?? randomUUID()
    const request: ReadFileRuntimeRequest = {
      version: RUNTIME_PROTOCOL_VERSION,
      id,
      method: "read_file",
      params: { path },
    }
    const response = await invokeRuntime(this.#options, request, signal)
    if ("error" in response) {
      throw new RuntimeCallError(response.error.code, response.error.message)
    }
    if (!("content" in response.result)) throw new Error("Runtime returned an unexpected result")
    return response.result.content
  }

  async listDirectory(path: string, signal?: AbortSignal): Promise<DirectoryEntry[]> {
    signal?.throwIfAborted()
    const id = this.#options.createRequestId?.() ?? randomUUID()
    const request: ListDirectoryRuntimeRequest = {
      version: RUNTIME_PROTOCOL_VERSION,
      id,
      method: "list_directory",
      params: { path },
    }
    const response = await invokeRuntime(this.#options, request, signal)
    if ("error" in response) {
      throw new RuntimeCallError(response.error.code, response.error.message)
    }
    if (!("entries" in response.result)) throw new Error("Runtime returned an unexpected result")
    return response.result.entries
  }

  async searchText(path: string, query: string, signal?: AbortSignal): Promise<{
    matches: SearchTextMatch[]
    truncated: boolean
  }> {
    signal?.throwIfAborted()
    const id = this.#options.createRequestId?.() ?? randomUUID()
    const request: SearchTextRuntimeRequest = {
      version: RUNTIME_PROTOCOL_VERSION,
      id,
      method: "search_text",
      params: { path, query },
    }
    const response = await invokeRuntime(this.#options, request, signal)
    if ("error" in response) {
      throw new RuntimeCallError(response.error.code, response.error.message)
    }
    if (!("matches" in response.result)) throw new Error("Runtime returned an unexpected result")
    return response.result
  }
}

async function invokeRuntime(
  options: RuntimeClientOptions,
  request: RuntimeRequest,
  signal?: AbortSignal,
): Promise<RuntimeResponse> {
  return await new Promise((resolve, reject) => {
    const child = spawn(options.executable, [
      ...(options.executableArgs ?? []),
      "--workspace",
      options.workspaceRoot,
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false

    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", abort)
      action()
    }
    const abort = () => {
      child.kill("SIGTERM")
      finish(() => reject(signal?.reason))
    }
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted === true) {
      abort()
      return
    }

    child.on("error", (error) => finish(() => reject(error)))
    child.stdin.on("error", (error) => finish(() => reject(error)))
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => { stderr += chunk })
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(`Runtime exited with code ${code}: ${stderr.trim()}`))
          return
        }
        try {
          const response = parseRuntimeResponse(stdout.trim())
          if (response.id !== request.id) {
            throw new Error(`Runtime response id mismatch: expected ${request.id}`)
          }
          resolve(response)
        } catch (error) {
          reject(error)
        }
      })
    })

    child.stdin.end(`${JSON.stringify(request)}\n`)
  })
}

export function parseRuntimeResponse(input: string): RuntimeResponse {
  const value: unknown = JSON.parse(input)
  if (
    !isRecord(value)
    || value.version !== RUNTIME_PROTOCOL_VERSION
    || typeof value.id !== "string"
    || value.id.length === 0
  ) {
    throw new Error("Invalid runtime response envelope")
  }
  if (
    hasOnlyKeys(value, ["version", "id", "result"])
    && isRecord(value.result)
    && hasOnlyKeys(value.result, ["content"])
    && typeof value.result.content === "string"
  ) {
    return { version: RUNTIME_PROTOCOL_VERSION, id: value.id, result: { content: value.result.content } }
  }
  if (
    hasOnlyKeys(value, ["version", "id", "result"])
    && isRecord(value.result)
    && hasOnlyKeys(value.result, ["entries"])
    && Array.isArray(value.result.entries)
    && value.result.entries.every(isDirectoryEntry)
  ) {
    return { version: RUNTIME_PROTOCOL_VERSION, id: value.id, result: { entries: value.result.entries } }
  }
  if (
    hasOnlyKeys(value, ["version", "id", "result"])
    && isRecord(value.result)
    && hasOnlyKeys(value.result, ["matches", "truncated"])
    && Array.isArray(value.result.matches)
    && value.result.matches.every(isSearchTextMatch)
    && typeof value.result.truncated === "boolean"
  ) {
    return {
      version: RUNTIME_PROTOCOL_VERSION,
      id: value.id,
      result: { matches: value.result.matches, truncated: value.result.truncated },
    }
  }
  if (
    hasOnlyKeys(value, ["version", "id", "error"])
    && isRecord(value.error)
    && hasOnlyKeys(value.error, ["code", "message"])
    && isRuntimeErrorCode(value.error.code)
    && typeof value.error.message === "string"
  ) {
    return {
      version: RUNTIME_PROTOCOL_VERSION,
      id: value.id,
      error: { code: value.error.code, message: value.error.message },
    }
  }
  throw new Error("Invalid runtime response payload")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function isRuntimeErrorCode(value: unknown): value is RuntimeErrorCode {
  return typeof value === "string" && RUNTIME_ERROR_CODES.some((code) => code === value)
}

function isDirectoryEntry(value: unknown): value is DirectoryEntry {
  return isRecord(value)
    && hasOnlyKeys(value, ["path", "type"])
    && typeof value.path === "string"
    && (value.type === "file" || value.type === "directory" || value.type === "symlink")
}

function isSearchTextMatch(value: unknown): value is SearchTextMatch {
  return isRecord(value)
    && hasOnlyKeys(value, ["path", "line", "column", "preview"])
    && typeof value.path === "string"
    && Number.isInteger(value.line)
    && Number(value.line) >= 1
    && Number.isInteger(value.column)
    && Number(value.column) >= 1
    && typeof value.preview === "string"
}
