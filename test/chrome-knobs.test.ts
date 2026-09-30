import { afterEach, describe, expect, test } from "bun:test"
import { createKnobsController } from "../src/client/app/knobs"
import type { KnobsView } from "../src/client/ui/contract"
import type { Request } from "../src/client/app/knobs-discovery"

class Style {
  values = new Map<string, string>()
  constructor(values: Record<string, string> = {}) { this.values = new Map(Object.entries(values)) }
  get cssText() { return [...this.values].map(([name, value]) => `${name}: ${value};`).join(" ") }
  get length() { return this.values.size }
  [Symbol.iterator]() { return this.values.keys() }
  getPropertyValue(name: string) { return this.values.get(name) ?? "" }
  getPropertyPriority() { return "" }
  setProperty(name: string, value: string) { this.values.set(name, value) }
}
class CSSPropertyRule {
  name = "--rows"; syntax = "<number>"; inherits = true; initialValue = "360"
  parentRule = null
  constructor(public parentStyleSheet: CSSStyleSheet) {}
  get cssText() { return `@property --rows { syntax: "<number>"; inherits: true; initial-value: ${this.initialValue}; }` }
}
class CSSStyleRule {
  parentRule = null
  constructor(public selectorText: string, public style: Style, public parentStyleSheet: CSSStyleSheet) {}
}
class CSSContainerRule {
  parentRule = null
  cssRules: CSSStyleRule[] = []
  constructor(public conditionText: string, public parentStyleSheet: CSSStyleSheet) {}
  get cssText() { return `@container ${this.conditionText} { .card { height: 80px; } }` }
}
class CSSStyleSheet {
  ownerNode: object | null = null
  cssRules: Array<CSSPropertyRule | CSSStyleRule | CSSContainerRule> = []
  replaceSync(text: string) { this.cssRules = []; this.insertRule(text, 0) }
  deleteRule(index: number) { this.cssRules.splice(index, 1) }
  insertRule(text: string, index: number) {
    if (text.startsWith("@container")) this.cssRules.splice(index, 0, new CSSContainerRule(text.slice(10, text.indexOf("{")).trim(), this))
    else {
      const rule = new CSSPropertyRule(this)
      rule.initialValue = /initial-value:\s*([^;]+)/.exec(text)?.[1] ?? "360"
      rule.syntax = /syntax:\s*"([^"]+)"/.exec(text)?.[1] ?? "<number>"
      this.cssRules.splice(index, 0, rule)
    }
    return index
  }
}

const controllers: Array<ReturnType<typeof createKnobsController>> = []
const originalCSS = Object.getOwnPropertyDescriptor(globalThis, "CSS")
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy()
  if (originalCSS) Object.defineProperty(globalThis, "CSS", originalCSS)
  else Reflect.deleteProperty(globalThis, "CSS")
})
const wait = async (callback: () => boolean) => {
  for (let count = 0; count < 100; count++) { if (callback()) return; await Bun.sleep(10) }
  throw new Error("Controller did not settle")
}
const ready = (view: KnobsView) => { if (view._tag !== "Ready") throw new Error(view._tag); return view }

