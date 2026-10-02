import type { ToolCall } from "./tool.js"

export type UserMessage = {
  id: string
  role: "user"
  content: string
}

export type TextContent = {
  type: "text"
  text: string
}

export type ToolCallContent = {
  type: "tool_call"
  toolCall: ToolCall
}

export type AssistantContent = TextContent | ToolCallContent

export type AssistantStopReason = "end_turn" | "tool_use" | "max_tokens" | "content_filter"

export type AssistantMessage = {
  id: string
  role: "assistant"
  content: AssistantContent[]
  stopReason: AssistantStopReason
}

export type AgentMessage = UserMessage | AssistantMessage
