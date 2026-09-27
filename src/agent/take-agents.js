// @ts-check
import { readFileSync } from "node:fs"
import { Agent } from "@earendil-works/pi-agent-core"
import { DEVICES } from "../client/device-frame.js"
import { takeTools } from "./tools.js"
import { metadataTools } from "./metadata-tools.js"
import { createIntegrationReview } from "../takes/integration.js"

/**
 * @typedef {import("./model.js").Engine} Engine
 * @typedef {import("./tools.js").RenderTake} RenderTake
 * @typedef {import("../takes/store.js").TakeStore} TakeStore
 * @typedef {import("../types").TakeView} TakeView
 * @typedef {import("../types").TakeRun} TakeRun
 * @typedef {import("../types").TakeLogEntry} TakeLogEntry
 * @typedef {{ part: string, state: string, device: string, direction?: import("../takes/store.js").Direction, others?: string[] }} TakeAsk
 *   `direction` is the planner's way for this take to answer the prompt;
 *   `others` are the titles of the directions its sibling takes got.
 * @typedef {{ agent: Agent | null, run: TakeRun, log: TakeLogEntry[] }} Live
 *   `agent` is null until the first prompt creates it, and stays null when that fails.
 */

/** A run stops after this many model turns, so a confused agent cannot spend without end. */
export const MAX_TURNS = 40

/**
 * Every take's agent in one dev server. Each take has its own agent, tools
 * and conversation; they run at the same time without sharing state.
 *
 * @param {{
 *   store: TakeStore,
 *   engine: () => Engine,
 *   renderFor: (take: string, ask: TakeAsk) => RenderTake,
 *   onChange: () => void,
 * }} input
 *   `engine` is called when a take starts, so a missing connection fails that
 *   take, not the server. `onChange` fires on every visible change.
 */
export function createTakeAgents({ store, engine, renderFor, onChange }) {
  /** @type {Map<string, Live>} */
  const live = new Map()
  const integration = createIntegrationReview(store)

  /**
   * Start a new take of a part and give its agent the first prompt.
   *
   * @param {TakeAsk & { prompt: string }} input
   * @returns {string} the take number
   */
  const start = ({ prompt, ...ask }) => {
    const take = store.create({ ...ask, ...(ask.direction ? { name: ask.direction.title } : {}) })
    void send(take, prompt)
    return take
  }

  /**
   * Give a take's agent another prompt. The agent keeps the conversation it
   * had since the server started.
   *
   * @param {string} take
   * @param {string} prompt
   */
  const follow = (take, prompt) => {
    if (store.record(take) === null) throw new Error(`Take ${take} does not exist.`)
    if (live.get(take)?.run._tag === "Running") throw new Error(`Take ${take} is still working. Stop it first, or wait.`)
    void send(take, prompt)
  }

  /** @param {string} take */
  const stop = take => {
    live.get(take)?.agent?.abort()
  }

  /** @param {string} take */
  const accept = take => {
    if (live.get(take)?.run._tag === "Running") throw new Error(`Take ${take} is still working. Stop it before you accept it.`)
    if (store.record(take)?.integration) throw new Error("This is an integration proposal. Review and check it before applying it.")
    const changed = store.accept(take)
    live.delete(take)
    onChange()
    return changed
  }

  /** @param {string} take */
  const discard = take => {
    live.get(take)?.agent?.abort()
    live.delete(take)
    store.discard(take)
    onChange()
  }

  /** @returns {TakeView[]} */
  const views = () => store.list().flatMap(take => {
    const record = store.record(take)
    if (record === null) return []
    const state = live.get(take)
    return [{
      take,
      part: record.part,
      state: record.state,
      device: record.device,
      created: record.created,
      ...(record.direction === undefined ? {} : { direction: record.direction }),
      ...(record.name ? { name: record.name } : {}),
      ...(!record.name && !record.direction && state?.run._tag !== "Running" ? { nameIssue: "No generated name. Ask the agent to name this take." } : {}),
      ...(record.integration ? { integration: integration.summary(take) } : {}),
      run: state?.run ?? { _tag: "Idle" },
      files: store.files(take),
      log: state?.log ?? [],
    }]
  })

  /**
   * @param {string} take
   * @param {string} prompt
   */
  const send = async (take, prompt) => {
    const record = /** @type {import("../takes/store.js").TakeRecord} */ (store.record(take))
    /** @type {Live} */
    const entry = live.get(take) ?? { agent: null, run: { _tag: "Running" }, log: [] }
    entry.run = { _tag: "Running" }
    entry.log.push({ _tag: "User", text: prompt })
    live.set(take, entry)
    onChange()
    try {
      const render = renderFor(take, record)
      const first = entry.agent === null
      const agent = entry.agent ?? createAgent(take, record, render, entry)
      entry.agent = agent
      const content = first ? await firstMessage(record, prompt, render, store, take) : prompt
      // Discarded while Caliper rendered the part for the first message.
      if (live.get(take) !== entry) return
      await (typeof content === "string"
        ? agent.prompt(content)
        : agent.prompt({ role: "user", content, timestamp: Date.now() }))
      const last = agent.state.messages.at(-1)
      entry.run = last?.role === "assistant" && last.stopReason === "error"
        ? { _tag: "Failed", reason: last.errorMessage ?? "The model request failed." }
        : { _tag: "Idle" }
    } catch (error) {
      entry.run = { _tag: "Failed", reason: error instanceof Error ? error.message : String(error) }
    }
    onChange()
  }

  /**
   * @param {string} take
   * @param {TakeAsk} ask
   * @param {RenderTake} render
   * @param {Live} entry
   */
  const createAgent = (take, ask, render, entry) => {
    const { models, model, reasoning } = engine()
    const tools = [
      ...takeTools({ store, take, render, defaults: { state: ask.state, device: ask.device } }),
      ...metadataTools({ store, take, onChange, integration }),
    ]
    let turns = 0
    const agent = new Agent({
      initialState: { systemPrompt: systemPrompt(take), model, thinkingLevel: reasoning, tools },
      streamFn: models.streamSimple.bind(models),
      sessionId: `caliper-take-${take}-${Date.now()}`,
      toolExecution: "sequential",
      finishTurn: async ({ message }) => {
        turns += 1
        if (turns < MAX_TURNS || message.stopReason !== "toolUse") return undefined
        entry.log.push({ _tag: "Assistant", text: `Stopped after ${MAX_TURNS} turns. Send another prompt to go on.` })
        return { action: "end" }
      },
    })
    agent.subscribe(event => {
      if (event.type === "agent_start") turns = 0
      if (applyEvent(entry.log, event)) onChange()
    })
    return agent
  }

  /** @param {string} take */
  const assertIdle = take => {
    if (live.get(take)?.run._tag === "Running") throw new Error(`Take ${take} is still working. Stop it first, or wait.`)
  }

  /** Prepare separately so the original experiment remains available for replacement. @param {string} source */
  const alternate = source => {
    assertIdle(source)
    const take = integration.begin(source)
    void send(take, INTEGRATION_PROMPT)
    return take
  }

  /** @param {string} take @param {string} revision @param {boolean} behaviorReviewed */
  const apply = (take, revision, behaviorReviewed) => {
    assertIdle(take)
    const files = integration.apply(take, revision, behaviorReviewed)
    live.delete(take)
    onChange()
    return files
  }

  return { start, follow, stop, accept, discard, views, alternate, assertIdle, integration, apply }
}

