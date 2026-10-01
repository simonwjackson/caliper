// @ts-check

/**
 * @typedef {import("../types").AgentOptions} AgentOptions
 * @typedef {import("../types").AgentApi} AgentApi
 * @typedef {import("../types").AgentStatus} AgentStatus
 * @typedef {import("../types").ReasoningLevel} ReasoningLevel
 * @typedef {{
 *   model: string,
 *   baseUrl: string,
 *   apiKey: string,
 *   reasoning: ReasoningLevel,
 *   api: AgentApi,
 *   contextWindow?: number,
 *   maxTokens?: number,
 * }} Connection
 *   Everything the agent needs to call the model. It holds the key, so it
 *   stays in the server and never goes into a response.
 */

export const DEFAULT_KEY_ENV = "CALIPER_AGENT_API_KEY"
/** Where the Caliper app keeps its settings, relative to the XDG config folder. */
export const CONFIG_FILE = "caliper/config.json"
const SETTINGS = `~/.config/${CONFIG_FILE}`
const REASONING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

/**
 * Each API the agent can call, and the endpoint it uses when the settings
 * name none. An OpenAI-compatible endpoint has no default: it is whatever
 * server the user runs. The two provider endpoints are pi-ai's own.
 *
 * @type {Record<AgentApi, string | null>}
 */
const APIS = {
  "chat-completions": null,
  responses: null,
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com/v1beta",
}
const API_NAMES = /** @type {AgentApi[]} */ (Object.keys(APIS))

/**
 * Decide how the agent reaches its model, from the `agent` settings and the
 * environment. Pure: it reads no files.
 *
 * The key comes only from the environment variable `apiKeyEnv` names, so it
 * never sits in a file Caliper reads and never goes to an endpoint the user
 * did not choose.
 *
 * @param {{ option: AgentOptions | undefined, env: Record<string, string | undefined> }} input
 * @returns {{ status: AgentStatus, connection: Connection | null }}
 */
export function resolveAgent({ option, env }) {
  if (option === undefined) {
    return off(`Add "agent": { "model": ..., "baseUrl": ... } to ${SETTINGS} to make takes with an AI agent.`)
  }
  if (typeof option.model !== "string" || option.model.trim() === "") {
    return failed(`The agent in ${SETTINGS} has no model.`, "Set agent.model to a model id the endpoint knows.")
  }
  const reasoning = option.reasoning ?? "medium"
  if (!REASONING.includes(reasoning)) {
    return failed(`agent.reasoning "${reasoning}" is not a reasoning level.`, `Use one of: ${REASONING.join(", ")}.`)
  }
  const api = option.api ?? "chat-completions"
  if (!API_NAMES.includes(api)) {
    return failed(`agent.api "${api}" is not an API Caliper can call.`, `Use ${API_NAMES.slice(0, -1).map(name => `"${name}"`).join(", ")} or "${API_NAMES.at(-1)}".`)
  }
  for (const limit of /** @type {const} */ (["contextWindow", "maxTokens"])) {
    const value = option[limit]
    if (value !== undefined && !(Number.isInteger(value) && value > 0)) {
      return failed(`agent.${limit} ${JSON.stringify(value)} is not a positive whole number.`, `Remove agent.${limit} to use the model's own limit, or set a number of tokens.`)
    }
  }

  const fallback = APIS[api]
  /** @type {{ url: string, from: string } | null} */
  const base = option.baseUrl !== undefined
    ? { url: trimSlash(option.baseUrl), from: SETTINGS }
    : fallback !== null
      ? { url: fallback, from: `the default for api "${api}"` }
      : null
  if (base === null) {
    return failed(`The agent in ${SETTINGS} has no baseUrl.`, 'Set agent.baseUrl to an OpenAI-compatible endpoint, with its /v1, for example "http://localhost:11434/v1". Or set agent.api to "anthropic" or "google".')
  }
  if (!/^https?:\/\//.test(base.url)) {
    return failed(`agent.baseUrl "${base.url}" is not an http or https URL.`, "Set agent.baseUrl to the endpoint's full URL.")
  }

  const keyEnv = option.apiKeyEnv ?? DEFAULT_KEY_ENV
  const apiKey = env[keyEnv]
  if (!apiKey) {
    return failed(`No API key for ${base.url}.`, `Set ${keyEnv} in the environment of the Caliper app. Never put the key in ${SETTINGS}.`)
  }

  return {
    status: { _tag: "Ready", model: option.model, baseUrl: base.url, reasoning, api, baseUrlFrom: base.from, keyFrom: keyEnv },
    connection: {
      model: option.model, baseUrl: base.url, apiKey, reasoning, api,
      ...(option.contextWindow !== undefined ? { contextWindow: option.contextWindow } : {}),
      ...(option.maxTokens !== undefined ? { maxTokens: option.maxTokens } : {}),
    },
  }
}

/** @param {string} url */
function trimSlash(url) {
  return url.trim().replace(/\/+$/, "")
}

/** @param {string} hint */
function off(hint) {
  return { status: /** @type {AgentStatus} */ ({ _tag: "Off", hint }), connection: null }
}

/**
 * @param {string} reason
 * @param {string} hint
 */
function failed(reason, hint) {
  return { status: /** @type {AgentStatus} */ ({ _tag: "Failed", reason, hint }), connection: null }
}
