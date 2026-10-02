import type {
  AgentEvent,
  AgentMessage,
  AssistantContent,
  AssistantMessage,
  AssistantStopReason,
  ToolCall,
} from "@landache/protocol"

import { describeError, emitBestEffort } from "./internal/failure.js"

export type ModelStopReason = "end_turn" | "tool_use" | "max_tokens" | "content_filter"

export type ModelStreamEvent =
  | { type: "text.delta"; delta: string }
  | { type: "tool_call.completed"; toolCall: ToolCall }
  | { type: "response.completed"; stopReason: ModelStopReason }

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
  assistantMessage: AssistantMessage
}

export async function runModelTurn(options: ModelTurnOptions): Promise<ModelTurnResult> {
  const emit = options.emit ?? (() => undefined)
  const content: AssistantContent[] = []
  const pendingTextChunks: string[] = []
  const toolCallIds = new Set<string>()
  let modelStopReason: ModelStopReason | undefined
  let turnStarted = false
  let messageStarted = false
  let messageTerminated = false
  let turnTerminated = false

  const flushText = () => {
    if (pendingTextChunks.length === 0) {
      return
    }

    content.push({ type: "text", text: pendingTextChunks.join("") })
    pendingTextChunks.length = 0
  }

  options.signal?.throwIfAborted()
  try {
    await emit({ type: "turn.started", turn: options.turn })
    turnStarted = true
    await emit({
      type: "message.started",
      messageId: options.assistantMessageId,
      role: "assistant",
    })
    messageStarted = true

    for await (const event of options.streamModel(options.messages, options.signal)) {
      options.signal?.throwIfAborted()

      switch (event.type) {
        case "text.delta":
          pendingTextChunks.push(event.delta)
          await emit({
            type: "message.delta",
            messageId: options.assistantMessageId,
            delta: event.delta,
          })
          break
        case "tool_call.completed":
          if (toolCallIds.has(event.toolCall.id)) {
            throw new Error(`Duplicate tool call id: ${event.toolCall.id}`)
          }

          flushText()
          toolCallIds.add(event.toolCall.id)
          content.push({ type: "tool_call", toolCall: event.toolCall })
          await emit({
            type: "tool.call.proposed",
            messageId: options.assistantMessageId,
            toolCall: event.toolCall,
          })
          break
        case "response.completed":
          modelStopReason = event.stopReason
          break
        default:
          assertNever(event)
      }
    }

    options.signal?.throwIfAborted()

    if (modelStopReason === undefined) {
      throw new Error("Model stream ended before response.completed")
    }

    flushText()

    if (modelStopReason === "tool_use" && toolCallIds.size === 0) {
      throw new Error("Model completed with tool_use but proposed no tool calls")
    }

    if (modelStopReason !== "tool_use" && toolCallIds.size > 0) {
      throw new Error(`Model proposed tool calls but completed with ${modelStopReason}`)
    }

    const assistantMessage: AssistantMessage = {
      id: options.assistantMessageId,
      role: "assistant",
      content,
      stopReason: toAssistantStopReason(modelStopReason),
    }

    await emit({ type: "message.completed", message: assistantMessage })
    messageTerminated = true
    await emit({
      type: "turn.completed",
      turn: options.turn,
      messageId: assistantMessage.id,
    })
    turnTerminated = true

    return { assistantMessage }
  } catch (error) {
    const cancelled = options.signal?.aborted === true
    const detail = describeError(cancelled ? options.signal?.reason : error)

    if (messageStarted && !messageTerminated) {
      await emitBestEffort(
        emit,
        cancelled
          ? { type: "message.cancelled", messageId: options.assistantMessageId, reason: detail }
          : { type: "message.failed", messageId: options.assistantMessageId, error: detail },
      )
    }

    if (turnStarted && !turnTerminated) {
      await emitBestEffort(
        emit,
        cancelled
          ? { type: "turn.cancelled", turn: options.turn, reason: detail }
          : { type: "turn.failed", turn: options.turn, error: detail },
      )
    }

    throw error
  }
}

function toAssistantStopReason(reason: ModelStopReason): AssistantStopReason {
  switch (reason) {
    case "end_turn":
    case "tool_use":
    case "max_tokens":
    case "content_filter":
      return reason
    default:
      return assertNever(reason)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled model stream event: ${JSON.stringify(value)}`)
}
