import assert from "node:assert/strict"
import test from "node:test"

import {
  BUILTIN_PROVIDERS,
  createProviderRegistry,
  resolveProviderConfig,
} from "@landache/providers"

test("resolves OpenAI with backward-compatible environment names", () => {
  const config = resolveProviderConfig({
    OPENAI_API_KEY: "openai-key",
    OPENAI_MODEL: "openai-model",
  })
  assert.equal(config.id, "openai")
  assert.equal(config.apiKey, "openai-key")
  assert.equal(config.model, "openai-model")
  assert.equal(config.conversation, "previous_response_id")
  assert.equal(config.store, true)
})

test("treats empty provider and base URL overrides as unset", () => {
  const config = resolveProviderConfig({
    MODEL_PROVIDER: "",
    MODEL_BASE_URL: "",
    OPENAI_API_KEY: "openai-key",
    OPENAI_MODEL: "openai-model",
  })
  assert.equal(config.id, "openai")
  assert.equal(config.baseUrl, "https://api.openai.com/v1")
})

test("keeps built-in provider definitions immutable", () => {
  assert.equal(Object.isFrozen(BUILTIN_PROVIDERS), true)
  assert.equal(BUILTIN_PROVIDERS.every(Object.isFrozen), true)
})

test("resolves DeepSeek as a stateless Responses provider", () => {
  const config = resolveProviderConfig({
    MODEL_PROVIDER: "deepseek",
    MODEL_NAME: "deepseek-flash",
    DEEPSEEK_API_KEY: "deepseek-key",
  })
  assert.equal(config.baseUrl, "https://api.deepseek.com")
  assert.equal(config.conversation, "full_history")
  assert.equal(config.store, false)
})

test("rejects unknown and duplicate providers", () => {
  assert.throws(() => resolveProviderConfig({ MODEL_PROVIDER: "missing" }), /Unknown model provider/)
  assert.throws(() => createProviderRegistry([
    {
      id: "same",
      name: "First",
      protocol: "openai-responses",
      baseUrl: "https://first.example",
      apiKeyEnvironment: "FIRST_KEY",
      conversation: "full_history",
      store: false,
    },
    {
      id: "same",
      name: "Second",
      protocol: "openai-responses",
      baseUrl: "https://second.example",
      apiKeyEnvironment: "SECOND_KEY",
      conversation: "full_history",
      store: false,
    },
  ]), /Duplicate provider id/)
})

test("requires the resolved provider credentials and model", () => {
  assert.throws(
    () => resolveProviderConfig({ MODEL_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "key" }),
    /MODEL_NAME is required/,
  )
  assert.throws(
    () => resolveProviderConfig({ MODEL_PROVIDER: "deepseek", MODEL_NAME: "model" }),
    /DEEPSEEK_API_KEY is required/,
  )
})
