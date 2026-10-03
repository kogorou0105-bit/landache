import assert from "node:assert/strict"
import test from "node:test"

import type { AgentEvent } from "@landache/protocol"

import {
  createToolRegistry,
  runAgentLoop,
  type ModelStream,
  type ToolDefinition,
} from "@landache/agent"

const userMessage = { id: "user-1", role: "user", content: "Echo hello" } as const

const echoTool: ToolDefinition = {
  name: "echo",
  description: "Returns the provided text.",
  inputSchema: { type: "object" },
  validate: (input) => ({ ok: true, value: input }),
  execute: (input) => ({ echoed: input.text ?? null }),
}

function createIds(...ids: string[]): () => string {
  return () => {
    const id = ids.shift()
    assert.notEqual(id, undefined, "unexpected message id request")
    return id!
  }
}

test("executes tool calls sequentially and continues with their results", async () => {
  const modelInputs: string[][] = []
  const modelTools: string[][] = []
  const executionOrder: string[] = []
  const tool: ToolDefinition = {
    ...echoTool,
    execute: (input) => {
      executionOrder.push(String(input.text))
      return { echoed: input.text ?? null }
    },
  }
  let modelTurn = 0
  const streamModel: ModelStream = async function* ({ messages, tools }) {
    modelInputs.push(messages.map((message) => message.id))
    modelTools.push(tools.map((tool) => tool.name))
    modelTurn += 1
    if (modelTurn === 1) {
      yield {
        type: "tool_call.completed",
        toolCall: { id: "call-1", name: "echo", arguments: { text: "first" } },
      }
      yield {
        type: "tool_call.completed",
        toolCall: { id: "call-2", name: "echo", arguments: { text: "second" } },
      }
      yield { type: "response.completed", stopReason: "tool_use" }
      return
    }

    yield { type: "text.delta", delta: "Done" }
    yield { type: "response.completed", stopReason: "end_turn" }
  }

  const result = await runAgentLoop({
    messages: [userMessage],
    registry: createToolRegistry([tool]),
    streamModel,
    maxTurns: 2,
    createMessageId: createIds("assistant-1", "result-1", "result-2", "assistant-2"),
  })

  assert.deepEqual(executionOrder, ["first", "second"])
  assert.deepEqual(modelInputs, [
    ["user-1"],
    ["user-1", "assistant-1", "result-1", "result-2"],
  ])
  assert.deepEqual(modelTools, [["echo"], ["echo"]])
  assert.deepEqual(result.messages.map((message) => message.id), [
    "user-1",
    "assistant-1",
    "result-1",
    "result-2",
    "assistant-2",
  ])
  assert.equal(result.assistantMessage.id, "assistant-2")
  assert.deepEqual(result.assistantMessage.content, [{ type: "text", text: "Done" }])
})

test("preserves tool errors in history and lets the model recover", async () => {
  let modelTurn = 0
  const streamModel: ModelStream = async function* ({ messages }) {
    modelTurn += 1
    if (modelTurn === 1) {
      yield {
        type: "tool_call.completed",
        toolCall: { id: "missing-call", name: "missing", arguments: {} },
      }
      yield { type: "response.completed", stopReason: "tool_use" }
      return
    }

    assert.deepEqual(messages.at(-1)?.role, "tool")
    yield { type: "response.completed", stopReason: "end_turn" }
  }

  const result = await runAgentLoop({
    messages: [userMessage],
    registry: createToolRegistry([]),
    streamModel,
    maxTurns: 2,
    createMessageId: createIds("assistant-1", "result-1", "assistant-2"),
  })

  assert.deepEqual(result.messages[2], {
    id: "result-1",
    role: "tool",
    toolCallId: "missing-call",
    toolName: "missing",
    content: { type: "error", code: "unknown_tool", message: "Unknown tool: missing" },
  })
})

test("stops on non-tool model stop reasons", async () => {
  const streamModel: ModelStream = async function* () {
    yield { type: "text.delta", delta: "partial" }
    yield { type: "response.completed", stopReason: "max_tokens" }
  }

  const result = await runAgentLoop({
    messages: [userMessage],
    registry: createToolRegistry([]),
    streamModel,
    maxTurns: 3,
    createMessageId: createIds("assistant-1"),
  })

  assert.equal(result.assistantMessage.stopReason, "max_tokens")
})

test("throws after executing the last allowed turn's tool calls", async () => {
  const events: AgentEvent[] = []
  const streamModel: ModelStream = async function* () {
    yield {
      type: "tool_call.completed",
      toolCall: { id: "call-1", name: "echo", arguments: { text: "hello" } },
    }
    yield { type: "response.completed", stopReason: "tool_use" }
  }

  await assert.rejects(
    runAgentLoop({
      messages: [userMessage],
      registry: createToolRegistry([echoTool]),
      streamModel,
      maxTurns: 1,
      createMessageId: createIds("assistant-1", "result-1"),
      emit: (event) => {
        events.push(event)
      },
    }),
    /reached maxTurns \(1\)/,
  )
  assert.equal(events.at(-1)?.type, "tool.call.completed")
})

test("validates the turn limit and generated message ids before starting", async () => {
  let modelStarted = false
  const streamModel: ModelStream = async function* () {
    modelStarted = true
    yield { type: "response.completed", stopReason: "end_turn" }
  }
  const baseOptions = {
    messages: [userMessage],
    registry: createToolRegistry([]),
    streamModel,
    createMessageId: createIds("assistant-1"),
  }

  await assert.rejects(runAgentLoop({ ...baseOptions, maxTurns: 0 }), /positive safe integer/)
  assert.equal(modelStarted, false)

  await assert.rejects(
    runAgentLoop({ ...baseOptions, maxTurns: 1, createMessageId: () => "" }),
    /empty id/,
  )
  assert.equal(modelStarted, false)

  await assert.rejects(
    runAgentLoop({ ...baseOptions, maxTurns: 1, createMessageId: () => "user-1" }),
    /Duplicate message id: user-1/,
  )
  assert.equal(modelStarted, false)
})
