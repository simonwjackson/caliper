// The unstyled reference renderer on the real app wiring, served from a live
// subject. Only the renderer differs from entry.tsx: the production Darkroom
// markup belongs to the UI worker. Requests, the event stream and frame
// documents are real.
import { createRoot } from "react-dom/client"
import { useSyncExternalStore } from "react"
import Chrome from "../../src/client/ui/Chrome"
import { createChromeApp } from "../../src/client/app/runtime"
import { validateResponse } from "../../src/client/app/wire"

const app = createChromeApp({
  hash: location.hash, storage: localStorage, origin: location.origin,
  saveLocation: hash => history.replaceState(null, "", hash), confirm: () => true,
  request: async <T,>(path: string, data?: object): Promise<T> => {
    const response = await fetch(path.replace(/^\//, ""), data === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) })
    const value = await response.json()
    if (!response.ok) throw new Error(value?.error ?? `HTTP ${response.status}`)
    validateResponse(path, value, data !== undefined)
    return value
  },
})
// Read-only access for the gate's assertions. Actions go through the rendered controls.
Object.assign(window, { caliperHarness: { snapshot: () => app.getSnapshot() } })
function App() {
  const view = useSyncExternalStore(app.subscribe, app.getSnapshot)
  return <Chrome view={view} actions={app.actions} />
}
const host = document.getElementById("caliper")
if (!host) throw new Error("The harness's mounting element is missing.")
createRoot(host).render(<App />)
const events = new EventSource("events")
const receive = (handler: (value: unknown) => void) => (event: Event) => handler(JSON.parse((event as MessageEvent<string>).data))
events.addEventListener("project", receive(app.receiveProject))
events.addEventListener("takes", receive(app.receiveTakes))
events.addEventListener("checks", receive(app.receiveChecks))
events.addEventListener("code", receive(app.receiveCode))
events.addEventListener("marks", receive(app.receiveMarks))
events.addEventListener("error", () => app.unreachable())
void app.loadMarks()
window.addEventListener("message", event => app.receiveFrame(event))
