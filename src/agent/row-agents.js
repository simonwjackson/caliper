// @ts-check
import { readFileSync } from "node:fs"
import { Agent } from "@earendil-works/pi-agent-core"
import { Type } from "typebox"
import { applyEvent } from "./take-agents.js"
import { skillPrompt, skillSession } from "./skills.js"
import { rowPath } from "../takes/workspace-contract.js"

/**
 * The row agents of one project (decision 45, workspaces slice 2). A row
 * agent writes one scratch row: a part file in a workspace's folder that the
 * board renders in Today and in every idea, with checks that send browser
 * input. It reads the project's repository, writes only its own row file,
 * and renders that row in Today with its checks. Ideas never write a row,
 * so every idea is judged by the same row.
 *
 * Each row's conversation and log live in memory, as a take's do. The file
 * and what you asked are on disk, in the workspace.
 *
 * @typedef {import("./model.js").Engine} Engine
 * @typedef {import("../types").TakeRun} TakeRun
 * @typedef {import("../types").TakeLogEntry} TakeLogEntry
 * @typedef {import("../render/render.js").RenderResult} RenderResult
 * @typedef {import("@earendil-works/pi-agent-core").AgentTool<any>} AgentTool
 * @typedef {{ agent: Agent | null, run: TakeRun, log: TakeLogEntry[], device: string }} Live
 */

/** A row's run stops after this many model turns, as a take's does. */
export const MAX_ROW_TURNS = 40
/** The most characters read_file returns. */
const READ_LIMIT = 200_000
/** The most files list_files returns. */
const LIST_LIMIT = 400
/** The most screenshots one render returns to the model. */
const IMAGE_LIMIT = 4

/**
 * @param {{
 *   workspaces: import("./host-types").AgentWorkspaces,
 *   engine: () => Engine,
 *   renderRow: (workspace: string, file: string, device: string, signal: AbortSignal) => Promise<RenderResult[]>,
 *   project: (signal?: AbortSignal) => Promise<Pick<import("../types").Project, "parts" | "devices">>,
 *   onChange: () => void,
 *   onDone?: (workspace: string, file: string, device: string) => void,
 *   skills?: () => import("./skills.js").SkillCatalog | Promise<import("./skills.js").SkillCatalog>,
 * }} input
 *   `renderRow` renders the row in Today and runs its checks. `onDone` hears
 *   that a run ended, so the board can check the row in every column.
 */
