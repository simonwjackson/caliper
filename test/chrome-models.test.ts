import { describe, expect, test } from "bun:test"
import { createChromeApp } from "../src/client/app/runtime"

type Call = { path: string; data?: object }

/**
 * The chrome app on a scripted server: each request answers from `answers`,
 * in order, after the test lets it go.
 */
function app(answers: Array<object | Error>) {
  const calls: Call[] = []
  const pending: Array<() => void> = []
  const chrome = createChromeApp({
    request: async <T,>(path: string, data?: object) => {
      calls.push(data === undefined ? { path } : { path, data })
      await new Promise<void>(resolve => pending.push(resolve))
      const answer = answers.shift()
      if (answer instanceof Error) throw answer
      return answer as T
    },
  })
  const release = async () => { pending.shift()?.(); await settle() }
  return { chrome, calls, release, models: () => chrome.getSnapshot().composer.models }
}

/** The chrome publishes a new snapshot after the current task. */
function settle() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

const listed = { current: "a", favorites: ["a", "b"], models: ["c"] }

describe("the model chooser's controller", () => {
  test("loads the list when asked, and keeps it while a fresh one loads", async () => {
    const { chrome, calls, release, models } = app([listed, { ...listed, models: ["c", "d"] }])
    expect(models()).toEqual({ _tag: "Idle" })
    chrome.actions.onModels()
    await settle()
    expect(models()).toEqual({ _tag: "Loading" })
    await release()
    expect(models()).toEqual({ _tag: "Ready", current: "a", favorites: ["a", "b"], models: ["c"], problem: "", choosing: null })
    chrome.actions.onModels()
    await settle()
    expect(models()._tag).toBe("Ready")
    await release()
    expect(models()).toMatchObject({ models: ["c", "d"] })
    expect(calls).toEqual([{ path: "models.json" }, { path: "models.json" }])
  })

  test("saves a choice, shows it while saving, and ignores the model already in use", async () => {
    const { chrome, calls, release, models } = app([listed, { ...listed, current: "b" }])
    chrome.actions.onModels()
    await release()
    chrome.actions.onModel("a")
    chrome.actions.onModel(" b ")
    await settle()
    expect(models()).toMatchObject({ current: "a", choosing: "b" })
    chrome.actions.onModel("c")
    await release()
    expect(models()).toMatchObject({ current: "b", choosing: null })
    expect(calls.slice(1)).toEqual([{ path: "model", data: { model: "b" } }])
  })

  test("a refused choice keeps the old model and says why", async () => {
    const { chrome, release, models } = app([listed, new Error("The settings file has no \"agent\".")])
    chrome.actions.onModels()
    await release()
    chrome.actions.onModel("c")
    await release()
    expect(models()).toMatchObject({ current: "a", choosing: null })
    expect(chrome.getSnapshot().composer.notices).toEqual([{ kind: "error", text: "The settings file has no \"agent\"." }])
  })

  test("a model chosen in another tab reaches this one through the takes snapshot", async () => {
    const { chrome, release, models } = app([listed])
    chrome.actions.onModels()
    await release()
    chrome.receiveTakes({ agent: { _tag: "Ready", model: "c", baseUrl: "http://x/v1", reasoning: "low", api: "chat-completions", baseUrlFrom: "f", keyFrom: "K" }, skills: { skills: [], problems: [] }, accepted: [], takes: [] })
    await settle()
    expect(models()).toMatchObject({ current: "c" })
  })
})
