# 最小 Agent Loop

[English](../../en/architecture/agent-loop.md) | [简体中文](agent-loop.md)

> 状态：已实现  
> 目标版本：V0.1  
> 最后更新：2026-10-03

## 1. 范围

`runAgentLoop` 闭合最小可用的模型与工具循环。它调用 `runModelTurn`、追加 Assistant Message、
通过 `ToolRegistry` 顺序执行所有 Tool Call、追加 Tool Result Message，然后开始下一个模型回合。
本阶段刻意不加入持久化、审批策略、并行执行、steering、重试或上下文压缩。

## 2. 输入与所有权

调用方提供初始消息历史、Registry、模型流、Abort Signal、事件接收器、正整数 `maxTurns` 和
`createMessageId`。循环会复制初始数组，不会修改调用方的数组；返回值包含扩展后的完整历史和
最后一条 Assistant Message。

循环负责它所创建消息的 ID，Provider 负责 Tool Call ID。由调用方提供 ID 工厂，既能让存储层的
ID 策略留在 agent 包之外，也能让测试保持确定性。空 ID 或重复生成的消息 ID 会在对应消息开始前
被拒绝。

## 3. 控制流

模型回合从 1 开始，每轮依次执行：

1. 检查取消状态；
2. 创建 Assistant Message ID，并使用当前历史调用 `runModelTurn`；
3. 追加返回的 Assistant Message；
4. 如果停止原因不是 `tool_use`，返回该消息和完整历史；
5. 否则按 content 中的顺序提取 Tool Call，逐个执行并追加每个结果；
6. 把扩展后的历史传给下一模型回合。

以 `ToolResultMessage` 表示的工具错误属于正常模型输入，下一回合可以解释或恢复。取消和基础设施
故障仍按照已有的底层契约使整个循环 reject。

`max_tokens` 和 `content_filter` 与 `end_turn` 一样会停止循环；它们是 Provider 的明确终止结果，
并不表示需要再执行一轮工具。如果最后一个允许的回合以 `tool_use` 结束，其中的工具仍会执行并
完成生命周期事件，随后循环因没有下一模型回合可消费结果而 reject。这样 `maxTurns` 明确限制的
是模型调用次数，同时不会静默丢弃已经提出的工作。

## 4. 测试与后续工作

测试覆盖多个工具的顺序执行、传给下一回合的历史、可恢复的工具错误、非工具停止原因、回合上限，
以及非法或重复 ID。未来可以在不改变模型单回合和单工具执行边界的前提下，增加 Run 级事件、
持久化、审批、并行工具调度和上下文管理。