function setup() {
  const requests: Array<{ path: string; data: Record<string, unknown> }> = []
  let target: { take: string | null; label: string } | null = { take: null, label: "Real files" }
  let writeResult: object = { _tag: "Written" }
  let promoteResult: object = { _tag: "Promoted" }
  let writeWait: Promise<object> | null = null
  let locateWait: Promise<void> | null = null
  let changes = 0
  let disconnected = 0
  let sourceValue = "360"
  let malformed = false
  let sourceHints: Record<string, unknown> = {}
  let observer: ((records: unknown[]) => void) | null = null
  const sheet = new CSSStyleSheet()
  const node = { nodeType: 1, textContent: "source CSS", getAttribute: () => "/project/tokens.css", hasAttribute: () => true }
  sheet.ownerNode = node
  const rows = new CSSPropertyRule(sheet)
  const theme = new CSSStyleRule(".theme", new Style({ "--p8-pink": "#ff77a8" }), sheet)
  const cardRule = new CSSStyleRule(".card", new Style({ width: "300px" }), sheet)
  const container = new CSSContainerRule("stage (30px < width < 60px)", sheet)
  container.cssRules = [new CSSStyleRule(".card", new Style({ height: "80px" }), sheet)]
  sheet.cssRules = [rows, theme, cardRule, container]
  const card = { matches: (selector: string) => selector === ".card", closest: (selector: string) => selector === ".theme" ? {} : null, getAttribute: () => null }
  const host = { querySelectorAll: () => [card], querySelector: () => card, matches: () => false, append() {}, closest: () => ({}), getAttribute: () => null }
  const window = {
    CSSStyleSheet,
    MutationObserver: class {
      constructor(callback: (records: unknown[]) => void) { observer = callback }
      observe() {}
      disconnect() { disconnected++ }
    },
    getComputedStyle: (_element: object, pseudo?: string) => ({ content: pseudo ? "none" : "", getPropertyValue: (name: string) => name === "--rows" ? (sheet.cssRules[0] as CSSPropertyRule).initialValue : name === "width" ? cardRule.style.getPropertyValue(name) : theme.style.getPropertyValue(name) }),
  }
  const document = {
    head: {}, documentElement: { dataset: { caliperState: "Rendered" } }, styleSheets: [sheet], defaultView: window,
    getElementById: () => host,
    querySelectorAll: (selector: string) => selector.includes("[style]") ? [host] : [card],
    createElement: () => ({ style: new Style(), remove() {} }),
  }
  const iframe = { getAttribute: () => `http://localhost/__caliper/frame?part=Card${target?.take ? `&take=${target.take}` : ""}`, contentDocument: document, contentWindow: window }
  Object.defineProperty(globalThis, "CSS", { configurable: true, value: { supports: (property: string, value: string) => property !== "color" || /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\([^)]*\))$/i.test(value) } })
  const request: Request = async <T>(path: string, data?: object): Promise<T> => {
    const body = data as Record<string, unknown>
    requests.push({ path, data: body })
    if (path === "knobs/write") return await (writeWait ?? Promise.resolve(writeResult)) as T
    if (path === "knobs/promote") return promoteResult as T
    if (locateWait) await locateWait
    if (malformed) return { results: [{ _tag: "Located" }], configured: {}, problems: [] } as T
    const targets = body.targets as Array<{ path: number[]; property: string }>
    return { results: targets.map(({ property }) => ({ _tag: "Located", file: "src/tokens.css", version: "0123456789abcdef", start: property === "width" ? 80 : property === "@container" ? 100 : property === "--p8-pink" ? 50 : 20,
      end: property === "width" ? 85 : property === "@container" ? 130 : property === "--p8-pink" ? 57 : 23, line: 3,
      value: property === "width" ? "300px" : property === "@container" ? "stage (30px < width < 60px)" : property === "--p8-pink" ? "#ff77a8" : sourceValue, hints: property === "initial-value" ? sourceHints : {}, note: "Source note", problems: [] })), configured: {}, problems: [] } as T
  }
  const controller = createKnobsController({ request, frames: () => [iframe as unknown as HTMLIFrameElement], variant: () => target, changed: () => { changes++ } })
  controllers.push(controller)
  return { controller, requests, sheet, cardRule,
    setControl(syntax: string, value: string, hints: Record<string, unknown> = {}) { rows.syntax = syntax; rows.initialValue = sourceValue = value; sourceHints = hints },
    setMalformed() { malformed = true },
    setTarget(next: typeof target) { target = next }, setWrite(result: object) { writeResult = result }, setPromote(result: object) { promoteResult = result },
    setWriteWait(promise: Promise<object>) { writeWait = promise }, setLocateWait(promise: Promise<void>) { locateWait = promise },
    observe() { observer?.([{ target: node, addedNodes: [] }]) }, get changes() { return changes }, get disconnected() { return disconnected } }
}
async function opened() {
  const fixture = setup()
  fixture.controller.sync(true)
  await wait(() => fixture.controller.getView()._tag === "Ready")
  return fixture
}

