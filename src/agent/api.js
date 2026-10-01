// @ts-check
import { NO_CHROMIUM } from "../render/chromium.js"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Check } from "typebox/value"
import { StateRefSchema } from "../scenario-contract.js"
import { discoverParts, PART_SUFFIX } from "../derive/parts.js"
import { contextsFor, relatedStates, sameState, stateExists } from "../client/scenarios.js"
import { planRenders, unknownDevice, withViewport } from "../render/plan.js"
import { renderJobs } from "../render/render.js"
import { checkJobs } from "../render/checks.js"
import { json, MAX_BODY, MAX_FILE_BODY, readJson, refuse, validFile } from "../http.js"
import { isIdea, isTakeId } from "../takes/store.js"
import { connectEngine } from "./model.js"
import { planDirections, planIdeas } from "./planner.js"
import { createTakeAgents } from "./take-agents.js"
import { verifyIntegration } from "./verify-integration.js"
import { skillsStatus } from "./skills.js"
import { MAX_IMAGES_BODY, readImages } from "./images.js"
import { MAX_IMAGES } from "../client/images.js"
import { createMarkupApi } from "./markup.js"
import { createMarkStore } from "../takes/marks.js"
import { createWorkspaceStore } from "../takes/workspaces.js"
import { createWorkspacesApi } from "./workspaces.js"
import { Type } from "typebox"

/**
 * @typedef {import("node:http").IncomingMessage} IncomingMessage
 * @typedef {import("node:http").ServerResponse} ServerResponse
 * @typedef {import("../types").Project} Project
 * @typedef {import("../types").AgentStatus} AgentStatus
 * @typedef {import("../types").TakesSnapshot} TakesSnapshot
 * @typedef {import("./config.js").Connection} Connection
 * @typedef {import("./host-types").AgentStore} TakeStore
 * @typedef {import("./skills.js").SkillCatalog} SkillCatalog
 */

const MAX_PROMPT = 8_000
/** The most takes one prompt starts. The chrome offers the same. */
const MAX_TAKES = 4
const applySchema = Type.Object({ revision: Type.String({ minLength: 1 }), behaviorReviewed: Type.Literal(true) }, { additionalProperties: false })

/**
 * The takes API on the dev server, under `/__caliper/takes`. The chrome
 * starts, prompts, stops, accepts and discards takes here, and hears about
 * every change on the event stream.
 *
 * @param {{
 *   store: TakeStore,
 *   status: AgentStatus,
 *   connection: Connection | null,
 *   project: (signal?: AbortSignal) => Promise<Project>,
 *   serverUrl: (signal?: AbortSignal) => string | null | Promise<string | null>,
 *   chromium: string | undefined,
 *   onChange: () => void,
 *   onMarks?: (draft: import("../takes/marks-contract.js").Draft) => void,
 *   skills?: () => SkillCatalog | Promise<SkillCatalog>,
 *   host?: Host,
 * }} input
 *   `skills` finds the skills each new agent, the planner and the chrome see.
 *   `onMarks` hears every new draft of marks. `host` replaces the reads of
 *   the project's disk, for the Caliper app, whose agent reaches the project
 *   only through its plugin. `setAgent` replaces the agent for every take and
 *   plan that starts after it; a running take keeps the model it started with.
 */
