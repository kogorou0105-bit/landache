---
name: change-quality-review
description: Review a code change or implementation plan for correctness, design quality, objective strengths and weaknesses, and future evolution. Use when asked to evaluate a diff, PR, recent implementation, architecture choice, or whether a change is ready to merge; remain read-only unless fixes are explicitly requested.
---

1. Freeze the review scope and restate the intended behavior from the request, repository rules, design docs, and tests; do not substitute personal style for project intent.
2. Inspect the diff plus relevant surrounding code and run safe checks when useful; distinguish verified evidence, reasoned inference, and anything not assessed.
3. Evaluate correctness and failure paths first, then contracts, state ownership, dependency direction, simplicity, compatibility, security, performance, tests, documentation, and future extensibility in proportion to risk.
4. Report only actionable findings, ordered by severity, with precise locations, impact, evidence, and a concrete remedy; avoid speculative warnings, duplicated comments, and cosmetic noise.
5. End with an objective account of strengths, tradeoffs, residual risks, follow-up opportunities, blind spots, and a `SHIP`, `FIX`, or `BLOCK` verdict; never equate passing tests with proven correctness.
