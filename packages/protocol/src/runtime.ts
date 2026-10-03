// Contract mirror checked against schemas/runtime/protocol.schema.json by tests.
export const RUNTIME_PROTOCOL_VERSION = 1 as const

export const RUNTIME_ERROR_CODES = [
  "invalid_request",
  "path_outside_workspace",
  "not_found",
  "not_a_file",
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

export type RuntimeResponse =
  | { version: typeof RUNTIME_PROTOCOL_VERSION; id: string; result: ReadFileRuntimeResult }
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION
      id: string
      error: { code: RuntimeErrorCode; message: string }
    }
