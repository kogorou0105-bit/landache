# Commit Convention

[English](commits.md) | [简体中文](../../zh-CN/development/commits.md)

Landache uses Conventional Commits with a required emoji for each type:

```text
<type>(<scope>)!: <emoji> <subject>
```

Examples:

```text
feat(agent): ✨ add bounded tool retries
fix(runtime): 🐛 terminate child process trees
docs(architecture): 📝 define the session model
feat(protocol)!: ✨ version command envelopes
```

## Types

| Type | Emoji | Purpose |
| --- | --- | --- |
| `feat` | ✨ | User-facing capability |
| `fix` | 🐛 | Bug fix |
| `refactor` | ♻️ | Internal restructuring without behavior change |
| `perf` | ⚡️ | Performance improvement |
| `docs` | 📝 | Documentation only |
| `test` | ✅ | Tests only |
| `build` | 📦 | Dependencies, build, or packaging |
| `ci` | 👷 | Continuous integration |
| `chore` | 🔧 | Repository maintenance |
| `revert` | ⏪ | Revert an earlier change |

Scopes are defined in `commitlint.config.mjs`. A scope is required for `feat`,
`fix`, `refactor`, and `perf` commits.

Subjects use English imperative phrasing, have no trailing period, and keep the
complete header at or below 100 characters. A breaking change uses `!` and a
`BREAKING CHANGE:` footer.

## Enforcement

- Lefthook runs Commitlint from the local `commit-msg` hook.
- GitHub Actions validates every pull request title and every commit in the PR.
- The `main` branch must be protected by a GitHub Ruleset that requires pull
  requests and the `commit-policy` status check.
- Pull requests are squash-merged so the validated PR title becomes the final
  commit title on `main`.

Run a manual check with:

```bash
printf '%s\n' 'feat(agent): ✨ add bounded retries' | pnpm commitlint
```

