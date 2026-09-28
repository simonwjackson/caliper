// @ts-check
import { existsSync, lstatSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, sep } from "node:path"
import { Check, Errors } from "typebox/value"
import { json, MAX_BODY, MAX_FILE_BODY, readJson, refuse } from "../http.js"
import { blankImports, takeOf } from "../takes/overlay.js"
import { fenceProjectPath } from "../takes/store.js"
import { editSource, valueProblem, versionOf } from "./edit.js"
import { locateDeclarations } from "./locate.js"
import { KnobOptionsSchema, LocateRequestSchema, WriteRequestSchema } from "./contract.js"

/**
 * The knobs API, under `/__caliper/knobs` (decisions 23 and 26).
 *
 *   POST /knobs/locate { sheet, take, css, rules, targets }
 *     where each declaration a knob shows lives in its source file
 *   POST /knobs/write { file, take, version, start, end, expected, value }
 *     replace one value, once, when you release the knob
 *
 * A located declaration carries the version of the file it was found in. A
 * write names that version, so a file that changed since gets no write: its
 * offsets may have moved. In a take's frame both read and write the take's
 * copy; the real file does not change until Replace.
 *
 * @typedef {import("node:http").IncomingMessage} IncomingMessage
 * @typedef {import("node:http").ServerResponse} ServerResponse
 * @typedef {import("../takes/store.js").TakeStore} TakeStore
 * @typedef {import("../types").KnobHints} KnobHints
 * @typedef {import("../types").KnobSource} KnobSource
 */

/**
 * @param {{
 *   store: TakeStore,
 *   writeTake: (take: string, file: string, content: string) => void,
 *   options?: unknown,
 * }} input `writeTake` saves a take's copy as an edit by hand; `options` is `caliper({ knobs })`
 */