/**
 * Fold one agent event into the take's log. Returns true when the log changed.
 *
 * @param {TakeLogEntry[]} log
 * @param {import("@earendil-works/pi-agent-core").AgentEvent} event
 */
export function applyEvent(log, event) {
  if (event.type === "message_start" && event.message.role === "assistant") {
    log.push({ _tag: "Assistant", text: "" })
    return true
  }
  if (event.type === "message_update" || event.type === "message_end") {
    const message = event.message
    if (message.role !== "assistant") return false
    const text = message.content.filter(block => block.type === "text").map(block => block.text).join("")
    const index = lastAssistant(log)
    if (index === -1) return false
    const error = message.stopReason === "error" && message.errorMessage ? `\n\n${message.errorMessage}` : ""
    const full = `${text}${error}`.trim()
    // A turn that only calls tools has no words; its tools show in the log.
    if (event.type === "message_end" && full === "") log.splice(index, 1)
    else log[index] = { _tag: "Assistant", text: full }
    return true
  }
  if (event.type === "tool_execution_start") {
    log.push({ _tag: "Tool", id: event.toolCallId, name: event.toolName, subject: subjectOf(event.toolName, event.args), outcome: "Running", detail: "" })
    return true
  }
  if (event.type === "tool_execution_end") {
    const index = log.findIndex(entry => entry._tag === "Tool" && entry.id === event.toolCallId)
    const current = log[index]
    if (current === undefined || current._tag !== "Tool") return false
    log[index] = { ...current, outcome: event.isError ? "Failed" : "Done", detail: detailOf(event.result, event.isError) }
    return true
  }
  return false
}

