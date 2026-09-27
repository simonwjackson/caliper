// @ts-check
import { isAbsolute, relative, sep } from "node:path"
import { isTakeId, TAKES_DIR } from "../takes/store.js"
import { codeFiles, partFiles } from "./part-files.js"

/**
 * @typedef {import("node:http").ServerResponse} ServerResponse
 * @typedef {import("../types").Project} Project
 * @typedef {import("../types").Resolve} Resolve
 * @typedef {import("../types").CodeChange} CodeChange
 * @typedef {import("../types").CodeDocument} CodeDocument
 * @typedef {import("../takes/store.js").TakeStore} TakeStore
 */

/**
 * What the code pane reads, under `/__caliper/code`. Reads only: the pane
 * writes through the takes API, because every edit it makes lands in a take.
 *
 *   GET /code/files?part=<file>[&take=<n>]   the files a part is made of
 *   GET /code/file?file=<file>[&take=<n>]    one file, and the real file to compare with
 *
 * @param {{ store: TakeStore, project: () => Promise<Project>, resolve: Resolve }} input
 */
export function createCodeApi({ store, project, resolve }) {
  /**
   * @param {string} take
   * @returns {(file: string) => string | null}
   */
  const reader = take => file => {
    try {
      return take === "" ? store.original(file) : store.read(take, file)
    } catch {
      return null
    }
  }

  /**
   * @param {string} path below `/__caliper`
   * @param {URL} url
   * @param {ServerResponse} response
   * @returns {Promise<boolean>} false when the path is not the API's
   */
  const handle = async (path, url, response) => {
    if (path !== "/code/files" && path !== "/code/file") return false
    const take = url.searchParams.get("take") ?? ""
    if (take !== "" && (!isTakeId(take) || store.record(take) === null)) {
      json(response, 404, { error: `Take ${take} does not exist. It may have been accepted or discarded.` })
      return true
    }
    try {
      if (path === "/code/files") {
        const part = url.searchParams.get("part") ?? ""
        if (!(await project()).parts.some(candidate => candidate.file === part)) {
          json(response, 404, { error: `"${part}" is not a part.` })
          return true
        }
        const reached = await partFiles({ root: store.root, part, read: reader(take), resolve })
        json(response, 200, { files: codeFiles(reached, take === "" ? [] : store.files(take)) })
        return true
      }
      const file = url.searchParams.get("file") ?? ""
      const content = reader(take)(file)
      if (content === null) {
        json(response, 404, { error: `"${file}" does not exist${take === "" ? "" : ` in take ${take}`}.` })
        return true
      }
      /** @type {CodeDocument} */
      const document = take === "" ? { file, content } : { file, content, original: store.original(file) }
      json(response, 200, document)
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }

  return { handle }
}

/**
 * The code change a file event on disk means, or null when the pane does not
 * care: a file outside the project, in node_modules, or a take's record.
 *
 * @param {string} root absolute
 * @param {string} absolute the changed file
 * @returns {CodeChange | null}
 */
export function codeChange(root, absolute) {
  const inside = relative(root, absolute)
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return null
  const segments = inside.split(sep)
  if (segments.includes("node_modules") || segments[0] === ".git") return null
  const takes = TAKES_DIR.split("/")
  if (takes.every((segment, index) => segments[index] === segment)) {
    const [take = "", ...rest] = segments.slice(takes.length)
    return isTakeId(take) && rest.length > 0 ? { file: rest.join("/"), take } : null
  }
  if (segments[0] === takes[0]) return null
  return { file: segments.join("/"), take: null }
}

/**
 * @param {ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(body))
}
