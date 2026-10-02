import type {
  AgentEvent,
  JsonValue,
  ToolArguments,
  ToolCall,
  ToolDescriptor,
  ToolErrorCode,
  ToolResultMessage,
} from "@landache/protocol"

import { describeError, emitBestEffort } from "./internal/failure.js"

export type ToolValidationResult =
  | { ok: true; value: ToolArguments }
  | { ok: false; error: string }

export type ToolDefinition = ToolDescriptor & {
  validate: (input: ToolArguments) => ToolValidationResult
  execute: (input: ToolArguments, signal?: AbortSignal) => JsonValue | Promise<JsonValue>
}

export type ToolRegistry = {
  get: (name: string) => ToolDefinition | undefined
  list: () => readonly ToolDescriptor[]
}

export type ExecuteToolCallOptions = {
  toolCall: ToolCall
  resultMessageId: string
  registry: ToolRegistry
  signal?: AbortSignal
  emit?: (event: AgentEvent) => void | Promise<void>
}

export function createToolRegistry(tools: readonly ToolDefinition[]): ToolRegistry {
  const definitions = new Map<string, ToolDefinition>()
  const descriptors: ToolDescriptor[] = []

  for (const tool of tools) {
    if (definitions.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`)
    }

    definitions.set(tool.name, tool)
    descriptors.push(Object.freeze({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))
  }

  const publicDescriptors = Object.freeze(descriptors)

  return {
    get: (name) => definitions.get(name),
    list: () => publicDescriptors,
  }
}

export async function executeToolCall(options: ExecuteToolCallOptions): Promise<ToolResultMessage> {
  const emit = options.emit ?? (() => undefined)
  let started = false

  options.signal?.throwIfAborted()

  try {
    await emit({
      type: "tool.call.started",
      toolCall: options.toolCall,
      resultMessageId: options.resultMessageId,
    })
    started = true

    const tool = options.registry.get(options.toolCall.name)
    if (tool === undefined) {
      return await completeWithError(options, emit, "unknown_tool", `Unknown tool: ${options.toolCall.name}`)
    }

    let validation: ToolValidationResult
    try {
      validation = tool.validate(options.toolCall.arguments)
    } catch (error) {
      return await completeWithError(options, emit, "invalid_arguments", describeError(error))
    }

    if (!validation.ok) {
      return await completeWithError(options, emit, "invalid_arguments", validation.error)
    }

    options.signal?.throwIfAborted()

    let output: JsonValue
    try {
      output = await tool.execute(validation.value, options.signal)
      options.signal?.throwIfAborted()
      if (!isJsonValue(output)) {
        throw new Error("Tool returned a non-JSON-serializable value")
      }
    } catch (error) {
      if (options.signal?.aborted === true) {
        throw error
      }

      return await completeWithError(options, emit, "execution_failed", describeError(error))
    }

    const result = createResultMessage(options, { type: "output", value: output })
    await emit({ type: "tool.call.completed", result })
    return result
  } catch (error) {
    if (started) {
      await emitBestEffort(
        emit,
        options.signal?.aborted === true
          ? {
              type: "tool.call.cancelled",
              toolCallId: options.toolCall.id,
              reason: describeError(options.signal.reason),
            }
          : {
              type: "tool.call.failed",
              toolCallId: options.toolCall.id,
              error: describeError(error),
            },
      )
    }
    throw error
  }
}

async function completeWithError(
  options: ExecuteToolCallOptions,
  emit: (event: AgentEvent) => void | Promise<void>,
  code: ToolErrorCode,
  message: string,
): Promise<ToolResultMessage> {
  const result = createResultMessage(options, { type: "error", code, message })
  await emit({ type: "tool.call.completed", result })
  return result
}

function createResultMessage(
  options: ExecuteToolCallOptions,
  content: ToolResultMessage["content"],
): ToolResultMessage {
  return {
    id: options.resultMessageId,
    role: "tool",
    toolCallId: options.toolCall.id,
    toolName: options.toolCall.name,
    content,
  }
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
  }

  if (typeof value !== "object" || ancestors.has(value)) {
    return false
  }

  const nextAncestors = new Set(ancestors).add(value)
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, nextAncestors))
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return false
  }

  return Object.values(value).every((item) => isJsonValue(item, nextAncestors))
}
