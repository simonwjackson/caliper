import { expect, test } from "bun:test"
import { createChromeApp } from "../src/client/app/runtime"
import { withProject, manifest } from "./project-server.js"
import { createTakeStore } from "../src/takes/store.js"
import { createIntegrationReview } from "../src/takes/integration.js"
import type { ChromeView } from "../src/client/ui/contract"

const part = "src/Chip.part.tsx"
const files = { "package.json": manifest(), "src/index.ts": "export {}", [part]: "export default function Chip() { return <span>chip</span> }" }
const options = { agent: { model: "m", baseUrl: "http://127.0.0.1:9/v1", apiKeyEnv: "PATH", skills: false as const } }
const anchor = {
  kind: "Point", rect: { x: 5, y: 5, width: 0, height: 0 }, elements: [], afterInput: false,
  element: { selector: "#caliper-host > span:nth-of-type(1)", tag: "span", classes: [], text: "chip", box: { x: 0, y: 0, width: 30, height: 18 } },
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30))

/** Real HTTP to a live dev server. Without frames, every mark is unresolved in this chrome. */
test("the app wiring loads the draft, keeps frames' markability honest and blocks an unchecked Send", () => withProject({ files, options }, async ({ url, root, get }) => {
  const store = createTakeStore(root)
  const take = store.create({ part, state: "default", device: "rg353m", prompt: "Warm" })
  const created = store.record(take)!.created
  const alternate = createIntegrationReview(store).begin(take)
  const notices: string[] = []
  const app = createChromeApp({
    hash: `#part=${part}&state=takes:default&take=${take}&device=rg353m`,
    request: async <T,>(path: string, data?: object): Promise<T> => {
      const response = await fetch(new URL(`__caliper/${path}`, url), data === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error)
      return value
    },
  })
  app.subscribe(() => { for (const notice of app.getSnapshot().composer.notices) if (!notices.includes(notice.text)) notices.push(notice.text) })
  try {
    app.receiveProject(await (await get("/__caliper/project.json")).json())
    app.receiveTakes(await (await get("/__caliper/takes.json")).json())
    expect(app.getSnapshot().markup).toEqual({ _tag: "Unavailable", reason: "Loading the draft of marks…" })
    await app.loadMarks()
    const view: ChromeView = app.getSnapshot()
    expect(view.markup).toMatchObject({ _tag: "Ready", revision: 0, groups: [], send: { _tag: "Idle", availability: { _tag: "Disabled", reason: "Mark a take first." } } })
    if (view.canvas._tag !== "Frames") throw new Error("no frames")
    const byTake = new Map(view.canvas.frames.map(frame => [frame.take, frame]))
    // Phase 6: the original frame is markable too (plan decision 8).
    expect(byTake.get(null)?.markable._tag).toBe("Enabled")
    expect(byTake.get(take)?.markable._tag).toBe("Enabled")
    expect(byTake.get(alternate)?.markable).toEqual({ _tag: "Disabled", reason: "Alternates have their own review. Mark the experiment instead." })

    app.actions.onMarkPoint(byTake.get(take)!.key, { x: 5, y: 5 })
    await settle()
    expect(notices).toContain("Wait for the frame to render, then mark it.")

    // A mark from another chrome arrives on the stream.
    const added = await (await fetch(new URL("__caliper/marks", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: 0, source: { take, created }, preview: { part, state: "default" }, device: "rg353m", anchor }) })).json()
    app.receiveMarks(added.draft)
    await settle()
    const marked = app.getSnapshot().markup
    if (marked._tag !== "Ready") throw new Error("not ready")
    expect(marked.groups[0]?.marks[0]).toMatchObject({ name: `${take}A`, location: { _tag: "Unresolved" } })
    expect(marked.send).toMatchObject({ _tag: "Idle", label: "Send · 1 new take", availability: { _tag: "Disabled" } })
    app.receiveMarks({ revision: 0, marks: [] })
    await settle()
    expect((app.getSnapshot().markup as { revision: number }).revision).toBe(1)

    app.actions.onMarkEdit(added.id)
    app.actions.onMarkNote(added.id, "love this")
    await settle()
    expect(app.getSnapshot().markup).toMatchObject({ editor: { _tag: "Open", name: `${take}A`, note: "love this" } })
    app.actions.onMarkEdit(null)
    for (let attempt = 0; attempt < 50 && (app.getSnapshot().markup as { revision: number }).revision < 2; attempt++) await settle()
    expect((await (await get("/__caliper/marks.json")).json()).marks[0].note).toBe("love this")

    // Phase 6: a mark on the original needs its subject; a note that names it makes it a reference.
    const post = (path: string, body: object) => fetch(new URL(`__caliper/${path}`, url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    expect((await post("marks", { revision: 2, source: { take: "0", created: 0 }, preview: { part, state: "default" }, device: "rg353m", anchor })).status).toBe(400)
    const onOriginal = await (await post("marks", { revision: 2, source: { take: "0", created: 0 }, preview: { part, state: "default" }, subject: { part, state: "default" }, device: "rg353m", anchor })).json()
    app.receiveMarks(onOriginal.draft)
    app.actions.onMarkEdit(added.id)
    app.actions.onMarkNote(added.id, "love this, use 0A")
    await settle()
    const referring = app.getSnapshot().markup
    if (referring._tag !== "Ready" || referring.editor._tag !== "Open") throw new Error("no editor")
    expect(referring.editor.references.map(option => option.name)).toEqual(["0A"])
    expect(referring.groups.map(group => [group.label, group.outcome._tag])).toEqual([[`Take ${take} · Take ${take}`, "NewTake"], ["Original · the real files", "PointedTo"]])
    expect(referring.groups[0]?.marks[0]?.references).toEqual(["0A"])
    app.actions.onMarkEdit(null)
    for (let attempt = 0; attempt < 50 && (app.getSnapshot().markup as { revision: number }).revision < 4; attempt++) await settle()
    const release = await post("marks/release", { revision: 4, ids: [added.id] })
    expect(release.status).toBe(400)
    expect((await release.json()).error).toBe("Only marks on the original go with a prompt.")
    const released = await (await post("marks/release", { revision: 4, ids: [onOriginal.id] })).json()
    expect(released.draft.marks.map((mark: { id: string }) => mark.id)).toEqual([added.id])
    app.receiveMarks(released.draft)

    app.actions.onSend(0)
    await settle()
    expect(notices).toContain("The draft changed since you looked at it. Check it and send again.")
    app.actions.onMarkRemove(added.id)
    for (let attempt = 0; attempt < 50 && (app.getSnapshot().markup as { readonly groups: readonly unknown[] }).groups.length; attempt++) await settle()
    expect((await (await get("/__caliper/marks.json")).json()).marks).toEqual([])
  } finally { app.dispose() }
}), 30_000)
