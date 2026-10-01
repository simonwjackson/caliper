import { afterEach, expect, test } from "bun:test"
import { createChromeApp } from "../src/client/app/runtime"
import type { RuntimeInput } from "../src/client/app/runtime"
import type { Project, TakesSnapshot, TakeView } from "../src/types"
import type { ChainView } from "../src/client/ui/contract"
import { STANDARD_DEVICES } from "../src/client/device-frame.js"

// Phase 5 core: chains on the Takes canvas from the served take records.
const part = "src/Chip.atom.part.tsx"
const other = "src/Badge.atom.part.tsx"
const origin = "http://caliper.test"
const t0 = 1_790_726_400_000

function project(): Project {
  return {
    name: "chains",
    parts: [
      { file: part, name: "Chip", layer: "atom", states: [{ export: "default", label: "Default" }] },
      { file: other, name: "Badge", layer: "atom", states: [{ export: "default", label: "Default" }] },
    ],
    entry: { _tag: "Derived", value: { file: "src/main.tsx" }, source: { file: "index.html", line: 6 }, via: "module script" },
    css: { _tag: "Derived", value: { stylesheets: [], unresolved: [] }, source: { file: "src/main.tsx", line: 1 }, via: "entry imports" },
    wrapper: { _tag: "Overridden", value: { elements: [] }, option: "wrap" },
    devices: STANDARD_DEVICES,
  }
}
const at = (take: string, minutes: number) => ({ take, created: t0 + minutes * 60_000 })
function take(id: string, minutes: number, overrides: Partial<TakeView> = {}): TakeView {
  return { ...at(id, minutes), part, state: "default", device: "iphone-16", name: `Take ${id} name`, files: ["src/chip.css"], images: [], run: { _tag: "Idle" }, log: [], ...overrides }
}
/** Take 6 from 1 across a discarded 4; take 5 from 2; take 3 alone. */
function chainTakes(): TakeView[] {
  return [
    take("1", 1), take("2", 2), take("3", 3),
    take("5", 5, { parent: at("2", 2), chain: at("2", 2), lineage: [at("2", 2)] }),
    take("6", 6, { parent: at("4", 4), chain: at("1", 1), lineage: [at("1", 1), at("4", 4)] }),
  ]
}
function snapshot(list: readonly TakeView[], accepted: TakesSnapshot["accepted"] = []): TakesSnapshot {
  return { agent: { _tag: "Off", hint: "No agent in this test." }, skills: { skills: [], problems: [] }, takes: list, accepted }
}
type App = ReturnType<typeof createChromeApp>
const apps = new Set<App>()
afterEach(() => { for (const app of apps) app.dispose(); apps.clear() })
function memory() {
  const items = new Map<string, string>()
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key), items }
}
function open(list: readonly TakeView[], input: Partial<RuntimeInput> = {}, accepted: TakesSnapshot["accepted"] = []) {
  const calls: string[] = []
  const app = createChromeApp({
    request: async <T>(path: string): Promise<T> => {
      calls.push(path)
      if (path === "takes.json") return snapshot(list, accepted) as T
      if (path === "project.json") return project() as T
      return {} as T
    },
    hash: `#part=${part}&state=takes:default`, origin, confirm: () => true, ...input,
  })
  apps.add(app)
  app.receiveProject(project()); app.receiveTakes(snapshot(list, accepted))
  return { app, calls }
}
function chains(app: App): readonly ChainView[] {
  const canvas = app.getSnapshot().canvas
  if (canvas._tag !== "Frames") throw new Error("Expected frames")
  return canvas.chains
}
const frameTakes = (app: App) => {
  const canvas = app.getSnapshot().canvas
  return canvas._tag === "Frames" ? canvas.frames.map(frame => frame.take) : []
}
async function settle() { for (let index = 0; index < 40; index++) await Promise.resolve() }

test("the Takes canvas groups served takes into chains: newest take next to its nearest existing ancestor", () => {
  const { app } = open(chainTakes())
  expect(chains(app).map(chain => chain.label)).toEqual(["6 ← from 1 (1 discarded)", "5 ← from 2", "3"])
  expect(chains(app).map(chain => chain.id)).toEqual([`1@${at("1", 1).created}`, `2@${at("2", 2).created}`, `3@${at("3", 3).created}`])
  expect(frameTakes(app)).toEqual([null, "1", "6", "2", "5", "3"])
  expect(chains(app)[2]).toMatchObject({ parent: null, history: { _tag: "None" }, solo: "Shown" })
})

