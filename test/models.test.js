// @ts-check
import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeModel } from "../src/central/config.js"
import { matchFavorites, modelChoices, piFavorites } from "../src/central/models.js"

/**
 * A real OpenAI-style model list on a local port.
 *
 * @param {{ status?: number, ids?: string[] }} behavior
 * @param {(baseUrl: string, seen: string[]) => Promise<void>} run
 */
async function withEndpoint({ status = 200, ids = [] }, run) {
  /** @type {string[]} */
  const seen = []
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url} ${request.headers.authorization}`)
    response.writeHead(status, { "content-type": "application/json" })
    response.end(JSON.stringify(status === 200 ? { object: "list", data: ids.map(id => ({ id, object: "model" })) } : { error: "no" }))
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)))
  const address = /** @type {import("node:net").AddressInfo} */ (server.address())
  try { await run(`http://127.0.0.1:${address.port}/v1`, seen) }
  finally { await new Promise(resolve => server.close(() => resolve(undefined))) }
}

/** @type {import("../src/agent/config.js").Connection} */
const connection = { model: "m", baseUrl: "", apiKey: "secret", reasoning: "medium", api: "chat-completions" }

describe("matchFavorites", () => {
  const ids = ["claude-opus-5-5", "gpt-6.1-sol", "gemini-3.8-flash-high", "gemini-2.5-pro", "openrouter/x:exacto"]

  test("names the endpoint's ids from pi's provider/id patterns, in the patterns' order", () => {
    expect(matchFavorites(["cliproxyapi/gpt-6.1-sol", "cliproxyapi/claude-opus-5-5", "cliproxyapi/deepseek-v4.1-flash"], ids))
      .toEqual(["gpt-6.1-sol", "claude-opus-5-5"])
  })

  test("drops a thinking suffix, ignores case, and expands globs", () => {
    expect(matchFavorites(["CLAUDE-OPUS-5-5:high", "*/gemini-*"], ids)).toEqual(["claude-opus-5-5", "gemini-3.8-flash-high", "gemini-2.5-pro"])
    expect(matchFavorites(["gemini-[23].*-pro"], ids)).toEqual(["gemini-2.5-pro"])
  })

  test("keeps a colon that is part of the id", () => {
    expect(matchFavorites(["openrouter/x:exacto"], ids)).toEqual(["openrouter/x:exacto"])
  })

  test("needs the whole id, unlike pi's partial match", () => {
    expect(matchFavorites(["opus"], ids)).toEqual([])
  })

  test("without the endpoint's list, keeps each plain pattern as its own id", () => {
    expect(matchFavorites(["cliproxyapi/claude-opus-5-5:high", "claude-*", "gpt-6.1-sol"], null)).toEqual(["claude-opus-5-5", "gpt-6.1-sol"])
  })
})

describe("piFavorites", () => {
  test("reads enabledModels from pi's settings folder, and nothing when pi is not set up", () => {
    const dir = mkdtempSync(join(tmpdir(), "caliper-pi-"))
    try {
      expect(piFavorites({ PI_CODING_AGENT_DIR: dir }, "/nonexistent")).toEqual([])
      writeFileSync(join(dir, "settings.json"), JSON.stringify({ enabledModels: ["a/b", 7, ""], defaultModel: "z" }))
      expect(piFavorites({ PI_CODING_AGENT_DIR: dir }, "/nonexistent")).toEqual(["a/b"])
      writeFileSync(join(dir, "settings.json"), "{ broken")
      expect(piFavorites({ PI_CODING_AGENT_DIR: dir }, "/nonexistent")).toEqual([])
      mkdirSync(join(dir, "home/.pi/agent"), { recursive: true })
      writeFileSync(join(dir, "home/.pi/agent/settings.json"), JSON.stringify({ enabledModels: ["c"] }))
      expect(piFavorites({}, join(dir, "home"))).toEqual(["c"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("modelChoices", () => {
  test("lists the endpoint's models with its key, favorites first and apart", async () => {
    await withEndpoint({ ids: ["zeta", "m", "fast-1", "alpha"] }, async (baseUrl, seen) => {
      const choices = await modelChoices({ current: "m", connection: { ...connection, baseUrl }, patterns: ["p/fast-*"] })
      expect(choices).toEqual({ current: "m", favorites: ["fast-1"], models: ["alpha", "m", "zeta"] })
      expect(seen).toEqual(["GET /v1/models Bearer secret"])
    })
  })

  test("names the problem and keeps plain favorites when the endpoint lists nothing", async () => {
    await withEndpoint({ status: 500 }, async baseUrl => {
      const choices = await modelChoices({ current: "m", connection: { ...connection, baseUrl }, patterns: ["p/fast-1", "p/*"] })
      expect(choices).toMatchObject({ current: "m", favorites: ["fast-1"], models: [] })
      expect(choices.problem).toContain("/models answered 500.")
    })
  })

  test("takes the models of the anthropic and google APIs from pi-ai's catalog, with no request", async () => {
    const choices = await modelChoices({ current: "claude-opus-4-8", connection: { ...connection, api: "anthropic", baseUrl: "http://127.0.0.1:9" }, patterns: ["anthropic/claude-opus-4-8"] })
    expect(choices.favorites).toEqual(["claude-opus-4-8"])
    expect(choices.models).toContain("claude-sonnet-5")
    expect(choices.problem).toBeUndefined()
  })
})

describe("writeModel", () => {
  test("changes only the model and keeps every other setting", () => {
    const dir = mkdtempSync(join(tmpdir(), "caliper-settings-"))
    try {
      const file = join(dir, "config.json")
      writeFileSync(file, JSON.stringify({ agent: { model: "a", baseUrl: "https://x/v1", reasoning: "high", skills: false } }))
      writeModel(file, "b")
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ agent: { model: "b", baseUrl: "https://x/v1", reasoning: "high", skills: false } })
      writeFileSync(file, "{}")
      expect(() => writeModel(file, "b")).toThrow('has no "agent"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
