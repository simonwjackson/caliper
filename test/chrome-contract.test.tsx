import { expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import Chrome from "../src/client/ui/Chrome"
import { CAL, calSelector } from "../src/client/ui/hooks"
import { contractViews, readyView, markupView } from "./fixtures/chrome-view"
import { createChromeScenario } from "./fixtures/chrome-scenario"

const require = createRequire(import.meta.url)
test("contract examples render every declared behavioral hook across their applicable states", () => {
  const found = new Set<string>()
  for (const view of Object.values(contractViews())) {
    const scenario = createChromeScenario(view)
    const html = renderToStaticMarkup(createElement(Chrome, { view, actions: scenario.actions }))
    for (const match of html.matchAll(/data-cal="([^"]+)"/g)) if (match[1]) found.add(match[1])
  }
  expect(Object.values(CAL).filter(hook => !found.has(hook))).toEqual([])
  expect(new Set(Object.values(CAL)).size).toBe(Object.values(CAL).length)
  expect(calSelector(CAL.accept)).toBe('[data-cal="take-accept"]')
})
test("local scenario updates explicit inputs without mutating the original snapshot", () => {
  const initial = readyView()
  const scenario = createChromeScenario(initial)
  scenario.actions.onPrompt("New words")
  expect(scenario.getView().composer.prompt).toBe("New words")
  expect(initial.composer.prompt).toBe("Make the button quiet")
  expect(scenario.calls.at(-1)).toEqual({ name: "onPrompt", args: ["New words"] })
})
test("shared seam has no runtime imports or references to live app wiring", () => {
  const contract = readFileSync(new URL("../src/client/ui/contract.ts", import.meta.url), "utf8")
  expect(contract.match(/^import (?!type)/gm)).toBeNull()
  expect(contract).not.toContain("client/app/")
  const renderer = readFileSync(new URL("../src/client/ui/Chrome.tsx", import.meta.url), "utf8")
  expect(renderer).not.toMatch(/\b(fetch|localStorage|EventSource)\b/)
  expect(renderer).not.toContain('from "../app/')
  expect(renderer).not.toMatch(/\b(contentDocument|elementFromPoint)\b/)
})
test("editing and removing draft marks updates explicit inputs without changing the original", () => {
  const initial = markupView()
  const scenario = createChromeScenario(initial)
  scenario.actions.onMarkNote("mark-6-a", "Keep the title")
  let view = scenario.getView()
  expect(view.markup._tag).toBe("Ready")
  if (view.markup._tag === "Ready") {
    expect(view.markup.revision).toBe(5)
    expect(view.markup.groups[0]?.marks[0]?.note).toBe("Keep the title")
  }
  if (initial.markup._tag === "Ready") expect(initial.markup.groups[0]?.marks[0]?.note).toBe("Keep this spacing")
  scenario.actions.onMarkReplace("mark-6-a")
  scenario.actions.onMarkRemove("mark-6-a")
  view = scenario.getView()
  if (view.markup._tag === "Ready") {
    expect(view.markup.mode).toEqual({ _tag: "Off" })
    expect(view.markup.editor).toEqual({ _tag: "Closed" })
    expect(view.markup.send).toMatchObject({ _tag: "Idle", label: "Send · 1 new take" })
  }
  if (view.canvas._tag === "Frames") expect(view.canvas.frames.flatMap(frame => frame.marks).map(mark => mark.id)).toEqual(["mark-7-a"])
})

test("stale, blocked and duplicate Send requests cannot start a local submission", () => {
  const scenario = createChromeScenario(markupView())
  scenario.actions.onSend(3)
  let view = scenario.getView()
  if (view.markup._tag === "Ready") expect(view.markup.send._tag).toBe("Idle")
  scenario.actions.onSend(4)
  const sending = scenario.getView()
  expect(sending.markup).toMatchObject({ _tag: "Ready", send: { _tag: "Sending" } })
  scenario.actions.onSend(4)
  scenario.actions.onMarkNote("mark-6-a", "Must not change a submitted draft")
  scenario.actions.onMarkRemove("mark-6-a")
  expect(scenario.getView()).toBe(sending)
  for (const state of ["empty", "lost", "blocked"] as const) {
    const blocked = createChromeScenario(markupView(state))
    blocked.actions.onSend(4)
    view = blocked.getView()
    if (view.markup._tag === "Ready") expect(view.markup.send._tag).toBe("Idle")
  }
})

test("removing one blocking mark never authorizes the other running parent", () => {
  const scenario = createChromeScenario(markupView("blocked"))
  scenario.actions.onMarkRemove("mark-6-a")
  const view = scenario.getView()
  if (view.markup._tag === "Ready" && view.markup.send._tag === "Idle") expect(view.markup.send.availability._tag).toBe("Disabled")
})

test("removing a lost mark refreshes the surviving parent's draft decision", () => {
  const initial = markupView("lost")
  if (initial.markup._tag !== "Ready") throw new Error("Expected a draft fixture")
  const group = initial.markup.groups[0]!
  const extra = { ...group.marks[0]!, id: "mark-6-b", name: "6B", letter: "B", location: { _tag: "Located" as const } }
  const scenario = createChromeScenario({ ...initial, markup: { ...initial.markup, groups: [{ ...group, marks: [...group.marks, extra] }, ...initial.markup.groups.slice(1)] } })
  scenario.actions.onMarkRemove("mark-6-a")
  const view = scenario.getView()
  expect(view.markup).toMatchObject({ _tag: "Ready", groups: [{ source: { take: "6", created: 1234 }, marks: [{ id: "mark-6-b" }], decision: { _tag: "Ready" } }, { decision: { _tag: "Ready" } }], send: { _tag: "Idle", availability: { _tag: "Enabled" } } })
})

test("contract positive and negative type probes pass with library checking", () => {
  const output = execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"),
    "--noEmit", "--strict", "--skipLibCheck", "false", "--jsx", "preserve",
    "--allowJs", "--module", "esnext", "--moduleResolution", "bundler", "--target", "es2022",
    "--types", "node", "test/chrome-contract-types.ts",
  ], { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 30_000 })
  expect(output).toBe("")
}, 35_000)
