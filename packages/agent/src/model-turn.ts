import type { AgentEvent, AgentMessage, AssistantMessage } from "@landache/protocol"

export type ModelStreamEvent =
  | { type: "text.delta"; delta: string }
  | { type: "response.completed"; stopReason: "end_turn" }

export type ModelStream = (
  messages: readonly AgentMessage[],
  signal?: AbortSignal,
) => AsyncIterable<ModelStreamEvent>

export type ModelTurnOptions = {
  messages: readonly AgentMessage[]
  assistantMessageId: string
  turn: number
  streamModel: ModelStream
  signal?: AbortSignal
  emit?: (event: AgentEvent) => void | Promise<void>
}

export type ModelTurnResult = {
  messages: AgentMessage[]
  assistantMessage: AssistantMessage
}

export async function runModelTurn(options: ModelTurnOptions): Promise<ModelTurnResult> {
  const emit = options.emit ?? (() => undefined)
  const chunks: string[] = []
  let stopReason: AssistantMessage["stopReason"] | undefined

  options.signal?.throwIfAborted()
  await emit({ type: "turn.started", turn: options.turn })
  await emit({
    type: "message.started",
    messageId: options.assistantMessageId,
    role: "assistant",
  })

  for await (const event of options.streamModel(options.messages, options.signal)) {
    options.signal?.throwIfAborted()

    switch (event.type) {
      case "text.delta":
        chunks.push(event.delta)
        await emit({
          type: "message.delta",
          messageId: options.assistantMessageId,
          delta: event.delta,
        })
        break
      case "response.completed":
        stopReason = event.stopReason
        break
      default:
        assertNever(event)
    }
  }

  if (stopReason === undefined) {
    throw new Error("Model stream ended before response.completed")
  }

  const assistantMessage: AssistantMessage = {
    id: options.assistantMessageId,
    role: "assistant",
    content: chunks.join(""),
    stopReason,
  }
  const messages = [...options.messages, assistantMessage]

  await emit({ type: "message.completed", message: assistantMessage })
  await emit({
    type: "turn.completed",
    turn: options.turn,
    messageId: assistantMessage.id,
  })

  return { messages, assistantMessage }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled model stream event: ${JSON.stringify(value)}`)
}
