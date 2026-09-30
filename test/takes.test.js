// @ts-check
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createTakeStore, fenceProjectPath } from "../src/takes/store.js"
import { manifest, withProject } from "./project-server.js"

/**
 * @param {Record<string, string>} files
 * @param {(root: string) => void | Promise<void>} run
 */
async function inFolder(files, run) {
  const root = mkdtempSync(join(tmpdir(), "caliper-takes-"))
  try {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), content)
    }
    await run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const ask = { part: "src/Chip.part.tsx", state: "default", device: "rg353m" }

describe("fenceProjectPath", () => {
  test("accepts a project file and normalises the path", async () => {
    await inFolder({ "src/a.css": "" }, root => {
      expect(fenceProjectPath(root, "./src/../src/a.css")).toEqual({ _tag: "Inside", file: "src/a.css" })
      expect(fenceProjectPath(root, "src/new/file.tsx")).toEqual({ _tag: "Inside", file: "src/new/file.tsx" })
    })
  })

  test("refuses paths outside the project, and folders a take must not touch", async () => {
    await inFolder({}, root => {
      for (const file of ["../x", "/etc/passwd", "", "node_modules/react/index.js", ".git/config", ".caliper/takes/1/a", "src/.env", ".env.local"]) {
        expect(fenceProjectPath(root, file)._tag).toBe("Outside")
      }
    })
  })

  test("refuses a path that goes through a link out of the project", async () => {
    await inFolder({}, root => {
      const outside = mkdtempSync(join(tmpdir(), "caliper-outside-"))
      try {
        symlinkSync(outside, join(root, "linked"))
        expect(fenceProjectPath(root, "linked/file.css")._tag).toBe("Outside")
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    })
  })
})

describe("the take store", () => {
  test("metadata updates refuse aliases to real files", async () => {
    await inFolder({ "package.json": "original" }, root => {
      const store = createTakeStore(root)
      const take = store.create(ask)
      const metadata = join(root, ".caliper/takes", `${take}.json`)
      rmSync(metadata)
      symlinkSync(join(root, "package.json"), metadata)
      expect(() => store.update(take, { name: "Unsafe" })).toThrow("symbolic link")
      expect(readFileSync(join(root, "package.json"), "utf8")).toBe("original")
    })
  })

  test("reset and write refuse a take folder aliased to the project", async () => {
    await inFolder({ "src/a.css": "original" }, root => {
      const store = createTakeStore(root)
      const take = store.create(ask)
      const folder = join(root, ".caliper/takes", take)
      rmSync(folder, { recursive: true })
      symlinkSync(root, folder)
      expect(() => store.reset(take, "src/a.css")).toThrow("symbolic link")
      expect(() => store.write(take, "src/a.css", "unsafe")).toThrow("symbolic link")
      expect(readFileSync(join(root, "src/a.css"), "utf8")).toBe("original")
    })
  })

  test("numbers takes from 1 and keeps .caliper out of Git", async () => {
    await inFolder({}, root => {
      const store = createTakeStore(root)
      expect(store.create(ask)).toBe("1")
      expect(store.create(ask)).toBe("2")
      expect(store.list()).toEqual(["1", "2"])
      expect(store.record("1")).toMatchObject(ask)
      expect(readFileSync(join(root, ".caliper/.gitignore"), "utf8")).toContain("*")
    })
  })

  test("writes copies into the take and never changes the real file", async () => {
    await inFolder({ "src/a.css": "real" }, root => {
      const store = createTakeStore(root)
      const take = store.create(ask)
      expect(store.read(take, "src/a.css")).toBe("real")
      store.write(take, "src/a.css", "edited")
      store.write(take, "src/b.css", "new")
      expect(store.read(take, "src/a.css")).toBe("edited")
      expect(readFileSync(join(root, "src/a.css"), "utf8")).toBe("real")
      expect(store.files(take)).toEqual(["src/a.css", "src/b.css"])
      expect(() => store.write(take, "../escape.css", "x")).toThrow("outside the project")
    })
  })

  test("accept copies the take over the real files and removes the take", async () => {
    await inFolder({ "src/a.css": "real" }, root => {
      const store = createTakeStore(root)
      const take = store.create(ask)
      store.write(take, "src/a.css", "edited")
      expect(store.accept(take)).toEqual(["src/a.css"])
      expect(readFileSync(join(root, "src/a.css"), "utf8")).toBe("edited")
      expect(store.list()).toEqual([])
    })
  })

  test("accept records the take, its part and the files it wrote in the accept log", async () => {
    await inFolder({ "src/a.css": "real", "src/b.css": "real" }, root => {
      const store = createTakeStore(root)
      expect(store.accepted()).toEqual([])
      const first = store.create(ask)
      store.write(first, "src/a.css", "one")
      const created = /** @type {import("../src/takes/store.js").TakeRecord} */ (store.record(first)).created
      const before = Date.now()
      store.accept(first)
      const second = store.create({ ...ask, part: "src/Other.part.tsx" })
      store.write(second, "src/b.css", "two")
      store.accept(second)
      const log = store.accepted()
      expect(log.map(({ at: _at, created: _created, ...rest }) => rest)).toEqual([
        { take: first, part: ask.part, state: "default", files: ["src/a.css"] },
        { take: second, part: "src/Other.part.tsx", state: "default", files: ["src/b.css"] },
      ])
      expect(log[0]?.created).toBe(created)
      expect(log[0]?.at).toBeGreaterThanOrEqual(before)
      expect(JSON.parse(readFileSync(join(root, ".caliper/accepted.json"), "utf8"))).toHaveLength(2)
    })
  })

  test("a damaged accept log reads as empty entries skipped, never as an error", async () => {
    await inFolder({ ".caliper/accepted.json": "[{\"take\":\"1\"}, 3, {\"take\":\"2\",\"created\":5,\"part\":\"p\",\"state\":\"s\",\"files\":[\"a\"],\"at\":9}]" }, root => {
      expect(createTakeStore(root).accepted()).toEqual([{ take: "2", created: 5, part: "p", state: "s", files: ["a"], at: 9 }])
    })
    await inFolder({ ".caliper/accepted.json": "not json" }, root => {
      expect(createTakeStore(root).accepted()).toEqual([])
    })
  })

  test("discard removes the take and leaves the real files", async () => {
    await inFolder({ "src/a.css": "real" }, root => {
      const store = createTakeStore(root)
      const take = store.create(ask)
      store.write(take, "src/a.css", "edited")
      store.discard(take)
      expect(existsSync(join(root, ".caliper/takes", take))).toBe(false)
      expect(readFileSync(join(root, "src/a.css"), "utf8")).toBe("real")
    })
  })
})

const project = {
  "package.json": manifest(),
  "src/index.ts": 'import "./app.css"\nexport { mount } from "./mount"\n',
  "src/mount.tsx": 'import { createRoot } from "react-dom/client"\nexport const mount = (el: HTMLElement) => createRoot(el).render(<div className="shell" />)\n',
  "src/app.css": '@import "./chip.css";\n.shell { width: 100% }\n',
  "src/chip.css": ".chip { color: blue }\n",
  "src/Chip.tsx": "export const Chip = () => <span className=\"chip\">real</span>\n",
  "src/Chip.part.tsx": 'import { Chip } from "./Chip"\nexport default function Part() { return <Chip /> }\n',
  ".caliper/takes/1.json": JSON.stringify(ask),
  ".caliper/takes/1/src/chip.css": ".chip { color: red }\n",
  ".caliper/takes/1/src/Chip.tsx": "export const Chip = () => <span className=\"chip\">take</span>\n",
}

/** @param {string} html */
function frameConfig(html) {
  const json = html.match(/<script type="application\/json" id="caliper-frame-config">(.*?)<\/script>/s)?.[1]
  if (json === undefined) throw new Error("The frame page has no config")
  return JSON.parse(json)
}

describe("a take frame", () => {
  test("tags the part and loads each local stylesheet on its own", async () => {
    await withProject({ files: project }, async ({ get }) => {
      const response = await get("/__caliper/frame?part=src/Chip.part.tsx&take=1")
      expect(response.status).toBe(200)
      expect(frameConfig(await response.text())).toMatchObject({
        part: "/src/Chip.part.tsx?take=1",
        take: "1",
        css: ["/src/chip.css?take=1", "/src/app.css?take=1"],
        warnings: [],
      })
    })
  })

  test("serves the take's copy of each project module the part imports", async () => {
    await withProject({ files: project }, async ({ get }) => {
      await get("/__caliper/frame?part=src/Chip.part.tsx&take=1")
      const part = await (await get("/src/Chip.part.tsx?take=1")).text()
      expect(part).toMatch(/\/src\/Chip\.tsx\?take=1/)
      const chip = await (await get("/src/Chip.tsx?take=1")).text()
      expect(chip).toContain('"take"')
      const real = await (await get("/src/Chip.tsx")).text()
      expect(real).toContain('"real"')
      const css = await (await get("/src/chip.css?take=1")).text()
      expect(css).toContain("red")
      const app = await (await get("/src/app.css?take=1")).text()
      expect(app).not.toContain(".chip { color: blue }")
    })
  })

  test("component CSS comes through the tagged component, not frame injection", async () => {
    const files = {
      ...project,
      "src/app.css": ".shell { width: 100% }",
      "src/Chip.tsx": 'import "./chip.css"\nexport const Chip = () => <span className="chip">real</span>',
      ".caliper/takes/1/src/Chip.tsx": 'import "./chip.css"\nexport const Chip = () => <span className="chip">take</span>',
    }
    await withProject({ files }, async ({ get }) => {
      const frame = frameConfig(await (await get("/__caliper/frame?part=src/Chip.part.tsx&take=1")).text())
      expect(frame.css).toEqual(["/src/app.css?take=1"])
      const chip = await (await get("/src/Chip.tsx?take=1")).text()
      expect(chip).toContain("/src/chip.css?take=1")
      expect(await (await get("/src/chip.css?take=1")).text()).toContain("red")
    })
  })

  test.each([
    '@import "./nested.css";',
    '@import "nested.css";',
    '/* before */ @import "./nested.css";',
    '@import url("./nested.css") screen;',
  ])("component CSS rejects an unflattened import: %s", async statement => {
    const files = {
      ...project,
      "src/app.css": ".shell { width: 100% }",
      ".caliper/takes/1/src/chip.css": `${statement}\n.chip { color: red }`,
      "src/nested.css": ".chip { border: 1px solid }",
    }
    await withProject({ files }, async ({ get }) => {
      await get("/__caliper/frame?part=src/Chip.part.tsx&take=1")
      const response = await get("/src/chip.css?take=1")
      expect(response.status).toBe(500)
      expect(await response.text()).toContain("Import these stylesheets from JS or TS")
    })
  })

  test("CSS import examples in comments and strings are not import rules", async () => {
    const files = {
      ...project,
      "src/app.css": ".shell { width: 100% }",
      ".caliper/takes/1/src/chip.css": '/* @import "./missing.css"; */\n.chip::before { content: \'@import "./missing.css";\'; }',
    }
    await withProject({ files }, async ({ get }) => {
      await get("/__caliper/frame?part=src/Chip.part.tsx&take=1")
      const response = await get("/src/chip.css?take=1")
      expect(response.status).toBe(200)
    })
  })

  test("says so when the take does not exist", async () => {
    await withProject({ files: project }, async ({ get }) => {
      const response = await get("/__caliper/frame?part=src/Chip.part.tsx&take=9")
      expect(response.status).toBe(404)
      expect(frameConfig(await response.text()).problem).toContain("Take 9 does not exist")
    })
  })

  test("a take's copy of a part file is not a part", async () => {
    const files = { ...project, ".caliper/takes/1/src/Chip.part.tsx": "export default function Part() { return null }\n", ".caliper/.gitignore": "*\n" }
    await withProject({ files, git: true }, async ({ project: read }) => {
      expect((await read()).parts.map(part => part.file)).toEqual(["src/Chip.part.tsx"])
    })
  })
})
