import assert from "node:assert/strict"
import test from "node:test"

import type { AgentEvent } from "@landache/protocol"

import { runModelTurn, type ModelStream } from "../src/model-turn.ts"

const userMessage = { id: "user-1", role: "user", content: "Say hello" } as const

test("streams one model turn and emits compact ordered events", async () => {
  const streamModel: ModelStream = async function* () {
    yield { type: "text.delta", delta: "Hello" }
    yield { type: "text.delta", delta: " world" }
    yield { type: "response.completed", stopReason: "end_turn" }
  }
  const events: AgentEvent[] = []

  const result = await runModelTurn({
    messages: [userMessage],
    assistantMessageId: "assistant-1",
    turn: 3,
    streamModel,
    emit: (event) => {
      events.push(event)
    },
  })

  assert.deepEqual(result.assistantMessage, {
    id: "assistant-1",
    role: "assistant",
    content: [{ type: "text", text: "Hello world" }],
    stopReason: "end_turn",
  })
  assert.deepEqual(events, [
    { type: "turn.started", turn: 3 },
    { type: "message.started", messageId: "assistant-1", role: "assistant" },
    { type: "message.delta", messageId: "assistant-1", delta: "Hello" },
    { type: "message.delta", messageId: "assistant-1", delta: " world" },
    { type: "message.completed", message: result.assistantMessage },
    { type: "turn.completed", turn: 3, messageId: "assistant-1" },
  ])
})

test("preserves text and tool call order in the assistant message", async () => {
  const toolCall = {
    id: "tool-call-1",
    name: "read_file",
    arguments: { path: "README.md" },
  } as const
  const streamModel: ModelStream = async function* () {
    yield { type: "text.delta", delta: "I will inspect the file." }
    yield { type: "tool_call.completed", toolCall }
    yield { type: "text.delta", delta: " Waiting for the result." }
    yield { type: "response.completed", stopReason: "tool_use" }
  }
  const events: AgentEvent[] = []

  const result = await runModelTurn({
    messages: [userMessage],
    assistantMessageId: "assistant-1",
    turn: 1,
    streamModel,
    emit: (event) => {
      events.push(event)
    },
  })

  assert.deepEqual(result.assistantMessage, {
    id: "assistant-1",
    role: "assistant",
    content: [
      { type: "text", text: "I will inspect the file." },
      { type: "tool_call", toolCall },
      { type: "text", text: " Waiting for the result." },
    ],
    stopReason: "tool_use",
  })
  assert.deepEqual(events.find((event) => event.type === "tool.call.proposed"), {
    type: "tool.call.proposed",
    messageId: "assistant-1",
    toolCall,
  })
})

test("rejects inconsistent tool stop reasons", async (context) => {
  await context.test("tool_use without a tool call", async () => {
    const streamModel: ModelStream = async function* () {
      yield { type: "response.completed", stopReason: "tool_use" }
    }

    await assert.rejects(
      runModelTurn({
        messages: [userMessage],
        assistantMessageId: "assistant-1",
        turn: 1,
        streamModel,
      }),
      /proposed no tool calls/,
    )
  })

  await context.test("a tool call followed by end_turn", async () => {
    const events: AgentEvent[] = []
    const streamModel: ModelStream = async function* () {
      yield {
        type: "tool_call.completed",
        toolCall: { id: "tool-call-1", name: "echo", arguments: {} },
      }
      yield { type: "response.completed", stopReason: "end_turn" }
    }

    await assert.rejects(
      runModelTurn({
        messages: [userMessage],
        assistantMessageId: "assistant-1",
        turn: 1,
        streamModel,
        emit: (event) => {
          events.push(event)
        },
      }),
      /completed with end_turn/,
    )
    assert.deepEqual(
      events.map((event) => event.type),
      [
        "turn.started",
        "message.started",
        "tool.call.proposed",
        "message.failed",
        "turn.failed",
      ],
    )
  })
})

test("rejects duplicate tool call ids", async () => {
  const streamModel: ModelStream = async function* () {
    const toolCall = { id: "tool-call-1", name: "echo", arguments: {} }
    yield { type: "tool_call.completed", toolCall }
    yield { type: "tool_call.completed", toolCall }
    yield { type: "response.completed", stopReason: "tool_use" }
  }

  await assert.rejects(
    runModelTurn({
      messages: [userMessage],
      assistantMessageId: "assistant-1",
      turn: 1,
      streamModel,
    }),
    /Duplicate tool call id/,
  )
})

