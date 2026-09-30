// @ts-check
// A project's take store, marks, integration, parts and skills, as the agent
// in the Caliper app sees them. Every call goes to the project's plugin
// (`POST /__caliper/host`), which runs it against its own disk and fence.
import { StaleDraft } from "../takes/marks.js"
import { decode, encode, HOST_METHODS } from "../host/wire.js"

/**
 * @typedef {import("../takes/store.js").TakeStore} TakeStore
 * @typedef {import("../takes/marks.js").MarkStore} MarkStore
 * @typedef {import("../agent/skills.js").SkillCatalog} SkillCatalog
 * @typedef {(target: string, method: string, args: unknown) => import("./sync-call.js").ReplyMessage} Call
 */

/**
 * @param {{ call: Call, root: string }} input
 *   `call` blocks until the plugin answers. `root` is the project's root, shown
 *   in messages; the agent never reads it.
 */
export function remoteHost({ call, root }) {
  /** @param {string} target @param {string} method @param {unknown[]} args */
  const invoke = (target, method, args) => {
    const reply = call(target, method, encode(args))
    if (reply.error !== undefined) {
      if (reply.name === "StaleDraft") throw new StaleDraft(decode(reply.draft))
      throw new Error(reply.error)
    }
    return decode(reply.value)
  }
  /** @param {keyof typeof HOST_METHODS} target */
  const proxy = target => Object.fromEntries(HOST_METHODS[target].map(method => [method, (/** @type {unknown[]} */ ...args) => invoke(target, method, args)]))

  const calls = proxy("store")
  /** @type {{ takes: Array<{ take: string, record: unknown, files: string[] }>, accepted: unknown } | null} */
  let overview = null
  const store = /** @type {TakeStore & { batch: <T>(read: () => T) => T }} */ ({
    ...calls,
    root,
    list: () => overview ? overview.takes.map(entry => entry.take) : calls.list?.(),
    record: (/** @type {string} */ take) => overview ? overview.takes.find(entry => entry.take === take)?.record ?? null : calls.record?.(take),
    files: (/** @type {string} */ take) => overview?.takes.some(entry => entry.take === take) ? overview.takes.find(entry => entry.take === take)?.files : calls.files?.(take),
    accepted: () => overview ? overview.accepted : calls.accepted?.(),
    /**
     * Read the takes' list, records and files in one call while `read` runs.
     * A snapshot of the takes then costs one request, not three per take.
     */
    batch: read => {
      if (overview !== null) return read()
      overview = /** @type {any} */ (calls.overview?.())
      try { return read() } finally { overview = null }
    },
  })

  const marks = /** @type {MarkStore} */ (/** @type {unknown} */ (proxy("marks")))
  const integrationCalls = proxy("integration")
  const integration = /** @type {ReturnType<typeof import("../takes/integration.js").createIntegrationReview>} */ (/** @type {unknown} */ ({
    ...integrationCalls,
    /** The verifier runs here; the plugin holds the take while it runs. @param {string} take @param {() => Promise<string>} verify */
    check: async (take, verify) => {
      const revision = integrationCalls.beginCheck?.(take)
      /** @type {{ summary: unknown } | { error: string }} */
      let outcome
      try { outcome = { summary: await verify() } } catch (error) { outcome = { error: error instanceof Error ? error.message : String(error) } }
      return integrationCalls.finishCheck?.(take, revision, outcome)
    },
  }))

  /** @param {Map<string, string>} [overrides] */
  const parts = overrides => /** @type {import("../types").Part[]} */ (invoke("parts", "discover", [overrides ? [...overrides] : []]))

  /** @param {string} file */
  const readFile = file => {
    const content = store.original(file)
    if (content === null) throw new Error(`${file} does not exist in the project.`)
    return content
  }

  /** The project's skills, whose files the plugin reads. @returns {SkillCatalog} */
  const projectSkills = () => {
    const listed = /** @type {{ skills: Array<{ name: string, description: string, scope: "project", location: string, modelInvocable: boolean }>, problems: string[] }} */ (invoke("skills", "list", []))
    return {
      problems: listed.problems,
      skills: listed.skills.map(skill => ({
        ...skill, file: "", dir: "",
        remote: {
          content: () => /** @type {string} */ (invoke("skills", "content", [skill.name])),
          read: (/** @type {string} */ path) => /** @type {string} */ (invoke("skills", "read", [skill.name, path])),
        },
      })),
    }
  }

  return { store, marks, integration, parts, readFile, projectSkills }
}
