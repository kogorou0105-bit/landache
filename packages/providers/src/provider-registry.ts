import type { ModelStream } from "@landache/protocol"

import {
  createResponsesStream,
  type ResponsesConversationStrategy,
} from "./openai-responses.js"

export type ProviderProtocol = "openai-responses"

export type ProviderDefinition = {
  readonly id: string
  readonly name: string
  readonly protocol: ProviderProtocol
  readonly baseUrl: string
  readonly apiKeyEnvironment: string
  readonly conversation: ResponsesConversationStrategy
  readonly store: boolean
}

export type ProviderConfig = ProviderDefinition & {
  apiKey: string
  model: string
}

export type ProviderRegistry = {
  list(): readonly ProviderDefinition[]
  resolve(id: string): ProviderDefinition
}

export const BUILTIN_PROVIDERS = Object.freeze([
  Object.freeze({
    id: "openai",
    name: "OpenAI",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvironment: "OPENAI_API_KEY",
    conversation: "previous_response_id",
    store: true,
  }),
  Object.freeze({
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai-responses",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnvironment: "DEEPSEEK_API_KEY",
    conversation: "full_history",
    store: false,
  }),
] satisfies readonly ProviderDefinition[])

export function createProviderRegistry(
  definitions: readonly ProviderDefinition[] = BUILTIN_PROVIDERS,
): ProviderRegistry {
  const providers = new Map<string, ProviderDefinition>()
  for (const definition of definitions) {
    if (providers.has(definition.id)) throw new Error(`Duplicate provider id: ${definition.id}`)
    providers.set(definition.id, Object.freeze({ ...definition }))
  }
  return {
    list: () => [...providers.values()],
    resolve(id) {
      const provider = providers.get(id)
      if (provider === undefined) {
        throw new Error(`Unknown model provider ${JSON.stringify(id)}; available: ${[...providers.keys()].join(", ")}`)
      }
      return provider
    },
  }
}

export function resolveProviderConfig(
  environment: Readonly<Record<string, string | undefined>>,
  registry: ProviderRegistry = createProviderRegistry(),
): ProviderConfig {
  const provider = registry.resolve(environment.MODEL_PROVIDER || "openai")
  const model = environment.MODEL_NAME ?? environment.OPENAI_MODEL
  if (model === undefined || model === "") throw new Error("MODEL_NAME is required")
  const apiKey = environment.MODEL_API_KEY ?? environment[provider.apiKeyEnvironment]
  if (apiKey === undefined || apiKey === "") {
    throw new Error(`MODEL_API_KEY or ${provider.apiKeyEnvironment} is required`)
  }
  return {
    ...provider,
    apiKey,
    model,
    baseUrl: environment.MODEL_BASE_URL || provider.baseUrl,
  }
}

export function createProviderModelStream(
  config: ProviderConfig,
  options: { fetch?: typeof globalThis.fetch } = {},
): ModelStream {
  switch (config.protocol) {
    case "openai-responses":
      return createResponsesStream({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        conversation: config.conversation,
        store: config.store,
        providerName: config.name,
        fetch: options.fetch,
      })
    default:
      return assertNever(config.protocol)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported provider protocol: ${String(value)}`)
}
