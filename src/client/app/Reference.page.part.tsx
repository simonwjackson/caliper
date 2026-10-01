import { useEffect, useState, useSyncExternalStore } from "react"
import Chrome from "../ui/Chrome"
import { createChromeApp } from "./runtime"
import { STANDARD_DEVICES } from "../device-frame.js"

export const name = "Reference chrome"
export const note = "Local empty-project inputs. Navigation, filter, tools and calibration work without a server. Agent and file writes are unavailable."

/** The pinned tool can inspect the reference without running the subject's dev chrome. */
function Scenario({ initial }: { initial: "ready" | "calibrate" | "unreachable" }) {
  const [app] = useState(() => {
    const app = createChromeApp({ request: async () => { throw new Error("This local scenario has no source or agent server.") } })
    app.receiveProject({ name: "Caliper subject", parts: [], entry: { _tag: "Overridden", value: { file: "src/client/app/entry.tsx" }, option: "entry" }, css: { _tag: "Overridden", value: { stylesheets: [], unresolved: [] }, option: "css" }, wrapper: { _tag: "Overridden", value: { elements: [] }, option: "wrap" }, devices: STANDARD_DEVICES })
    app.receiveTakes({ agent: { _tag: "Off", hint: "This scenario supplies local inputs and does not start an agent." }, skills: { skills: [], problems: [] }, takes: [], accepted: [] })
    if (initial === "calibrate") app.actions.onTool("calibrate")
    if (initial === "unreachable") app.unreachable("The local scenario records an unreachable subject server.")
    return app
  })
  const view = useSyncExternalStore(app.subscribe, app.getSnapshot)
  useEffect(() => () => app.dispose(), [app])
  return <Chrome view={view} actions={app.actions} />
}
export default function Ready() { return <Scenario initial="ready" /> }
export function Calibrate() { return <Scenario initial="calibrate" /> }
export function Unreachable() { return <Scenario initial="unreachable" /> }
