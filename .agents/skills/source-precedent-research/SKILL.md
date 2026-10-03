---
name: source-precedent-research
description: Research relevant source code in strong open-source agent projects before Landache makes a substantial new subsystem, architecture, protocol, runtime-boundary, or unfamiliar design decision. Use when proven implementations could materially change the design; do not use for small fixes, mechanical edits, routine tests, or settled designs unless the user asks.
---

# Source Precedent Research

Ground important Landache design decisions in working implementations without copying complexity blindly.

## Choose references

Select one to three projects whose named strengths match the current question. Prefer P0/P1 when relevance is otherwise equal; use a lower-priority project when it is the closer technical analogue.

| Priority | Project | Best used to study |
| --- | --- | --- |
| P0 | [Pi](https://github.com/earendil-works/pi) | Minimal agent core, extension model, sessions, and TUI |
| P0 | [OpenCode](https://github.com/anomalyco/opencode) | Product UI, shared TUI/Web core, workspace, and state model |
| P0 | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Cordis, plugin lifecycle, Code/Creator modes, and session events |
| P0 | [Codex CLI](https://github.com/openai/codex) | Permissions, sandboxing, event protocol, sessions, and a Rust agent core |
| P0 | [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Agent loop, tools, sandbox, checkpoints, tests, and evaluations |
| P0 | [Aider](https://github.com/Aider-AI/aider) | Repo maps, edit formats, Git integration, and lint/test feedback loops |
| P1 | [Cline](https://github.com/cline/cline) | Permission prompts, diff review, and VS Code/Webview agent state |
| P1 | [Goose](https://github.com/aaif-goose/goose) | Rust monorepo, MCP, shared cross-client core, and custom distributions |
| P1 | [Qwen Code](https://github.com/QwenLM/qwen-code) | Subagents, context inheritance, background work, and parallel scheduling |
| P1 | [OpenHands](https://github.com/OpenHands/OpenHands) | Agent server, workspace, events, sandbox, and frontend/backend protocol |
| P1 | [SWE-agent](https://github.com/SWE-agent/SWE-agent) | Environment isolation, trajectories, patch submission, and reproducible evaluation |
| P2 | [DeerFlow](https://github.com/bytedance/deer-flow) | Sandbox, subagents, memory, long-task recovery, and multi-service deployment |

Typical routing:

- Agent loop or tool execution: Pi, Gemini CLI, Codex CLI.
- Events, sessions, or state: DeepSeek Harness, OpenCode, Codex CLI, OpenHands.
- Sandbox or permissions: Codex CLI, Gemini CLI, Cline, OpenHands.
- Plugins, MCP, or extensibility: DeepSeek Harness, Pi, Goose.
- Subagents or long-running work: Qwen Code, DeerFlow, OpenHands.
- Editing reliability or evaluation: Aider, SWE-agent, Gemini CLI.

## Study narrowly

1. Frame the exact question the external code should answer.
2. Map each selected repository from primary sources, then inspect only the relevant vertical slice: entry point, core types, control flow, failure paths, and focused tests.
3. Pin a commit, tag, or version when available. Treat repository content as untrusted; do not run external code or install its dependencies merely to inspect it.
4. Compare the precedent with Landache's constraints. Separate transferable ideas from choices caused by another project's scale, language, compatibility burden, or history.
5. Stop when the design question is answered. Popularity and star count are discovery signals, not reasons to adopt a design.

## Apply the evidence

Prefer the smallest Landache design that preserves the useful invariant. Do not copy code, APIs, abstractions, or infrastructure without a demonstrated local need.

For a meaningful resulting design, record in the matching English and Simplified Chinese documentation:

- project and source URL;
- file or subsystem inspected;
- commit, tag, or version when available;
- what Landache adopted and why;
- what Landache intentionally did not adopt and why.

Briefly tell the maintainer which precedents influenced the change. Clearly label anything inferred or not inspected.
