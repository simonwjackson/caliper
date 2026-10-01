// @ts-check
import { describe, expect, test } from "bun:test"
import { connectEngine } from "../src/agent/model.js"

/** @type {import("../src/agent/config.js").Connection} */
const base = { model: "m", baseUrl: "https://proxy.example/v1", apiKey: "k", reasoning: "medium", api: "chat-completions" }

describe("connectEngine", () => {
  test("calls an OpenAI-compatible endpoint with generous limits for a model it cannot know", () => {
    const { model, reasoning } = connectEngine(base)
    expect(model).toMatchObject({ id: "m", api: "openai-completions", baseUrl: "https://proxy.example/v1", contextWindow: 200_000, maxTokens: 32_000, reasoning: true })
    expect(reasoning).toBe("medium")
    expect(connectEngine({ ...base, api: "responses" }).model.api).toBe("openai-responses")
  })

  test("takes a known model's limits and thinking rules from pi-ai's catalog", () => {
    const { model } = connectEngine({ ...base, model: "claude-opus-4-8", api: "anthropic", baseUrl: "https://api.anthropic.com" })
    expect(model).toMatchObject({ api: "anthropic-messages", baseUrl: "https://api.anthropic.com", contextWindow: 1_000_000, maxTokens: 128_000 })
    expect(model.compat).toMatchObject({ forceAdaptiveThinking: true })
    const gemini = connectEngine({ ...base, model: "gemini-2.5-pro", api: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta" }).model
    expect(gemini).toMatchObject({ api: "google-generative-ai", contextWindow: 1_048_576, maxTokens: 65_536 })
  })

  test("keeps the configured endpoint for a catalog model behind a proxy", () => {
    const { model } = connectEngine({ ...base, model: "claude-opus-4-8", api: "anthropic", baseUrl: "https://proxy.example" })
    expect(model.baseUrl).toBe("https://proxy.example")
  })

  test("uses the generic definition for a model the catalog does not know", () => {
    const { model } = connectEngine({ ...base, model: "claude-next", api: "anthropic", baseUrl: "https://api.anthropic.com" })
    expect(model).toMatchObject({ api: "anthropic-messages", contextWindow: 200_000, maxTokens: 32_000 })
  })

  test("lets the settings' token limits win over the catalog and the defaults", () => {
    expect(connectEngine({ ...base, contextWindow: 64_000, maxTokens: 4_000 }).model).toMatchObject({ contextWindow: 64_000, maxTokens: 4_000 })
    const { model } = connectEngine({ ...base, model: "claude-opus-4-8", api: "anthropic", baseUrl: "https://api.anthropic.com", maxTokens: 16_000 })
    expect(model).toMatchObject({ contextWindow: 1_000_000, maxTokens: 16_000 })
  })

  test("turns reasoning off on a generic model when the level is off", () => {
    expect(connectEngine({ ...base, reasoning: "off" }).model.reasoning).toBe(false)
  })
})
