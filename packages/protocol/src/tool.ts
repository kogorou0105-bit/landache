export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type ToolArguments = Record<string, JsonValue>

export type ToolCall = {
  id: string
  name: string
  arguments: ToolArguments
}
