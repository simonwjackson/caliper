import { createRoot } from "react-dom/client"
import { useSyncExternalStore } from "react"
import Darkroom from "../ui/Darkroom"
import { createChromeApp } from "./runtime"
import { validateResponse } from "./wire"

const app = createChromeApp({
  hash: location.hash, storage: localStorage, origin: location.origin,
  saveLocation: hash => history.replaceState(null, "", hash), confirm: text => window.confirm(text),
  request: async <T,>(path: string, data?: object): Promise<T> => {
    const response = await fetch(path.replace(/^\//, ""), data === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) })
    const value = await response.json()
    const conflict = response.status === 409 && (path === "knobs/write" || path === "knobs/promote") && value?._tag === "Conflict"
    if (!response.ok && !conflict) throw new Error(value?.error ?? `HTTP ${response.status}`)
    validateResponse(path, value, data !== undefined)
    return value
  },
  imageData: file => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { const data = String(reader.result); resolve({ data: data.slice(data.indexOf(",") + 1), url: URL.createObjectURL(file) }) }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  }),
  revokeImage: url => URL.revokeObjectURL(url),
})
function App() {
  const view = useSyncExternalStore(app.subscribe, app.getSnapshot)
  return <Darkroom view={view} actions={app.actions} />
}
const host = document.getElementById("caliper")
if (!host) throw new Error("Caliper's mounting element is missing.")
const root = createRoot(host)
root.render(<App />)
const events = new EventSource("events")
function receive(handler: (value: unknown) => void) {
  return (event: Event) => {
    try { handler(JSON.parse((event as MessageEvent<string>).data)) }
    catch (error) { app.unreachable(error instanceof Error ? error.message : String(error)) }
  }
}
events.addEventListener("project", receive(app.receiveProject))
events.addEventListener("takes", receive(app.receiveTakes))
events.addEventListener("checks", receive(app.receiveChecks))
events.addEventListener("code", receive(app.receiveCode))
events.addEventListener("error", () => app.unreachable())
const report = (event: MessageEvent<unknown>) => app.receiveFrame(event)
window.addEventListener("message", report)
window.addEventListener("pagehide", () => { events.close(); window.removeEventListener("message", report); root.unmount(); app.dispose() }, { once: true })
