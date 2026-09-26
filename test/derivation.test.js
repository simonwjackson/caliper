// @ts-check
import { describe, expect, test } from "bun:test"
import { manifest, withProject } from "./project-server.js"

/**
 * The shape Pico has: the entry re-exports a mount module, the mount module
 * renders the surface, and the surface's root element carries the theme
 * classes. Type-only imports must not be followed.
 */
const picoShape = {
  "package.json": manifest(),
  "src/index.ts": [
    "/** entry */",
    'export { Surface } from "./Surface"',
    'export { surface } from "./mount"',
    'import type { Model } from "./model"',
    'import "./app.css"',
    "",
  ].join("\n"),
  "src/mount.tsx": [
    'import { createRoot } from "react-dom/client"',
    'import { Surface } from "./Surface"',
    "",
    "export const surface = {",
    "  mount(container: HTMLElement) {",
    "    const root = createRoot(container)",
    "    root.render(<Surface model={1} />)",
    "  },",
    "}",
    "",
  ].join("\n"),
  "src/Surface.tsx": [
    'import "./surface.css"',
    'import { Home } from "./Home"',
    "",
    "export function Surface({ model }: { model: number }) {",
    "  if (model < 0) return <p>bad</p>",
    "  return (",
    '    <div className="app-theme app-screen">',
    "      {model > 0 ? <Home /> : null}",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n"),
  "src/Home.tsx": 'import "./home.css"\nexport function Home() { return <main /> }\n',
  "src/model.ts": 'import "./never.css"\nexport type Model = number\n',
  "src/app.css": '@import "./tokens.css";\n.app-theme { color: red }\n',
  "src/tokens.css": ":root { --x: 1 }\n",
  "src/surface.css": ".app-screen { width: 100% }\n",
  "src/home.css": "main { display: block }\n",
  "src/never.css": "body { display: none }\n",
  "src/Button.atom.part.tsx": 'export const name = "Primary button"\nexport const note = "The main call to action"\nexport default function Part() { return <button>Go</button> }\n',
  "src/pages/Home.page.part.tsx": "export default function Part() { return <main /> }\n",
}

const DEFAULT_STATE = { export: "default", label: "Default" }

describe("parts", () => {
  test("lists every *.part.tsx file with its name and note, sorted by path", async () => {
    await withProject({ files: picoShape }, async ({ project }) => {
      expect((await project()).parts).toEqual([
        { file: "src/Button.atom.part.tsx", name: "Primary button", note: "The main call to action", states: [DEFAULT_STATE] },
        { file: "src/pages/Home.page.part.tsx", name: "Home", states: [DEFAULT_STATE] },
      ])
    })
  })

  test("lists each exported component as a state, after the default export, in source order", async () => {
    const files = {
      ...picoShape,
      "src/pages/Home.page.part.tsx": [
        'import { fixture } from "./fixture"',
        'export const name = "Home"',
        "export function LoadingSlow() { return <main aria-busy /> }",
        "export default function Part() { return <main /> }",
        "export const Empty = () => <main />",
        "export const CatalogError = function () { return <main /> }",
        "export function helper() { return 1 }",
        "export const LIMIT = 3",
        "export type Props = { a: number }",
        "",
      ].join("\n"),
    }
    await withProject({ files }, async ({ project }) => {
      const home = (await project()).parts.find(part => part.file === "src/pages/Home.page.part.tsx")
      expect(home?.states).toEqual([
        DEFAULT_STATE,
        { export: "LoadingSlow", label: "Loading slow", line: 3 },
        { export: "Empty", label: "Empty", line: 5 },
        { export: "CatalogError", label: "Catalog error", line: 6 },
      ])
    })
  })

  test("skips parts the Git checkout ignores, and node_modules", async () => {
    const files = {
      ...picoShape,
      ".gitignore": "generated/\n",
      "generated/Old.part.tsx": "export default function Part() { return null }\n",
      "node_modules/lib/Lib.part.tsx": "export default function Part() { return null }\n",
    }
    await withProject({ files, git: true }, async ({ project }) => {
      expect((await project()).parts.map(part => part.file)).toEqual([
        "src/Button.atom.part.tsx",
        "src/pages/Home.page.part.tsx",
      ])
    })
  })

  test("sees a part added while the server runs", async () => {
    await withProject({ files: picoShape }, async ({ project, write }) => {
      expect((await project()).parts).toHaveLength(2)
      write("src/New.part.tsx", "export default function Part() { return null }\n")
      await waitFor(async () => (await project()).parts.length === 3)
    })
  })
})

describe("entry", () => {
  test("comes from package.json exports[\".\"]", async () => {
    await withProject({ files: picoShape }, async ({ project }) => {
      expect((await project()).entry).toEqual({
        _tag: "Derived",
        value: { file: "src/index.ts" },
        source: { file: "package.json", line: 4 },
        via: 'package.json exports["."]',
      })
    })
  })

  test("prefers the module script in index.html", async () => {
    const files = {
      ...picoShape,
      "index.html": '<!doctype html>\n<div id="app"></div>\n<script type="module" src="/src/mount.tsx"></script>\n',
    }
    await withProject({ files }, async ({ project }) => {
      const { entry } = await project()
      expect(entry._tag === "Derived" && entry.value.file).toBe("src/mount.tsx")
      expect(entry._tag === "Derived" && entry.source).toEqual({ file: "index.html", line: 3 })
    })
  })

  test("falls back to package.json main", async () => {
    const files = { ...picoShape, "package.json": JSON.stringify({ name: "x", main: "src/index.ts" }) }
    await withProject({ files }, async ({ project }) => {
      const { entry } = await project()
      expect(entry._tag === "Derived" && entry.via).toBe("package.json main")
    })
  })

  test("fails with a hint when nothing names an entry", async () => {
    const files = { ...picoShape, "package.json": JSON.stringify({ name: "x" }) }
    await withProject({ files }, async ({ project }) => {
      const { entry, css, wrapper } = await project()
      expect(entry._tag).toBe("Failed")
      expect(entry._tag === "Failed" && entry.hint).toContain("caliper({ entry")
      expect(css._tag).toBe("Failed")
      expect(wrapper._tag).toBe("Failed")
    })
  })

  test("the entry option overrides the derived entry", async () => {
    await withProject({ files: picoShape, options: { entry: "src/mount.tsx" } }, async ({ project }) => {
      expect((await project()).entry).toEqual({ _tag: "Overridden", value: { file: "src/mount.tsx" }, option: "entry" })
    })
  })
})

describe("global CSS", () => {
  test("injects only direct entry styles, preserving their order and source sites", async () => {
    await withProject({ files: picoShape }, async ({ project }) => {
      const { css } = await project()
      expect(css._tag).toBe("Derived")
      if (css._tag !== "Derived") return
      expect(css.value.stylesheets).toEqual([
        { file: "src/app.css", importedAt: { file: "src/index.ts", line: 5 } },
      ])
    })
  })

  test("does not hoist nested bootstrap CSS and keeps direct import order through cycles", async () => {
    const files = {
      ...picoShape,
      "src/index.ts": 'import "./bootstrap"\nimport "./tokens.css"\nimport "./app.css"\nexport { surface } from "./mount"',
      "src/bootstrap.ts": 'import "./app.css"\nimport "./index"\nimport "./surface.css"',
    }
    await withProject({ files }, async ({ project }) => {
      const { css, wrapper } = await project()
      expect(css._tag !== "Failed" && css.value.stylesheets.map(sheet => sheet.file)).toEqual(["src/tokens.css", "src/app.css"])
      expect(wrapper._tag).toBe("Derived")
    })
  })

  test("a project with only component styles injects no globals", async () => {
    const files = { ...picoShape, "src/index.ts": 'export { surface } from "./mount"' }
    await withProject({ files }, async ({ project }) => {
      const { css } = await project()
      expect(css._tag !== "Failed" && css.value.stylesheets).toEqual([])
      expect(css._tag === "Derived" && css.via).toContain("caliper({ css:")
    })
  })

  test("reports imports that do not resolve", async () => {
    const files = { ...picoShape, "src/Home.tsx": 'import "./missing.css"\nexport function Home() { return <main /> }\n' }
    await withProject({ files }, async ({ project }) => {
      const { css } = await project()
      expect(css._tag === "Derived" && css.value.unresolved).toContainEqual({
        specifier: "./missing.css",
        at: { file: "src/Home.tsx", line: 1 },
      })
    })
  })

  test("skips CSS modules and ?inline imports", async () => {
    const files = {
      ...picoShape,
      "src/Home.tsx": 'import styles from "./home.module.css"\nimport text from "./home.css?inline"\nexport function Home() { return <main className={styles.x}>{text}</main> }\n',
      "src/home.module.css": ".x { color: blue }\n",
    }
    await withProject({ files }, async ({ project }) => {
      const { css } = await project()
      expect(css._tag === "Derived" && css.value.stylesheets.map(sheet => sheet.file)).toEqual(["src/app.css"])
    })
  })
})

describe("explicit global CSS", () => {
  test("replaces the derived list, preserving order and removing duplicates", async () => {
    await withProject({ files: picoShape, options: { css: ["src/home.css", "src/app.css", "src/home.css"] } }, async ({ project }) => {
      expect((await project()).css).toEqual({
        _tag: "Overridden", option: "css",
        value: { stylesheets: [{ file: "src/home.css" }, { file: "src/app.css" }], unresolved: [] },
      })
    })
  })

  test("an override recovers when its missing file is created", async () => {
    await withProject({ files: picoShape, options: { css: ["src/late.css"] } }, async ({ project, write }) => {
      expect((await project()).css._tag).toBe("Failed")
      write("src/late.css", "body { color: blue }")
      await waitFor(async () => (await project()).css._tag === "Overridden")
    })
  })

  test("an empty override injects no globals", async () => {
    await withProject({ files: picoShape, options: { css: [] } }, async ({ project }) => {
      const { css } = await project()
      expect(css._tag).toBe("Overridden")
      expect(css._tag !== "Failed" && css.value.stylesheets).toEqual([])
    })
  })

  test("can supply globals when no app entry exists", async () => {
    const files = { ...picoShape, "package.json": JSON.stringify({ name: "parts-only" }) }
    await withProject({ files, options: { css: ["src/app.css"], wrap: false } }, async ({ project }) => {
      const { entry, css } = await project()
      expect(entry._tag).toBe("Failed")
      expect(css).toMatchObject({ _tag: "Overridden", option: "css", value: { stylesheets: [{ file: "src/app.css" }] } })
    })
  })

  test.each(["src/missing.css", "src/Home.tsx", "src/app.css?inline", "../outside.css", "/absolute.css"])("rejects invalid stylesheet %s visibly", async file => {
    await withProject({ files: picoShape, options: { css: [file] } }, async ({ project, get }) => {
      const { css } = await project()
      expect(css._tag).toBe("Failed")
      expect(css._tag === "Failed" && css.reason).toContain(file)
      expect(css._tag === "Failed" && css.hint).toContain("caliper({ css:")
      const frame = await (await get("/__caliper/frame?part=src/Button.atom.part.tsx")).text()
      expect(frame).toContain(file)
    })
  })
})

describe("wrapper", () => {
  test("is the outermost DOM element of the component the app renders", async () => {
    await withProject({ files: picoShape }, async ({ project }) => {
      expect((await project()).wrapper).toEqual({
        _tag: "Derived",
        value: {
          elements: [{ tag: "div", className: "app-theme app-screen" }],
          renderedAt: { file: "src/mount.tsx", line: 7 },
        },
        source: { file: "src/Surface.tsx", line: 7 },
        via: "outermost DOM elements of the component the app renders",
      })
    })
  })

  test("follows nested DOM elements while each has one DOM child", async () => {
    const files = {
      ...picoShape,
      "src/Surface.tsx": 'export const Surface = () => (\n  <div className="outer">\n    <section className={"inner"}>\n      <slot />\n      <slot />\n    </section>\n  </div>\n)\n',
    }
    await withProject({ files }, async ({ project }) => {
      const { wrapper } = await project()
      expect(wrapper._tag === "Derived" && wrapper.value.elements).toEqual([
        { tag: "div", className: "outer" },
        { tag: "section", className: "inner" },
      ])
    })
  })

  test("fails with the line when the className is computed", async () => {
    const files = {
      ...picoShape,
      "src/Surface.tsx": 'const theme = "dark"\nexport function Surface() {\n  return <div className={theme}>x</div>\n}\n',
    }
    await withProject({ files }, async ({ project }) => {
      const { wrapper } = await project()
      expect(wrapper._tag).toBe("Failed")
      expect(wrapper._tag === "Failed" && wrapper.reason).toContain("src/Surface.tsx:3 is computed")
      expect(wrapper._tag === "Failed" && wrapper.hint).toContain("caliper({ wrap")
    })
  })

  test("fails when the app's root component returns another component", async () => {
    const files = {
      ...picoShape,
      "src/Surface.tsx": 'import { Theme } from "./Theme"\nexport function Surface() {\n  return <Theme><div className="app" /></Theme>\n}\n',
      "src/Theme.tsx": "export function Theme(props: { children: unknown }) { return <>{props.children}</> }\n",
    }
    await withProject({ files }, async ({ project }) => {
      const { wrapper } = await project()
      expect(wrapper._tag === "Failed" && wrapper.reason).toContain("returns <Theme>")
    })
  })

  test("fails when nothing reachable renders a React root", async () => {
    const files = { ...picoShape, "src/index.ts": 'import "./app.css"\nexport const x = 1\n' }
    await withProject({ files }, async ({ project }) => {
      const { wrapper, css } = await project()
      expect(wrapper._tag === "Failed" && wrapper.reason).toContain("createRoot")
      expect(css._tag).toBe("Derived")
    })
  })

  test("the wrap option overrides the derived wrapper", async () => {
    await withProject({ files: picoShape, options: { wrap: ["a b", "c"] } }, async ({ project }) => {
      expect((await project()).wrapper).toEqual({
        _tag: "Overridden",
        value: { elements: [{ tag: "div", className: "a b" }, { tag: "div", className: "c" }] },
        option: "wrap",
      })
    })
  })

  test("wrap: false renders parts with no wrapper", async () => {
    await withProject({ files: picoShape, options: { wrap: false } }, async ({ project }) => {
      const { wrapper } = await project()
      expect(wrapper._tag === "Overridden" && wrapper.value.elements).toEqual([])
    })
  })
})

/**
 * @param {() => Promise<boolean>} check
 * @param {number} [timeoutMs]
 */
async function waitFor(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error("Condition did not become true in time")
}
