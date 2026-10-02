import type { AssistantMessage, ToolResultMessage } from "./message.js"
import type { ToolCall } from "./tool.js"

export type AgentEvent =
  | { type: "turn.started"; turn: number }
  | { type: "message.started"; messageId: string; role: "assistant" }
  | { type: "message.delta"; messageId: string; delta: string }
  | { type: "tool.call.proposed"; messageId: string; toolCall: ToolCall }
  | { type: "tool.call.started"; toolCall: ToolCall; resultMessageId: string }
  | { type: "tool.call.completed"; result: ToolResultMessage }
  | { type: "tool.call.failed"; toolCallId: string; error: string }
  | { type: "tool.call.cancelled"; toolCallId: string; reason: string }
  | { type: "message.completed"; message: AssistantMessage }
  | { type: "message.failed"; messageId: string; error: string }
  | { type: "message.cancelled"; messageId: string; reason: string }
  | { type: "turn.completed"; turn: number; messageId: string }
  | { type: "turn.failed"; turn: number; error: string }
  | { type: "turn.cancelled"; turn: number; reason: string }