/** @param {TakeLogEntry[]} log */
function lastAssistant(log) {
  for (let index = log.length - 1; index >= 0; index -= 1) if (log[index]?._tag === "Assistant") return index
  return -1
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
function subjectOf(name, args) {
  if (name === "render") return [args?.state, args?.device].filter(Boolean).join("@") || "as asked"
  if (name === "list_files") return String(args?.folder || ".")
  return String(args?.path ?? "")
}

/**
 * @param {{ content?: Array<{ type: string, text?: string }>, details?: any }} result
 * @param {boolean} isError
 */
function detailOf(result, isError) {
  const text = result?.content?.find(block => block.type === "text")?.text ?? ""
  if (isError) return text.slice(0, 400)
  const verdicts = result?.details?.results
  if (Array.isArray(verdicts)) {
    return verdicts.map(verdict => {
      const notes = [
        verdict.problems?.length ? `${verdict.problems.length} problems` : "",
        verdict.console?.length ? `${verdict.console.length} console errors` : "",
        verdict.spill ? "spill" : "",
      ].filter(Boolean).join(", ")
      return `${verdict.state}@${verdict.device}: ${verdict.frame}${notes ? ` (${notes})` : ""}`
    }).join("; ")
  }
  return text.split("\n")[0]?.slice(0, 200) ?? ""
}

/** @param {string} take */
function systemPrompt(take) {
  const devices = DEVICES.map(device => `${device.id} (${device.name}, ${device.cssWidth}x${device.cssHeight} CSS px)`).join(", ")
  return `You are the design agent inside Caliper, a tool that shows a React project's UI parts at the true size of handheld devices.

You work on take ${take}. A take is one proposed version of a part. Your edits go into the take, never into the real project; the user sees the take next to the original and accepts it or throws it away.

Terms:
- A part is a file named *.part.tsx. Its default export and its other exported components are its states: example renders with realistic data.
- The part renders the project's real components with the project's real CSS. To change how something looks, edit the component or its CSS, not the part file. Edit the part file only when the user asks about its example data or states.
- Devices: ${devices}. Every size you see is the device's CSS viewport.

Tools: read_file, list_files, edit_file and write_file work on project files as this take sees them. render shows the take in a headless browser and returns a verdict and screenshots.

How to work:
1. Call name_take with a short descriptive name for this design, unless the existing direction title already fits. Read the files you need before you change them. Keep the project's structure, naming and CSS style.
2. Make the smallest change that does what the user asked.
3. Call render after each change. Fix every problem and console error. A spill is content past the screen edge: fix it, or say why it is intended.
4. Stop when the request is done and the render is clean. Then write two or three short sentences: what you changed, in which files, and anything you could not do.

Do not ask the user questions. When a request is unclear, make a sensible choice and say which one.`
}

const INTEGRATION_PROMPT = `Prepare this experiment as an additional supported choice, not a replacement. You are working in a separate proposal take copied from the experiment. No real files have changed.

Read the original files with read_original. Preserve every existing caller's default behavior and every existing part state's output. Reuse an existing variant mechanism when the design fits it; otherwise add a separate named component sharing unchanged dependencies. Do not blindly duplicate behavior or change a global token for the alternate. Use reset_file to remove experiment edits that would change existing callers.

Add an explicit product-owned part state that demonstrates the alternate. Keep existing states unchanged. You may add a new part file. The render tool accepts part and state so you can inspect both original and alternate. Keep real actions and local fixture behavior. Do not introduce request interception or replace child fixtures in a composed scenario.

Render the alternate and original states. Then call submit_integration with strategy, summary, shared behavior, preserved defaults, exact caller usage, and preview part/state. Do not claim screenshots prove interaction behavior or type safety. The user will inspect diffs, run render checks, and confirm product checks separately. Stop after submitting. Never apply changes yourself.`

/**
 * The part of the first message that gives the take its direction, so
 * takes started from one prompt try different things.
 *
 * @param {TakeAsk} ask
 */
function directionText(ask) {
  if (ask.direction === undefined) return ""
  const others = ask.others?.length
    ? `\nOther takes of this prompt try: ${ask.others.map(title => `"${title}"`).join(", ")}. Stay clearly apart from them; the user compares the takes side by side.`
    : ""
  return `\n\nThis take's direction: ${ask.direction.title}. ${ask.direction.brief}${others}\nFollow this direction, even where another answer would be more obvious. If it cannot work, say why in your summary.`
}

/**
 * The first message: the request, the take's direction, the part's source,
 * and how the part renders now.
 *
 * @param {TakeAsk} ask
 * @param {string} prompt
 * @param {RenderTake} render
 * @param {TakeStore} store
 * @param {string} take
 * @returns {Promise<Array<{ type: "text", text: string } | { type: "image", data: string, mimeType: string }>>}
 */
async function firstMessage(ask, prompt, render, store, take) {
  const source = store.read(take, ask.part)
  /** @type {Array<{ type: "text", text: string } | { type: "image", data: string, mimeType: string }>} */
  const content = [{
    type: "text",
    text: `${prompt}${directionText(ask)}\n\nThe part is ${ask.part}. The user is looking at its state "${ask.state}" on the device ${ask.device}.\n\n<file path="${ask.part}">\n${source}\n</file>`,
  }]
  try {
    const [result] = await render({ state: ask.state, devices: [ask.device] })
    if (result !== undefined) {
      const { png, ...verdict } = result
      content.push({ type: "text", text: `How the part renders now:\n${JSON.stringify(verdict, null, 2)}` })
      content.push({ type: "image", data: readFileSync(png).toString("base64"), mimeType: "image/png" })
    }
  } catch (error) {
    content.push({ type: "text", text: `Caliper could not render the part before you started: ${error instanceof Error ? error.message : String(error)}` })
  }
  return content
}