describe("knobs behavioral controller", () => {
  test("starts closed, discovers located controls, and getView does no I/O", async () => {
    const fixture = setup()
    expect(fixture.controller.getView()).toEqual({ _tag: "Closed" })
    fixture.controller.sync(true)
    await wait(() => fixture.controller.getView()._tag === "Ready")
    const before = fixture.requests.length
    const view = ready(fixture.controller.getView())
    expect(view.knobs.map(knob => knob.origin)).toEqual(["Property", "Threshold", "Threshold"])
    expect(view.knobs[0]?.source).toEqual({ file: "src/tokens.css", line: 3 })
    expect(view.knobs[0]?.control).toEqual({ _tag: "Number", number: 360, unit: "", step: 1 })
    fixture.controller.getView()
    expect(fixture.requests.length).toBe(before)
    expect(JSON.stringify(view)).not.toContain("0123456789abcdef")
  })
  test("input is CSSOM-only, reapply survives sheet replacement, cancel restores without writing", async () => {
    const fixture = await opened()
    const id = ready(fixture.controller.getView()).knobs[0]!.id
    fixture.controller.input(id, "480")
    expect((fixture.sheet.cssRules[0] as CSSPropertyRule).initialValue).toBe("480")
    fixture.sheet.cssRules[0] = new CSSPropertyRule(fixture.sheet)
    fixture.observe()
    expect((fixture.sheet.cssRules[0] as CSSPropertyRule).initialValue).toBe("480")
    await Bun.sleep(170)
    fixture.controller.cancel(id)
    expect((fixture.sheet.cssRules[0] as CSSPropertyRule).initialValue).toBe("360")
    expect(fixture.requests.filter(request => request.path === "knobs/write")).toHaveLength(0)
  })
  test("commit writes the retained source version once and disables duplicate writes", async () => {
    const fixture = await opened()
    let resolve!: (result: object) => void
    fixture.setWriteWait(new Promise(done => { resolve = done }))
    const id = ready(fixture.controller.getView()).knobs[0]!.id
    fixture.controller.input(id, "420")
    fixture.controller.commit(id, "420")
    fixture.controller.commit(id, "430")
    fixture.controller.input(id, "440")
    expect(ready(fixture.controller.getView()).knobs[0]?.edit._tag).toBe("Disabled")
    const writes = fixture.requests.filter(request => request.path === "knobs/write")
    expect(writes).toHaveLength(1)
    expect(writes[0]?.data).toEqual({ file: "src/tokens.css", take: null, version: "0123456789abcdef", start: 20, end: 23, expected: "360", value: "420" })
    resolve({ _tag: "Written" })
    await wait(() => ready(fixture.controller.getView()).knobs[0]?.write._tag === "Saved")
  })
  test.each(["Conflict", "Failed"])("%s restores source value and retains the reason", async tag => {
    const fixture = await opened()
    fixture.setWrite(tag === "Conflict" ? { _tag: "Conflict", reason: "Changed outside" } : { error: "No write" })
    const id = ready(fixture.controller.getView()).knobs[0]!.id
    fixture.controller.commit(id, "420")
    await wait(() => ready(fixture.controller.getView()).knobs[0]?.write._tag === tag)
    expect(ready(fixture.controller.getView()).knobs[0]?.value).toBe("360")
    expect((fixture.sheet.cssRules[0] as CSSPropertyRule).initialValue).toBe("360")
  })
  test("rejects unknown ids, invalid numeric values and unchanged commits", async () => {
    const fixture = await opened()
    const id = ready(fixture.controller.getView()).knobs[0]!.id
    for (const value of ["", "NaN", "Infinity", "4px", "360"]) fixture.controller.commit(id, value)
    fixture.controller.commit("stale", "440")
    expect(fixture.requests.filter(request => request.path === "knobs/write")).toHaveLength(0)
  })
  test("thresholds compose live and cancel independently, without an invented maximum", async () => {
    const fixture = await opened()
    const knobs = ready(fixture.controller.getView()).knobs
    expect(knobs[1]?.control).toEqual({ _tag: "Number", number: 30, unit: "px", step: 1, min: 0 })
    fixture.controller.input(knobs[1]!.id, "40px")
    fixture.controller.input(knobs[2]!.id, "90px")
    expect((fixture.sheet.cssRules[3] as CSSContainerRule).conditionText).toBe("stage (40px < width < 90px)")
    fixture.controller.cancel(knobs[1]!.id)
    expect((fixture.sheet.cssRules[3] as CSSContainerRule).conditionText).toBe("stage (30px < width < 90px)")
  })
  test("take ids differ, stale actions cannot write, and late saves cannot change another variant", async () => {
    const fixture = await opened()
    const old = ready(fixture.controller.getView()).knobs[0]!.id
    let resolve!: (result: object) => void
    fixture.setWriteWait(new Promise(done => { resolve = done }))
    fixture.controller.commit(old, "420")
    fixture.setTarget({ take: "2", label: "Take 2" })
    fixture.controller.sync(true)
    await wait(() => fixture.controller.getView()._tag === "Ready")
    const knob = ready(fixture.controller.getView()).knobs[0]!
    expect(knob.id).not.toBe(old)
    fixture.controller.commit(old, "460")
    resolve({ _tag: "Written" })
    await Bun.sleep(10)
    expect(ready(fixture.controller.getView()).knobs[0]?.write._tag).toBe("Idle")
    expect(fixture.requests.filter(request => request.path === "knobs/write")).toHaveLength(1)
    fixture.controller.commit(knob.id, "400")
    expect(fixture.requests.filter(request => request.path === "knobs/write").at(-1)?.data.take).toBe("2")
  })
  test("closing invalidates pending discovery and stops observers", async () => {
    const fixture = setup()
    let resolve!: () => void
    fixture.setLocateWait(new Promise(done => { resolve = done }))
    fixture.controller.sync(true)
    fixture.controller.sync(false)
    resolve()
    await Bun.sleep(10)
    expect(fixture.controller.getView()).toEqual({ _tag: "Closed" })
    expect(fixture.disconnected).toBe(1)
  })
  test("literal discovery is opt-in; reviewed name/home promotion preserves both spans", async () => {
    const fixture = await opened()
    expect(ready(fixture.controller.getView()).literals._tag).toBe("Closed")
    fixture.controller.literalsOpen(true)
    await wait(() => ready(fixture.controller.getView()).literals._tag === "Ready")
    const literals = ready(fixture.controller.getView()).literals
    if (literals._tag !== "Ready") throw new Error("No literals")
    const literal = literals.literals.find(item => item.property === "width")!
    fixture.controller.promote(literal.id)
    expect(fixture.requests.filter(request => request.path === "knobs/promote")).toHaveLength(0)
    fixture.controller.literalDraft(literal.id, true)
    const draft = () => {
      const view = ready(fixture.controller.getView()).literals
      if (view._tag !== "Ready") throw new Error("No literals")
      return view.literals.find(item => item.id === literal.id)!.draft
    }
    expect(draft()).toMatchObject({ _tag: "Editing", name: "--p8-card-width" })
    fixture.controller.literalName(literal.id, "--p8-pink")
    expect(draft()).toMatchObject({ create: { _tag: "Disabled" } })
    fixture.controller.promote(literal.id)
    fixture.controller.literalName(literal.id, "--card-width")
    fixture.controller.literalHome(literal.id, "unknown")
    fixture.controller.literalHome(literal.id, literal.homes[0]!.id)
    expect(draft()).toMatchObject({ preview: "Adds --card-width: 300px; to .theme (tokens.css:3), and writes var(--card-width) in its place (tokens.css:3)." })
    fixture.controller.promote(literal.id)
    await wait(() => draft()._tag === "Closed")
    const promotion = fixture.requests.find(request => request.path === "knobs/promote")!
    expect(promotion.data).toEqual({ take: null, name: "--card-width",
      literal: { file: "src/tokens.css", version: "0123456789abcdef", start: 80, end: 85, expected: "300px" },
      home: { file: "src/tokens.css", version: "0123456789abcdef", start: 50, end: 57, expected: "#ff77a8" } })
  })
  test("closing after a saved edit does not restore the old located value", async () => {
    const fixture = await opened()
    const id = ready(fixture.controller.getView()).knobs[0]!.id
    fixture.controller.commit(id, "420")
    await wait(() => ready(fixture.controller.getView()).knobs[0]?.write._tag === "Saved")
    fixture.controller.sync(false)
    expect((fixture.sheet.cssRules[0] as CSSPropertyRule).initialValue).toBe("420")
    expect(fixture.controller.getView()).toEqual({ _tag: "Closed" })
  })
  test("refreshing a different target while closed never opens Knobs", () => {
    const fixture = setup()
    fixture.controller.refresh()
    expect(fixture.controller.getView()).toEqual({ _tag: "Closed" })
    fixture.setTarget({ take: "2", label: "Take 2" })
    fixture.controller.refresh()
    expect(fixture.controller.getView()).toEqual({ _tag: "Closed" })
    expect(fixture.requests).toHaveLength(0)
  })
  test("malformed locate results are refused, never exposed as writable spans", async () => {
    const fixture = setup()
    fixture.setMalformed()
    fixture.controller.sync(true)
    await wait(() => fixture.controller.getView()._tag === "Ready")
    const view = ready(fixture.controller.getView())
    expect(view.knobs).toHaveLength(0)
    expect(view.skipped.length).toBeGreaterThan(0)
  })
  test("color text preserves a partial draft, previews valid input and updates the swatch", async () => {
    const fixture = setup()
    fixture.setControl("<color>", "#000000")
    fixture.controller.sync(true)
    await wait(() => fixture.controller.getView()._tag === "Ready")
    const id = ready(fixture.controller.getView()).knobs[0]!.id
    fixture.controller.input(id, "#f")
    expect(ready(fixture.controller.getView()).knobs[0]?.value).toBe("#f")
    expect((fixture.sheet.cssRules[0] as CSSPropertyRule).initialValue).toBe("#000000")
    fixture.controller.input(id, "#123")
    expect(ready(fixture.controller.getView()).knobs[0]?.control).toEqual({ _tag: "Color", hex: "#112233" })
    fixture.controller.commit(id, "not a color")
    expect((fixture.sheet.cssRules[0] as CSSPropertyRule).initialValue).toBe("#000000")
    expect(fixture.requests.filter(request => request.path === "knobs/write")).toHaveLength(0)
    fixture.controller.commit(id, "#123456")
    await wait(() => ready(fixture.controller.getView()).knobs[0]?.write._tag === "Saved")
    expect(fixture.requests.filter(request => request.path === "knobs/write")[0]?.data.value).toBe("#123456")
  })
  test("ident choices and number ranges recheck availability before writes", async () => {
    const fixture = setup()
    fixture.setControl("small | medium | large", "small")
    fixture.controller.sync(true)
    await wait(() => fixture.controller.getView()._tag === "Ready")
    const knob = ready(fixture.controller.getView()).knobs[0]!
    expect(knob.control).toEqual({ _tag: "Choice", options: ["small", "medium", "large"] })
    fixture.controller.commit(knob.id, "invented")
    expect(fixture.requests.filter(request => request.path === "knobs/write")).toHaveLength(0)
    fixture.controller.commit(knob.id, "medium")
    await wait(() => ready(fixture.controller.getView()).knobs[0]?.write._tag === "Saved")
    const bounded = setup()
    bounded.setControl("<number>", "360", { min: 180, max: 720, step: 10 })
    bounded.controller.sync(true)
    await wait(() => bounded.controller.getView()._tag === "Ready")
    bounded.controller.input(ready(bounded.controller.getView()).knobs[0]!.id, "999")
    expect(ready(bounded.controller.getView()).knobs[0]?.value).toBe("720")
  })
  test("promotion conflict retains the reviewed form and allows corrected retry", async () => {
    const fixture = await opened()
    fixture.controller.literalsOpen(true)
    await wait(() => ready(fixture.controller.getView()).literals._tag === "Ready")
    const view = ready(fixture.controller.getView()).literals
    if (view._tag !== "Ready") throw new Error("No literals")
    const literal = view.literals[0]!
    fixture.controller.literalDraft(literal.id, true)
    fixture.setPromote({ _tag: "Conflict", reason: "The home's file changed" })
    fixture.controller.promote(literal.id)
    await Bun.sleep(10)
    const next = ready(fixture.controller.getView()).literals
    if (next._tag !== "Ready") throw new Error("No literals")
    expect(next.literals[0]?.draft).toMatchObject({ _tag: "Failed", name: "--p8-card-width", problem: "The home's file changed" })
    fixture.controller.literalName(literal.id, "--new-width")
    const corrected = ready(fixture.controller.getView()).literals
    if (corrected._tag !== "Ready") throw new Error("No literals")
    expect(corrected.literals[0]?.draft._tag).toBe("Editing")
  })
  test("returned snapshots cannot mutate the model", async () => {
    const fixture = await opened()
    const view = ready(fixture.controller.getView())
    const mutable = view as unknown as { knobs: Array<{ label: string; edit: { _tag: string }; problems: string[] }>; problems: string[] }
    mutable.knobs[0]!.label = "Corrupted"
    mutable.knobs[0]!.edit._tag = "Disabled"
    mutable.problems.push("Corrupted")
    mutable.knobs[0]!.problems.push("Corrupted")
    const clean = ready(fixture.controller.getView())
    expect(clean.knobs[0]?.label).toBe("Rows")
    expect(clean.knobs[0]?.edit._tag).toBe("Enabled")
    expect(clean.problems).toEqual([])
    expect(clean.knobs[0]?.problems).toEqual([])
  })
  test("destroy restores active preview, ignores late results and publishes no more updates", async () => {
    const fixture = await opened()
    const knob = ready(fixture.controller.getView()).knobs[0]!
    fixture.controller.input(knob.id, "600")
    fixture.controller.destroy()
    const changes = fixture.changes
    expect((fixture.sheet.cssRules[0] as CSSPropertyRule).initialValue).toBe("360")
    fixture.controller.sync(true)
    fixture.controller.refresh()
    fixture.controller.input(knob.id, "500")
    expect(fixture.controller.getView()).toEqual({ _tag: "Closed" })
    expect(fixture.changes).toBe(changes)
  })
})
