import assert from "node:assert/strict"
import test from "node:test"

import type { AgentEvent, ToolCall } from "@landache/protocol"

import {
  createToolRegistry,
  executeToolCall,
  type ToolDefinition,
} from "@landache/agent"

const echoCall: ToolCall = {
  id: "tool-call-1",
  name: "echo",
  arguments: { text: "hello" },
}

const echoTool: ToolDefinition = {
  name: "echo",
  description: "Returns the provided text.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  validate: (input) =>
    typeof input.text === "string"
      ? { ok: true, value: input }
      : { ok: false, error: "text must be a string" },
  execute: (input) => ({ text: input.text ?? null }),
}

test("validates and executes a registered tool", async () => {
  const events: AgentEvent[] = []
  const result = await executeToolCall({
    toolCall: echoCall,
    resultMessageId: "tool-result-1",
    registry: createToolRegistry([echoTool]),
    emit: (event) => {
      events.push(event)
    },
  })

  assert.deepEqual(result, {
    id: "tool-result-1",
    role: "tool",
    toolCallId: "tool-call-1",
    toolName: "echo",
    content: { type: "output", value: { text: "hello" } },
  })
  assert.deepEqual(
    events.map((event) => event.type),
    ["tool.call.started", "tool.call.completed"],
  )
})

test("rejects duplicate tool registrations", () => {
  assert.throws(() => createToolRegistry([echoTool, echoTool]), /Duplicate tool name: echo/)
})

test("lists model-facing descriptors without execution functions", () => {
  const registry = createToolRegistry([echoTool])

  assert.deepEqual(registry.list(), [
    {
      name: "echo",
      description: "Returns the provided text.",
      inputSchema: echoTool.inputSchema,
    },
  ])
  assert.equal("execute" in registry.list()[0]!, false)
  assert.equal("validate" in registry.list()[0]!, false)
})

test("returns an error result for an unknown tool", async () => {
  const result = await executeToolCall({
    toolCall: echoCall,
    resultMessageId: "tool-result-1",
    registry: createToolRegistry([]),
  })

  assert.deepEqual(result.content, {
    type: "error",
    code: "unknown_tool",
    message: "Unknown tool: echo",
  })
})

test("does not execute a tool when argument validation fails", async () => {
  let executed = false
  const tool: ToolDefinition = {
    ...echoTool,
    validate: () => ({ ok: false, error: "invalid echo arguments" }),
    execute: () => {
      executed = true
      return null
    },
  }

  const result = await executeToolCall({
    toolCall: echoCall,
    resultMessageId: "tool-result-1",
    registry: createToolRegistry([tool]),
  })

  assert.equal(executed, false)
  assert.deepEqual(result.content, {
    type: "error",
    code: "invalid_arguments",
    message: "invalid echo arguments",
  })
})

test("normalizes tool execution exceptions into error results", async () => {
  const tool: ToolDefinition = {
    ...echoTool,
    execute: () => {
      throw new Error("echo unavailable")
    },
  }

  const result = await executeToolCall({
    toolCall: echoCall,
    resultMessageId: "tool-result-1",
    registry: createToolRegistry([tool]),
  })

  assert.deepEqual(result.content, {
    type: "error",
    code: "execution_failed",
    message: "echo unavailable",
  })
})

test("rejects tool outputs that are not JSON serializable", async () => {
  const tool: ToolDefinition = {
    ...echoTool,
    execute: () => undefined as never,
  }

  const result = await executeToolCall({
    toolCall: echoCall,
    resultMessageId: "tool-result-1",
    registry: createToolRegistry([tool]),
  })

  assert.deepEqual(result.content, {
    type: "error",
    code: "execution_failed",
    message: "Tool returned a non-JSON-serializable value",
  })
})

test("cancels an executing tool without creating a result", async () => {
  const controller = new AbortController()
  const events: AgentEvent[] = []
  const tool: ToolDefinition = {
    ...echoTool,
    execute: () => {
      controller.abort(new Error("tool cancelled"))
      controller.signal.throwIfAborted()
      return null
    },
  }

  await assert.rejects(
    executeToolCall({
      toolCall: echoCall,
      resultMessageId: "tool-result-1",
      registry: createToolRegistry([tool]),
      signal: controller.signal,
      emit: (event) => {
        events.push(event)
      },
    }),
    /tool cancelled/,
  )
  assert.deepEqual(
    events.map((event) => event.type),
    ["tool.call.started", "tool.call.cancelled"],
  )
})

test("fails the lifecycle when completed event publication fails", async () => {
  const events: AgentEvent[] = []

  await assert.rejects(
    executeToolCall({
      toolCall: echoCall,
      resultMessageId: "tool-result-1",
      registry: createToolRegistry([echoTool]),
      emit: (event) => {
        if (event.type === "tool.call.completed") {
          throw new Error("result was not stored")
        }
        events.push(event)
      },
    }),
    /result was not stored/,
  )
  assert.deepEqual(
    events.map((event) => event.type),
    ["tool.call.started", "tool.call.failed"],
  )
})