export function createRowAgents({ workspaces, engine, renderRow, project, onChange, onDone = () => {}, skills = () => ({ skills: [], problems: [] }) }) {
  /** @type {Map<string, Live>} */
  const live = new Map()
  /** @type {Map<string, AbortController>} */
  const controllers = new Map()
  /** @type {Map<string, Promise<void>>} */
  const pending = new Map()
  let closed = false
  /** @param {string} workspace @param {string} file */
  const keyOf = (workspace, file) => `${workspace}\n${file}`

  /** @param {string} workspace @param {string} file @param {string} prompt */
  const launch = (workspace, file, prompt) => {
    if (closed) throw new Error("The row agents are closed.")
    const key = keyOf(workspace, file)
    const controller = new AbortController()
    controllers.set(key, controller)
    const task = send(workspace, file, prompt, controller.signal)
    pending.set(key, task)
    void task.finally(() => {
      if (pending.get(key) === task) { pending.delete(key); controllers.delete(key) }
      if (live.has(key)) onDone(workspace, file, live.get(key)?.device ?? "")
    })
  }

  /**
   * Add a scratch row at the end of the board and start its agent with what you asked.
   *
   * @param {{ workspace: string, brief: string, device: string }} input
   * @returns {Promise<string>} the row's file, rows/<n>.part.tsx
   */
  const start = async ({ workspace, brief, device }) => {
    if (closed) throw new Error("The row agents are closed.")
    // No agent, no row: a missing connection fails here, before the board changes.
    engine()
    const { row } = await workspaces.addScratch(workspace, brief)
    live.set(keyOf(workspace, row.file), { agent: null, run: { _tag: "Running" }, log: [], device })
    launch(workspace, row.file, brief)
    return row.file
  }

  /**
   * Give a row's agent another prompt. It keeps the conversation it had since the app started.
   *
   * @param {string} workspace @param {string} file @param {string} prompt
   * @param {string} [device] the board's device, for an agent that starts again after a restart
   */
  const follow = async (workspace, file, prompt, device = "") => {
    const entry = live.get(keyOf(workspace, file))
    if (entry?.run._tag === "Running") throw new Error("The row's agent is still working. Stop it first, or wait.")
    if ((await workspaces.read(workspace))?.rows.some(row => row._tag === "Scratch" && row.file === file) !== true) throw new Error(`Workspace ${workspace} has no row ${file}.`)
    if (!entry) live.set(keyOf(workspace, file), { agent: null, run: { _tag: "Idle" }, log: [], device })
    launch(workspace, file, prompt)
  }

  /** @param {string} workspace @param {string} file */
  const stop = async (workspace, file) => {
    const key = keyOf(workspace, file)
    controllers.get(key)?.abort(new Error("The row was stopped."))
    live.get(key)?.agent?.abort()
    await pending.get(key)
  }

  /** Stop the row's agent, then take the row off the board and delete its file. @param {string} workspace @param {string} file */
  const remove = async (workspace, file) => {
    const key = keyOf(workspace, file)
    const entry = live.get(key)
    // Forget the row first, so its ending run checks nothing.
    live.delete(key)
    controllers.get(key)?.abort(new Error("The row was deleted."))
    entry?.agent?.abort()
    await pending.get(key)
    await workspaces.removeScratch(workspace, file)
    onChange()
  }

  /** Every row agent's run and log. @returns {Promise<Array<{ workspace: string, file: string, run: TakeRun, log: TakeLogEntry[] }>>} */
  const views = async () => [...live.entries()].map(([key, entry]) => {
    const [workspace = "", file = ""] = key.split("\n")
    return { workspace, file, run: entry.run, log: entry.log }
  })

  const close = async () => {
    closed = true
    await Promise.all([...pending.keys()].map(key => {
      const [workspace = "", file = ""] = key.split("\n")
      return stop(workspace, file)
    }))
  }

  /** @param {string} workspace @param {string} file @param {string} prompt @param {AbortSignal} signal */
  const send = async (workspace, file, prompt, signal) => {
    const key = keyOf(workspace, file)
    /** @type {Live} */
    const entry = live.get(key) ?? { agent: null, run: { _tag: "Running" }, log: [], device: "" }
    entry.run = { _tag: "Running" }
    entry.log.push({ _tag: "User", text: prompt })
    live.set(key, entry)
    onChange()
    try {
      signal.throwIfAborted()
      const first = entry.agent === null
      const agent = entry.agent ?? await createAgent(workspace, file, entry, signal)
      entry.agent = agent
      const content = first ? await firstMessage(workspace, file, prompt, entry.device, signal) : prompt
      signal.throwIfAborted()
      if (live.get(key) !== entry) return
      await (typeof content === "string" ? agent.prompt(content) : agent.prompt({ role: "user", content, timestamp: Date.now() }))
      signal.throwIfAborted()
      const last = agent.state.messages.at(-1)
      entry.run = last?.role === "assistant" && last.stopReason === "error" ? { _tag: "Failed", reason: last.errorMessage ?? "The model request failed." } : { _tag: "Idle" }
    } catch (error) {
      entry.run = { _tag: "Failed", reason: error instanceof Error ? error.message : String(error) }
    }
    onChange()
  }

  /**
   * The first message: the question, what you asked, where the row lives,
   * the other rows, and the project's parts.
   *
   * @param {string} workspace @param {string} file @param {string} prompt @param {string} device @param {AbortSignal} signal
   * @returns {Promise<Array<{ type: "text", text: string }>>}
   */
  const firstMessage = async (workspace, file, prompt, device, signal) => {
    const record = await workspaces.read(workspace)
    if (record === null) throw new Error(`Workspace ${workspace} does not exist.`)
    const { parts } = await project(signal)
    const path = rowPath(workspace, file)
    const others = record.rows.filter(row => !(row._tag === "Scratch" && row.file === file))
      .map(row => row._tag === "State" ? `- the pinned state ${row.part}, "${row.state}"` : `- the scratch row ${rowPath(workspace, row.file)}: ${row.brief}`)
    const now = await workspaces.readRow(workspace, file)
    return [{
      type: "text",
      text: [
        `The workspace's question: ${record.question || "(not written yet)"}`,
        `What the user asks of this row: ${prompt}`,
        `Your row is ${path}. ${now === null ? "It does not exist yet." : `It holds now:\n<file path="${path}">\n${now}\n</file>`}`,
        `Import product files by paths relative to the row file: the project root is "../../../../", so src/Home.tsx is "../../../../src/Home".`,
        `The board shows the rows on ${device || "the board's device"}.`,
        `The board's other rows:\n${others.join("\n") || "- none yet"}`,
        `The project's parts, by file and name:\n${parts.map(part => `- ${part.file} (${part.name})`).join("\n")}`,
      ].join("\n\n"),
    }]
  }

  /** @param {string} workspace @param {string} file @param {Live} entry @param {AbortSignal} signal */
  const createAgent = async (workspace, file, entry, signal) => {
    const { models, model, reasoning } = engine()
    const catalog = await skills()
    const session = skillSession(catalog)
    const tools = [...rowTools({ workspaces, workspace, file, render: activeSignal => renderRow(workspace, file, entry.device, activeSignal) }), ...session.tools]
    const devices = (await project(signal)).devices
    let turns = 0
    const agent = new Agent({
      initialState: { systemPrompt: `${rowSystemPrompt(rowPath(workspace, file), devices)}${skillPrompt(catalog)}`, model, thinkingLevel: reasoning, tools },
      streamFn: models.streamSimple.bind(models),
      sessionId: `caliper-row-${workspace}-${file}-${Date.now()}`,
      toolExecution: "sequential",
      finishTurn: async ({ message }) => {
        turns += 1
        if (turns < MAX_ROW_TURNS || message.stopReason !== "toolUse") return undefined
        entry.log.push({ _tag: "Assistant", text: `Stopped after ${MAX_ROW_TURNS} turns. Send another prompt to go on.` })
        return { action: "end" }
      },
    })
    agent.subscribe(event => {
      if (event.type === "agent_start") turns = 0
      if (applyEvent(entry.log, event)) onChange()
    })
    return agent
  }

  return { start, follow, stop, remove, views, close }
}

