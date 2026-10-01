// @ts-check
import { readFileSync } from "node:fs"
import { AsyncLocalStorage } from "node:async_hooks"
import { Agent } from "@earendil-works/pi-agent-core"
import { STANDARD_DEVICES } from "../client/device-frame.js"
import { takeTools } from "./tools.js"
import { metadataTools } from "./metadata-tools.js"
import { createIntegrationReview, integrationSummary } from "../takes/integration.js"
import { skillPrompt, skillSession } from "./skills.js"
import { imageContent } from "./images.js"
import { identityKey } from "../takes/chains.js"
import { isIdea } from "../takes/store.js"

/**
 * The chain a take belongs to: its record's `chain`, or the take itself.
 * @param {{ take: string, created: number, chain?: { take: string, created: number } }} take
 */
const chainKey = ({ take, created, chain }) => identityKey(chain ?? { take, created })

/**
 * @typedef {import("./model.js").Engine} Engine
 * @typedef {import("./tools.js").RenderTake} RenderTake
 * @typedef {import("./host-types").AgentStore} TakeStore
 * @typedef {import("../types").TakeView} TakeView
 * @typedef {import("../types").TakeRun} TakeRun
 * @typedef {import("../types").TakeLogEntry} TakeLogEntry
 * @typedef {{ part: string, state: string, device: string, context?: import("../types").StateRef, direction?: import("../takes/store.js").Direction, others?: string[] }} TakeAsk
 *   `direction` is the planner's way for this take to answer the prompt;
 *   `others` are the titles of the directions its sibling takes got.
 * @typedef {import("./images.js").AttachedImage} AttachedImage
 * @typedef {import("./skills.js").SkillCatalog} SkillCatalog
 * @typedef {ReturnType<typeof skillSession>} SkillSession
 * @typedef {{ agent: Agent | null, run: TakeRun, log: TakeLogEntry[], edited: Set<string>, skills?: SkillSession }} Live
 *   `agent` is null until the first prompt creates it, and stays null when that fails.
 *   `edited` holds the files you changed by hand since the agent's last turn.
 *   `skills` is the agent's use of the skills; it exists once the agent does.
 */

/** @returns {SkillCatalog} */
const noSkills = () => ({ skills: [], problems: [] })

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
 *   skills?: () => SkillCatalog | Promise<SkillCatalog>,
 *   integration?: import("./host-types").AgentIntegration,
 *   devices?: (signal?: AbortSignal) => readonly import("../client/device-frame.js").Device[] | Promise<readonly import("../client/device-frame.js").Device[]>,
 * }} input
 *   `devices` is the project's device list, read when a take's agent starts;
 *   without it, the agent hears of the standard devices.
 *   `engine` is called when a take starts, so a missing connection fails that
 *   take, not the server. `onChange` fires on every visible change. `skills`
 *   is read when a take's agent starts, so a new or changed skill reaches the
 *   next agent without a restart.
 */
