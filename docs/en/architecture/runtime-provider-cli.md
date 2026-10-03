# Runtime, Provider, and CLI Vertical Slice

[English](runtime-provider-cli.md) | [简体中文](../../zh-CN/architecture/runtime-provider-cli.md)

> Status: Implemented initial slice  
> Target: V0.1  
> Last updated: 2026-10-03

## Scope

This slice proves one end-to-end behavior: a user prompt reaches a real model, the model can request
`read_file`, Rust reads a workspace file through an explicit protocol, and the model receives the
result before the CLI prints its final response. It intentionally excludes writes, shell execution,
persistence, sessions, and a long-lived Agent Host. It includes only a minimal CLI-local approval
boundary for file reads, not the future general policy engine.

## Runtime protocol and `read_file`

[`schemas/runtime/protocol.schema.json`](../../../schemas/runtime/protocol.schema.json) is the canonical
v1 contract. It defines one NDJSON request/response exchange, one `read_file` method, and normalized
errors. TypeScript constants are checked against this schema. The first Rust binary accepts the
workspace root only as a trusted startup argument; model-controlled requests contain only a relative
path.

Rust canonicalizes both workspace and target paths, rejects absolute paths, parent traversal and
symlink escape, accepts regular UTF-8 files only, and caps output at 1 MiB. The TypeScript Runtime
client starts one process per request. This is deliberately inefficient but gives simple isolation and
cancellation: aborting the call terminates the child process. A persistent multiplexed Runtime can be
introduced after real workloads demonstrate the need.

## Provider boundary

`ModelStream` now receives a `ModelRequest` containing messages, model-facing tool descriptors, and an
optional abort signal. The first adapter uses the OpenAI Responses API with SSE. It translates text
deltas, completed function-call items, explicit completion, incomplete responses, and failures into
Landache's provider-neutral model events. Provider SDK types and credentials do not enter the agent
package.

One adapter instance belongs to one Agent Loop. It retains the last successful `response.id` and sends
only new user or tool-result items with `previous_response_id` on the next turn. This preserves
provider-managed reasoning context without adding provider-specific items to Landache messages or
leaking state across CLI runs.

The adapter requires an explicit model name. Tests inject `fetch` and use deterministic SSE fixtures;
paid API calls are not part of the default test suite.

Tool results are sent to the configured model provider. The initial OpenAI adapter sets `store: true`
so that `previous_response_id` can preserve provider-managed reasoning context. Consequently, any
approved file content may be retained by that third party according to the account's data controls.
This is a security and privacy boundary, not merely an implementation detail.

## CLI

The first CLI is a thin, single-prompt client. It accepts one prompt, treats the current directory as
the workspace, registers only `read_file`, prints streamed text, and maps Ctrl-C to cancellation.
Every ordinary file read requires explicit terminal approval by default. Common credential paths such
as `.env*`, `.git`, `.ssh`, credential filenames, and private-key extensions are denied before the
Runtime is called. This denylist is defense in depth, not a complete secret detector.

```sh
cargo build -p landache-runtime
OPENAI_API_KEY=... OPENAI_MODEL=... node apps/cli/dist/index.js "Summarize README.md"
```

`LANDACHE_RUNTIME_BIN` may override the default `target/debug/landache-runtime` path. The CLI does not
own agent logic or bypass the Runtime for workspace access. Non-interactive use is denied by default;
setting `LANDACHE_APPROVE_READ_FILE=1` explicitly approves all non-sensitive reads for that process,
while the sensitive-path denylist remains active.

## External precedents

- Official OpenAI documentation for [streaming Responses](https://developers.openai.com/api/docs/guides/streaming-responses)
  and [function calling](https://developers.openai.com/api/docs/guides/function-calling), observed on
  2026-10-03: adopted semantic SSE events and completed function-call items; did not adopt the SDK.
  The adapter instead uses response-ID chaining and documents the associated retention boundary above.
- OpenAI Codex [`rpc.rs`](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/rpc.rs)
  and [`export.rs`](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/export.rs), observed on `main` on
  2026-10-03: adopted explicit request IDs, structured envelopes, and schema-oriented contracts. We did
  not adopt its broad app-server protocol or long-lived server lifecycle.
- Gemini CLI [`packages/core`](https://github.com/google-gemini/gemini-cli/tree/main/packages/core)
  tool boundary and [tool reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/tools.md), observed on `main` on 2026-10-03:
  adopted the separation between a thin CLI, core orchestration, and classified tools. We did not adopt
  its complete policy engine or tool catalog.
- Pi [`packages/agent`](https://github.com/earendil-works/pi/tree/main/packages/agent), observed on
  `main` on 2026-10-03: adopted the separation of provider, agent core,
  and CLI packages. We kept sequential tool execution and did not adopt its extension, TUI, steering,
  or parallel execution systems.

The exact commit SHAs were not available through the inspected web views, so these observations are
date-pinned rather than commit-pinned.

## Verification and limits

TypeScript contract, agent, Runtime-client, and Provider tests cover the executable TypeScript side.
Focused tests cover provider failures, content filtering, chunk-split SSE, response-ID mismatch,
Runtime cancellation, and the CLI sensitive-path policy.
Rust unit tests cover normal reads, traversal rejection, symlink escape, output limits, and schema
error-code consistency. Local `cargo fmt --check`, `cargo test`, and strict Clippy validation pass with
Rust 1.99.0. Before shipping this slice, CI must repeat those checks and execute a temporary-workspace
TypeScript-to-Rust integration test; the cross-process integration is the remaining unverified layer.
