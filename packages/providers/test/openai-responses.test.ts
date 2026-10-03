import assert from "node:assert/strict"
import test from "node:test"

import { createOpenAIResponsesStream } from "@landache/providers"

test("maps OpenAI text and function-call SSE events", async () => {
  const requestBodies: Record<string, unknown>[] = []
  const fetchMock: typeof fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    const events = [
      { type: "response.output_text.delta", delta: "Reading" },
      {
        type: "response.output_item.done",
        item: { type: "function_call", call_id: "call-1", name: "read_file", arguments: '{"path":"README.md"}' },
      },
      { type: "response.completed", response: { id: "response-1", status: "completed" } },
    ]
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })
  }
  const stream = createOpenAIResponsesStream({ apiKey: "test", model: "test-model", fetch: fetchMock })
  const output = []
  for await (const event of stream({
    messages: [{ id: "u1", role: "user", content: "Read README" }],
    tools: [{ name: "read_file", description: "Read a file", inputSchema: { type: "object" } }],
  })) output.push(event)

  assert.deepEqual(output, [
    { type: "text.delta", delta: "Reading" },
    { type: "tool_call.completed", toolCall: { id: "call-1", name: "read_file", arguments: { path: "README.md" } } },
    { type: "response.completed", stopReason: "tool_use" },
  ])
  assert.equal(requestBodies[0]?.model, "test-model")
  assert.equal(Array.isArray(requestBodies[0]?.tools), true)
  assert.equal(requestBodies[0]?.store, true)

  for await (const _event of stream({
    messages: [
      { id: "u1", role: "user", content: "Read README" },
      {
        id: "a1",
        role: "assistant",
        content: [{ type: "tool_call", toolCall: { id: "call-1", name: "read_file", arguments: { path: "README.md" } } }],
        stopReason: "tool_use",
      },
      {
        id: "t1",
        role: "tool",
        toolCallId: "call-1",
        toolName: "read_file",
        content: { type: "output", value: { content: "Landache" } },
      },
    ],
    tools: [],
  })) {
    // Drain the second response to inspect its request.
  }
  assert.equal(requestBodies[1]?.previous_response_id, "response-1")
  assert.deepEqual(requestBodies[1]?.input, [{
    type: "function_call_output",
    call_id: "call-1",
    output: '{"type":"output","value":{"content":"Landache"}}',
  }])
})

test("maps an incomplete response to max_tokens", async () => {
  const fetchMock: typeof fetch = async () => new Response(
    'data: {"type":"response.incomplete","response":{"id":"response-2","incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
  )
  const stream = createOpenAIResponsesStream({ apiKey: "test", model: "test", fetch: fetchMock })
  const output = []
  for await (const event of stream({ messages: [], tools: [] })) output.push(event)
  assert.deepEqual(output, [{ type: "response.completed", stopReason: "max_tokens" }])
})

test("maps content filtering and provider failures", async () => {
  const filtered = createOpenAIResponsesStream({
    apiKey: "test",
    model: "test",
    fetch: async () => new Response(
      'data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"content_filter"}}}\n\n',
    ),
  })
  const output = []
  for await (const event of filtered({ messages: [], tools: [] })) output.push(event)
  assert.deepEqual(output, [{ type: "response.completed", stopReason: "content_filter" }])

  for (const failedEvent of [
    { type: "response.failed", response: { error: { message: "provider failed" } } },
    { type: "error", message: "stream failed" },
  ]) {
    const failed = createOpenAIResponsesStream({
      apiKey: "test",
      model: "test",
      fetch: async () => new Response(`data: ${JSON.stringify(failedEvent)}\n\n`),
    })
    await assert.rejects(async () => {
      for await (const _event of failed({ messages: [], tools: [] })) { /* drain */ }
    }, /failed/)
  }
})

test("parses SSE split across chunks and serializes assistant text", async () => {
  let requestBody: Record<string, unknown> | undefined
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"response.output_text.'))
      controller.enqueue(encoder.encode('delta","delta":"split"}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"response.completed","response":{"id":"r-split"}}\n\n'))
      controller.close()
    },
  })
  const stream = createOpenAIResponsesStream({
    apiKey: "test",
    model: "test",
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(body)
    },
  })
  const output = []
  for await (const event of stream({
    messages: [{
      id: "a1",
      role: "assistant",
      content: [{ type: "text", text: "prior answer" }],
      stopReason: "end_turn",
    }],
    tools: [],
  })) output.push(event)

  assert.deepEqual(output, [
    { type: "text.delta", delta: "split" },
    { type: "response.completed", stopReason: "end_turn" },
  ])
  assert.deepEqual(requestBody?.input, [{
    role: "assistant",
    content: [{ type: "output_text", text: "prior answer" }],
  }])
})