test("rejects a stream that ends without response.completed", async () => {
  const events: AgentEvent[] = []
  const streamModel: ModelStream = async function* () {
    yield { type: "text.delta", delta: "unfinished" }
  }

  await assert.rejects(
    runModelTurn({
      messages: [userMessage],
      assistantMessageId: "assistant-1",
      turn: 1,
      streamModel,
      emit: (event) => {
        events.push(event)
      },
    }),
    /before response\.completed/,
  )
  assert.deepEqual(events.slice(-2), [
    {
      type: "message.failed",
      messageId: "assistant-1",
      error: "Model stream ended before response.completed",
    },
    {
      type: "turn.failed",
      turn: 1,
      error: "Model stream ended before response.completed",
    },
  ])
})

test("does not start the model when already aborted", async () => {
  const controller = new AbortController()
  controller.abort(new Error("cancelled before start"))
  let modelStarted = false
  const events: AgentEvent[] = []
  const streamModel: ModelStream = async function* () {
    modelStarted = true
    yield { type: "response.completed", stopReason: "end_turn" }
  }

  await assert.rejects(
    runModelTurn({
      messages: [userMessage],
      assistantMessageId: "assistant-1",
      turn: 1,
      streamModel,
      signal: controller.signal,
      emit: (event) => {
        events.push(event)
      },
    }),
    /cancelled before start/,
  )
  assert.equal(modelStarted, false)
  assert.deepEqual(events, [])
})

test("rejects when aborted while streaming", async () => {
  const controller = new AbortController()
  const events: AgentEvent[] = []
  const streamModel: ModelStream = async function* () {
    yield { type: "text.delta", delta: "first" }
    yield { type: "text.delta", delta: "second" }
    yield { type: "response.completed", stopReason: "end_turn" }
  }

  await assert.rejects(
    runModelTurn({
      messages: [userMessage],
      assistantMessageId: "assistant-1",
      turn: 1,
      streamModel,
      signal: controller.signal,
      emit: (event) => {
        events.push(event)
        if (event.type === "message.delta") {
          controller.abort(new Error("cancelled while streaming"))
        }
      },
    }),
    /cancelled while streaming/,
  )
  assert.deepEqual(events.slice(-2), [
    {
      type: "message.cancelled",
      messageId: "assistant-1",
      reason: "cancelled while streaming",
    },
    { type: "turn.cancelled", turn: 1, reason: "cancelled while streaming" },
  ])
})

test("propagates event sink failures during streaming", async () => {
  let modelStarted = false
  const events: AgentEvent[] = []
  const streamModel: ModelStream = async function* () {
    modelStarted = true
    yield { type: "text.delta", delta: "never persisted" }
    yield { type: "response.completed", stopReason: "end_turn" }
  }

  await assert.rejects(
    runModelTurn({
      messages: [userMessage],
      assistantMessageId: "assistant-1",
      turn: 1,
      streamModel,
      emit: (event) => {
        events.push(event)
        if (event.type === "message.delta") {
          throw new Error("event sink failed")
        }
      },
    }),
    /event sink failed/,
  )
  assert.equal(modelStarted, true)
  assert.deepEqual(
    events.map((event) => event.type),
    ["turn.started", "message.started", "message.delta", "message.failed", "turn.failed"],
  )
})

test("fails only the turn when message start publication fails", async () => {
  const events: AgentEvent[] = []
  const streamModel: ModelStream = async function* () {
    yield { type: "response.completed", stopReason: "end_turn" }
  }

  await assert.rejects(
    runModelTurn({
      messages: [userMessage],
      assistantMessageId: "assistant-1",
      turn: 1,
      streamModel,
      emit: (event) => {
        if (event.type === "message.started") {
          throw new Error("message start was not stored")
        }
        events.push(event)
      },
    }),
    /message start was not stored/,
  )
  assert.deepEqual(
    events.map((event) => event.type),
    ["turn.started", "turn.failed"],
  )
})

test("does not fail an already completed message when turn completion fails", async () => {
  const events: AgentEvent[] = []
  const streamModel: ModelStream = async function* () {
    yield { type: "response.completed", stopReason: "end_turn" }
  }

  await assert.rejects(
    runModelTurn({
      messages: [userMessage],
      assistantMessageId: "assistant-1",
      turn: 1,
      streamModel,
      emit: (event) => {
        if (event.type === "turn.completed") {
          throw new Error("turn completion was not stored")
        }
        events.push(event)
      },
    }),
    /turn completion was not stored/,
  )
  assert.deepEqual(
    events.map((event) => event.type),
    ["turn.started", "message.started", "message.completed", "turn.failed"],
  )
})

test("preserves non-success model stop reasons", async () => {
  const streamModel: ModelStream = async function* () {
    yield { type: "text.delta", delta: "partial response" }
    yield { type: "response.completed", stopReason: "max_tokens" }
  }

  const result = await runModelTurn({
    messages: [userMessage],
    assistantMessageId: "assistant-1",
    turn: 1,
    streamModel,
  })

  assert.equal(result.assistantMessage.stopReason, "max_tokens")
})
