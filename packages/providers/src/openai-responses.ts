import type {
  AgentMessage,
  JsonObject,
  ModelStream,
  ModelStreamEvent,
  ToolDescriptor,
} from "@landache/protocol"

export type OpenAIResponsesOptions = {
  apiKey: string
  model: string
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

export function createOpenAIResponsesStream(options: OpenAIResponsesOptions): ModelStream {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  let previousResponseId: string | undefined
  return async function* ({ messages, tools, signal }) {
    const inputMessages = previousResponseId === undefined
      ? messages
      : messages.slice(findLastAssistantIndex(messages) + 1)
    const response = await fetchImplementation(`${options.baseUrl ?? "https://api.openai.com/v1"}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        input: toOpenAIInput(inputMessages),
        tools: tools.map(toOpenAITool),
        stream: true,
        store: true,
        ...(previousResponseId === undefined ? {} : { previous_response_id: previousResponseId }),
      }),
      signal,
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2_000)
      throw new Error(`OpenAI Responses API returned ${response.status}: ${detail}`)
    }
    if (response.body === null) {
      throw new Error("OpenAI Responses API returned no response body")
    }

    let sawToolCall = false
    for await (const event of parseSseJson(response.body)) {
      const type = stringProperty(event, "type")
      if (type === "response.output_text.delta") {
        yield { type: "text.delta", delta: stringProperty(event, "delta") } satisfies ModelStreamEvent
      } else if (type === "response.output_item.done") {
        const item = recordProperty(event, "item")
        if (item.type === "function_call") {
          const argumentsValue: unknown = JSON.parse(stringProperty(item, "arguments"))
          if (!isJsonObject(argumentsValue)) {
            throw new Error("OpenAI function call arguments must be a JSON object")
          }
          sawToolCall = true
          yield {
            type: "tool_call.completed",
            toolCall: {
              id: stringProperty(item, "call_id"),
              name: stringProperty(item, "name"),
              arguments: argumentsValue,
            },
          } satisfies ModelStreamEvent
        }
      } else if (type === "response.completed") {
        const responseValue = recordProperty(event, "response")
        previousResponseId = stringProperty(responseValue, "id")
        yield {
          type: "response.completed",
          stopReason: sawToolCall ? "tool_use" : "end_turn",
        } satisfies ModelStreamEvent
      } else if (type === "response.incomplete") {
        const responseValue = recordProperty(event, "response")
        const details = isRecord(responseValue.incomplete_details) ? responseValue.incomplete_details : {}
        const reason = details.reason === "content_filter" ? "content_filter" : "max_tokens"
        yield { type: "response.completed", stopReason: reason } satisfies ModelStreamEvent
      } else if (type === "response.failed" || type === "error") {
        throw new Error(readProviderError(event))
      }
    }
  }
}

function findLastAssistantIndex(messages: readonly AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return index
  }
  return -1
}

function toOpenAIInput(messages: readonly AgentMessage[]): unknown[] {
  return messages.flatMap((message): unknown[] => {
    if (message.role === "user") {
      return [{ role: "user", content: message.content }]
    }
    if (message.role === "tool") {
      return [{
        type: "function_call_output",
        call_id: message.toolCallId,
        output: JSON.stringify(message.content),
      }]
    }
    return message.content.map((content) =>
      content.type === "text"
        ? { role: "assistant", content: [{ type: "output_text", text: content.text }] }
        : {
            type: "function_call",
            call_id: content.toolCall.id,
            name: content.toolCall.name,
            arguments: JSON.stringify(content.toolCall.arguments),
          },
    )
  })
}

function toOpenAITool(tool: ToolDescriptor): unknown {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }
}

export async function* parseSseJson(body: ReadableStream<Uint8Array>): AsyncIterable<Record<string, unknown>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ""
      for (const block of blocks) {
        const data = block.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        if (data !== "" && data !== "[DONE]") {
          const value: unknown = JSON.parse(data)
          if (!isRecord(value)) throw new Error("OpenAI SSE data must be an object")
          yield value
        }
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}

function readProviderError(event: Record<string, unknown>): string {
  const response = isRecord(event.response) ? event.response : undefined
  const error = isRecord(event.error)
    ? event.error
    : response !== undefined && isRecord(response.error)
      ? response.error
      : event
  return typeof error.message === "string" ? error.message : "OpenAI response failed"
}

function stringProperty(value: Record<string, unknown>, key: string): string {
  const property = value[key]
  if (typeof property !== "string") throw new Error(`OpenAI event is missing string ${key}`)
  return property
}

function recordProperty(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const property = value[key]
  if (!isRecord(property)) throw new Error(`OpenAI event is missing object ${key}`)
  return property
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}
