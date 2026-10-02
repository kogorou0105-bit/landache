# Landache Agent Guidelines

These instructions apply to the entire repository.

## Working style

- Keep each change small enough for the maintainer to review and understand.
- Do not mix unrelated features, refactors, or cleanup into one change.
- Before editing, inspect the surrounding code and existing documentation.
- Prefer explicit, readable designs over premature abstractions.
- Treat failing type checks and tests as implementation failures, not optional cleanup.

## Explain changes before committing

Before creating a commit, explain to the maintainer in plain language:

1. what problem the change solves;
2. why the chosen design was used;
3. how the important code and data flow work;
4. which alternatives or tradeoffs were considered;
5. how the change was tested;
6. what future work the change enables.

Show the relevant diff or a clear file-by-file summary. Do not create the commit until the
maintainer explicitly approves it.

For a meaningful code or architecture change, apply the project skill at
`.agents/skills/change-quality-review/SKILL.md` before requesting approval to commit.

## Documentation

For a meaningful feature, fix, refactor, or architectural change, add or update documentation that
captures the design intent and implementation. Documentation should cover the parts that would help a
future maintainer understand why the code has its current shape, not merely repeat what the code says.

When external projects influence a design, record:

- the project and source URL;
- the file or subsystem studied;
- a commit, tag, or version when available;
- what Landache adopted;
- what Landache intentionally did not adopt.

Maintain English and Simplified Chinese documents as equal versions under `docs/en/` and
`docs/zh-CN/`, using the same relative path. Update both versions in the same change.

Small maintenance changes such as typo fixes, formatting, dependency metadata, or mechanical cleanup
do not require a new design document unless they introduce a lasting technical decision.

## Commits

- One commit should represent one coherent, reviewable design unit.
- Follow the repository's commit convention and use an allowed scope.
- Run the relevant type checks, tests, and build before requesting approval to commit.
- Never bypass local hooks or required CI checks.