/**
 * The only tools a row agent has. It reads the project's repository, writes
 * its one row file, and renders that row in Today. It cannot run commands or
 * write anywhere else: the workspace store fences every path.
 *
 * @param {{ workspaces: import("./host-types").AgentWorkspaces, workspace: string, file: string, render: (signal: AbortSignal) => Promise<RenderResult[]> }} input
 * @returns {AgentTool[]}
 */
export function rowTools({ workspaces, workspace, file, render }) {
  /** @param {string} value */
  const text = value => ({ type: /** @type {const} */ ("text"), text: value })
  const path = rowPath(workspace, file)

  /** @type {AgentTool} */
  const readFile = {
    name: "read_file", label: "Read",
    description: "Read a file of the project's repository as it is now. Paths are relative to the project root; ../ reaches the rest of the repository, such as a sibling package the row imports.",
    parameters: Type.Object({ path: Type.String({ description: "Path relative to the project root, for example src/Home.tsx" }) }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      const { path: wanted } = /** @type {{ path: string }} */ (params)
      const content = await workspaces.readSource(wanted)
      const clipped = content.length > READ_LIMIT ? `${content.slice(0, READ_LIMIT)}\n[... clipped at ${READ_LIMIT} characters]` : content
      return { content: [text(clipped)], details: { path: wanted } }
    },
  }

  /** @type {AgentTool} */
  const listFiles = {
    name: "list_files", label: "List",
    description: "List the files under a folder of the project's repository. node_modules, .git and environment files are not listed.",
    parameters: Type.Object({ folder: Type.Optional(Type.String({ description: 'Folder relative to the project root. Default: "" (the whole project)' })) }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      const { folder } = /** @type {{ folder?: string }} */ (params)
      const found = await workspaces.listSource(folder ?? "")
      const shown = found.slice(0, LIST_LIMIT)
      const more = found.length > shown.length ? `\n[... ${found.length - shown.length} more. List a smaller folder.]` : ""
      return { content: [text(`${shown.join("\n")}${more}` || "No files.")], details: { folder: folder ?? "", count: found.length } }
    },
  }

  /** @type {AgentTool} */
  const readRow = {
    name: "read_row", label: "Read row",
    description: `Read your row file, ${path}, as it is now. It can change by hand between your turns.`,
    parameters: Type.Object({}),
    execute: async () => {
      const content = await workspaces.readRow(workspace, file)
      return { content: [text(content ?? "The row file does not exist yet. Write it with write_row.")], details: { path } }
    },
  }

  /** @type {AgentTool} */
  const writeRow = {
    name: "write_row", label: "Write row",
    description: `Write the whole content of your row file, ${path}. It is the only file you can write.`,
    parameters: Type.Object({ content: Type.String({ description: "The complete content of the row file" }) }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      const { content } = /** @type {{ content: string }} */ (params)
      await workspaces.writeRow(workspace, file, content)
      return { content: [text(`Wrote ${path}: ${content.split("\n").length} lines.`)], details: { path } }
    },
  }

  /** @type {AgentTool} */
  const editRow = {
    name: "edit_row", label: "Edit row",
    description: "Replace one exact piece of text in your row file. old_text must appear exactly once.",
    parameters: Type.Object({
      old_text: Type.String({ description: "Exact text to replace. It must appear once." }),
      new_text: Type.String({ description: "The replacement text" }),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      const { old_text: oldText, new_text: newText } = /** @type {{ old_text: string, new_text: string }} */ (params)
      const current = await workspaces.readRow(workspace, file)
      if (current === null) throw new Error("The row file does not exist yet. Write it with write_row.")
      const count = oldText === "" ? 0 : current.split(oldText).length - 1
      if (count !== 1) throw new Error(count === 0 ? "old_text does not appear in the row. Read it again and copy the text exactly." : `old_text appears ${count} times. Add more lines around it so it appears once.`)
      await workspaces.writeRow(workspace, file, current.replace(oldText, () => newText))
      return { content: [text(`Edited ${path}.`)], details: { path } }
    },
  }

  /** @type {AgentTool} */
  const renderRowTool = {
    name: "render_row", label: "Render row",
    description: [
      "Render your row in Today, the real files, on the board's device, and run its checks. Returns a JSON verdict and screenshots: the first render, then the page at the end of each check.",
      '`frame` is "Rendered", "Empty" or "Failed"; `problems` are load and render errors. `authored.checks` holds each named check: Passed, Failed (with `reason` and `detail`), Inconclusive or NotRun.',
      "A check that fails in Today can be the finding. A check that fails because of an error in the row is a defect to fix.",
    ].join(" "),
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async (_id, _params, signal) => {
      signal?.throwIfAborted()
      const results = await render(signal ?? new AbortController().signal)
      const paths = [...results.map(result => result.png), ...results.flatMap(result => result.authored?.checks.flatMap(check => check.image ? [check.image] : []) ?? [])]
      const shown = paths.slice(0, IMAGE_LIMIT)
      const images = shown.map(image => ({ type: /** @type {const} */ ("image"), data: readFileSync(image).toString("base64"), mimeType: "image/png" }))
      const omitted = paths.length > images.length ? `\n${paths.length - images.length} screenshots omitted.` : ""
      return { content: [text(`${JSON.stringify(results, null, 2)}\nAttached images, in order: ${JSON.stringify(shown)}${omitted}`), ...images], details: { results } }
    },
  }

  return [readFile, listFiles, readRow, writeRow, editRow, renderRowTool]
}

/**
 * @param {string} path the row file, project-relative
 * @param {readonly import("../client/device-frame.js").Device[]} projectDevices
 */
function rowSystemPrompt(path, projectDevices) {
  const devices = projectDevices.map(device => `${device.id} (${device.name}, ${device.cssWidth}x${device.cssHeight} CSS px)`).join(", ")
  return `You are a row agent inside Caliper, a tool that shows a React project's UI at the true size of the devices it targets.

A workspace holds competing ideas that answer one question. Its board renders every row in Today, the real files, and in each idea, its own copy of the files. You write one scratch row: a test bench the workspace owns. No idea can change it, so every idea is judged by it the same way.

Your row is one file, ${path}. It uses Caliper's part format:
- \`export default function ...\` renders the row's one state with explicit local data and no network. Compose the product's real components; import them by paths relative to the row file. Code elsewhere in the repository works too.
- \`export const name = "..."\` names the row in a few words.
- \`export const checks = { default: { "what it checks": async ({ canvas, within, input, expect, waitFor }) => { ... } } }\` holds the row's checks. A check sends browser input as a person would and asserts what the page shows:
  - \`input.click(element)\`, \`input.type(element, text)\` and \`input.press(element, key)\`, with Playwright key names such as "ArrowDown", "Enter" and "Escape". Await each one.
  - \`input.press\` focuses its element first. To press a key on whatever has focus, as a d-pad does, pass \`document.activeElement ?? document.body\`.
  - \`canvas\` is Testing Library, scoped to the row. \`expect\` has jest-dom matchers. \`waitFor\` retries. Query again after each input.
  - A check never calls a product function directly. Give each \`expect\` a message that says what the person could not do.
- Write no other export.

You can write only your row file. You can read any file of the project's repository. You cannot run commands.

Work: read the product files you need, write the row with write_row, then render_row. render_row renders the row in Today and runs its checks there. Fix the row until it renders and every check runs to a verdict. A check that fails in Today can be the finding: the question may say that Today lacks something. Never weaken a check so that Today passes; report what Today does. A check that fails because of an error in the row is a defect: fix it.

When the row renders and each check gives a verdict you can explain, stop. Reply in two or three sentences: what the row shows, what each check presses and expects, and how Today did. Write in plain words.

The project's devices: ${devices || "the standard devices"}.
You have ${MAX_ROW_TURNS} turns. Make a first write before half of them are gone.`
}
