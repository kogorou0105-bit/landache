import type { AssistantMessage } from "./message.js"

export type AgentEvent =
  | { type: "turn.started"; turn: number }
  | { type: "message.started"; messageId: string; role: "assistant" }
  | { type: "message.delta"; messageId: string; delta: string }
  | { type: "message.completed"; message: AssistantMessage }
  | { type: "turn.completed"; turn: number; messageId: string }
