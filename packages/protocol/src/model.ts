import type { AgentMessage } from "./message.js"
import type { ToolCall, ToolDescriptor } from "./tool.js"

export type ModelStopReason = "end_turn" | "tool_use" | "max_tokens" | "content_filter"

export type ModelStreamEvent =
  | { type: "text.delta"; delta: string }
  | { type: "tool_call.completed"; toolCall: ToolCall }
  | { type: "response.completed"; stopReason: ModelStopReason }

export type ModelRequest = {
  messages: readonly AgentMessage[]
  tools: readonly ToolDescriptor[]
  signal?: AbortSignal
}

export type ModelStream = (request: ModelRequest) => AsyncIterable<ModelStreamEvent>
