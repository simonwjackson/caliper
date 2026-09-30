// @ts-check
// The plugin's side of the central app's agent (decision 37). The agent runs
// in the central app and reaches this project only through `POST
// /__caliper/host`. Every call runs here, against this project's own take
// store, marks and parts, so the store's fence decides what the agent can
// read and write.
import { discoverParts } from "../derive/parts.js"
import { discoverProjectSkills, readSkillFile, skillText } from "../agent/skills.js"
import { json, readJson } from "../http.js"
import { MAX_IMAGES_BODY } from "../agent/images.js"
import { decode, encode, HOST_METHODS } from "./wire.js"

/**
 * @typedef {import("../takes/store.js").TakeStore} TakeStore
 * @typedef {import("../takes/marks.js").MarkStore} MarkStore
 * @typedef {ReturnType<typeof import("../takes/integration.js").createIntegrationReview>} IntegrationReview
 */

/**
 * @param {{ store: TakeStore, marks: MarkStore, integration: IntegrationReview, root: string, home: string }} input
 */
export function createHostApi({ store, marks, integration, root, home }) {
  const skillCatalog = () => discoverProjectSkills({ root, home })
  /** @param {string} name */
  const skill = name => {
    const found = skillCatalog().skills.find(candidate => candidate.name === name)
    if (found === undefined) throw new Error(`The project has no skill named "${name}".`)
    return found
  }

  /** @type {Record<keyof typeof HOST_METHODS, any>} */
  const targets = {
    store: {
      ...store,
      /** The takes, their records and files, in one call, for a snapshot of the takes. */
      overview: () => ({
        takes: store.list().map(take => ({ take, record: store.record(take), files: store.record(take) === null ? [] : store.files(take) })),
        accepted: store.accepted(),
      }),
    },
    marks: /** @type {any} */ (marks),
    integration: /** @type {any} */ (integration),
    parts: {
      /** @param {Array<[string, string]>} [overrides] take copies of part files */
      discover: overrides => discoverParts(root, new Map(overrides ?? [])),
    },
    skills: {
      list: () => {
        const catalog = skillCatalog()
        return { skills: catalog.skills.map(({ name, description, scope, location, modelInvocable }) => ({ name, description, scope, location, modelInvocable })), problems: catalog.problems }
      },
      /** @param {string} name */
      content: name => skillText(skill(name)),
      /** @param {string} name @param {string} path */
      read: (name, path) => readSkillFile(skill(name), path),
    },
  }

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  const handle = async (request, response) => {
    /** @type {any} */
    let body
    try { body = await readJson(request, MAX_IMAGES_BODY) }
    catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : String(error) }) }
    const { target, method, args } = body ?? {}
    const allowed = /** @type {Record<string, readonly string[]>} */ (HOST_METHODS)[target]
    if (allowed === undefined || typeof method !== "string" || !allowed.includes(method) || !Array.isArray(args)) {
      return json(response, 400, { error: `The host has no call ${String(target)}.${String(method)}.` })
    }
    const call = /** @type {Record<string, Record<string, (...args: unknown[]) => unknown>>} */ (targets)[target]?.[method]
    if (typeof call !== "function") return json(response, 400, { error: `The host has no call ${target}.${method}.` })
    try {
      const value = await call(...decode(args))
      json(response, 200, { value: encode(value === undefined ? null : value) })
    } catch (error) {
      const failure = /** @type {Error & { draft?: unknown }} */ (error)
      json(response, 200, { error: failure instanceof Error ? failure.message : String(failure), name: failure?.name, ...(failure?.draft === undefined ? {} : { draft: encode(failure.draft) }) })
    }
  }

  return { handle }
}
