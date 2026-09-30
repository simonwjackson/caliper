/**
 * The Darkroom gallery: the real chrome with local input fixtures, until core
 * lands. `?fixture=` picks a fixture from src/client/ui/fixtures/views.ts and
 * `?scheme=light|dark` forces a scheme (otherwise the system's choice).
 * `window.gallery` exposes the recorded action calls to the gates.
 */
import { useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import Darkroom from "../../src/client/ui/Darkroom"
import { FIXTURES } from "../../src/client/ui/fixtures/views"
import type { FixtureName } from "../../src/client/ui/fixtures/views"
import { createScenario } from "../../src/client/ui/fixtures/scenario"
import { CAL } from "../../src/client/ui/hooks"
import { editorStats, fixtureEditor } from "./fixture-editor"
import { applicableHooks } from "./applicable"

const params = new URLSearchParams(location.search)
const name = (params.get("fixture") ?? "takes") as FixtureName
const make = FIXTURES[name]
if (!make) throw new Error(`Unknown fixture ${name}. Known: ${Object.keys(FIXTURES).join(", ")}`)
const scheme = params.get("scheme")
const scenario = createScenario(make(), fixtureEditor)
const host = document.getElementById("root")
if (!host) throw new Error("Missing gallery host")
const root = createRoot(host)

function Gallery() {
  const view = useSyncExternalStore(scenario.subscribe, scenario.getView)
  return <Darkroom view={view} actions={scenario.actions} scheme={scheme === "light" || scheme === "dark" ? scheme : undefined} />
}
root.render(<Gallery />)

const control = {
  fixture: name,
  names: Object.keys(FIXTURES),
  hooks: CAL,
  calls: scenario.calls,
  editor: editorStats,
  /** Replace the view with another fixture, as a stream update would. */
  change(next: string) { const factory = FIXTURES[next as FixtureName]; if (!factory) throw new Error(`Unknown fixture ${next}`); scenario.update(factory()) },
  /** A stream update with the same data: a new snapshot object, nothing changed. */
  tick() { scenario.update(structuredClone(scenario.getView())) },
  view: () => scenario.getView(),
  /** The hooks that apply to the current view, given the rendered layout. */
  applicable() {
    const root = document.querySelector<HTMLElement>("[data-cal=chrome]")
    return applicableHooks(scenario.getView(), { bar: root?.dataset.bar === "on", code: root?.dataset.code ?? "closed" })
  },
  unmount() { root.unmount() },
}
declare global { interface Window { gallery: typeof control } }
window.gallery = control