test("a chain's history opens with every step, discarded ones marked, and folds again", () => {
  const { app } = open(chainTakes())
  const first = chains(app)[0]!
  expect(first.history).toEqual({ _tag: "Folded", label: "3 in chain" })
  app.actions.onChainHistory(first.id, true)
  expect(chains(app)[0]!.history).toEqual({ _tag: "Open", label: "3 in chain", steps: [
    { _tag: "Present", take: "1", label: "Take 1", selected: false },
    { _tag: "Discarded", take: "4", label: "Take 4, discarded" },
    { _tag: "Present", take: "6", label: "Take 6", selected: true },
  ] })
  expect(chains(app)[1]!.history._tag).toBe("Folded")
  app.actions.onChainHistory(first.id, false)
  expect(chains(app)[0]!.history._tag).toBe("Folded")
})

test("selecting an older take keeps the Takes canvas and moves it into its chain's pair", () => {
  const { app } = open([...chainTakes(), take("7", 7, { parent: at("6", 6), chain: at("1", 1), lineage: [at("1", 1), at("4", 4), at("6", 6)] })])
  expect(chains(app)[0]).toMatchObject({ take: "7", label: "7 ← from 6" })
  app.actions.onTake("6")
  expect(app.getSnapshot().canvas).toMatchObject({ _tag: "Frames", mode: "Takes" })
  expect(chains(app)[0]).toMatchObject({ take: "6", label: "6 ← from 1 (1 discarded)" })
  expect(app.getSnapshot().focusedTake).toMatchObject({ id: "6", lineage: "6 ← from 1 (1 discarded)" })
})

test("the fallback side is kept per chain across a reload, and a chain with no parent cannot show one", () => {
  const storage = memory()
  const first = open(chainTakes(), { storage })
  const [pair, , single] = chains(first.app)
  first.app.actions.onChainSolo(pair!.id, "Parent")
  first.app.actions.onChainSolo(single!.id, "Parent")
  expect(chains(first.app).map(chain => chain.solo)).toEqual(["Parent", "Shown", "Shown"])
  expect(JSON.parse(storage.items.get("caliper:chain-solo") ?? "[]")).toEqual([pair!.id])
  const reloaded = open(chainTakes(), { storage })
  expect(chains(reloaded.app).map(chain => chain.solo)).toEqual(["Parent", "Shown", "Shown"])
  reloaded.app.actions.onChainSolo(pair!.id, "Shown")
  expect(chains(reloaded.app)[0]!.solo).toBe("Shown")
  expect(JSON.parse(storage.items.get("caliper:chain-solo") ?? "[]")).toEqual([])
})

test("a take made before a later accept of another part that wrote one of its files is flagged", () => {
  const accepted = [{ ...at("9", 8), part: other, state: "default", files: ["src/chip.css"], at: t0 + 9 * 60_000 }]
  const { app } = open([...chainTakes(), take("8", 10)], {}, accepted)
  const flags = chains(app).map(chain => chain.flag._tag === "Before" ? chain.flag.label : "")
  expect(flags).toEqual(["made before take 9 was accepted", "made before take 9 was accepted", "made before take 9 was accepted", ""])
  expect(chains(app)[0]!.flag).toMatchObject({ detail: expect.stringContaining("src/chip.css") })
  app.actions.onTake("6")
  expect(app.getSnapshot().focusedTake?.flag._tag).toBe("Before")
})

test("accept's confirmation names the other takes of the chain it removes", async () => {
  const asked: string[] = []
  const { app, calls } = open(chainTakes(), { confirm: text => { asked.push(text); return true } })
  app.actions.onTake("6")
  app.actions.onAccept("6")
  await settle()
  expect(asked[0]).toContain("Accept also removes take 1 of this chain.")
  expect(calls).toContain("takes/6/accept")
  app.actions.onTake("3")
  app.actions.onAccept("3")
  await settle()
  expect(asked[1]).not.toContain("Accept also removes")
})
