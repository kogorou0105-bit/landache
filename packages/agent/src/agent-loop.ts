import type {
  AgentEvent,
  AgentMessage,
  AssistantMessage,
  ToolCall,
} from "@landache/protocol"

import { runModelTurn, type ModelStream } from "./model-turn.js"
import { executeToolCall, type ToolRegistry } from "./tool-execution.js"

export type AgentLoopOptions = {
  messages: readonly AgentMessage[]
  registry: ToolRegistry
  streamModel: ModelStream
  maxTurns: number
  createMessageId: () => string
  signal?: AbortSignal
  emit?: (event: AgentEvent) => void | Promise<void>
}

export type AgentLoopResult = {
  messages: AgentMessage[]
  assistantMessage: AssistantMessage
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  if (!Number.isSafeInteger(options.maxTurns) || options.maxTurns < 1) {
    throw new RangeError("maxTurns must be a positive safe integer")
  }

  const messages = [...options.messages]
  const messageIds = new Set(messages.map((message) => message.id))

  const createMessageId = () => {
    const id = options.createMessageId()
    if (id.length === 0) {
      throw new Error("createMessageId returned an empty id")
    }
    if (messageIds.has(id)) {
      throw new Error(`Duplicate message id: ${id}`)
    }
    messageIds.add(id)
    return id
  }

  for (let turn = 1; turn <= options.maxTurns; turn += 1) {
    options.signal?.throwIfAborted()

    const { assistantMessage } = await runModelTurn({
      messages,
      assistantMessageId: createMessageId(),
      turn,
      streamModel: options.streamModel,
      tools: options.registry.list(),
      signal: options.signal,
      emit: options.emit,
    })
    messages.push(assistantMessage)

    if (assistantMessage.stopReason !== "tool_use") {
      return { messages, assistantMessage }
    }

    for (const toolCall of getToolCalls(assistantMessage)) {
      const result = await executeToolCall({
        toolCall,
        resultMessageId: createMessageId(),
        registry: options.registry,
        signal: options.signal,
        emit: options.emit,
      })
      messages.push(result)
    }
  }

  throw new Error(`Agent loop reached maxTurns (${options.maxTurns}) before completion`)
}

function getToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.flatMap((content) =>
    content.type === "tool_call" ? [content.toolCall] : [],
  )
}
