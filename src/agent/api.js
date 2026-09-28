// @ts-check
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Check } from "typebox/value"
import { StateRefSchema } from "../scenario-contract.js"
import { discoverParts, PART_SUFFIX } from "../derive/parts.js"
import { DEVICES } from "../client/device-frame.js"
import { contextsFor, relatedStates, sameState, stateExists } from "../client/scenarios.js"
import { planRenders } from "../render/plan.js"
import { renderJobs } from "../render/render.js"
import { checkJobs } from "../render/checks.js"
import { json, MAX_BODY, MAX_FILE_BODY, readJson, refuse, validFile } from "../http.js"
import { isTakeId } from "../takes/store.js"
import { connectEngine } from "./model.js"
import { planDirections } from "./planner.js"
import { createTakeAgents } from "./take-agents.js"
import { verifyIntegration } from "./verify-integration.js"
import { skillsStatus } from "./skills.js"
import { Type } from "typebox"

/**
 * @typedef {import("node:http").IncomingMessage} IncomingMessage
 * @typedef {import("node:http").ServerResponse} ServerResponse
 * @typedef {import("../types").Project} Project
 * @typedef {import("../types").AgentStatus} AgentStatus
 * @typedef {import("../types").TakesSnapshot} TakesSnapshot
 * @typedef {import("./config.js").Connection} Connection
 * @typedef {import("../takes/store.js").TakeStore} TakeStore
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
 *   project: () => Promise<Project>,
 *   serverUrl: () => string | null,
 *   chromium: string | undefined,
 *   onChange: () => void,
 *   skills?: () => SkillCatalog,
 * }} input
 *   `skills` finds the skills each new agent, the planner and the chrome see.
 */
