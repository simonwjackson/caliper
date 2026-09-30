import { useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import Chrome from "../src/client/ui/Chrome"
import { createChecksController } from "../src/client/app/checks"
import type { ChecksView } from "../src/checks/contract.js"
import type { ChromeActions } from "../src/client/ui/contract"
import { readyView } from "./fixtures/chrome-view"
import { createChromeScenario } from "./fixtures/chrome-scenario"

// Use the actual renderer with local scenario inputs. Checks actions and wire
// transitions use the real controller and real HTTP, not replaced fetch or DOM.
const initial = readyView()
const scenario = createChromeScenario({
  ...initial, canvas: { _tag: "Empty", message: "Retry scenario" }, focusedTake: null,
  tools: { ...initial.tools, active: "preview", codeOpen: false, side: "closed" },
  code: { _tag: "Closed" }, knobs: { _tag: "Closed" }, record: { _tag: "Closed" }, calibration: { _tag: "Closed" },
})
const controller = createChecksController({
  target: () => ({ part: "Button.part.tsx", state: "default", label: "Retry scenario" }),
  changed: () => scenario.update({ ...scenario.getView(), checks: controller.getView() }),
  request: async <T,>(path: string, data?: object): Promise<T> => {
    const response = await fetch(path, data === undefined ? undefined : {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
    return result
  },
})
const actions: ChromeActions = {
  ...scenario.actions,
  onTool: tool => { if (tool === "checks") controller.open(); else scenario.actions.onTool(tool) },
  onChecksClose: controller.close, onCheckRun: controller.run, onCheckStop: controller.stop,
  onImageLoaded: controller.imageLoaded, onImageFailed: controller.imageFailed,
  onImageReviewed: controller.imageReviewed, onApproveImage: controller.approve,
}
function ChecksScenario() {
  const view = useSyncExternalStore(scenario.subscribe, scenario.getView)
  return <Chrome view={view} actions={actions} />
}
const host = document.getElementById("root")
if (!host) throw new Error("Missing checks scenario host")
const root = createRoot(host)
root.render(<ChecksScenario />)
const events = new EventSource("events")
events.addEventListener("checks", event => controller.receive(JSON.parse((event as MessageEvent<string>).data) as ChecksView))
window.addEventListener("pagehide", () => { events.close(); root.unmount(); controller.destroy() }, { once: true })
