// @ts-check
// The Caliper app's settings. The agent's model and endpoint live here, not in
// any project (decision 37). The key never does: it comes only from the app's
// environment.
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { CONFIG_FILE } from "../agent/config.js"

/**
 * @typedef {{ agent?: import("../types").AgentOptions }} Settings
 */

/**
 * The settings file: `CALIPER_CONFIG`, else `$XDG_CONFIG_HOME/caliper/config.json`.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function settingsFile(env = process.env) {
  return env.CALIPER_CONFIG || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), CONFIG_FILE)
}

/**
 * Read the settings. A missing file means no agent. A broken file is an error
 * that names the file, so the app does not start with settings it ignored.
 *
 * @param {string} file
 * @returns {Settings}
 */
export function readSettings(file) {
  if (!existsSync(file)) return {}
  /** @type {unknown} */
  let value
  try { value = JSON.parse(readFileSync(file, "utf8")) }
  catch (error) { throw new Error(`${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`) }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} must hold one object, for example { "agent": { "model": "gpt-5", "baseUrl": "https://api.openai.com/v1" } }.`)
  const settings = /** @type {Record<string, unknown>} */ (value)
  const unknown = Object.keys(settings).filter(key => key !== "agent")
  if (unknown.length > 0) throw new Error(`${file} has settings Caliper does not know: ${unknown.join(", ")}.`)
  if (settings.agent !== undefined && (settings.agent === null || typeof settings.agent !== "object" || Array.isArray(settings.agent))) {
    throw new Error(`"agent" in ${file} must be an object, for example { "model": "gpt-5", "baseUrl": "https://api.openai.com/v1" }.`)
  }
  if (settings.agent !== undefined && "apiKey" in /** @type {object} */ (settings.agent)) {
    throw new Error(`Remove "apiKey" from ${file}. Caliper reads the key from CALIPER_AGENT_API_KEY, or the variable agent.apiKeyEnv names.`)
  }
  return /** @type {Settings} */ (settings)
}