export function createTakesApi({ store, status, connection, project, serverUrl, chromium, onChange, skills = () => ({ skills: [], problems: [] }) }) {
  const renderDir = mkdtempSync(join(tmpdir(), "caliper-takes-"))
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
    if (connection === null) throw new Error(status._tag === "Failed" ? `${status.reason} ${status.hint}` : "The agent is off. Add agent: { model } to caliper() in vite.config.")
    return connectEngine(connection)
  }

  /** @param {string} take */
  const proposedParts = take => discoverParts(store.root, new Map(
    store.files(take).filter(file => file.endsWith(PART_SUFFIX)).map(file => [file, store.read(take, file)]),
  ))

  /** Both replacement and alternate proposals preserve their subject and context. @param {string} take */
  const validateProposedContext = take => {
    const record = /** @type {import("../takes/store.js").TakeRecord} */ (store.record(take))
    const baseline = discoverParts(store.root)
    validateTakeContext(baseline, record)
    const proposed = proposedParts(take)
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
    const viewed = take === undefined ? original : { ...original, parts: proposedParts(take) }
    const plan = planRenders(viewed, { part, state, devices, ...(take === undefined ? {} : { take }) })
    if (plan._tag === "Invalid") throw new Error(plan.reason)
    if (!chromium) throw new Error("Caliper cannot render: set CHROMIUM to a Chromium executable in the shell that starts Vite, or in .env.local.")
    const url = serverUrl()
    if (url === null) throw new Error("The dev server is not listening yet.")
    return trackRender(() => renderJobs({ url, jobs: plan.jobs, out: join(renderDir, take === undefined ? "real" : `take-${take}`), executablePath: chromium, signal: shutdown.signal }))
  }

  const agents = createTakeAgents({
    store,
    engine,
    renderFor: (take, ask) => async request => {
      const original = await project()
      validateTakeContext(original.parts, ask)
      const viewed = { ...original, parts: proposedParts(take) }
      const jobs = planTakeRenders(viewed, ask, request, take, Boolean(store.record(take)?.integration))
      if (!chromium) throw new Error("Caliper cannot render: set CHROMIUM to a Chromium executable in the shell that starts Vite, or in .env.local.")
      const url = serverUrl()
      if (url === null) throw new Error("The dev server is not listening yet.")
      const signal = request.signal ? AbortSignal.any([shutdown.signal, request.signal]) : shutdown.signal
      const input = { url, jobs, out: join(renderDir, `take-${take}`), executablePath: chromium, signal }
      return trackRender(async () => {
        signal.throwIfAborted()
        if (!request.checks) return renderJobs(input)
        const checked = await checkJobs({ ...input, project: original.name, baselines: join(store.root, ".caliper", "baselines") })
        const run = "run" in checked.report ? checked.report.run : undefined
        if (checked.results.length === 0) throw new Error(`Checks produced no complete visual results. Run: ${JSON.stringify(run)}. Report: ${checked.reportPath}`)
        return checked.results.map(result => ({ ...result, checkReport: checked.reportPath, ...(run === undefined ? {} : { checkRun: run }) }))
      })
    },
    onChange,
    skills,
  })

  /** Checks hold a take still until they finish, including follow-up and discard. */
  const checking = new Set()

  /** @param {string} take */
  const checkIntegration = async take => {
    agents.assertIdle(take)
    checking.add(take)
    onChange()
    try {
      return await agents.integration.check(take, async () => {
        validateProposedContext(take)
        const original = await project()
        const proposal = agents.integration.review(take).proposal
        if (original.parts.find(part => part.file === proposal.preview.part)?.states.some(state => state.export === proposal.preview.state)) {
          throw new Error("The alternate needs a new named state or part that opts into the new choice. Existing states must stay unchanged.")
        }
        if (!chromium) throw new Error("Set CHROMIUM before checking an integration.")
        const url = serverUrl()
        if (!url) throw new Error("The dev server is not listening yet.")
        const jobs = original.parts.flatMap(part => part.states.flatMap(state => DEVICES.map(device => ({ part: part.file, state: state.export, device: device.id }))))
        const originals = () => trackRender(() => renderJobs({ url, jobs, out: join(renderDir, `check-${take}-original`), executablePath: chromium, signal: shutdown.signal }))
        const proposed = () => trackRender(() => renderJobs({ url, jobs: jobs.map(job => ({ ...job, take })), out: join(renderDir, `check-${take}-proposed`), executablePath: chromium, signal: shutdown.signal }))
        return verifyIntegration({ originals, proposed, alternate: () => renderPart(proposal.preview.part, { state: proposal.preview.state, devices: ["*"], take }) })
      })
    } finally {
      checking.delete(take)
      onChange()
    }
  }

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
    const context = [...new Set([ask.part, ask.context?.part].filter(file => file !== undefined))].map(file => ({
      type: "text", text: `<file path="${file}">\n${readFileSync(join(store.root, file), "utf8")}\n</file>`,
    }))
    const preview = ask.context ?? ask
    try {
      const [result] = await renderPart(preview.part, { state: preview.state, devices: [ask.device] })
      if (result !== undefined) context.push({ type: "image", data: readFileSync(result.png).toString("base64"), mimeType: "image/png" })
    } catch (error) {
      context.push({ type: "text", text: `Caliper could not render the part: ${error instanceof Error ? error.message : String(error)}` })
    }
    return planDirections({ engine: connected, prompt: ask.prompt, count, part: ask.part, state: ask.state, device: ask.device, context, skills: skills(), ...(ask.context === undefined ? {} : { preview: ask.context }) })
  }

  /** @returns {TakesSnapshot} */
  const snapshot = () => ({ agent: status, skills: status._tag === "Ready" ? skillsStatus(skills()) : { skills: [], problems: [] }, takes: agents.views() })

  /**
   * @param {string} path below `/__caliper`
   * @param {IncomingMessage} request
   * @param {ServerResponse} response
   * @returns {Promise<boolean>} false when the path is not the API's
   */
  const handle = async (path, request, response) => {
    if (path === "/takes.json") {
      json(response, 200, snapshot())
      return true
    }
    if (path !== "/takes" && !path.startsWith("/takes/")) return false
    const refusal = refuse(request)
    if (refusal !== null) {
      json(response, 403, { error: refusal })
      return true
    }
    try {
      // A save to a take carries a whole file.
      const body = await readJson(request, path.endsWith("/file") ? MAX_FILE_BODY : MAX_BODY)
      shutdown.signal.throwIfAborted()
      if (path === "/takes") {
        const ask = await validAsk(body)
        json(response, 201, { take: agents.start({ ...ask, ...validDirection(body) }) })
        return true
      }
      if (path === "/takes/plan") {
        json(response, 200, await plan(body))
        return true
      }
      const [, , take = "", action = ""] = path.split("/")
      if (!isTakeId(take) || store.record(take) === null) {
        json(response, 404, { error: `Take ${take} does not exist.` })
        return true
      }
      if (checking.has(take)) throw new Error("This integration is being checked. Wait before changing it.")
      if (action === "alternate") {
        validateTakeContext(discoverParts(store.root), /** @type {import("../takes/store.js").TakeRecord} */ (store.record(take)))
        json(response, 201, { take: agents.alternate(take) })
      } else if (action === "review") {
        agents.assertIdle(take)
        json(response, 200, agents.integration.review(take))
      } else if (action === "check") {
        json(response, 200, await checkIntegration(take))
      } else if (action === "apply") {
        agents.assertIdle(take)
        if (!Check(applySchema, body)) throw new Error("Apply needs the reviewed revision and confirmation of product checks.")
        validateProposedContext(take)
        const files = agents.apply(take, body.revision, body.behaviorReviewed)
        json(response, 200, { take, files })
      } else if (action === "file") {
        const { file, content } = validFile(body)
        json(response, 200, { take, files: agents.editByHand(take, file, content) })
      } else if (action === "prompt") {
        validateTakeContext((await project()).parts, /** @type {import("../takes/store.js").TakeRecord} */ (store.record(take)))
        agents.follow(take, validPrompt(body))
        json(response, 200, { take })
      } else if (action === "stop") {
        await agents.stop(take)
        json(response, 200, { take })
      } else if (action === "accept") {
        validateProposedContext(take)
        json(response, 200, { take, files: agents.accept(take) })
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
    return { ...(await validTarget(body)), prompt }
  }

  /**
   * The part, state and device a take is about, and the composed scenario it
   * is viewed in, when there is one.
   *
   * @param {unknown} body
   */
  const validTarget = async body => {
    const { part, state, device, context } = /** @type {Record<string, unknown>} */ (body ?? {})
    const parts = (await project()).parts
    const known = parts.find(candidate => candidate.file === part)
    if (known === undefined) throw new Error(`"${part}" is not a part.`)
    const stateName = typeof state === "string" ? state : "default"
    if (!known.states.some(candidate => candidate.export === stateName)) throw new Error(`${known.file} has no state "${stateName}".`)
    const deviceId = typeof device === "string" ? device : DEVICES[0]?.id ?? ""
    if (!DEVICES.some(candidate => candidate.id === deviceId)) throw new Error(`Caliper has no device "${deviceId}".`)
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
  const editByHand = (take, file, content) => {
    if (checking.has(take)) throw new Error("This integration is being checked. Wait before changing it.")
    agents.editByHand(take, file, content)
  }

  return { handle, snapshot, close, editByHand }
}

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
  return { direction: { title, brief }, others: siblings }
}

/** @param {unknown} body */
function validPrompt(body) {
  const prompt = /** @type {Record<string, unknown>} */ (body ?? {}).prompt
  if (typeof prompt !== "string" || prompt.trim() === "") throw new Error("The prompt is empty.")
  if (prompt.length > MAX_PROMPT) throw new Error(`The prompt is longer than ${MAX_PROMPT} characters.`)
  return prompt.trim()
}

