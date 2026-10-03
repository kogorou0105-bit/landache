# Runtime、Provider 与 CLI 纵向切片

[English](../../en/architecture/runtime-provider-cli.md) | [简体中文](runtime-provider-cli.md)

> 状态：已实现初始切片  
> 目标版本：V0.1  
> 最后更新：2026-10-03

## 范围

这个切片验证一个端到端行为：用户 Prompt 到达真实模型，模型可以请求 `read_file`，Rust 通过明确
协议读取 Workspace 文件，模型收到结果后由 CLI 输出最终回答。本阶段刻意不加入写操作、Shell、
持久化、Session 和常驻 Agent Host，只加入 CLI 本地的最小文件读取审批边界，而不是未来的通用
Policy Engine。

## Runtime 协议与 `read_file`

[`schemas/runtime/protocol.schema.json`](../../../schemas/runtime/protocol.schema.json) 是 v1 契约的
唯一真相，定义了一次 NDJSON 请求/响应、一个 `read_file` 方法和归一化错误。测试会校验 TypeScript
常量与该 Schema 一致。首个 Rust 二进制只从可信启动参数接收 Workspace Root；模型可控请求只
包含相对路径。

Rust 会规范化 Workspace 和目标路径，拒绝绝对路径、父目录穿越和 Symlink Escape，只接受普通
UTF-8 文件，并把输出限制为 1 MiB。TypeScript Runtime Client 每次请求启动一个进程。这个方案
效率不高，但隔离和取消语义简单：调用取消时终止子进程。真实负载证明有需要后，再引入常驻、
多路复用的 Runtime。

## Provider Registry 与边界

`ModelStream` 现在接收包含消息、面向模型的 Tool Descriptor 和可选 Abort Signal 的
`ModelRequest`。一个小型 Registry 负责解析 Provider 身份、凭据、Endpoint、模型、Wire Protocol、
会话策略和存储行为。首个协议适配器通过 SSE 使用 Responses API，把文本增量、完成的 Function
Call、正常完成、未完整响应和失败转换为 Landache 的 Provider 中立事件。Provider SDK 类型和
凭据不会进入 agent 包。

内置 `openai` 定义使用 `previous_response_id`，下一回合只发送最后一条 Assistant Message 之后的
新增 Item，并请求 `store: true`。内置 `deepseek` 定义复用相同 Wire Adapter，但每回合发送完整
Landache 历史并使用 `store: false`，因为 DeepSeek Responses API 是无状态的。会话所有权因此是
显式配置，而不是 Agent Loop 中按厂商名称分支。

适配器要求调用方显式指定模型。测试注入 `fetch` 并使用确定性的 SSE Fixture；默认测试套件不会
发起付费 API 调用。

Tool Result 会发送给配置的模型 Provider。OpenAI 配置设置 `store: true`，以便通过
`previous_response_id` 保留 Provider 管理的推理上下文。因此，任何获批文件的内容都可能按照该
第三方及账户的数据控制策略被留存。这是安全与隐私边界，不只是实现细节。

## CLI

首个 CLI 是很薄的单 Prompt 客户端：接收一个 Prompt，把当前目录作为 Workspace，只注册
`read_file`，输出流式文本，并把 Ctrl-C 映射为取消。
默认情况下，每次普通文件读取都需要终端明确审批。`.env*`、`.git`、`.ssh`、常见凭据文件名和
私钥扩展名等路径会在调用 Runtime 前被拒绝。这个拒绝列表是纵深防御，不是完整的秘密检测器。

```sh
cargo build -p landache-runtime
MODEL_PROVIDER=openai MODEL_NAME=... OPENAI_API_KEY=... \
  node apps/cli/dist/index.js "Summarize README.md"

MODEL_PROVIDER=deepseek MODEL_NAME=deepseek-flash DEEPSEEK_API_KEY=... \
  node apps/cli/dist/index.js "Summarize README.md"
```

`MODEL_API_KEY` 可以替代厂商专属 Key 变量，`MODEL_BASE_URL` 可以覆盖内置 Endpoint。
`OPENAI_MODEL` 为原 OpenAI-only CLI 保留兼容回退；新配置应使用 `MODEL_NAME`。省略
`MODEL_PROVIDER` 时默认选择 `openai`。

