import { useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import Chrome from "../../src/client/ui/Chrome"
import { CAL } from "../../src/client/ui/hooks"
import { contractViews } from "../../test/fixtures/chrome-view"
import { createChromeScenario } from "../../test/fixtures/chrome-scenario"

const views = contractViews()
const name = new URLSearchParams(location.search).get("scenario") ?? "ready"
const initial = views[name]
if (!initial) throw new Error(`Unknown contract scenario ${name}`)
const scenario = createChromeScenario(initial)
const host = document.getElementById("root")
if (!host) throw new Error("Missing contract host")
const root = createRoot(host)
function ContractScenario() {
  const view = useSyncExternalStore(scenario.subscribe, scenario.getView)
  return <Chrome view={view} actions={scenario.actions} />
}
root.render(<ContractScenario />)
const control = {
  names: Object.keys(views),
  hooks: CAL,
  calls: scenario.calls,
  change(name: string) { const next = views[name]; if (!next) throw new Error(`Unknown scenario ${name}`); scenario.update(next) },
  tick() { scenario.update({ ...scenario.getView() }) },
  unmount() { root.unmount() },
}
declare global { interface Window { chromeContract: typeof control } }
window.chromeContract = control
