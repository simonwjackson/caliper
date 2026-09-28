// @ts-check
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createTakeStore } from "../src/takes/store.js"
import { manifest, withProject } from "./project-server.js"

// A global stylesheet that imports a child, as Pico's tokens do. Vite inlines
// the child, so the served text is not the source of either file.
const files = {
  "package.json": manifest(),
  "src/index.ts": 'import "./global.css"\n',
  "src/child.css": ".theme {\n  --paper: rgb(9, 9, 9);\n}\n",
  "src/global.css": [
    '@import "./child.css";',
    "",
    "/* How many rows of virtual pixels. */",
    "@property --rows {",
    '  syntax: "<number>";',
    "  inherits: true;",
    "  initial-value: 360;",
    "}",
    "",
    "/** @label Ground @knob ignore */",
    "@property --ground {",
    '  syntax: "<color>";',
    "  inherits: true;",
    "  initial-value: #000000;",
    "}",
    "",
    ".theme {",
    "  --p8-black: #000000;",
    "  --p8-pink: #ff77a8;",
    "  background: url(\"./dot.png\");",
    "  /** @min 1 @max 8 @step 1 @colour red */",
    "  --gap:   4px ;",
    "  --ground: var(--p8-black);",
    "}",
    "",
  ].join("\n"),
  "src/dot.png": "png",
  "src/Box.part.tsx": 'export default function Part() { return <div className="theme">box</div> }\n',
}

/** The CSSOM of the served global.css, as the chrome summarizes it. */
const rules = [
  { path: [0], kind: "style", selector: ".theme" },
  { path: [1], kind: "property", name: "--rows" },
  { path: [2], kind: "property", name: "--ground" },
  { path: [3], kind: "style", selector: ".theme" },
]

/**
 * @param {string} url
 * @param {string} path
 * @param {unknown} body
 */
