// @ts-check
import { createModels, createProvider } from "@earendil-works/pi-ai"
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy"

/**
 * @typedef {import("./config.js").Connection} Connection
 * @typedef {import("../types").ReasoningLevel} ReasoningLevel
 * @typedef {{
 *   models: import("@earendil-works/pi-ai").Models,
 *   model: import("@earendil-works/pi-ai").Model<any>,
 *   reasoning: ReasoningLevel,
 * }} Engine
 *   The model the agent calls, the collection that streams from it, and the
 *   reasoning level for every request.
 */

const PROVIDER = "caliper"
/** Unknown for an arbitrary endpoint; generous values that current models accept. */
const CONTEXT_WINDOW = 200_000
const MAX_TOKENS = 32_000

/**
 * The engine for one OpenAI-compatible endpoint. The key stays inside the
 * provider's auth; nothing else sees it.
 *
 * @param {Connection} connection
 * @returns {Engine}
 */
export function connectEngine(connection) {
  const api = connection.api === "responses" ? "openai-responses" : "openai-completions"
  // pi-ai sends xhigh and max only when the model maps them.
  const optIn = connection.reasoning === "xhigh" || connection.reasoning === "max"
  /** @type {import("@earendil-works/pi-ai").Model<any>} */
  const definition = {
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
  const apiKey = connection.apiKey
  const provider = createProvider({
    id: PROVIDER,
    name: "Caliper agent",
    baseUrl: connection.baseUrl,
    auth: { apiKey: { name: "Caliper agent", resolve: async () => ({ auth: { apiKey } }) } },
    models: [definition],
    api: api === "openai-responses" ? openAIResponsesApi() : openAICompletionsApi(),
  })
  const models = createModels()
  models.setProvider(provider)
  const model = models.getModel(PROVIDER, connection.model)
  if (!model) throw new Error(`pi-ai did not register the model ${connection.model}.`)
  return { models, model, reasoning: connection.reasoning }
}
