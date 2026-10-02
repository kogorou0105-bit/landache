export type JsonPrimitive = string | number | boolean | null

export type JsonObject = { [key: string]: JsonValue }

export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject

export type ToolArguments = JsonObject

export type ToolInputSchema = JsonObject

export type ToolDescriptor = {
  readonly name: string
  readonly description: string
  readonly inputSchema: ToolInputSchema
}

export type ToolCall = {
  id: string
  name: string
  arguments: ToolArguments
}

export type ToolErrorCode = "unknown_tool" | "invalid_arguments" | "execution_failed"

export type ToolResultContent =
  | { type: "output"; value: JsonValue }
  | { type: "error"; code: ToolErrorCode; message: string }
