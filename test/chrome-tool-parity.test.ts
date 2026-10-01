import { afterEach, describe, expect, test } from "bun:test"
import { createChromeApp } from "../src/client/app/runtime"
import { createScenario } from "../src/client/ui/fixtures/scenario"
import { logView, takesView } from "../src/client/ui/fixtures/views"
import { showsBar, sideOpen } from "../src/client/ui/Darkroom"
import { STANDARD_DEVICES } from "../src/client/device-frame.js"
import type { Project, TakesSnapshot } from "../src/types"
import type { ChromeActions, ChromeView } from "../src/client/ui/contract"

// The gallery is how Caliper judges a change to its own chrome (decisions 18
// and 36), so a tool press or a Close must end the same way there as in the
// app. Both sides run their real code; only the app's server is in memory.

const part = "src/Chip.atom.part.tsx"
const project: Project = {
  name: "parity", devices: STANDARD_DEVICES,
  parts: [{ file: part, name: "Chip", layer: "atom", states: [{ export: "default", label: "Default" }] }],
  entry: { _tag: "Derived", value: { file: "src/main.tsx" }, source: { file: "index.html", line: 6 }, via: "module script" },
  css: { _tag: "Derived", value: { stylesheets: [], unresolved: [] }, source: { file: "src/main.tsx", line: 1 }, via: "entry imports" },
  wrapper: { _tag: "Overridden", value: { elements: [] }, option: "wrap" },
}
const takes: TakesSnapshot = {
  agent: { _tag: "Ready", model: "local", baseUrl: "http://localhost:8080/v1", reasoning: "off", api: "chat-completions", baseUrlFrom: "test configuration", keyFrom: "test environment" },
  skills: { skills: [], problems: [] }, accepted: [], takes: [],
}

type Step = { [K in keyof ChromeActions]: [K, ...Parameters<ChromeActions[K]>] }[keyof ChromeActions]
type Side = { readonly act: (step: Step) => void; readonly view: () => ChromeView }
const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose() })

function app(): Side {
  const app = createChromeApp({ hash: `#part=${encodeURIComponent(part)}&state=default`, request: async <T>(path: string): Promise<T> => {
    if (path === "project.json") return project as T
    if (path === "takes.json") return takes as T
    return {} as T
  } })
  disposers.push(() => app.dispose())
  app.receiveProject(project); app.receiveTakes(takes)
  return { act: ([name, ...args]) => (app.actions[name] as (...values: unknown[]) => void)(...args), view: () => app.getSnapshot() }
}
function gallery(start: ChromeView["tools"]): Side {
  const base = takesView()
  const scenario = createScenario({ ...base, tools: { ...base.tools, ...start }, code: { _tag: "Closed" }, knobs: { _tag: "Closed" }, record: { _tag: "Closed" }, checks: { _tag: "Closed" }, calibration: { _tag: "Closed" } })
  return { act: ([name, ...args]) => (scenario.actions[name] as (...values: unknown[]) => void)(...args), view: () => scenario.getView() }
}
/** What a person sees: the pressed tool, the open panes and windows, and the composer bar. */
const seen = (view: ChromeView) => ({
  pressed: view.tools.active,
  code: view.tools.codeOpen && view.code._tag !== "Closed",
  side: sideOpen(view) ? view.tools.side : "closed",
  checks: view.checks._tag !== "Closed",
  calibration: view.calibration._tag !== "Closed",
  composer: showsBar(view),
})

const sequences: Record<string, readonly Step[]> = {
  "the worked example, by Close buttons": [["onTool", "takes"], ["onTool", "code"], ["onTool", "knobs"], ["onKnobsClose"], ["onCodeClose"]],
  "the worked example, by second presses": [["onTool", "takes"], ["onTool", "code"], ["onTool", "knobs"], ["onTool", "knobs"], ["onTool", "code"]],
  "Code twice": [["onTool", "code"], ["onTool", "code"]],
  "Knobs twice": [["onTool", "knobs"], ["onTool", "knobs"]],
  "Checks over Code, then Close": [["onTool", "code"], ["onTool", "checks"], ["onChecksClose"]],
  "Calibrate over Takes, then Done": [["onTool", "takes"], ["onTool", "calibrate"], ["onCalibrationClose"]],
  "Calibrate pressed twice": [["onTool", "takes"], ["onTool", "calibrate"], ["onTool", "calibrate"]],
  "Checks over Calibrate over Code": [["onTool", "code"], ["onTool", "calibrate"], ["onTool", "checks"], ["onChecksClose"], ["onCalibrationClose"]],
  "Close Knobs beside Code": [["onTool", "knobs"], ["onTool", "code"], ["onKnobsClose"]],
  "a covered pane comes back": [["onTool", "code"], ["onTool", "preview"], ["onTool", "code"], ["onTool", "calibrate"], ["onTool", "code"], ["onTool", "calibrate"]],
}

describe("the app follows the agreed behaviour, not only the gallery", () => {
  test("the worked example ends on Takes with the composer shown", async () => {
    const real = app()
    await Promise.resolve()
    for (const step of sequences["the worked example, by Close buttons"] ?? []) real.act(step)
    expect(seen(real.view())).toEqual({ pressed: "takes", code: false, side: "closed", checks: false, calibration: false, composer: true })
  })
  test("Close Knobs closes the panel beside Code", async () => {
    const real = app()
    await Promise.resolve()
    for (const step of sequences["Close Knobs beside Code"] ?? []) real.act(step)
    expect(seen(real.view())).toMatchObject({ pressed: "code", code: true, side: "closed" })
  })
})

describe("the gallery keeps what the app keeps", () => {
  test("after the record's Close, Takes shows the same record again", () => {
    const scenario = createScenario(logView())
    const shown = scenario.getView().record
    expect(shown._tag).toBe("Open")
    scenario.actions.onRecordClose()
    expect(scenario.getView().record._tag).toBe("Closed")
    expect(scenario.getView().tools.active).toBe("takes")
    scenario.actions.onTool("takes")
    expect(scenario.getView().record).toEqual(shown)
  })
})

describe("a tool press or a Close ends the same way in the gallery as in the app", () => {
  for (const [name, steps] of Object.entries(sequences)) {
    test(name, async () => {
      const real = app()
      await Promise.resolve()
      const local = gallery(real.view().tools)
      expect(seen(local.view())).toEqual(seen(real.view()))
      for (const [index, step] of steps.entries()) {
        real.act(step); local.act(step)
        await Promise.resolve()
        expect({ step: index + 1, ...seen(local.view()) }).toEqual({ step: index + 1, ...seen(real.view()) })
      }
    })
  }
})
