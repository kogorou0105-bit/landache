// Contract mirror checked against schemas/runtime/protocol.schema.json by tests.
export const RUNTIME_PROTOCOL_VERSION = 1 as const

export const RUNTIME_METHODS = ["read_file", "list_directory", "search_text"] as const

export type RuntimeMethod = (typeof RUNTIME_METHODS)[number]

export const RUNTIME_ERROR_CODES = [
  "invalid_request",
  "path_outside_workspace",
  "not_found",
  "not_a_file",
  "not_a_directory",
  "permission_denied",
  "output_limit_exceeded",
  "invalid_utf8",
  "internal_error",
] as const

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number]

export type ReadFileRuntimeRequest = {
  version: typeof RUNTIME_PROTOCOL_VERSION
  id: string
  method: "read_file"
  params: { path: string }
}

export type ReadFileRuntimeResult = { content: string }

export type ListDirectoryRuntimeRequest = {
  version: typeof RUNTIME_PROTOCOL_VERSION
  id: string
  method: "list_directory"
  params: { path: string }
}

export type DirectoryEntry = {
  path: string
  type: "file" | "directory" | "symlink"
}

export type ListDirectoryRuntimeResult = { entries: DirectoryEntry[] }

export type SearchTextRuntimeRequest = {
  version: typeof RUNTIME_PROTOCOL_VERSION
  id: string
  method: "search_text"
  params: { path: string; query: string }
}

export type SearchTextMatch = {
  path: string
  line: number
  column: number
  preview: string
}

export type SearchTextRuntimeResult = {
  matches: SearchTextMatch[]
  truncated: boolean
}

export type RuntimeRequest =
  | ReadFileRuntimeRequest
  | ListDirectoryRuntimeRequest
  | SearchTextRuntimeRequest

export type RuntimeResult =
  | ReadFileRuntimeResult
  | ListDirectoryRuntimeResult
  | SearchTextRuntimeResult

export type RuntimeResponse =
  | { version: typeof RUNTIME_PROTOCOL_VERSION; id: string; result: RuntimeResult }
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION
      id: string
      error: { code: RuntimeErrorCode; message: string }
    }
