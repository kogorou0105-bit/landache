# Minimal Agent Loop

[English](agent-loop.md) | [简体中文](../../zh-CN/architecture/agent-loop.md)

> Status: Implemented  
> Target: V0.1  
> Last updated: 2026-10-03

## 1. Scope

`runAgentLoop` closes the smallest useful model/tool cycle. It calls `runModelTurn`, appends the
assistant message, executes every proposed tool call sequentially through the `ToolRegistry`, appends
the resulting tool messages, and starts the next model turn. It deliberately does not add persistence,
approval policy, parallel execution, steering, retries, or context compaction.

## 2. Inputs and ownership

The caller supplies the initial message history, registry, model stream, abort signal, event sink,
positive `maxTurns`, and `createMessageId`. The loop copies the initial array and never mutates the
caller's array. It returns the complete copied-and-extended history plus the final assistant message.

The loop owns IDs for messages it creates, while the provider owns tool-call IDs. A caller-provided ID
factory keeps storage-specific ID policy outside the agent package and makes tests deterministic. Empty
or duplicate generated message IDs are rejected before their message starts.

## 3. Control flow

For each model turn, starting at turn 1:

1. check cancellation;
2. create an assistant message ID and call `runModelTurn` with the current history;
3. append the returned assistant message;
4. if its stop reason is not `tool_use`, return it and the complete history;
5. otherwise, extract tool calls in content order, execute them one at a time, and append each result;
6. pass the expanded history to the next model turn.

Tool failures represented by `ToolResultMessage` are normal model inputs, so the next turn can explain
or recover from them. Cancellation and infrastructure failures still reject the loop through the
existing lower-level contracts.

`max_tokens` and `content_filter` stop the loop just like `end_turn`; they are explicit provider
terminations, not requests for another tool round. If a `tool_use` turn consumes the final allowed
turn, its tools still run and their lifecycle events complete, then the loop rejects because no model
turn remains to consume the results. This makes `maxTurns` a bound on model calls without silently
discarding already proposed work.

## 4. Tests and future work

Tests cover ordered multi-tool execution, history passed to the next model turn, recoverable tool
errors, non-tool stop reasons, the turn limit, and invalid or duplicate IDs. Later work can add run-level
events, persistence, approvals, parallel tool scheduling, and context management without changing the
model-turn or single-tool execution boundaries.

