const emojiByType = {
  feat: "✨",
  fix: "🐛",
  refactor: "♻️",
  perf: "⚡️",
  docs: "📝",
  test: "✅",
  build: "📦",
  ci: "👷",
  chore: "🔧",
  revert: "⏪",
}

const scopes = [
  "cli",
  "web",
  "host",
  "agent",
  "protocol",
  "providers",
  "config",
  "ui",
  "runtime",
  "schemas",
  "evals",
  "docs",
  "brand",
  "repo",
  "release",
]

const scopedTypes = new Set(["feat", "fix", "refactor", "perf"])

const landachePlugin = {
  rules: {
    "emoji-match-type": ({ type, subject }) => {
      if (!type || !subject || !emojiByType[type]) {
        return [true]
      }

      const expected = emojiByType[type]

      return [
        subject.startsWith(`${expected} `),
        `subject must start with "${expected} " for type "${type}"`,
      ]
    },

    "scope-required-for-type": ({ type, scope }) => {
      if (!type || !scopedTypes.has(type)) {
        return [true]
      }

      return [Boolean(scope), `scope is required for type "${type}"`]
    },
  },
}

export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [landachePlugin],
  rules: {
    "emoji-match-type": [2, "always"],
    "header-max-length": [2, "always", 100],
    "scope-case": [2, "always", "kebab-case"],
    "scope-enum": [2, "always", scopes],
    "scope-required-for-type": [2, "always"],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "type-enum": [2, "always", Object.keys(emojiByType)],
  },
}

