export type UserMessage = {
  id: string
  role: "user"
  content: string
}

export type AssistantMessage = {
  id: string
  role: "assistant"
  content: string
  stopReason: "end_turn"
}

export type AgentMessage = UserMessage | AssistantMessage
