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
    content: "Hello world",
    stopReason: "end_turn",
  })
  assert.deepEqual(result.messages, [userMessage, result.assistantMessage])
  assert.deepEqual(events, [
    { type: "turn.started", turn: 3 },
    { type: "message.started", messageId: "assistant-1", role: "assistant" },
    { type: "message.delta", messageId: "assistant-1", delta: "Hello" },
    { type: "message.delta", messageId: "assistant-1", delta: " world" },
    { type: "message.completed", message: result.assistantMessage },
    { type: "turn.completed", turn: 3, messageId: "assistant-1" },
  ])
})

test("rejects a stream that ends without response.completed", async () => {
  const streamModel: ModelStream = async function* () {
    yield { type: "text.delta", delta: "unfinished" }
  }

  await assert.rejects(
    runModelTurn({
      messages: [userMessage],
      assistantMessageId: "assistant-1",
      turn: 1,
      streamModel,
    }),
    /before response\.completed/,
  )
})

test("does not start the model when already aborted", async () => {
  const controller = new AbortController()
  controller.abort(new Error("cancelled before start"))
  let modelStarted = false
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
    }),
    /cancelled before start/,
  )
  assert.equal(modelStarted, false)
})

test("rejects when aborted while streaming", async () => {
  const controller = new AbortController()
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
        if (event.type === "message.delta") {
          controller.abort(new Error("cancelled while streaming"))
        }
      },
    }),
    /cancelled while streaming/,
  )
})

test("propagates event sink failures during streaming", async () => {
  let modelStarted = false
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
        if (event.type === "message.delta") {
          throw new Error("event sink failed")
        }
      },
    }),
    /event sink failed/,
  )
  assert.equal(modelStarted, true)
})