export function createTakesApi({ store, status: initialStatus, connection: initialConnection, project, serverUrl, chromium, onChange, onMarks = () => {}, skills = () => ({ skills: [], problems: [] }), host = {} }) {
  const discover = host.parts ?? (overrides => discoverParts(store.root, overrides))
  const readProjectFile = host.readFile ?? (file => readFileSync(join(store.root, file), "utf8"))
  const baselines = host.baselines ?? join(store.root, ".caliper", "baselines")
  const renderDir = mkdtempSync(join(tmpdir(), "caliper-takes-"))
  let status = initialStatus
  let connection = initialConnection
  const shutdown = new AbortController()
  /** @type {Set<Promise<unknown>>} */
  const rendering = new Set()
  /** @template T @param {() => Promise<T>} run @returns {Promise<T>} */
  const trackRender = async run => {
    shutdown.signal.throwIfAborted()
    const pending = run()
    rendering.add(pending)
    try { return await pending }
    finally { rendering.delete(pending) }
  }
  const engine = () => {
    if (connection === null) throw new Error(status._tag === "Failed" ? `${status.reason} ${status.hint}` : "The agent is off. Add \"agent\": { \"model\": ... } to ~/.config/caliper/config.json.")
    return connectEngine(connection)
  }

  /** @param {string} take */
  const proposedParts = async take => discover(new Map(
    await Promise.all((await store.files(take)).filter(file => file.endsWith(PART_SUFFIX)).map(async file => /** @type {[string, string]} */ ([file, await store.read(take, file)]))),
  ))

  /**
   * A take of a part. An idea belongs to its workspace's board, which has its
   * own routes; these routes refuse it.
   *
   * @param {string} take
   * @returns {Promise<import("../takes/store.js").StateTakeRecord>}
   */
  const stateTake = async take => {
    const record = await store.record(take)
    if (record === null) throw new Error(`Take ${take} does not exist.`)
    if (isIdea(record)) throw new Error(`Take ${take} is an idea of workspace ${record.subject.workspace}. Use the workspace's board for it.`)
    return record
  }

  /** Both replacement and alternate proposals preserve their subject and context. @param {string} take */
  const validateProposedContext = async take => {
    const record = await stateTake(take)
    const baseline = await discover()
    validateTakeContext(baseline, record)
    const proposed = await proposedParts(take)
    validateTakeContext(proposed, record)
    const existing = new Set(baseline.flatMap(part => part.compositionProblems ?? []))
    const problems = proposed.flatMap(part => part.compositionProblems ?? []).filter(problem => !existing.has(problem))
    if (problems.length) throw new Error(`The proposed files have invalid composition declarations:\n${problems.join("\n")}`)
  }

  /**
   * Render a part, as a take changes it or as the real files are.
   *
   * @param {string} part
   * @param {{ state: string, devices: string[], take?: string }} request
   */
  const renderPart = async (part, { state, devices, take }) => {
    const original = await project()
    const viewed = take === undefined ? original : { ...original, parts: await proposedParts(take) }
    const plan = planRenders(viewed, { part, state, devices, ...(take === undefined ? {} : { take }) })
    if (plan._tag === "Invalid") throw new Error(plan.reason)
    if (!chromium) throw new Error(`Caliper cannot render. ${NO_CHROMIUM}`)
    const url = await serverUrl()
    if (url === null) throw new Error("The dev server is not listening yet.")
    return trackRender(() => renderJobs({ url, jobs: plan.jobs, out: join(renderDir, take === undefined ? "real" : `take-${take}`), executablePath: chromium, signal: shutdown.signal }))
  }

  const workspaceStore = host.workspaces ?? createWorkspaceStore(store.root)
  const agents = createTakeAgents({
    store,
    workspaces: workspaceStore,
    ...(host.integration ? { integration: host.integration } : {}),
    engine,
    renderFor: (take, ask) => async request => {
      const signal = request.signal ? AbortSignal.any([shutdown.signal, request.signal]) : shutdown.signal
      signal.throwIfAborted()
      const original = await project(signal)
      const viewed = { ...original, parts: await proposedParts(take) }
      /** @type {import("../render/plan.js").RenderJob[]} */
      let jobs
      if (isIdea(ask)) {
        // The rows as they are now: you can pin and unpin while the idea works.
        const workspace = await workspaceStore.read(ask.subject.workspace)
        if (workspace === null) throw new Error(`Workspace ${ask.subject.workspace} does not exist.`)
        jobs = planIdeaRenders(viewed, workspace.rows, request, take)
      } else {
        validateTakeContext(original.parts, ask)
        jobs = planTakeRenders(viewed, ask, request, take, Boolean((await store.record(take))?.integration))
      }
      if (!chromium) throw new Error(`Caliper cannot render. ${NO_CHROMIUM}`)
      const url = await serverUrl(signal)
      signal.throwIfAborted()
      if (url === null) throw new Error("The dev server is not listening yet.")
      const input = { url, jobs, out: join(renderDir, `take-${take}`), executablePath: chromium, signal }
      return trackRender(async () => {
        signal.throwIfAborted()
        if (!request.checks) return renderJobs(input)
        const checked = await checkJobs({ ...input, project: original.name, baselines })
        const run = "run" in checked.report ? checked.report.run : undefined
        if (checked.results.length === 0) throw new Error(`Checks produced no complete visual results. Run: ${JSON.stringify(run)}. Report: ${checked.reportPath}`)
        return checked.results.map(result => ({ ...result, checkReport: checked.reportPath, ...(run === undefined ? {} : { checkRun: run }) }))
      })
    },
    onChange,
    skills,
    devices: async signal => (await project(signal)).devices,
  })

  const workspaces = createWorkspacesApi({
    workspaces: workspaceStore,
    agents,
    project,
    onChange,
    plan: async ({ workspace, count, device, images }) => {
      const connected = engine()
      const { parts } = await project()
      /** @type {import("./planner.js").Content[]} */
      const context = await Promise.all([...new Set(workspace.rows.map(row => row.part))].map(async file => ({
        type: /** @type {const} */ ("text"), text: `<file path="${file}">\n${await readProjectFile(file)}\n</file>`,
      })))
      context.push({ type: "text", text: `The project's parts, by file and name:\n${parts.map(part => `- ${part.file} (${part.name}, ${part.states.length} states)`).join("\n")}` })
      for (const row of workspace.rows.slice(0, MAX_TAKES)) {
        try {
          const [result] = await renderPart(row.part, { state: row.state, devices: [device] })
          if (result === undefined) continue
          context.push({ type: "text", text: `How ${row.part}, state "${row.state}", renders now:` })
          context.push({ type: "image", data: readFileSync(result.png).toString("base64"), mimeType: "image/png" })
        } catch (error) {
          context.push({ type: "text", text: `Caliper could not render ${row.part}, state "${row.state}": ${error instanceof Error ? error.message : String(error)}` })
        }
      }
      return planIdeas({ engine: connected, question: workspace.question, count, rows: workspace.rows, device, context, images, skills: await skills() })
    },
  })

  const markup = createMarkupApi({
    store,
    marks: host.marks ?? createMarkStore(store.root),
    agents,
    project,
    validateTake: validateTakeContext,
    render: async requested => {
      const viewed = await project()
      const jobs = requested.map(job => withViewport(viewed, job))
      if (!chromium) throw new Error(`Caliper cannot draw marks on a render. ${NO_CHROMIUM}`)
      const url = await serverUrl()
      if (url === null) throw new Error("The dev server is not listening yet.")
      return trackRender(() => renderJobs({ url, jobs, out: join(renderDir, `marks-${Date.now()}`), executablePath: chromium, signal: shutdown.signal }))
    },
    onDraft: onMarks,
    agentProblem: () => connection === null ? (status._tag === "Failed" ? `${status.reason} ${status.hint}` : "The agent is off. Add \"agent\": { \"model\": ... } to ~/.config/caliper/config.json.") : null,
  })

  /** Checks hold a take still until they finish, including follow-up and discard. */
  const checking = new Set()

  /** @param {string} take */
  const checkIntegration = async take => agents.whileIdle(take, async () => {
    checking.add(take)
    onChange()
    try {
      return await agents.integration.check(take, async () => {
        await validateProposedContext(take)
        const original = await project()
        const proposal = (await agents.integration.review(take)).proposal
        if (original.parts.find(part => part.file === proposal.preview.part)?.states.some(state => state.export === proposal.preview.state)) {
          throw new Error("The alternate needs a new named state or part that opts into the new choice. Existing states must stay unchanged.")
        }
        if (!chromium) throw new Error(`Caliper cannot check an integration. ${NO_CHROMIUM}`)
        const url = await serverUrl()
        if (!url) throw new Error("The dev server is not listening yet.")
        const jobs = original.parts.flatMap(part => part.states.flatMap(state => original.devices.map(device => withViewport(original, { part: part.file, state: state.export, device: device.id }))))
        const originals = () => trackRender(() => renderJobs({ url, jobs, out: join(renderDir, `check-${take}-original`), executablePath: chromium, signal: shutdown.signal }))
        const proposed = () => trackRender(() => renderJobs({ url, jobs: jobs.map(job => ({ ...job, take })), out: join(renderDir, `check-${take}-proposed`), executablePath: chromium, signal: shutdown.signal }))
        return verifyIntegration({ originals, proposed, alternate: () => renderPart(proposal.preview.part, { state: proposal.preview.state, devices: ["*"], take }) })
      })
    } finally {
      checking.delete(take)
      onChange()
    }
  })

  /**
   * Ask the planner for different directions for one prompt. It sees the
   * part's source and how the real part renders now.
   *
   * @param {unknown} body
   * @returns {Promise<import("../types").TakePlan>}
   */
  const plan = async body => {
    const ask = await validAsk(body)
    const count = /** @type {Record<string, unknown>} */ (body ?? {}).count
    if (typeof count !== "number" || !Number.isInteger(count) || count < 2 || count > MAX_TAKES) {
      throw new Error(`Ask the planner for 2 to ${MAX_TAKES} directions.`)
    }
    const connected = engine()
    /** @type {import("./planner.js").Content[]} */
    const context = await Promise.all([...new Set([ask.part, ask.context?.part].filter(file => file !== undefined))].map(async file => ({
      type: /** @type {const} */ ("text"), text: `<file path="${file}">\n${await readProjectFile(file)}\n</file>`,
    })))
    const preview = ask.context ?? ask
    try {
      const [result] = await renderPart(preview.part, { state: preview.state, devices: [ask.device] })
      if (result !== undefined) context.push({ type: "image", data: readFileSync(result.png).toString("base64"), mimeType: "image/png" })
    } catch (error) {
      context.push({ type: "text", text: `Caliper could not render the part: ${error instanceof Error ? error.message : String(error)}` })
    }
    return planDirections({ engine: connected, prompt: ask.prompt, count, part: ask.part, state: ask.state, device: ask.device, context, images: ask.images, skills: await skills(), ...(ask.context === undefined ? {} : { preview: ask.context }) })
  }

  /** @returns {Promise<TakesSnapshot>} */
  const snapshot = async () => (store.batch ?? (read => read()))(async () => ({
    agent: status, skills: status._tag === "Ready" ? skillsStatus(await skills()) : { skills: [], problems: [] },
    takes: await agents.views(), accepted: await store.accepted(), workspaces: await workspaces.views(),
  }))

  /**
   * @param {string} path below `/__caliper`
   * @param {IncomingMessage} request
   * @param {ServerResponse} response
   * @returns {Promise<boolean>} false when the path is not the API's
   */
  const handle = async (path, request, response) => {
    if (await markup.handle(path, request, response)) return true
    if (await workspaces.handle(path, request, response)) return true
    if (path === "/takes.json") {
      json(response, 200, await snapshot())
      return true
    }
    if (path !== "/takes" && !path.startsWith("/takes/")) return false
    const shown = /^\/takes\/([^/]+)\/images\/([^/]+)$/.exec(path)
    if (shown !== null && request.method === "GET") {
      await serveImage(shown[1] ?? "", shown[2] ?? "", response)
      return true
    }
    const refusal = refuse(request)
    if (refusal !== null) {
      json(response, 403, { error: refusal })
      return true
    }
    try {
      // A save to a take carries a whole file; a prompt can carry images.
      const carriesImages = path === "/takes" || path === "/takes/plan" || path.endsWith("/prompt")
      const body = await readJson(request, path.endsWith("/file") ? MAX_FILE_BODY : carriesImages ? MAX_IMAGES_BODY : MAX_BODY)
      shutdown.signal.throwIfAborted()
      if (path === "/takes") {
        const ask = await validAsk(body)
        json(response, 201, { take: await agents.start({ ...ask, ...validDirection(body) }) })
        return true
      }
      if (path === "/takes/plan") {
        json(response, 200, await plan(body))
        return true
      }
      const [, , take = "", action = ""] = path.split("/")
      if (isTakeId(take) && action === "stop") await agents.stop(take)
      const record = isTakeId(take) ? await store.record(take) : null
      if (record === null) {
        json(response, 404, { error: `Take ${take} does not exist.` })
        return true
      }
      if (isIdea(record)) {
        json(response, 409, { error: `Take ${take} is an idea of workspace ${record.subject.workspace}. Use the workspace's board for it.` })
        return true
      }
      if (checking.has(take)) throw new Error("This integration is being checked. Wait before changing it.")
      if (action === "alternate") {
        validateTakeContext(await discover(), await stateTake(take))
        json(response, 201, { take: await agents.alternate(take) })
      } else if (action === "review") {
        agents.assertIdle(take)
        json(response, 200, await agents.integration.review(take))
      } else if (action === "check") {
        json(response, 200, await checkIntegration(take))
      } else if (action === "apply") {
        agents.assertIdle(take)
        if (!Check(applySchema, body)) throw new Error("Apply needs the reviewed revision and confirmation of product checks.")
        await validateProposedContext(take)
        const files = await agents.apply(take, body.revision, body.behaviorReviewed)
        json(response, 200, { take, files })
      } else if (action === "file") {
        const { file, content } = validFile(body)
        json(response, 200, { take, files: await agents.editByHand(take, file, content) })
      } else if (action === "prompt") {
        validateTakeContext((await project()).parts, await stateTake(take))
        await agents.follow(take, validPrompt(body), readImages(body))
        json(response, 200, { take })
      } else if (action === "stop") {
        await agents.stop(take)
        json(response, 200, { take })
      } else if (action === "accept") {
        await validateProposedContext(take)
        json(response, 200, { take, files: await agents.accept(take) })
      } else if (action === "discard") {
        await agents.discard(take)
        json(response, 200, { take })
      } else {
        json(response, 404, { error: `Takes have no action "${action}".` })
      }
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }

  /** @param {unknown} body */
  const validAsk = async body => {
    const prompt = validPrompt(body)
    const target = await validTarget(body)
    const images = readImages(body)
    const marked = await markup.promptMarks(/** @type {Record<string, unknown>} */ (body ?? {}).marks, target)
    if (images.length + marked.images.length > MAX_IMAGES) throw new Error(`A prompt can carry at most ${MAX_IMAGES} images, and the marks on the original add one.`)
    return { ...target, prompt: `${prompt}${marked.text}`, images: [...images, ...marked.images] }
  }

  /**
   * Send one image of a take. Take numbers are reused after a discard, so the
   * browser must not keep a copy.
   *
   * @param {string} take
   * @param {string} file
   * @param {ServerResponse} response
   */
  const serveImage = async (take, file, response) => {
    const kept = isTakeId(take) ? await store.image(take, file) : null
    if (kept === null) {
      json(response, 404, { error: `Take ${take} has no image "${file}".` })
      return
    }
    response.writeHead(200, {
      "content-type": kept.image.mimeType,
      "content-length": String(kept.bytes.length),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    })
    response.end(kept.bytes)
  }

  /**
   * The part, state and device a take is about, and the composed scenario it
   * is viewed in, when there is one.
   *
   * @param {unknown} body
   */
  const validTarget = async body => {
    const { part, state, device, context } = /** @type {Record<string, unknown>} */ (body ?? {})
    const viewed = await project()
    const parts = viewed.parts
    const known = parts.find(candidate => candidate.file === part)
    if (known === undefined) throw new Error(`"${part}" is not a part.`)
    const stateName = typeof state === "string" ? state : "default"
    if (!known.states.some(candidate => candidate.export === stateName)) throw new Error(`${known.file} has no state "${stateName}".`)
    const deviceId = typeof device === "string" ? device : viewed.devices[0]?.id ?? ""
    if (!viewed.devices.some(candidate => candidate.id === deviceId)) throw new Error(unknownDevice(viewed, deviceId))
    const target = { part: known.file, state: stateName, device: deviceId, ...(context === undefined ? {} : { context: readContext(context) }) }
    validateTakeContext(parts, target)
    return target
  }

  // Vite must await this before declaring shutdown complete.
  const close = async () => {
    shutdown.abort(new Error("The Vite server is closing."))
    await Promise.all([agents.close(), Promise.allSettled([...rendering])])
  }

  /**
   * Save a take's copy of a file as an edit by hand, as the code pane does. A
   * knob in a take's frame writes here, so the agent's next prompt names it.
   *
   * @param {string} take
   * @param {string} file
   * @param {string} content
   */
  const editByHand = async (take, file, content) => {
    assertEditable(take)
    await agents.editByHand(take, file, content)
  }

  /** Refuse an edit by hand while the take's agent works or its integration is checked. @param {string} take */
  const assertEditable = take => {
    if (checking.has(take)) throw new Error("This integration is being checked. Wait before changing it.")
    agents.assertIdle(take)
  }

  /** @param {AgentStatus} nextStatus @param {Connection | null} nextConnection */
  const setAgent = (nextStatus, nextConnection) => {
    status = nextStatus
    connection = nextConnection
    onChange()
  }

  return { handle, snapshot, marks: markup.draft, close, editByHand, assertEditable, noteHandEdit: agents.noteHandEdit, setAgent }
}

/**
 * @typedef {{
 *   parts?: (overrides?: Map<string, string>) => import("../types").Part[] | Promise<import("../types").Part[]>,
 *   readFile?: (file: string) => string | Promise<string>,
 *   marks?: import("./host-types").AgentMarks,
 *   workspaces?: import("./host-types").AgentWorkspaces,
 *   integration?: import("./host-types").AgentIntegration,
 *   baselines?: string,
 * }} Host
 */

/**
 * Validate a persisted or requested subject and its composed preview against the current project.
 * A missing relationship must never turn a composed review into an isolated one.
 *
 * @param {readonly import("../types").Part[]} parts
 * @param {import("../types").StateRef & { context?: import("../types").StateRef }} ask
 */
export function validateTakeContext(parts, ask) {
  if (!stateExists(parts, ask)) throw new Error(`The take's subject ${ask.part} · ${ask.state} no longer exists.`)
  if (ask.context === undefined) return
  const context = readContext(ask.context)
  if (!stateExists(parts, context)) throw new Error(`The preview scenario ${context.part} · ${context.state} no longer exists.`)
  if (!contextsFor(parts, ask).some(candidate => sameState(candidate, context))) {
    throw new Error(`${context.part} · ${context.state} is not a declared context for ${ask.part} · ${ask.state}. Choose a declared preview scenario.`)
  }
}

/** @param {unknown} raw @returns {import("../types").StateRef} */
function readContext(raw) {
  if (!Check(StateRefSchema, raw)) {
    throw new Error("A preview context needs a part path and a state export, with no extra fields.")
  }
  return { part: raw.part, state: raw.state }
}

/**
 * Regular takes render only the subject's own states and declared composed scenarios.
 * Integrations can explicitly render new alternate states and parts. Their default remains
 * the selected composed preview, and related checks still use the declared scenario graph.
 *
 * @param {Project} project
 * @param {import("../types").StateRef & { context?: import("../types").StateRef }} ask
 * @param {Parameters<import("./tools.js").RenderTake>[0]} request
 * @param {string} take
 * @param {boolean} [integration] Whether this is a separately prepared alternate proposal.
 * @returns {import("../render/plan.js").RenderJob[]}
 */
export function planTakeRenders(project, ask, request, take, integration = false) {
  validateTakeContext(project.parts, ask)
  const allowed = relatedStates(project.parts, ask)
  if (request.related && request.part !== undefined) throw new Error("Use related without a part override to check all declared scenarios.")
  const preview = ask.context ?? ask
  const part = request.part ?? preview.part
  if (integration && !request.related) {
    const plan = planRenders(project, { part, state: request.state, devices: request.devices, take })
    if (plan._tag === "Invalid") throw new Error(plan.reason)
    return plan.jobs
  }
  const targets = request.related ? allowed
    : request.state === "*" ? allowed.filter(ref => ref.part === part)
      : [{ part, state: request.state }]
  if (targets.length === 0) throw new Error(`No declared states of ${part} are related to this take.`)
  /** @type {Map<string, import("../render/plan.js").RenderJob>} */
  const jobs = new Map()
  for (const target of targets) {
    if (!allowed.some(candidate => sameState(candidate, target))) {
      throw new Error(`${target.part} · ${target.state} is not the take's subject or a declared related scenario.`)
    }
    const plan = planRenders(project, { ...target, devices: request.devices, take })
    if (plan._tag === "Invalid") throw new Error(plan.reason)
    for (const job of plan.jobs) jobs.set(JSON.stringify([job.part, job.state, job.device]), job)
  }
  return [...jobs.values()]
}

/**
 * What an idea of a workspace renders (decision 45). `related` renders every
 * row of the board, once each. Otherwise the idea renders the part and state
 * it names, or the first row: any state its own files declare, including a
 * part the idea adds, because a workspace is a scratch area. A row whose
 * state is gone is an error that names it.
 *
 * @param {Project} project the project as the idea's files declare it
 * @param {readonly import("../types").StateRef[]} rows the board's rows
 * @param {Parameters<import("./tools.js").RenderTake>[0]} request
 * @param {string} take
 * @returns {import("../render/plan.js").RenderJob[]}
 */
export function planIdeaRenders(project, rows, request, take) {
  const targets = request.related ? rows
    : [{ part: request.part ?? rows[0]?.part ?? "", state: request.state }]
  if (targets.length === 0 || targets[0]?.part === "") throw new Error("The board has no rows yet. Name a part to render.")
  return targets.flatMap(target => {
    const plan = planRenders(project, { part: target.part, state: target.state, devices: request.devices, take })
    if (plan._tag === "Invalid") throw new Error(plan.reason)
    return plan.jobs
  })
}

/**
 * The direction a new take follows, and the titles its siblings follow, when
 * the chrome started it from a plan.
 *
 * @param {unknown} body
 * @returns {{ direction?: import("../types").Direction, others?: string[] }}
 */
function validDirection(body) {
  const { direction, others } = /** @type {Record<string, any>} */ (body ?? {})
  if (direction === undefined) return {}
  const title = typeof direction?.title === "string" ? direction.title.trim() : ""
  const brief = typeof direction?.brief === "string" ? direction.brief.trim() : ""
  if (title === "" || brief === "") throw new Error("A direction needs a title and a brief.")
  if (title.length > 80 || brief.length > MAX_PROMPT) throw new Error("The direction is too long.")
  const siblings = Array.isArray(others) ? others.filter(other => typeof other === "string" && other.trim() !== "").map(other => other.trim().slice(0, 80)).slice(0, MAX_TAKES) : []
  return { direction: direction.strange === true ? { title, brief, strange: true } : { title, brief }, others: siblings }
}

/** @param {unknown} body */
function validPrompt(body) {
  const prompt = /** @type {Record<string, unknown>} */ (body ?? {}).prompt
  if (typeof prompt !== "string" || prompt.trim() === "") throw new Error("The prompt is empty.")
  if (prompt.length > MAX_PROMPT) throw new Error(`The prompt is longer than ${MAX_PROMPT} characters.`)
  return prompt.trim()
}