可以用 `LANDACHE_RUNTIME_BIN` 覆盖默认的 `target/debug/landache-runtime` 路径。CLI 不拥有 Agent
逻辑，也不会绕过 Runtime 访问 Workspace。非交互运行默认拒绝读取；设置
`LANDACHE_APPROVE_READ_FILE=1` 会为该进程明确批准全部非敏感读取，而敏感路径拒绝列表仍然生效。

## 外部项目参考

- OpenAI 官方文档的 [Responses 流式输出](https://developers.openai.com/api/docs/guides/streaming-responses)
  与 [Function Calling](https://developers.openai.com/api/docs/guides/function-calling)，于 2026-10-03
  查看：采用语义化 SSE Event 和完成后的 Function Call Item；没有采用 SDK。首个 Adapter 使用
  Response ID 串联，并在上文明确记录其数据留存边界。
- DeepSeek 官方文档的 [Responses API](https://api-docs.deepseek.com/zh-cn/api/create-response/)
  与[兼容性说明](https://api-docs.deepseek.com/guides/responses_api/)，于 2026-10-03 查看：采用
  `/responses` Endpoint、语义化 SSE Event、完整历史会话策略和 `store: false`。DeepSeek 将该 API
  明确记录为无状态，并且不支持 `previous_response_id`。
- OpenAI Codex 的 [`rpc.rs`](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/rpc.rs)
  与 [`export.rs`](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/export.rs)，于 2026-10-03 查看
  `main`：采用明确请求 ID、结构化 Envelope 和以 Schema 为中心的契约；没有采用它的大型 App
  Server 协议和常驻 Server 生命周期。
- Gemini CLI 的 [`packages/core`](https://github.com/google-gemini/gemini-cli/tree/main/packages/core)
  工具边界与 [Tool Reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/tools.md)，于 2026-10-03 查看 `main`：采用薄
  CLI、Core 编排和工具分类之间的分离；没有采用完整 Policy Engine 和工具集合。
- Pi 的 [`packages/agent`](https://github.com/earendil-works/pi/tree/main/packages/agent)，于
  2026-10-03 查看 `main`：采用 Provider、Agent Core 与 CLI 分包；
  保持顺序工具执行，没有采用它的扩展、TUI、Steering 和并行执行系统。
- Pi 的 [`packages/ai`](https://github.com/earendil-works/pi/tree/main/packages/ai)，版本 `v0.87.1`
 （`f07218c`），以及其中按协议拆分的 Provider Adapter：采用 Wire Protocol 与 Provider/Model
  兼容配置分离；没有采用完整模型目录、OAuth、成本统计和大量协议集合。
- OpenCode 的 [`provider.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/provider/provider.ts)，
  于 2026-10-03 查看 `dev`：采用在模型执行前解析 Provider 配置的 Registry；没有采用动态 npm
  Loader 和大型 Provider 目录。
- Codex 的 [`model-provider-info`](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs)，
  于 2026-10-03 查看 `main`：采用显式 Endpoint 和 Wire Protocol 配置。与当前 Codex 不同，
  Landache 为非 Responses 协议 Adapter 保留扩展位置。

除上文已经明确记录 Release 与 Commit 的条目外，其余来源因无法通过查看的 Web 页面得到准确
Commit SHA，按查看日期固定。

## 验证与限制

TypeScript 契约、Agent、Runtime Client 和 Provider 测试覆盖了可执行的 TypeScript 部分。聚焦
测试还覆盖 Provider 失败、内容过滤、跨 Chunk SSE、响应 ID 不匹配、Runtime 取消和 CLI 敏感
路径策略，以及 Registry 校验、兼容旧配置的 OpenAI 解析和无状态 DeepSeek Tool Result 往返。
DeepSeek Wire Contract 已对照其官方文档核验，但默认测试套件不会向 DeepSeek 线上 Endpoint
发起付费调用。
Rust 单元测试覆盖正常读取、路径穿越、Symlink Escape、输出上限和 Schema 错误码一致性。
本地已使用 Rust 1.99.0 通过 `cargo fmt --check`、`cargo test` 和严格 Clippy 检查。发布前 CI 必须
重复这些检查，并在临时 Workspace 中执行 TypeScript 到 Rust 的跨进程集成测试；该集成层仍是
当前唯一未验证的部分。
