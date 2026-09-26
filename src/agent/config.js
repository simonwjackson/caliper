// @ts-check
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * @typedef {import("../types").AgentOptions} AgentOptions
 * @typedef {import("../types").AgentStatus} AgentStatus
 * @typedef {import("../types").ReasoningLevel} ReasoningLevel
 * @typedef {{
 *   model: string,
 *   baseUrl: string,
 *   apiKey: string,
 *   reasoning: ReasoningLevel,
 *   api: "chat-completions" | "responses",
 * }} Connection
 *   Everything the agent needs to call the model. It holds the key, so it
 *   stays in the server and never goes into a response.
 */

export const DEFAULT_KEY_ENV = "CALIPER_AGENT_API_KEY"
/** An optional local fallback: the CLIProxyAPI settings of a pi install. */
export const PI_PROXY_FILE = ".pi/agent/cliproxyapi.json"
const REASONING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

/**
 * Decide how the agent reaches its model, from the `agent` option, the
 * environment and the optional pi proxy file. Pure apart from reading that file.
 *
 * The key comes from the environment variable first. The pi proxy file gives
 * the key only when the agent uses that file's base URL, so Caliper never
 * sends that key to another endpoint.
 *
 * @param {{ option: AgentOptions | undefined, env: Record<string, string | undefined>, home: string }} input
 * @returns {{ status: AgentStatus, connection: Connection | null }}
 */
export function resolveAgent({ option, env, home }) {
  if (option === undefined) {
    return off("Add agent: { model } to caliper() in vite.config to make takes with an AI agent.")
  }
  if (typeof option.model !== "string" || option.model.trim() === "") {
    return failed("caliper({ agent }) has no model.", 'Set agent.model to a model id the endpoint knows, for example "claude-opus-5-5".')
  }
  const reasoning = option.reasoning ?? "medium"
  if (!REASONING.includes(reasoning)) {
    return failed(`agent.reasoning "${reasoning}" is not a reasoning level.`, `Use one of: ${REASONING.join(", ")}.`)
  }
  const api = option.api ?? "chat-completions"
  if (api !== "chat-completions" && api !== "responses") {
    return failed(`agent.api "${api}" is not an API Caliper can call.`, 'Use "chat-completions" or "responses".')
  }
  const keyEnv = option.apiKeyEnv ?? DEFAULT_KEY_ENV
  const proxy = readProxyFile(home)

  /** @type {{ url: string, from: string } | null} */
  const base = option.baseUrl !== undefined
    ? { url: trimSlash(option.baseUrl), from: "vite.config" }
    : proxy !== null
      ? { url: proxy.baseUrl, from: `~/${PI_PROXY_FILE}` }
      : null
  if (base === null) {
    return failed("caliper({ agent }) has no baseUrl.", 'Set agent.baseUrl to an OpenAI-compatible endpoint, with its /v1, for example "http://localhost:11434/v1".')
  }
  if (!/^https?:\/\//.test(base.url)) {
    return failed(`agent.baseUrl "${base.url}" is not an http or https URL.`, "Set agent.baseUrl to the endpoint's full URL.")
  }

  const envKey = env[keyEnv]
  /** @type {{ key: string, from: string } | null} */
  const key = envKey
    ? { key: envKey, from: keyEnv }
    : proxy !== null && sameEndpoint(proxy.baseUrl, base.url)
      ? { key: proxy.apiKey, from: `~/${PI_PROXY_FILE}` }
      : null
  if (key === null) {
    return failed(`No API key for ${base.url}.`, `Set ${keyEnv} in the shell that starts Vite, or in the project's .env.local. Never put the key in vite.config.`)
  }

  return {
    status: { _tag: "Ready", model: option.model, baseUrl: base.url, reasoning, api, baseUrlFrom: base.from, keyFrom: key.from },
    connection: { model: option.model, baseUrl: base.url, apiKey: key.key, reasoning, api },
  }
}

/**
 * The pi proxy file's base URL, with `/v1`, and key. Null when the file is
 * missing or unreadable. That file names the proxy host without `/v1`.
 *
 * @param {string} home
 * @returns {{ baseUrl: string, apiKey: string } | null}
 */
function readProxyFile(home) {
  const file = join(home, PI_PROXY_FILE)
  if (!existsSync(file)) return null
  try {
    const { baseUrl, apiKey } = JSON.parse(readFileSync(file, "utf8"))
    if (typeof baseUrl !== "string" || typeof apiKey !== "string" || baseUrl === "" || apiKey === "") return null
    const trimmed = trimSlash(baseUrl)
    return { baseUrl: trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`, apiKey }
  } catch {
    return null
  }
}

/** @param {string} url */
function trimSlash(url) {
  return url.trim().replace(/\/+$/, "")
}

/**
 * @param {string} left
 * @param {string} right
 */
function sameEndpoint(left, right) {
  /** @param {string} url */
  const bare = url => trimSlash(url).replace(/\/v1$/, "")
  return bare(left) === bare(right)
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
