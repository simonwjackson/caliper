// @ts-check
import { readFileSync } from "node:fs"
import { Type } from "typebox"

/**
 * The only tools a take's agent has. It reads project files, writes into its
 * own take, and renders the take. It cannot run commands or write anywhere
 * else: the take store fences every path.
 *
 * @typedef {import("@earendil-works/pi-agent-core").AgentTool<any>} AgentTool
 * @typedef {import("../takes/store.js").TakeStore} TakeStore
 * @typedef {import("../render/render.js").RenderResult} RenderResult
 * @typedef {(request: { state: string, devices: string[] }) => Promise<RenderResult[]>} RenderTake
 *   Renders the take's part. `state` is an export name or "*".
 */

/** The most files list_files returns, so a large project does not flood the context. */
const LIST_LIMIT = 400
/** The most characters read_file returns. */
const READ_LIMIT = 200_000
/** The most screenshots one render returns to the model. */
const IMAGE_LIMIT = 4

/**
 * @param {{ store: TakeStore, take: string, render: RenderTake, defaults: { state: string, device: string } }} input
 * @returns {AgentTool[]}
 */
export function takeTools({ store, take, render, defaults }) {
  /** @param {string} value */
  const text = value => ({ type: /** @type {const} */ ("text"), text: value })

  /** @type {AgentTool} */
  const readFile = {
    name: "read_file",
    label: "Read",
    description: "Read a project file as this take sees it: the take's edited copy when there is one, else the real file. Paths are relative to the project root.",
    parameters: Type.Object({ path: Type.String({ description: "Path relative to the project root, for example src/ui/Button.tsx" }) }),
    execute: async (_id, params) => {
      const { path } = /** @type {{ path: string }} */ (params)
      const content = store.read(take, path)
      const clipped = content.length > READ_LIMIT ? `${content.slice(0, READ_LIMIT)}\n[... clipped at ${READ_LIMIT} characters]` : content
      return { content: [text(clipped)], details: { path } }
    },
  }

  /** @type {AgentTool} */
  const listFiles = {
    name: "list_files",
    label: "List",
    description: "List the project's files under a folder, including files this take adds. node_modules, .git and environment files are not listed.",
    parameters: Type.Object({ folder: Type.Optional(Type.String({ description: 'Folder relative to the project root. Default: "" (the whole project)' })) }),
    execute: async (_id, params) => {
      const { folder } = /** @type {{ folder?: string }} */ (params)
      const found = store.listFiles(take, folder ?? "")
      const shown = found.slice(0, LIST_LIMIT)
      const more = found.length > shown.length ? `\n[... ${found.length - shown.length} more. List a smaller folder.]` : ""
      return { content: [text(`${shown.join("\n")}${more}` || "No files.")], details: { folder: folder ?? "", count: found.length } }
    },
  }

  /** @type {AgentTool} */
  const writeFile = {
    name: "write_file",
    label: "Write",
    description: "Write the whole content of a project file into this take. The real file does not change until the user accepts the take. Use it for new files and full rewrites; use edit_file for small changes.",
    parameters: Type.Object({
      path: Type.String({ description: "Path relative to the project root" }),
      content: Type.String({ description: "The complete new content of the file" }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { path, content } = /** @type {{ path: string, content: string }} */ (params)
      const file = store.write(take, path, content)
      return { content: [text(`Wrote ${file} in take ${take}.`)], details: { path: file } }
    },
  }

  /** @type {AgentTool} */
  const editFile = {
    name: "edit_file",
    label: "Edit",
    description: "Replace one exact piece of text in a project file, in this take. old_text must appear exactly once in the file as the take sees it.",
    parameters: Type.Object({
      path: Type.String({ description: "Path relative to the project root" }),
      old_text: Type.String({ description: "Exact text to replace. It must appear once." }),
      new_text: Type.String({ description: "The replacement text" }),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { path, old_text: oldText, new_text: newText } = /** @type {{ path: string, old_text: string, new_text: string }} */ (params)
      const current = store.read(take, path)
      const count = oldText === "" ? 0 : current.split(oldText).length - 1
      if (count !== 1) {
        throw new Error(count === 0
          ? `old_text does not appear in ${path}. Read the file again and copy the text exactly.`
          : `old_text appears ${count} times in ${path}. Add more lines around it so it appears once.`)
      }
      const file = store.write(take, path, current.replace(oldText, () => newText))
      return { content: [text(`Edited ${file} in take ${take}.`)], details: { path: file } }
    },
  }

  /** @type {AgentTool} */
  const renderTool = {
    name: "render",
    label: "Render",
    description: [
      "Render the part as this take changes it, in a headless browser at each device's CSS viewport. Returns a JSON verdict per state and device, and the screenshots.",
      '`frame` is "Rendered", "Empty" or "Failed". `problems` are load and render errors with stacks. `console` holds browser errors. `spill` is null when the part fits the screen; otherwise it names the elements past the edge.',
      "Render after each change, and read the verdict before you look at the picture.",
    ].join(" "),
    parameters: Type.Object({
      state: Type.Optional(Type.String({ description: `A state export of the part, or "*" for every state. Default: "${defaults.state}"` })),
      device: Type.Optional(Type.String({ description: `A device id, or "*" for every device. Default: "${defaults.device}"` })),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { state, device } = /** @type {{ state?: string, device?: string }} */ (params)
      const results = await render({ state: state ?? defaults.state, devices: [device ?? defaults.device] })
      const verdicts = results.map(({ png: _png, ...result }) => result)
      const images = results.slice(0, IMAGE_LIMIT).map(result => ({
        type: /** @type {const} */ ("image"),
        data: readFileSync(result.png).toString("base64"),
        mimeType: "image/png",
      }))
      const omitted = results.length > images.length ? `\n${results.length - images.length} screenshots omitted; render fewer states or devices to see them.` : ""
      return {
        content: [text(`${JSON.stringify(verdicts, null, 2)}${omitted}`), ...images],
        details: { results: verdicts },
      }
    },
  }

  return [readFile, listFiles, editFile, writeFile, renderTool]
}
