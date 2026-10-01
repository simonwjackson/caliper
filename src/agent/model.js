// @ts-check
import { createModels, createProvider } from "@earendil-works/pi-ai"
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy"
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy"
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy"
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models"
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models"

/**
 * @typedef {import("./config.js").Connection} Connection
 * @typedef {import("../types").AgentApi} AgentApi
 * @typedef {import("../types").ReasoningLevel} ReasoningLevel
 * @typedef {import("@earendil-works/pi-ai").Model<any>} Model
 * @typedef {{
 *   models: import("@earendil-works/pi-ai").Models,
 *   model: Model,
 *   reasoning: ReasoningLevel,
 * }} Engine
 *   The model the agent calls, the collection that streams from it, and the
 *   reasoning level for every request.
 */

const PROVIDER = "caliper"
/** Unknown for a model outside pi-ai's catalog; generous values that current models accept. */
const CONTEXT_WINDOW = 200_000
const MAX_TOKENS = 32_000

/**
 * pi-ai's wire API for each Caliper `api`, and its catalog of known models.
 * A catalog entry carries the model's real limits and thinking rules; recent
 * Claude models, for example, accept only adaptive thinking.
 *
 * @type {Record<AgentApi, { api: string, streams: () => import("@earendil-works/pi-ai").ProviderStreams, catalog: Record<string, Model> }>}
 */
const WIRES = {
  "chat-completions": { api: "openai-completions", streams: openAICompletionsApi, catalog: {} },
  responses: { api: "openai-responses", streams: openAIResponsesApi, catalog: {} },
  anthropic: { api: "anthropic-messages", streams: anthropicMessagesApi, catalog: /** @type {Record<string, Model>} */ (ANTHROPIC_MODELS) },
  google: { api: "google-generative-ai", streams: googleGenerativeAIApi, catalog: /** @type {Record<string, Model>} */ (GOOGLE_MODELS) },
}

/**
 * The engine for one endpoint. The key stays inside the provider's auth;
 * nothing else sees it.
 *
 * @param {Connection} connection
 * @returns {Engine}
 */
export function connectEngine(connection) {
  const wire = WIRES[connection.api]
  const known = Object.hasOwn(wire.catalog, connection.model) ? wire.catalog[connection.model] : undefined
  const definition = known
    ? { ...known, provider: PROVIDER, baseUrl: connection.baseUrl }
    : generic(connection, wire.api)
  /** @type {Model} */
  const model = {
    ...definition,
    ...(connection.contextWindow !== undefined ? { contextWindow: connection.contextWindow } : {}),
    ...(connection.maxTokens !== undefined ? { maxTokens: connection.maxTokens } : {}),
  }
  const apiKey = connection.apiKey
  const provider = createProvider({
    id: PROVIDER,
    name: "Caliper agent",
    baseUrl: connection.baseUrl,
    auth: { apiKey: { name: "Caliper agent", resolve: async () => ({ auth: { apiKey } }) } },
    models: [model],
    api: wire.streams(),
  })
  const models = createModels()
  models.setProvider(provider)
  const registered = models.getModel(PROVIDER, connection.model)
  if (!registered) throw new Error(`pi-ai did not register the model ${connection.model}.`)
  return { models, model: registered, reasoning: connection.reasoning }
}

/**
 * A definition for a model pi-ai does not know, such as one behind a local
 * OpenAI-compatible server.
 *
 * @param {Connection} connection
 * @param {string} api
 * @returns {Model}
 */
function generic(connection, api) {
  // pi-ai sends xhigh and max only when the model maps them.
  const optIn = connection.reasoning === "xhigh" || connection.reasoning === "max"
  return {
    id: connection.model,
    name: connection.model,
    api,
    provider: PROVIDER,
    baseUrl: connection.baseUrl,
    reasoning: connection.reasoning !== "off",
    ...(optIn ? { thinkingLevelMap: { [connection.reasoning]: connection.reasoning } } : {}),
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: CONTEXT_WINDOW,
    maxTokens: MAX_TOKENS,
  }
}
