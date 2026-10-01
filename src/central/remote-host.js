// @ts-check
// The agent awaits plugin calls; only the plugin reads disk and applies its fence.
import { AsyncLocalStorage } from "node:async_hooks"
import { StaleDraft } from "../takes/marks.js"
import { decode, encode, HOST_METHODS } from "../host/wire.js"

/** @typedef {import("../agent/host-types").AgentStore} AgentStore */
/** @typedef {import("../agent/host-types").AgentMarks} AgentMarks */
/** @typedef {import("../agent/host-types").AgentIntegration} AgentIntegration */
/** @typedef {import("../agent/skills.js").SkillCatalog} SkillCatalog */
/** @typedef {(target: string, method: string, args: unknown, signal?: AbortSignal) => Promise<import("./host-call.js").ReplyMessage>} Call */
/** @typedef {{ takes: Array<{ take: string, record: import("../takes/store.js").TakeRecord | null, files: string[] }>, accepted: import("../takes/store.js").AcceptRecord[] }} Overview */

/** @param {{ call: Call, root: string }} input */
export function remoteHost({ call, root }) {
  /** Each concurrent snapshot or agent run owns its cache and cancellation. */
  /** @type {AsyncLocalStorage<{ overview?: Overview, signal?: AbortSignal }>} */
  const scope = new AsyncLocalStorage()
  /** @param {string} target @param {string} method @param {unknown[]} args */
  const invoke = async (target, method, args) => {
    const signal = scope.getStore()?.signal
    signal?.throwIfAborted()
    const reply = await call(target, method, encode(args), signal)
    signal?.throwIfAborted()
    if (reply.error !== undefined) {
      if (reply.name === "StaleDraft") throw new StaleDraft(decode(reply.draft))
      throw new Error(reply.error)
    }
    return decode(reply.value)
  }
  /** @param {keyof typeof HOST_METHODS} target */
  const proxy = target => Object.fromEntries(HOST_METHODS[target].map(method => [method, (/** @type {unknown[]} */ ...args) => invoke(target, method, args)]))

  const calls = proxy("store")
  const overview = () => scope.getStore()?.overview
  const store = /** @type {AgentStore & { batch: <T>(read: () => Promise<T>) => Promise<T>, withSignal: <T>(signal: AbortSignal, run: () => Promise<T>) => Promise<T> }} */ ({
    ...calls,
    root,
    list: async () => { const cached = overview(); return cached ? cached.takes.map(entry => entry.take) : calls.list?.() },
    record: async (/** @type {string} */ take) => { const cached = overview(); return cached ? cached.takes.find(entry => entry.take === take)?.record ?? null : calls.record?.(take) },
    files: async (/** @type {string} */ take) => { const cached = overview(); return cached ? cached.takes.find(entry => entry.take === take)?.files ?? [] : calls.files?.(take) },
    accepted: async () => { const cached = overview(); return cached ? cached.accepted : calls.accepted?.() },
    // AsyncLocalStorage prevents overlapping reads from sharing or clearing a cache.
    batch: async read => {
      if (overview()) return read()
      const cached = /** @type {Overview} */ (await calls.overview?.())
      return scope.run({ ...scope.getStore(), overview: cached }, read)
    },
    withSignal: (signal, run) => scope.run({ signal }, run),
  })

  const marks = /** @type {AgentMarks} */ (/** @type {unknown} */ (proxy("marks")))
  const workspaces = /** @type {import("../agent/host-types").AgentWorkspaces} */ (/** @type {unknown} */ ({ ...proxy("workspaces"), root }))
  const integrationCalls = proxy("integration")
  const integration = /** @type {AgentIntegration} */ (/** @type {unknown} */ ({
    ...integrationCalls,
    /** The plugin holds the take while the app verifies. @param {string} take @param {() => Promise<string>} verify */
    check: async (take, verify) => {
      const revision = await integrationCalls.beginCheck?.(take)
      /** @type {{ summary: unknown } | { error: string }} */
      let outcome
      try { outcome = { summary: await verify() } } catch (error) { outcome = { error: error instanceof Error ? error.message : String(error) } }
      return integrationCalls.finishCheck?.(take, revision, outcome)
    },
  }))

  /** @param {Map<string, string>} [overrides] */
  const parts = async overrides => /** @type {import("../types").Part[]} */ (await invoke("parts", "discover", [overrides ? [...overrides] : []]))
  /** @param {string} file */
  const readFile = async file => {
    const content = await store.original(file)
    if (content === null) throw new Error(`${file} does not exist in the project.`)
    return content
  }
  /** @returns {Promise<SkillCatalog>} */
  const projectSkills = async () => {
    const listed = /** @type {{ skills: Array<{ name: string, description: string, scope: "project", location: string, modelInvocable: boolean }>, problems: string[] }} */ (await invoke("skills", "list", []))
    return {
      problems: listed.problems,
      skills: listed.skills.map(skill => ({
        ...skill, file: "", dir: "",
        remote: {
          content: async () => /** @type {string} */ (await invoke("skills", "content", [skill.name])),
          read: async (/** @type {string} */ path) => /** @type {string} */ (await invoke("skills", "read", [skill.name, path])),
        },
      })),
    }
  }
  return { store, marks, integration, workspaces, parts, readFile, projectSkills }
}