function post(url, path, body) {
  return fetch(new URL(path.replace(/^\//, ""), url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

/**
 * The CSS text Vite puts into the `<style>` for a stylesheet, read from the
 * module it serves.
 *
 * @param {(path: string) => Promise<Response>} get
 * @param {string} path
 */
async function served(get, path) {
  const code = await (await get(path)).text()
  const literal = /const __vite__css = ("(?:[^"\\]|\\.)*")/.exec(code)?.[1]
  if (literal === undefined) throw new Error(`${path} is not a CSS module:\n${code}`)
  return /** @type {string} */ (JSON.parse(literal))
}

/**
 * @param {string} root
 * @param {string} file
 * @param {string} text
 */
function at(root, file, text) {
  const source = readFileSync(join(root, file), "utf8")
  const start = source.indexOf(text)
  return { start, end: start + text.length }
}

describe("locating a knob's declaration", () => {
  test("maps a rule the browser holds to the declaration in its source file, through the sourcemap", async () => {
    await withProject({ files }, async ({ get, url, root }) => {
      const css = await served(get, "/src/global.css")
      expect(css).toContain("sourceMappingURL=data:")
      const response = await post(url, "/__caliper/knobs/locate", {
        sheet: join(root, "src/global.css"),
        take: null,
        css,
        rules,
        targets: [
          { path: [3], property: "--gap" },
          { path: [0], property: "--paper" },
          { path: [1], property: "initial-value" },
          { path: [3], property: "--ground" },
        ],
      })
      expect(response.status).toBe(200)
      const { results } = await response.json()
      const [gap, paper, rows, ground] = results
      // The served text puts the child first and rewrites url(), so its offsets differ from the source.
      expect(gap).toMatchObject({ _tag: "Located", file: "src/global.css", value: "4px", ...at(root, "src/global.css", "4px") })
      expect(gap.hints).toEqual({ min: 1, max: 8, step: 1 })
      expect(gap.problems).toEqual(["Caliper does not know the hint @colour. It reads @label, @min, @max, @step and @knob ignore."])
      expect(paper).toMatchObject({ _tag: "Located", file: "src/child.css", value: "rgb(9, 9, 9)", ...at(root, "src/child.css", "rgb(9, 9, 9)") })
      expect(rows).toMatchObject({ _tag: "Located", file: "src/global.css", line: 7, value: "360", hints: {}, note: "How many rows of virtual pixels." })
      expect(ground).toMatchObject({ _tag: "Located", value: "var(--p8-black)", hints: {} })
      expect(gap.version).toMatch(/^[0-9a-f]{16}$/)
      expect(paper.version).not.toBe(gap.version)
    })
  })

  test("reads the hints above an @property rule for its initial value", async () => {
    await withProject({ files }, async ({ get, url, root }) => {
      const css = await served(get, "/src/global.css")
      const { results } = await (await post(url, "/__caliper/knobs/locate", {
        sheet: join(root, "src/global.css"), take: null, css, rules, targets: [{ path: [2], property: "initial-value" }],
      })).json()
      expect(results[0]).toMatchObject({ _tag: "Located", value: "#000000", hints: { label: "Ground", ignore: true } })
    })
  })

  test("refuses a rule it cannot pair, a declaration the rule does not hold, and a file that changed since it was served", async () => {
    await withProject({ files }, async ({ get, url, root, write }) => {
      const css = await served(get, "/src/global.css")
      const ask = async (/** @type {object} */ body) => (await (await post(url, "/__caliper/knobs/locate", {
        sheet: join(root, "src/global.css"), take: null, css, rules, ...body,
      })).json()).results[0]
      expect(await ask({ targets: [{ path: [3], property: "--missing" }] })).toEqual({ _tag: "Refused", reason: "The rule has no --missing declaration in the served CSS." })
      expect(await ask({ rules: [{ path: [0], kind: "style", selector: ".other" }], targets: [{ path: [0], property: "--paper" }] }))
        .toEqual({ _tag: "Refused", reason: "Caliper could not match this rule to the served CSS." })
      expect((await ask({ css: css.replace(/\/\*# sourceMappingURL=[^*]*\*\//, ""), targets: [{ path: [3], property: "--gap" }] })).reason)
        .toStartWith("The served CSS has no source map")
      write("src/global.css", `/* moved */\n${files["src/global.css"]}`)
      expect((await ask({ targets: [{ path: [3], property: "--gap" }] })).reason).toStartWith("src/global.css changed after the frame loaded it.")
    })
  })

  test("in a take's frame, reads the take's copy of the file", async () => {
    await withProject({ files }, async ({ get, url, root }) => {
      const store = createTakeStore(root)
      const take = store.create({ part: "src/Box.part.tsx", state: "default", device: "rg353m" })
      store.write(take, "src/child.css", ".theme {\n  --paper: rgb(1, 1, 1);\n}\n")
      const css = await served(get, `/src/child.css?take=${take}`)
      const body = { sheet: `${join(root, "src/child.css")}?take=${take}`, css, rules: [{ path: [0], kind: "style", selector: ".theme" }], targets: [{ path: [0], property: "--paper" }] }
      const { results } = await (await post(url, "/__caliper/knobs/locate", { ...body, take })).json()
      expect(results[0]).toMatchObject({ _tag: "Located", file: "src/child.css", value: "rgb(1, 1, 1)" })
      const wrong = await post(url, "/__caliper/knobs/locate", { ...body, take: null })
      expect((await wrong.json()).error).toBe(`This stylesheet belongs to take ${take}, not to the real files.`)
    })
  })

  test("in a take's frame, finds a declaration in a global stylesheet whose @import the take loads on its own", async () => {
    await withProject({ files }, async ({ get, url, root }) => {
      const take = createTakeStore(root).create({ part: "src/Box.part.tsx", state: "default", device: "rg353m" })
      // The frame page flattens the take's global stylesheets.
      expect((await get(`/__caliper/frame?part=src/Box.part.tsx&take=${take}`)).status).toBe(200)
      const css = await served(get, `/src/global.css?take=${take}`)
      expect(css).not.toContain("@import")
      const { results } = await (await post(url, "/__caliper/knobs/locate", {
        sheet: `${join(root, "src/global.css")}?take=${take}`,
        take,
        css,
        rules: [
          { path: [0], kind: "property", name: "--rows" },
          { path: [1], kind: "property", name: "--ground" },
          { path: [2], kind: "style", selector: ".theme" },
        ],
        targets: [{ path: [2], property: "--gap" }],
      })).json()
      expect(results[0]).toMatchObject({ _tag: "Located", file: "src/global.css", value: "4px", ...at(root, "src/global.css", "4px") })
    })
  })

  test("maps a @container rule to its condition as written in the source file, with the hints above it", async () => {
    const stage = [
      ".stage {",
      "  container: stage / size;",
      '  background: url("./dot.png");',
      "}",
      "",
      "/** Narrow stages stack the carts. @label Narrow @max 80 */",
      "@container stage (width < 45em)   and (height>=40em) {",
      "  .cart { display: none; }",
      "}",
      "",
    ].join("\n")
    await withProject({ files: { ...files, "src/stage.css": stage, "src/index.ts": 'import "./stage.css"\n' } }, async ({ get, url, root }) => {
      const css = await served(get, "/src/stage.css")
      expect(css).not.toContain('url("./dot.png")')
      const { results } = await (await post(url, "/__caliper/knobs/locate", {
        sheet: join(root, "src/stage.css"),
        take: null,
        css,
        rules: [
          { path: [0], kind: "style", selector: ".stage" },
          { path: [1], kind: "container" },
          { path: [1, 0], kind: "style", selector: ".cart" },
        ],
        targets: [{ path: [1], property: "@container" }, { path: [0], property: "@container" }],
      })).json()
      const condition = "stage (width < 45em)   and (height>=40em)"
      expect(results[0]).toMatchObject({
        _tag: "Located", file: "src/stage.css", line: 7, value: condition, ...at(root, "src/stage.css", condition),
        hints: { label: "Narrow", max: 80 }, note: "Narrow stages stack the carts.",
      })
      expect(results[1]).toEqual({ _tag: "Refused", reason: "A @container knob needs a @container rule." })
    })
  })

  test("gives the hints caliper({ knobs }) names for the properties asked about, and says when the option is not valid", async () => {
    const options = { knobs: { "--gap": { label: "Gap", max: 12 }, "--other": { label: "Other" } } }
    await withProject({ files, options }, async ({ get, url, root }) => {
      const css = await served(get, "/src/global.css")
      const answer = await (await post(url, "/__caliper/knobs/locate", {
        sheet: join(root, "src/global.css"), take: null, css, rules, targets: [{ path: [3], property: "--gap" }],
      })).json()
      expect(answer.configured).toEqual({ "--gap": { label: "Gap", max: 12 } })
      expect(answer.problems).toEqual([])
    })
    await withProject({ files, options: /** @type {any} */ ({ knobs: { gap: { label: 3 } } }) }, async ({ get, url, root }) => {
      const css = await served(get, "/src/global.css")
      const answer = await (await post(url, "/__caliper/knobs/locate", {
        sheet: join(root, "src/global.css"), take: null, css, rules, targets: [{ path: [3], property: "--gap" }],
      })).json()
      expect(answer.configured).toEqual({})
      expect(answer.problems[0]).toStartWith("caliper({ knobs }) is not valid, so Caliper ignores it:")
    })
  })
})

describe("writing a knob's value", () => {
  /**
   * Locate `--gap` in the real global.css.
   *
   * @param {(path: string) => Promise<Response>} get
   * @param {string} url
   * @param {string} root
   */
  const locateGap = async (get, url, root) => {
    const css = await served(get, "/src/global.css")
    const { results } = await (await post(url, "/__caliper/knobs/locate", {
      sheet: join(root, "src/global.css"), take: null, css, rules, targets: [{ path: [3], property: "--gap" }],
    })).json()
    return results[0]
  }

  test("replaces the one value in the real file, and names the file's new version", async () => {
    await withProject({ files }, async ({ get, url, root }) => {
      const gap = await locateGap(get, url, root)
      const response = await post(url, "/__caliper/knobs/write", { file: gap.file, take: null, version: gap.version, start: gap.start, end: gap.end, expected: gap.value, value: "6px" })
      expect(response.status).toBe(200)
      const written = await response.json()
      const text = readFileSync(join(root, "src/global.css"), "utf8")
      expect(text).toBe(files["src/global.css"].replace("--gap:   4px ;", "--gap:   6px ;"))
      expect(written).toMatchObject({ _tag: "Written", file: "src/global.css" })
      expect(written.version).not.toBe(gap.version)
    })
  })

  test("refuses to write when the file changed after the knob read it", async () => {
    await withProject({ files }, async ({ get, url, root, write }) => {
      const gap = await locateGap(get, url, root)
      const edited = files["src/global.css"].replace("--p8-pink", "--p8-rose")
      write("src/global.css", edited)
      const response = await post(url, "/__caliper/knobs/write", { file: gap.file, take: null, version: gap.version, start: gap.start, end: gap.end, expected: gap.value, value: "6px" })
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ _tag: "Conflict", reason: "The file changed after the knob read it. Caliper did not write your value." })
      expect(readFileSync(join(root, "src/global.css"), "utf8")).toBe(edited)
    })
  })

  test("refuses a value that would change more than the declaration, and a file outside the project", async () => {
    await withProject({ files }, async ({ get, url, root }) => {
      const gap = await locateGap(get, url, root)
      const error = async (/** @type {object} */ patch) => (await (await post(url, "/__caliper/knobs/write", {
        file: gap.file, take: null, version: gap.version, start: gap.start, end: gap.end, expected: gap.value, value: "6px", ...patch,
      })).json()).error
      expect(await error({ value: "6px; color: red" })).toBe('"6px; color: red" would change more than this declaration.')
      expect(await error({ value: "6px }" })).toBe('"6px }" would change more than this declaration.')
      expect(await error({ value: "calc(1px" })).toBe('"calc(1px" has unbalanced parentheses.')
      expect(await error({ file: "../outside.css" })).toContain("outside the project")
      expect(readFileSync(join(root, "src/global.css"), "utf8")).toBe(files["src/global.css"])
    })
  })

  test("in a take's frame, writes the take's copy as an edit by hand, and leaves the real file", async () => {
    await withProject({ files }, async ({ get, url, root }) => {
      const take = createTakeStore(root).create({ part: "src/Box.part.tsx", state: "default", device: "rg353m" })
      const css = await served(get, `/src/child.css?take=${take}`)
      const { results } = await (await post(url, "/__caliper/knobs/locate", {
        sheet: `${join(root, "src/child.css")}?take=${take}`, take, css, rules: [{ path: [0], kind: "style", selector: ".theme" }], targets: [{ path: [0], property: "--paper" }],
      })).json()
      const paper = results[0]
      const response = await post(url, "/__caliper/knobs/write", { file: paper.file, take, version: paper.version, start: paper.start, end: paper.end, expected: paper.value, value: "rgb(2, 2, 2)" })
      expect(response.status).toBe(200)
      expect(readFileSync(join(root, ".caliper/takes", take, "src/child.css"), "utf8")).toBe(".theme {\n  --paper: rgb(2, 2, 2);\n}\n")
      expect(readFileSync(join(root, "src/child.css"), "utf8")).toBe(files["src/child.css"])
      const snapshot = await (await get("/__caliper/takes.json")).json()
      expect(snapshot.takes.find((/** @type {any} */ view) => view.take === take).files).toEqual(["src/child.css"])
    })
  })

  test("a knob write needs the chrome's origin", async () => {
    await withProject({ files }, async ({ url }) => {
      const denied = await fetch(new URL("__caliper/knobs/write", url), {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({}),
      })
      expect(denied.status).toBe(403)
    })
  })
})

describe("the dev server", () => {
  test("serves CSS with an inline sourcemap, which a knob needs", async () => {
    await withProject({ files }, async ({ get }) => {
      expect(await served(get, "/src/child.css")).toContain("sourceMappingURL=data:application/json")
    })
  })
})
