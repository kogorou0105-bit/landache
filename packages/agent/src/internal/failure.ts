import type { AgentEvent } from "@landache/protocol"

export async function emitBestEffort(
  emit: (event: AgentEvent) => void | Promise<void>,
  event: AgentEvent,
): Promise<void> {
  try {
    await emit(event)
  } catch {
    // The original failure remains authoritative when the event sink is also unavailable.
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error ?? "Unknown error")
}
