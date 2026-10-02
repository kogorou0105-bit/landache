# 提交规范

[English](../../en/development/commits.md) | [简体中文](commits.md)

Landache 使用 Conventional Commits，并要求每个 Type 携带固定 Emoji：

```text
<type>(<scope>)!: <emoji> <subject>
```

示例：

```text
feat(agent): ✨ add bounded tool retries
fix(runtime): 🐛 terminate child process trees
docs(architecture): 📝 define the session model
feat(protocol)!: ✨ version command envelopes
```

## Type

| Type | Emoji | 用途 |
| --- | --- | --- |
| `feat` | ✨ | 用户可感知的新能力 |
| `fix` | 🐛 | Bug 修复 |
| `refactor` | ♻️ | 不改变行为的内部重构 |
| `perf` | ⚡️ | 性能优化 |
| `docs` | 📝 | 只修改文档 |
| `test` | ✅ | 只修改测试 |
| `build` | 📦 | 依赖、构建或打包 |
| `ci` | 👷 | 持续集成 |
| `chore` | 🔧 | 仓库日常维护 |
| `revert` | ⏪ | 回滚已有变更 |

允许的 Scope 定义在 `commitlint.config.mjs` 中。`feat`、`fix`、`refactor`
和 `perf` 类型必须填写 Scope。

Subject 使用英文祈使语气，不以句号结尾，完整 Header 不超过 100 个字符。破坏性变更
使用 `!`，并在 Footer 中写入 `BREAKING CHANGE:`。

## 强制执行

- Lefthook 在本地 `commit-msg` Hook 中运行 Commitlint；
- GitHub Actions 检查每个 PR Title 以及 PR 中的所有 Commit；
- `main` 必须通过 GitHub Ruleset 要求所有变更经过 PR，并强制通过
  `commit-policy` Status Check；
- PR 使用 Squash Merge，使经过检查的 PR Title 成为 `main` 上最终的 Commit Title。

手动检查：

```bash
printf '%s\n' 'feat(agent): ✨ add bounded retries' | pnpm commitlint
```

