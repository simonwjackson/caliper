import { createRoot } from "react-dom/client"
import { useSyncExternalStore } from "react"
import Darkroom from "../ui/Darkroom"
import { createChromeApp } from "./runtime"
import { validateResponse } from "./wire"

// The Caliper app serves this chrome at /__caliper/p/<id>/<base>__caliper/ (decision 37).
const projectId = /^\/__caliper\/p\/([0-9a-f]{12})\//.exec(location.pathname)?.[1]
const chromeUrls = new Map<string, string>()
const app = createChromeApp({
  hash: location.hash, storage: localStorage, origin: location.origin,
  ...(projectId ? { project: { id: projectId, open: (id: string) => { const url = chromeUrls.get(id); if (url) location.assign(url) } } } : {}),
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
events.addEventListener("marks", receive(app.receiveMarks))
// The stream skips the draft when marks.json is broken; this read reports why.
void app.loadMarks()
events.addEventListener("error", () => app.unreachable())
const projects = projectId ? new EventSource("/__caliper/api/projects/events") : null
projects?.addEventListener("projects", event => {
  try {
    const value = JSON.parse((event as MessageEvent<string>).data)
    for (const project of value?.projects ?? []) if (typeof project?.id === "string" && typeof project?.chrome === "string") chromeUrls.set(project.id, project.chrome)
    app.receiveProjects(value)
  } catch { /* the list stays as it was */ }
})
const report = (event: MessageEvent<unknown>) => app.receiveFrame(event)
window.addEventListener("message", report)
window.addEventListener("pagehide", () => { events.close(); projects?.close(); window.removeEventListener("message", report); root.unmount(); app.dispose() }, { once: true })