export function createTakeAgents({ store, engine, renderFor, onChange, skills = noSkills, integration = createIntegrationReview(/** @type {import("../takes/store.js").TakeStore} */ (store)), devices = () => STANDARD_DEVICES }) {
  /** @type {Map<string, Live>} */
  const live = new Map()
  /** @type {Map<string, AbortController>} */
  const controllers = new Map()
  /** @type {Map<string, Promise<void>>} */
  const pending = new Map()
  /** Reservations keep idle mutations exclusive across remote awaits. Stop never waits for one. */
  /** @type {Set<string>} */
  const changing = new Set()
  /** Takes prepared by Send remain reserved until launch or rollback. */
  /** @type {Map<string, number>} */
  const prepared = new Map()
  // Membership and allocation must stay exclusive until their remote reply.
  // Per-take reservations alone cannot protect an ID we have not received yet.
  /** @type {AsyncLocalStorage<boolean>} */
  const collectionScope = new AsyncLocalStorage()
  let collectionBusy = false
  let collectionTail = Promise.resolve()
  /** @template T @param {() => Promise<T>} run @returns {Promise<T>} */
  const whileCollection = run => {
    const task = collectionTail.then(() => collectionScope.run(true, async () => {
      collectionBusy = true
      try { return await run() } finally { collectionBusy = false }
    }))
    collectionTail = task.then(() => {}, () => {})
    return task
  }
  let closed = false
  const assertOpen = () => { if (closed) throw new Error("The takes API is closed.") }

  /**
   * @param {string} take
   * @param {string} prompt
   * @param {readonly AttachedImage[]} [images]
   * @param {boolean} [brief] the prompt is a markup brief: it replaces the first message, and the images are its pictures
   */
  const launch = (take, prompt, images = [], brief = false) => {
    assertOpen()
    const controller = new AbortController()
    controllers.set(take, controller)
    const run = () => send(take, prompt, images, controller.signal, brief)
    const task = store.withSignal ? store.withSignal(controller.signal, run) : run()
    pending.set(take, task)
    void task.finally(() => {
      if (pending.get(take) === task) {
        pending.delete(take)
        controllers.delete(take)
      }
    })
  }

  /**
   * Start a new take of a part and give its agent the first prompt.
   *
   * @param {TakeAsk & { prompt: string, images?: readonly AttachedImage[] }} input
   * @returns {Promise<string>} the take number
   */
  const start = async ({ prompt, images = [], ...ask }) => whileCollection(async () => {
    assertOpen()
    const take = await store.create({ ...ask, prompt, ...(ask.direction ? { name: ask.direction.title } : {}) })
    if (closed) { await store.discard(take); assertOpen() }
    launch(take, prompt, images)
    return take
  })

  /**
   * Start a take made from marks: a copy of its parent, whose agent gets the
   * brief and the parent's pictures with the marks drawn in, not the usual
   * first message. The parent does not change.
   *
   * @param {string} parent
   * @param {import("../takes/store.js").NewTakeRecord} record
   * @returns {Promise<string>} the take number
   */
  const fork = async (parent, record) => whileCollection(async () => {
    return whileIdle(parent, async () => {
      assertOpen()
      return holdPrepared(await store.fork(parent, record))
    })
  })

  /**
   * Start a take made from marks on the original: a new take of the real files.
   * Its agent is started with `startMarkup`.
   *
   * @param {import("../takes/store.js").NewTakeRecord} record
   * @returns {Promise<string>} the take number
   */
  const create = async record => whileCollection(async () => {
    assertOpen()
    return holdPrepared(await store.create(record))
  })

  /** @param {string} take */
  const holdPrepared = async take => {
    changing.add(take)
    try {
      const record = await store.record(take)
      if (record === null) throw new Error(`Take ${take} does not exist.`)
      prepared.set(take, record.created)
      return take
    } catch (error) { changing.delete(take); throw error }
  }

  /** Roll back only the reserved child's identity, never a reused number. @param {string} take */
  const discardPrepared = async take => whileCollection(async () => {
    try {
      if ((await store.record(take))?.created === prepared.get(take)) await store.discard(take)
    } finally { prepared.delete(take); changing.delete(take) }
  })

  /**
   * @param {string} take a take `fork` or `create` made
   * @param {string} brief
   * @param {readonly AttachedImage[]} pictures
   */
  const startMarkup = async (take, brief, pictures) => {
    assertOpen()
    if (!prepared.has(take) || (await store.record(take))?.created !== prepared.get(take)) throw new Error(`Take ${take} is no longer the prepared take.`)
    prepared.delete(take)
    changing.delete(take)
    launch(take, brief, pictures, true)
  }

  /**
   * Give a take's agent another prompt. The agent keeps the conversation it
   * had since the server started.
   *
   * @param {string} take
   * @param {string} prompt
   * @param {readonly AttachedImage[]} [images]
   */
  const follow = async (take, prompt, images = []) => {
    return whileIdle(take, async () => {
      assertOpen()
      if (await store.record(take) === null) throw new Error(`Take ${take} does not exist.`)
      if (live.get(take)?.run._tag === "Running") throw new Error(`Take ${take} is still working. Stop it first, or wait.`)
      launch(take, prompt, images)
    })
  }

  /**
   * Save your edit of one file in a take. Content equal to the real file
   * removes the take's copy, so the take changes only what still differs.
   * The agent hears about the edit with its next prompt.
   *
   * @param {string} take
   * @param {string} file root-relative
   * @param {string} content
   * @returns {Promise<string[]>} the files the take changes now
   */
  const editByHand = async (take, file, content) => {
    if (live.get(take)?.run._tag === "Running") throw new Error(`Take ${take}'s agent is working. Stop it before you edit by hand.`)
    return whileIdle(take, async () => {
      if (await store.record(take) === null) throw new Error(`Take ${take} does not exist.`)
      const original = await store.original(file)
      const inside = content === original ? (await store.reset(take, file), file) : await store.write(take, file, content)
      noteHandEdit(take, inside)
      return store.files(take)
    })
  }

  /**
   * Remember an edit by hand that someone else wrote, such as a knob in the
   * project's plugin, so the agent's next prompt names the file.
   *
   * @param {string} take
   * @param {string} inside root-relative
   */
  const noteHandEdit = (take, inside) => {
    const entry = live.get(take) ?? { agent: null, run: { _tag: "Idle" }, log: [], edited: new Set() }
    entry.edited.add(inside)
    const last = entry.log.at(-1)
    if (last?._tag !== "Edit" || last.file !== inside) entry.log.push({ _tag: "Edit", file: inside })
    live.set(take, entry)
    onChange()
  }

  /** @param {string} take */
  const stop = async take => {
    controllers.get(take)?.abort(new Error("The take was stopped."))
    live.get(take)?.agent?.abort()
    // SDK abort alone does not cover the render before the first model prompt.
    await pending.get(take)
  }

  const close = async () => {
    closed = true
    await Promise.all([...pending.keys()].map(stop))
  }

  /** @param {string} take */
  const accept = async take => whileCollection(async () => {
    if (live.get(take)?.run._tag === "Running") throw new Error(`Take ${take} is still working. Stop it before you accept it.`)
    return whileIdle(take, async () => {
      const accepting = await store.record(take)
      if (accepting !== null && isIdea(accepting)) throw new Error(`Take ${take} is an idea. A workspace compares ideas; it does not accept them.`)
      if (accepting?.integration) throw new Error("This is an integration proposal. Review and check it before applying it.")
      // Plan decision 12: accept removes the accepted take's whole chain. Check every member before the first write.
      const chain = accepting ? chainKey({ take, created: accepting.created, chain: accepting.chain }) : null
      const members = (await Promise.all((await store.list()).map(async other => {
        const record = other === take ? null : await store.record(other)
        return record !== null && chainKey({ take: other, created: record.created, chain: record.chain }) === chain ? other : null
      }))).filter(other => other !== null)
      const running = members.find(other => live.get(other)?.run._tag === "Running")
      if (running) throw new Error(`Take ${running} of this chain is still working. Stop it before you accept take ${take}.`)
      for (const other of members) assertIdle(other)
      for (const other of members) changing.add(other)
      try {
        const changed = await store.accept(take)
        live.delete(take)
        for (const other of members) {
          await store.discard(other)
          live.delete(other)
        }
        onChange()
        return changed
      } finally { for (const other of members) changing.delete(other) }
    })
  })

  /** @param {string} take @returns {Promise<void>} */
  const discard = async take => {
    if (live.get(take)?.run._tag === "Running") return stop(take).then(() => discard(take))
    return whileCollection(() => whileIdle(take, async () => {
      await store.discard(take)
      live.delete(take)
      onChange()
    }))
  }

  /** The takes of parts. An idea is on its workspace's board, never under a state. @returns {Promise<TakeView[]>} */
  const views = async () => (store.batch ?? (read => read()))(async () => {
    const entries = await Promise.all((await store.list()).map(async take => {
      const record = await store.record(take)
      if (record === null || isIdea(record)) return []
      const state = live.get(take)
      return [{
        take, part: record.part, state: record.state, device: record.device, created: record.created,
        ...(record.context === undefined ? {} : { context: record.context }),
        ...(record.direction === undefined ? {} : { direction: record.direction }),
        ...(record.name ? { name: record.name } : {}),
        ...(!record.name && !record.direction && state?.run._tag !== "Running" ? { nameIssue: "No generated name. Ask the agent to name this take." } : {}),
        ...(record.integration ? { integration: integrationSummary(record.integration) } : {}),
        ...(record.parent ? { parent: record.parent } : {}),
        ...(record.chain ? { chain: record.chain } : {}),
        ...(record.history ? { lineage: record.history.lineage } : {}),
        run: state?.run ?? { _tag: "Idle" },
        files: await store.files(take), images: record.images ?? [], log: state?.log ?? [],
      }]
    }))
    return entries.flat()
  })

  /**
   * The ideas of every workspace (decision 45), oldest first, each with the
   * workspace it answers.
   *
   * @returns {Promise<Array<import("../types").IdeaView & { workspace: string }>>}
   */
  const ideas = async () => (store.batch ?? (read => read()))(async () => {
    const entries = await Promise.all((await store.list()).map(async take => {
      const record = await store.record(take)
      if (record === null || !isIdea(record)) return []
      const state = live.get(take)
      return [{
        workspace: record.subject.workspace, take, device: record.device, created: record.created,
        ...(record.direction === undefined ? {} : { direction: record.direction }),
        ...(record.name ? { name: record.name } : {}),
        run: state?.run ?? { _tag: /** @type {const} */ ("Idle") },
        files: await store.files(take), images: record.images ?? [], log: state?.log ?? [],
      }]
    }))
    return entries.flat()
  })

  /**
   * @param {string} take
   * @param {string} prompt
   * @param {readonly AttachedImage[]} images attached to this prompt
   * @param {AbortSignal} signal
   * @param {boolean} brief
   */
  const send = async (take, prompt, images, signal, brief) => {
    /** @type {Live} */
    const entry = live.get(take) ?? { agent: null, run: { _tag: "Running" }, log: [], edited: new Set() }
    entry.run = { _tag: "Running" }
    const user = { _tag: /** @type {const} */ ("User"), text: prompt }
    entry.log.push(user)
    live.set(take, entry)
    onChange()
    const edited = [...entry.edited]
    entry.edited.clear()
    try {
      signal.throwIfAborted()
      const kept = await store.addImages(take, images)
      const attachedImages = kept.map((image, index) => ({ ...image, bytes: /** @type {AttachedImage} */ (images[index]).bytes }))
      const userIndex = entry.log.indexOf(user)
      entry.log[userIndex] = { ...user, ...(kept.length ? { images: kept.map(image => image.file) } : {}) }
      const record = await store.record(take)
      if (record === null) throw new Error(`Take ${take} does not exist.`)
      if (isIdea(record)) throw new Error(`Take ${take} is an idea. Ideas start from their workspace.`)
      signal.throwIfAborted()
      const renderTake = renderFor(take, record)
      /** @type {RenderTake} */
      const render = request => {
        // Existing agent tools survive follow-up prompts; read this run's controller.
        const active = controllers.get(take)?.signal
        const signals = [active, request.signal].filter(signal => signal !== undefined)
        const signal = AbortSignal.any(signals)
        signal.throwIfAborted()
        return renderTake({ ...request, signal })
      }
      const first = entry.agent === null
      // A list the caller already holds starts the agent without waiting a turn.
      const listed = entry.agent === null ? devices(signal) : []
      const agent = entry.agent ?? await createAgent(take, record, render, entry, Array.isArray(listed) ? listed : await listed)
      entry.agent = agent
      const named = await namedSkills(entry, prompt)
      if (named.length > 0) onChange()
      const attached = imageContent(attachedImages, "this prompt")
      const content = first && brief
        ? [{ type: /** @type {const} */ ("text"), text: prompt }, ...attachedImages.map(image => ({ type: /** @type {const} */ ("image"), data: image.bytes.toString("base64"), mimeType: image.mimeType }))]
        : first
        ? [
          ...await firstMessage(record, `${named}${handNote(edited, true)}${prompt}`, render, store, take),
          // A new agent in an old take, after a restart, has not seen the take's earlier images.
          ...imageContent(await earlierImages(store, take, attachedImages), "earlier prompts in this take"),
          ...attached,
        ]
        : attached.length > 0
          ? [{ type: /** @type {const} */ ("text"), text: `${named}${handNote(edited, false)}${prompt}` }, ...attached]
          : `${named}${handNote(edited, false)}${prompt}`
      signal.throwIfAborted()
      if (live.get(take) !== entry) return
      await (typeof content === "string"
        ? agent.prompt(content)
        : agent.prompt({ role: "user", content, timestamp: Date.now() }))
      signal.throwIfAborted()
      const last = agent.state.messages.at(-1)
      entry.run = last?.role === "assistant" && last.stopReason === "error"
        ? { _tag: "Failed", reason: last.errorMessage ?? "The model request failed." }
        : { _tag: "Idle" }
    } catch (error) {
      entry.run = { _tag: "Failed", reason: error instanceof Error ? error.message : String(error) }
      // The agent never read the note, so the next prompt carries it again.
      if (entry.agent === null || entry.agent.state.messages.length === 0) for (const file of edited) entry.edited.add(file)
    }
    onChange()
  }

  /**
   * @param {string} take
   * @param {TakeAsk} ask
   * @param {RenderTake} render
   * @param {Live} entry
   * @param {readonly import("../client/device-frame.js").Device[]} devices the project's
   */
  const createAgent = async (take, ask, render, entry, devices) => {
    const { models, model, reasoning } = engine()
    const preview = ask.context ?? ask
    const catalog = await skills()
    const session = skillSession(catalog)
    entry.skills = session
    const tools = [
      ...takeTools({ store, take, render, defaults: { part: preview.part, state: preview.state, device: ask.device } }),
      ...await metadataTools({ store, take, onChange, integration }),
      ...session.tools,
    ]
    let turns = 0
    const agent = new Agent({
      initialState: { systemPrompt: `${systemPrompt(take, devices)}${skillPrompt(catalog)}`, model, thinkingLevel: reasoning, tools },
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
    if (collectionBusy && !collectionScope.getStore()) throw new Error("Take storage is being changed. Wait for it to finish.")
    if (live.get(take)?.run._tag === "Running") throw new Error(`Take ${take} is still working. Stop it first, or wait.`)
    if (changing.has(take)) throw new Error(`Take ${take} is being changed. Wait for it to finish.`)
  }

  /** @template T @param {string} take @param {() => Promise<T>} run */
  const whileIdle = async (take, run) => {
    assertIdle(take)
    changing.add(take)
    try { return await run() } finally { changing.delete(take) }
  }

  /** Prepare separately so the original experiment remains available for replacement. @param {string} source */
  const alternate = async source => whileCollection(async () => {
    return whileIdle(source, async () => {
      assertOpen()
      const take = await integration.begin(source)
      if (closed) { await store.discard(take); assertOpen() }
      launch(take, INTEGRATION_PROMPT)
      return take
    })
  })

  /** @param {string} take @param {string} revision @param {boolean} behaviorReviewed */
  const apply = async (take, revision, behaviorReviewed) => whileCollection(async () => {
    return whileIdle(take, async () => {
      const files = await integration.apply(take, revision, behaviorReviewed)
      live.delete(take)
      onChange()
      return files
    })
  })

  return { start, fork, create, startMarkup, discardPrepared, whileIdle, editByHand, noteHandEdit, follow, stop, close, accept, discard, views, ideas, alternate, assertIdle, integration, apply }
}

/**
 * The instructions of each skill the prompt names as `/name`, which the
 * agent has not loaded yet, for the start of the message. Each one shows in
 * the take's log as a loaded skill.
 *
 * @param {Live} entry
 * @param {string} prompt
 */
async function namedSkills(entry, prompt) {
  const loaded = await entry.skills?.mentioned(prompt) ?? []
  for (const skill of loaded) {
    entry.log.push({ _tag: "Tool", id: `named-${skill.name}-${entry.log.length}`, name: "activate_skill", subject: skill.name, outcome: "Done", detail: `Loaded because the prompt names /${skill.name}.` })
  }
  return loaded.map(skill => `${skill.text}\n\n`).join("")
}

/**
 * The take's images from before this prompt, with their bytes. An image
 * whose file is gone is left out.
 *
 * @param {TakeStore} store
 * @param {string} take
 * @param {ReadonlyArray<{ file: string }>} now the images of this prompt
 * @returns {Promise<AttachedImage[]>}
 */
async function earlierImages(store, take, now) {
  const current = new Set(now.map(image => image.file))
  return (await Promise.all(((await store.record(take))?.images ?? []).map(async known => {
    if (current.has(known.file)) return []
    const kept = await store.image(take, known.file)
    return kept === null ? [] : [{ name: known.name, mimeType: known.mimeType, bytes: kept.bytes }]
  }))).flat()
}

/**
 * What the agent must know before it acts on a prompt: files you changed by
 * hand, which its conversation has not seen.
 *
 * @param {readonly string[]} files
 * @param {boolean} first whether this is the agent's first message in the take
 */
export function handNote(files, first) {
  if (files.length === 0) return ""
  const list = files.map(file => `"${file}"`).join(", ")
  const them = files.length === 1 ? "it" : "them"
  return first
    ? `I already edited ${list} by hand in this take. Build on my edits; read ${them} before you change ${them}.\n\n`
    : `I edited ${list} by hand since your last turn. Read ${them} again before you change ${them}.\n\n`
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
    log[index] = { ...current, outcome: event.isError ? "Failed" : "Done", detail: detailOf(event.result, event.isError, event.toolName) }
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
  if (name === "render") return args?.related ? "all declared related scenarios" : [args?.part, args?.state, args?.device].filter(Boolean).join("@") || "as asked"
  // A read of a take a note points to (planner choice 13) says which take it read.
  const from = typeof args?.take === "string" && (name === "read_file" || name === "list_files") ? ` in take ${args.take}` : ""
  if (name === "list_files") return `${String(args?.folder || ".")}${from}`
  if (name === "activate_skill") return String(args?.name ?? "")
  if (name === "read_skill_file") return `${args?.name ?? ""}: ${args?.path ?? ""}`
  return `${String(args?.path ?? "")}${from}`
}

/**
 * @param {{ content?: Array<{ type: string, text?: string }>, details?: any }} result
 * @param {boolean} isError
 * @param {string} name the tool's name
 */
function detailOf(result, isError, name) {
  const text = result?.content?.find(block => block.type === "text")?.text ?? ""
  if (isError) return text.slice(0, 400)
  if (name === "activate_skill") return text.startsWith("<skill_content") ? "Loaded its instructions." : "Already loaded."
  const verdicts = result?.details?.results
  if (Array.isArray(verdicts)) {
    return verdicts.map(verdict => {
      const notes = [
        verdict.problems?.length ? `${verdict.problems.length} problems` : "",
        verdict.console?.length ? `${verdict.console.length} console errors` : "",
        verdict.spill ? "spill" : "",
      ].filter(Boolean).join(", ")
      return `${verdict.part} · ${verdict.state}@${verdict.device}: ${verdict.frame}${notes ? ` (${notes})` : ""}`
    }).join("; ")
  }
  return text.split("\n")[0]?.slice(0, 200) ?? ""
}

/**
 * @param {string} take
 * @param {readonly import("../client/device-frame.js").Device[]} projectDevices
 */
function systemPrompt(take, projectDevices) {
  const devices = projectDevices.map(device => `${device.id} (${device.name}, ${device.cssWidth}x${device.cssHeight} CSS px)`).join(", ")
  return `You are the design agent inside Caliper, a tool that shows a React project's UI parts at the true size of the devices it targets.

You work on take ${take}. A take is one proposed version of a part. Your edits go into the take, never into the real project; the user sees the take next to the original and accepts it or throws it away.

Terms:
- A part is a file named *.part.tsx. Its default export and its other exported components are its states: example renders with realistic data.
- The part renders the project's real components with the project's real CSS. To change how something looks, edit the component or its CSS, not the part file. Edit the part file only when the user asks about its example data or states.
- A take belongs to one editing subject and state. Its preview can be a different, product-owned composed scenario. Keep that scenario's real data flow; never substitute an isolated child fixture into it.
- The subject is the requested editing focus, not a new filesystem restriction. Your writes are fenced to your take folder; accepting shared source edits affects other states and consumers too.
- Devices: ${devices}. Every size you see is the device's CSS viewport.

Tools: read_file, list_files, edit_file and write_file work on project files as this take sees them. render shows the take in a headless browser and returns a verdict and screenshots.

How to work:
1. Call name_take with a short descriptive name for this design, unless the existing direction title already fits. Read the files you need before you change them. Keep the project's structure, naming and CSS style.
2. Make the smallest change that does what the user asked.
3. Call render after each change. It defaults to the selected preview. Before finishing, also call render with related:true to check all subject states and declared composed scenarios. Fix errors, and explain intentional Empty results or spill. Empty means nothing rendered, not automatically a defect.
4. State what you checked and what remains unverified. Screenshots do not prove interactions, fixture isolation, or undeclared consumers. Stop when the request is done and the declared checks are clean. Then write two or three short sentences: what you changed, in which files, and anything you could not do.

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
  const strange = ask.direction.strange
    ? "\nThis is the strange direction: it breaks the part's current pattern on purpose. Do not drift back to the usual pattern, and keep it a real answer that works on the device."
    : ""
  return `\n\nThis take's direction: ${ask.direction.title}. ${ask.direction.brief}${others}${strange}\nFollow this direction, even where another answer would be more obvious. If it cannot work, say why in your summary.`
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
  const source = await store.read(take, ask.part)
  const preview = ask.context ?? ask
  const contextSource = ask.context !== undefined && ask.context.part !== ask.part
    ? `\n\n<file path="${ask.context.part}">\n${await store.read(take, ask.context.part)}\n</file>` : ""
  /** @type {Array<{ type: "text", text: string } | { type: "image", data: string, mimeType: string }>} */
  const content = [{
    type: "text",
    text: `${prompt}${directionText(ask)}\n\nThe editing subject is ${ask.part}, state "${ask.state}". The preview is ${preview.part}, state "${preview.state}", on ${ask.device}.\n${ask.context ? "This is a declared composed scenario. Edit the subject while preserving the page's real composition and fixture data flow." : "The preview shows the subject in isolation."}\n\n<file path="${ask.part}">\n${source}\n</file>${contextSource}`,
  }]
  try {
    const [result] = await render({ state: preview.state, devices: [ask.device] })
    if (result !== undefined) {
      const { png, ...verdict } = result
      content.push({ type: "text", text: `How the selected preview renders now:\n${JSON.stringify(verdict, null, 2)}` })
      content.push({ type: "image", data: readFileSync(png).toString("base64"), mimeType: "image/png" })
    }
  } catch (error) {
    content.push({ type: "text", text: `Caliper could not render the part before you started: ${error instanceof Error ? error.message : String(error)}` })
  }
  return content
}