export function createKnobsApi({ store, writeTake, options }) {
  const configured = configuredHints(options)

  /** @param {unknown} body */
  const locate = body => {
    if (!Check(LocateRequestSchema, body)) throw new Error(`The locate request is not valid: ${firstError(LocateRequestSchema, body)}`)
    const sheetTake = takeOf(body.sheet)
    if (sheetTake !== body.take) {
      throw new Error(sheetTake === null ? `This stylesheet belongs to the real files, not to take ${body.take}.` : `This stylesheet belongs to take ${sheetTake}, not to the real files.`)
    }
    if (body.take !== null && store.record(body.take) === null) throw new Error(`Take ${body.take} does not exist. It may have been accepted or discarded.`)
    const from = body.sheet.split("?")[0] ?? body.sheet
    const found = locateDeclarations({ css: body.css, from, rules: body.rules, targets: body.targets })
    /** @type {Map<string, string | null>} */
    const current = new Map()
    /** @type {KnobSource[]} */
    const results = found.map(result => {
      if (result._tag === "Refused") return result
      const inside = projectFile(store.root, result.file)
      if (inside._tag === "Outside") return { _tag: "Refused", reason: inside.reason }
      if (!current.has(inside.file)) current.set(inside.file, readVariant(store, body.take, inside.file))
      const text = current.get(inside.file)
      // A take's frame loads a flattened global stylesheet with its @imports
      // blanked to comments of the same length, so offsets still match.
      const served = text !== null && text !== undefined && body.take !== null && text !== result.source
        ? blankImports(store.root, join(store.root, inside.file), text, body.take)
        : text
      if (text === null || text === undefined || served !== result.source) {
        return { _tag: "Refused", reason: `${inside.file} changed after the frame loaded it. Caliper waits for the frame to reload.` }
      }
      return {
        _tag: "Located",
        file: inside.file,
        start: result.start,
        end: result.end,
        line: text.slice(0, result.start).split("\n").length,
        value: result.value,
        version: versionOf(text),
        hints: result.hints.hints,
        note: result.hints.note,
        problems: result.hints.problems,
      }
    })
    const properties = new Set(body.targets.map(target => target.property))
    const hints = Object.fromEntries([...properties].flatMap(property => (configured.hints[property] ? [[property, configured.hints[property]]] : [])))
    return { results, configured: hints, problems: configured.problems }
  }

  /** @param {unknown} body */
  const write = body => {
    if (!Check(WriteRequestSchema, body)) throw new Error(`The write request is not valid: ${firstError(WriteRequestSchema, body)}`)
    const problem = valueProblem(body.value)
    if (problem !== null) throw new Error(problem)
    const fenced = fenceProjectPath(store.root, body.file)
    if (fenced._tag === "Outside") throw new Error(fenced.reason)
    if (body.take !== null && store.record(body.take) === null) throw new Error(`Take ${body.take} does not exist. It may have been accepted or discarded.`)
    const text = readVariant(store, body.take, fenced.file)
    if (text === null) throw new Error(`"${fenced.file}" is not a file.`)
    const edited = editSource(text, body)
    if (edited._tag === "Conflict") return edited
    if (body.take === null) {
      const target = join(store.root, fenced.file)
      if (!existsSync(target) || lstatSync(target).isDirectory()) throw new Error(`"${fenced.file}" is not a file.`)
      writeFileSync(target, edited.text)
    } else {
      writeTake(body.take, fenced.file, edited.text)
    }
    return { _tag: "Written", file: fenced.file, version: versionOf(edited.text) }
  }

  /**
   * @param {string} path below `/__caliper`
   * @param {IncomingMessage} request
   * @param {ServerResponse} response
   * @returns {Promise<boolean>} false when the path is not the API's
   */
  const handle = async (path, request, response) => {
    if (path !== "/knobs/locate" && path !== "/knobs/write") return false
    const refusal = refuse(request)
    if (refusal !== null) {
      json(response, 403, { error: refusal })
      return true
    }
    try {
      // A locate request carries a whole stylesheet.
      const body = await readJson(request, path === "/knobs/locate" ? MAX_FILE_BODY : MAX_BODY)
      if (path === "/knobs/locate") {
        json(response, 200, locate(body))
      } else {
        const result = write(body)
        json(response, result._tag === "Conflict" ? 409 : 200, result)
      }
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }

  return { handle }
}

/**
 * A file as the frame's variant sees it: the take's copy, or the real file.
 *
 * @param {TakeStore} store
 * @param {string | null} take
 * @param {string} file root-relative
 */
function readVariant(store, take, file) {
  try {
    return take === null ? store.original(file) : store.read(take, file)
  } catch {
    return null
  }
}

/**
 * A located source file, as a project file a knob may write.
 *
 * @param {string} root
 * @param {string} absolute
 * @returns {{ _tag: "Inside", file: string } | { _tag: "Outside", reason: string }}
 */
function projectFile(root, absolute) {
  const inside = relative(root, absolute)
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return { _tag: "Outside", reason: `${absolute} is outside the project, so a knob cannot change it.` }
  const fenced = fenceProjectPath(root, inside.split(sep).join("/"))
  return fenced._tag === "Inside" ? fenced : { _tag: "Outside", reason: `${fenced.reason} A knob cannot change it.` }
}

/**
 * @param {unknown} options
 * @returns {{ hints: Record<string, KnobHints>, problems: string[] }}
 */
function configuredHints(options) {
  if (options === undefined) return { hints: {}, problems: [] }
  if (Check(KnobOptionsSchema, options)) return { hints: /** @type {Record<string, KnobHints>} */ (options), problems: [] }
  return { hints: {}, problems: [`caliper({ knobs }) is not valid, so Caliper ignores it: ${firstError(KnobOptionsSchema, options)}`] }
}

/**
 * @param {import("typebox").TSchema} schema
 * @param {unknown} value
 */
function firstError(schema, value) {
  const [error] = Errors(schema, value)
  if (!error) return "unknown"
  return `${error.instancePath || "/"} ${error.message}`
}
