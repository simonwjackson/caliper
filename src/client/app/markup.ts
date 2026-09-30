import type { Availability, CanvasView, DraftMarkView, FrameView, MarkMode, MarkPin, MarkPoint, MarkRect, MarkupGroup, MarkupOutcome, MarkupView, ReferenceOption } from "../ui/contract"
import type { Draft, Mark, MarkAnchor } from "../../takes/marks-contract.js"
import type { MarkLocation, SendPlan, TakeIdentity } from "../../takes/send-plan.js"
import { AddedMarkSchema, DraftResponseSchema, DraftSchema, SentSchema } from "../../takes/marks-contract.js"
import { anchorAt, anchorIn, locateAnchor } from "../../takes/anchor.js"
import { ORIGINAL, isOriginal, planSend, referencesIn } from "../../takes/send-plan.js"
import { sameState } from "../scenarios.js"
import { DEVICES } from "../device-frame.js"
import { parseWire } from "./wire"
import type { AppState } from "./state"
import { frameKey, previewRef, refLabel, subjectRef, takeName } from "./state"

/** A mark's frame: its take's, or the real files' for a mark on the original. */
const frameOf = (source: TakeIdentity) => isOriginal(source) ? null : source
/** "0A and 0B", "0A, 0B and 0C". */
const listed = (names: readonly string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

export type MarkupInput = {
  request: <T>(path: string, data?: object) => Promise<T>
  changed: () => void
  notify: (reason: unknown) => void
  inform: (text: string) => void
  state: () => AppState
  canvas: () => CanvasView
  frames: () => ReadonlyMap<string, HTMLIFrameElement>
  refreshTakes: () => Promise<void>
}
type DraftState = { _tag: "Loading" } | { _tag: "Ready"; draft: Draft } | { _tag: "Failed"; reason: string }
type SendState = { _tag: "Idle" } | { _tag: "Sending" } | { _tag: "Failed"; reason: string }
type Found = { location: MarkLocation; rect: MarkRect }
type Gesture = { _tag: "Point"; point: MarkPoint } | { _tag: "Region"; rect: MarkRect }

const enabled: Availability = { _tag: "Enabled" }
const disabled = (reason: string): Availability => ({ _tag: "Disabled", reason })
const NOTE_DELAY_MS = 400
const RESOLVE_DELAY_MS = 60
/** A pointer that moves less than this is a click, not a drag. Matches the reference overlay. */
const DRAG_PX = 4

/**
 * Marks, the shared draft and Send. Owns frame documents for marking: it
 * turns gestures into anchors, finds each mark again after every load, draft
 * change, scroll and DOM change, and catches Alt-click and Alt-drag inside
 * frames. Where a mark is is computed in each chrome, never stored.
 */
export function createMarkupController(input: MarkupInput) {
  let draft: DraftState = { _tag: "Loading" }
  let mode: MarkMode = { _tag: "Off" }
  let resume: MarkMode = { _tag: "Off" }
  let draftOpen = false
  let editor: { id: string; note: string; saved: string } | null = null
  let send: SendState = { _tag: "Idle" }
  let found = new Map<string, Found>()
  let writes: Promise<unknown> = Promise.resolve()
  let pending = 0, disposed = false
  let noteTimer: ReturnType<typeof setTimeout> | undefined
  let resolveTimer: ReturnType<typeof setTimeout> | undefined
  const afterInput = new Map<string, boolean>()
  const detach = new Map<string, () => void>()

  const ready = () => draft._tag === "Ready" ? draft.draft : null
  const nameOf = (mark: Mark) => `${mark.source.take}${mark.letter}`
  /** The note as this chrome shows it: the open editor's text, which is saved before Send. */
  const shownNote = (mark: Mark) => editor?.id === mark.id ? editor.note : mark.note
  const sameTake = (left: TakeIdentity, right: TakeIdentity) => left.take === right.take && left.created === right.created
  const takeOf = (source: TakeIdentity) => input.state().takes?.takes.find(take => sameTake(take, source)) ?? null

  function receive(value: unknown) {
    const next = parseWire(DraftSchema, value)
    const current = ready()
    // Stream and HTTP replies can arrive out of order. Never go back.
    if (current && next.revision < current.revision) return
    draft = { _tag: "Ready", draft: next }
    if (editor && !next.marks.some(mark => mark.id === editor?.id)) editor = null
    if (mode._tag === "Replacing" && !next.marks.some(mark => mark.id === (mode as { id: string }).id)) mode = resume
    resolve()
    input.changed()
  }
  async function reload() {
    try { receive(await input.request<unknown>("marks.json")) }
    catch (error) {
      if (!ready()) { draft = { _tag: "Failed", reason: error instanceof Error ? error.message : String(error) }; input.changed() }
      else input.notify(error)
    }
  }

  /** One write at a time, each against the newest revision this chrome has seen. */
  function write<T extends { draft: Draft }>(path: string, body: object, schema: typeof DraftResponseSchema | typeof AddedMarkSchema): Promise<T> {
    pending++; input.changed()
    const run = writes.then(async () => {
      const current = ready()
      if (!current) throw new Error("The draft of marks is not loaded.")
      try {
        const result = parseWire(schema, await input.request<unknown>(path, { ...body, revision: current.revision })) as T
        receive(result.draft)
        return result
      } catch (error) {
        await reload()
        throw error
      }
    })
    writes = run.catch(() => undefined).finally(() => { pending--; input.changed() })
    return run
  }

  // Where each mark is, in this chrome's frames.
  function locate(mark: Mark): Found {
    const state = input.state(), name = nameOf(mark)
    const unresolved = (reason: string): Found => ({ location: { _tag: "Unresolved", reason }, rect: viewportRect(mark.anchor.rect, null) })
    if (mark.device !== state.device.id) return unresolved(`${name} was placed on ${deviceName(mark.device)}. Switch to it to check ${name}.`)
    const node = input.frames().get(frameKey(mark.preview, frameOf(mark.source)))
    if (!node) return unresolved(`Show ${isOriginal(mark.source) ? "the real files" : `take ${mark.source.take}`} in ${refLabel(state, mark.preview)} to check ${name}.`)
    let document: Document | null = null
    try { document = node.contentDocument } catch { document = null }
    const status = document?.documentElement?.dataset.caliperState
    if (!document || status === undefined || status === "Loading") return unresolved(`${isOriginal(mark.source) ? "The real files'" : `Take ${mark.source.take}'s`} frame is loading. ${name} is checked when it renders.`)
    const where = locateAnchor(document, mark.anchor)
    return where._tag === "Located"
      ? { location: { _tag: "Located" }, rect: viewportRect(where.rect, document) }
      : { location: { _tag: "Lost", reason: `${where.reason} Re-place or remove ${name}.` }, rect: viewportRect(where.rect, document) }
  }
  function resolve() {
    clearTimeout(resolveTimer); resolveTimer = undefined
    const marks = ready()?.marks ?? []
    const next = new Map(marks.map(mark => [mark.id, locate(mark)]))
    const same = next.size === found.size && [...next].every(([id, value]) => JSON.stringify(found.get(id)) === JSON.stringify(value))
    found = next
    if (!same) input.changed()
  }
  function schedule() {
    if (disposed || resolveTimer !== undefined || !ready()?.marks.length) return
    resolveTimer = setTimeout(resolve, RESOLVE_DELAY_MS)
  }

  // Placing and moving marks.
  function frameFor(key: string): FrameView | null {
    const canvas = input.canvas()
    return canvas._tag === "Frames" ? canvas.frames.find(frame => frame.key === key) ?? null : null
  }
  function canMark(key: string) {
    const frame = frameFor(key)
    return Boolean(ready() && send._tag !== "Sending" && frame?.markable._tag === "Enabled")
  }
  function place(key: string, gesture: Gesture) {
    const current = ready(), frame = frameFor(key)
    if (!current || send._tag === "Sending" || !frame) return
    if (frame.markable._tag === "Disabled") return input.notify(new Error(frame.markable.reason))
    const take = frame.take === null ? null : input.state().takes?.takes.find(item => item.take === frame.take) ?? null
    let document: Document | null = null
    try { document = input.frames().get(key)?.contentDocument ?? null } catch { document = null }
    const status = document?.documentElement?.dataset.caliperState
    if ((frame.take !== null && !take) || !document || status === undefined || status === "Loading") return input.notify(new Error("Wait for the frame to render, then mark it."))
    const input_ = afterInput.get(key) ?? false
    const anchored = gesture._tag === "Point" ? anchorAt(document, gesture.point, input_) : anchorIn(document, gesture.rect, input_)
    if (anchored._tag === "Refused") return input.notify(new Error(anchored.reason))
    const device = input.state().device.id, source: TakeIdentity = take ? { take: take.take, created: take.created } : ORIGINAL
    if (mode._tag === "Replacing") {
      const id = mode.id, mark = current.marks.find(item => item.id === id)
      if (!mark) { mode = resume; input.changed(); return }
      if (!sameTake(mark.source, source) || !sameState(mark.preview, frame.preview) || mark.device !== device) {
        return input.notify(new Error(`Re-place ${nameOf(mark)} on ${isOriginal(mark.source) ? "the real files" : `take ${mark.source.take}`} in ${refLabel(input.state(), mark.preview)}, on ${deviceName(mark.device)}.`))
      }
      mode = resume
      void write(`marks/${encodeURIComponent(id)}`, { anchor: anchored.anchor }, DraftResponseSchema).catch(input.notify)
      return
    }
    const subject = take ? {} : { subject: { part: frame.subject.part, state: frame.subject.state } }
    void write<{ id: string; draft: Draft }>("marks", { source, preview: { part: frame.preview.part, state: frame.preview.state }, ...subject, device, anchor: anchored.anchor satisfies MarkAnchor }, AddedMarkSchema)
      .then(result => { flushNote(); editor = { id: result.id, note: "", saved: "" }; input.changed() })
      .catch(input.notify)
  }

  // Notes save shortly after typing stops, and at once when the editor closes or Send starts.
  function flushNote() {
    clearTimeout(noteTimer); noteTimer = undefined
    if (!editor || editor.note === editor.saved) return writes
    const { id, note } = editor
    editor.saved = note
    return write(`marks/${encodeURIComponent(id)}`, { note }, DraftResponseSchema).catch(error => {
      // Last write wins per mark: retry once against the reloaded draft.
      if (!ready()?.marks.some(mark => mark.id === id)) return input.notify(error)
      return write(`marks/${encodeURIComponent(id)}`, { note }, DraftResponseSchema).catch(input.notify)
    })
  }

  async function sendPass(revision: number) {
    const current = ready()
    if (!current || send._tag === "Sending") return
    if (revision !== current.revision) return input.notify(new Error("The draft changed since you looked at it. Check it and send again."))
    const view = getView()
    if (view._tag !== "Ready" || view.send._tag === "Sending" || view.send.availability._tag === "Disabled") return
    await flushNote(); await writes
    send = { _tag: "Sending" }; input.changed()
    try {
      const latest = ready()
      if (!latest) throw new Error("The draft of marks is not loaded.")
      const result = parseWire(SentSchema, await input.request<unknown>("marks/send", { revision: latest.revision }))
      receive(result.draft)
      send = { _tag: "Idle" }; mode = { _tag: "Off" }; editor = null
      input.inform(`Started ${result.takes.length === 1 ? "take" : "takes"} ${result.takes.join(", ")} from the marks.`)
      await input.refreshTakes()
    } catch (error) {
      send = { _tag: "Failed", reason: error instanceof Error ? error.message : String(error) }
      await reload()
    } finally { input.changed() }
  }

  // Frame documents: input tracking, Alt-click and Alt-drag, and triggers to find marks again.
  function frameLoaded(key: string, node: HTMLIFrameElement) {
    detach.get(key)?.()
    afterInput.set(key, false)
    let window: Window | null = null, document: Document | null = null
    try { window = node.contentWindow; document = node.contentDocument } catch { return }
    // A frame not yet navigated, or a document without events, has nothing to mark.
    if (!window || !document || document.location?.href === "about:blank" || typeof window.addEventListener !== "function" || !document.documentElement) return
    let start: { pointer: number; point: MarkPoint } | null = null
    let swallowClick = false
    const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation() }
    const down = (event: PointerEvent) => {
      if (event.altKey && event.button === 0 && canMark(key)) { stop(event); start = { pointer: event.pointerId, point: { x: event.clientX, y: event.clientY } }; return }
      afterInput.set(key, true)
    }
    const up = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.pointer) return
      stop(event)
      const from = start.point, to = { x: event.clientX, y: event.clientY }
      start = null; swallowClick = true
      if (Math.hypot(to.x - from.x, to.y - from.y) < DRAG_PX) place(key, { _tag: "Point", point: to })
      else place(key, { _tag: "Region", rect: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) } })
    }
    const click = (event: MouseEvent) => { if (swallowClick) { swallowClick = false; stop(event) } }
    const key_ = (event: KeyboardEvent) => { if (event.key !== "Alt") afterInput.set(key, true) }
    const options = { capture: true }
    window.addEventListener("pointerdown", down, options)
    window.addEventListener("pointerup", up, options)
    window.addEventListener("click", click, options)
    window.addEventListener("keydown", key_, options)
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    const Observer = (window as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver
    const observer = Observer ? new Observer(schedule) : null
    observer?.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    const ownWindow = window
    detach.set(key, () => {
      ownWindow.removeEventListener("pointerdown", down, options)
      ownWindow.removeEventListener("pointerup", up, options)
      ownWindow.removeEventListener("click", click, options)
      ownWindow.removeEventListener("keydown", key_, options)
      ownWindow.removeEventListener("scroll", schedule)
      ownWindow.removeEventListener("resize", schedule)
      observer?.disconnect()
      detach.delete(key)
    })
    schedule()
  }
  function frameRemoved(key: string) {
    detach.get(key)?.()
    afterInput.delete(key)
    schedule()
  }

  // The view: pure selection over the draft, locations and app state.
  function markable(frame: Pick<FrameView, "take">, state: AppState): Availability {
    const take = frame.take === null ? null : state.takes?.takes.find(item => item.take === frame.take)
    if (take === undefined) return disabled("This take is gone.")
    if (take?.integration) return disabled("Alternates have their own review. Mark the experiment instead.")
    if (draft._tag !== "Ready") return disabled(draft._tag === "Loading" ? "Loading the draft of marks…" : draft.reason)
    if (send._tag === "Sending") return disabled("Sending the draft.")
    return enabled
  }
  function pins(key: string, frame: Pick<FrameView, "take" | "preview">, state: AppState): MarkPin[] {
    const take = frame.take === null ? null : state.takes?.takes.find(item => item.take === frame.take)
    if (take === undefined) return []
    const source = take ? { take: take.take, created: take.created } : ORIGINAL
    return (ready()?.marks ?? []).flatMap(mark => {
      if (!sameTake(mark.source, source) || !sameState(mark.preview, frame.preview) || mark.device !== state.device.id) return []
      const where = found.get(mark.id) ?? locate(mark)
      return frameKey(mark.preview, frameOf(mark.source)) === key ? [{ id: mark.id, letter: mark.letter, kind: mark.anchor.kind, rect: where.rect, location: where.location }] : []
    })
  }
  function getView(): MarkupView {
    if (draft._tag === "Loading") return { _tag: "Unavailable", reason: "Loading the draft of marks…" }
    if (draft._tag === "Failed") return { _tag: "Unavailable", reason: draft.reason }
    const state = input.state(), marks = draft.draft.marks
    const sending = send._tag === "Sending"
    const where = (mark: Mark) => found.get(mark.id) ?? locate(mark)
    const plan = planOf(marks, state)
    const names = marks.map(nameOf)
    const busy = sending ? disabled("Sending the draft.") : enabled
    const markView = (mark: Mark): DraftMarkView => ({
      id: mark.id, letter: mark.letter, kind: mark.anchor.kind, rect: where(mark).rect, location: where(mark).location,
      name: nameOf(mark), note: shownNote(mark), references: referencesIn(shownNote(mark), mark.source.take, names),
      previewLabel: refLabel(state, mark.preview), deviceLabel: deviceName(mark.device),
      edit: busy, remove: busy, replace: sending ? busy : isOriginal(mark.source) || takeOf(mark.source) ? enabled : disabled(`Take ${mark.source.take} is gone. Remove ${nameOf(mark)}.`),
    })
    const prompt = withPrompt(state)
    const outcomeOf = (group: SendPlan["groups"][number]): MarkupOutcome => {
      const going = group.marks.filter(id => prompt.ids.includes(id))
      if (going.length) {
        const goingNames = going.map(id => nameOf(marks.find(mark => mark.id === id) as Mark))
        return { _tag: "WithPrompt", label: `${listed(goingNames)} ${goingNames.length === 1 ? "goes" : "go"} with your prompt when you press New take. Send would make a take from the real files instead.` }
      }
      if (group.outcome._tag === "NewTake") return { _tag: "NewTake", label: isOriginal(group.source) ? "Send makes a new take from the real files." : `Send makes a new take from take ${group.source.take}.` }
      const pointers = marks.filter(mark => referencesIn(shownNote(mark), mark.source.take, names).some(name => group.marks.some(id => nameOf(marks.find(item => item.id === id) as Mark) === name))).map(nameOf)
      return { _tag: "PointedTo", label: `Pointed to by ${listed(pointers)}; makes no take.` }
    }
    const groups: MarkupGroup[] = plan.groups.map(group => {
      const take = takeOf(group.source)
      return {
        source: group.source, label: isOriginal(group.source) ? "Original · the real files" : take ? `Take ${take.take} · ${takeName(take)}` : `Take ${group.source.take} · gone`,
        marks: group.marks.map(id => markView(marks.find(mark => mark.id === id) as Mark)),
        decision: group.reasons.length ? { _tag: "Blocked", reasons: group.reasons } : { _tag: "Ready" },
        outcome: outcomeOf(group),
      }
    })
    const why = state.connection._tag !== "Ready" ? "Vite is not reachable."
      : state.takes?.agent._tag !== "Ready" ? "The agent is not ready."
        : plan._tag === "Empty" ? "Mark a take first."
          : plan._tag === "Blocked" ? plan.reasons.join(" ")
            : pending ? "Saving the draft…" : ""
    const availability = why ? disabled(why) : enabled
    const editing = editor ? marks.find(mark => mark.id === editor?.id) : undefined
    return {
      _tag: "Ready", revision: draft.draft.revision, mode, draftOpen,
      groups,
      send: sending ? { _tag: "Sending", label: plan.label } : send._tag === "Failed" ? { _tag: "Failed", label: plan.label, reason: send.reason, availability } : { _tag: "Idle", label: plan.label, availability },
      editor: editor && editing ? { _tag: "Open", id: editing.id, name: nameOf(editing), note: editor.note, edit: busy, references: referenceOptions(editing, state) } : { _tag: "Closed" },
    }
  }

  function planOf(marks: readonly Mark[], state: AppState): SendPlan {
    const takes = (state.takes?.takes ?? []).map(take => ({ take: take.take, created: take.created, kind: take.integration ? "Alternate" as const : "Experiment" as const, run: take.run }))
    return planSend(marks.map(mark => ({ id: mark.id, name: nameOf(mark), note: shownNote(mark), source: mark.source, location: (found.get(mark.id) ?? locate(mark)).location })), takes)
  }
  /**
   * Planner choice 14 (A): the marks on the original that go with a typed prompt when
   * you press New take. They are on the shown original frame and device, found, and
   * no note points to them. Marks a note points to stay for Send.
   */
  function withPrompt(state: AppState): { ids: string[]; names: string[] } {
    const marks = ready()?.marks ?? [], preview = previewRef(state), subject = subjectRef(state)
    if (!state.prompt.trim() || !preview || !subject) return { ids: [], names: [] }
    const names = marks.map(nameOf)
    const named = new Set(marks.flatMap(mark => referencesIn(shownNote(mark), mark.source.take, names)))
    const going = marks.filter(mark => isOriginal(mark.source) && sameState(mark.preview, preview) && mark.device === state.device.id
      && (!mark.subject || sameState(mark.subject, subject)) && !named.has(nameOf(mark)) && (found.get(mark.id) ?? locate(mark)).location._tag === "Located")
    return { ids: going.map(mark => mark.id), names: going.map(nameOf) }
  }
  /** Every mark on another source that the note on `editing` can point to, with a crop of its place. */
  function referenceOptions(editing: Mark, state: AppState): ReferenceOption[] {
    return (ready()?.marks ?? []).filter(mark => mark.source.take !== editing.source.take).map(mark => {
      const take = takeOf(mark.source), device = DEVICES.find(item => item.id === mark.device)
      const lost = (found.get(mark.id) ?? locate(mark)).location._tag === "Lost"
      const src = `frame?${new URLSearchParams({ part: mark.preview.part, state: mark.preview.state, ...(isOriginal(mark.source) ? {} : { take: mark.source.take }) })}`
      return {
        id: mark.id, name: nameOf(mark), note: mark.note,
        label: isOriginal(mark.source) ? `Original · ${refLabel(state, mark.preview)}` : `Take ${mark.source.take}${take ? ` · ${takeName(take)}` : " · gone"}`,
        crop: lost || !device ? null : { src, viewport: { width: device.cssWidth, height: device.cssHeight }, rect: mark.anchor.rect },
      }
    })
  }
  /** After New take used them (choice 14), the marks leave the draft. */
  async function release(ids: readonly string[]) {
    if (!ids.length) return
    await write("marks/release", { ids }, DraftResponseSchema)
  }

  const actions = {
    onMarkMode: (on: boolean) => { if (!ready()) return; mode = on ? { _tag: "Marking" } : { _tag: "Off" }; resume = mode; input.changed() },
    onMarkPoint: (key: string, point: MarkPoint) => place(key, { _tag: "Point", point }),
    onMarkRegion: (key: string, rect: MarkRect) => place(key, { _tag: "Region", rect }),
    onMarkEdit: (id: string | null) => {
      void flushNote()
      const mark = id === null ? undefined : ready()?.marks.find(item => item.id === id)
      editor = mark ? { id: mark.id, note: mark.note, saved: mark.note } : null
      input.changed()
    },
    onMarkNote: (id: string, note: string) => {
      if (!editor || editor.id !== id || send._tag === "Sending") return
      editor = { ...editor, note: note.slice(0, 2000) }
      clearTimeout(noteTimer)
      noteTimer = setTimeout(() => void flushNote(), NOTE_DELAY_MS)
      input.changed()
    },
    onMarkRemove: (id: string) => {
      if (send._tag === "Sending" || !ready()?.marks.some(mark => mark.id === id)) return
      if (editor?.id === id) { clearTimeout(noteTimer); editor = null }
      void write(`marks/${encodeURIComponent(id)}/remove`, {}, DraftResponseSchema).catch(input.notify)
    },
    onMarkReplace: (id: string) => {
      if (send._tag === "Sending" || !ready()?.marks.some(mark => mark.id === id)) return
      if (mode._tag !== "Replacing") resume = mode
      mode = { _tag: "Replacing", id }
      input.changed()
    },
    onDraftOpen: (open: boolean) => { draftOpen = open; input.changed() },
    onSend: (revision: number) => { void sendPass(revision) },
  }

  return {
    actions, receive, reload, getView, pins, markable, frameLoaded, frameRemoved, schedule, resolve, withPrompt, release,
    dispose: () => {
      disposed = true
      clearTimeout(noteTimer); clearTimeout(resolveTimer)
      for (const off of [...detach.values()]) off()
    },
  }
}

function deviceName(id: string) { return DEVICES.find(device => device.id === id)?.name ?? id }
/** Document-origin to the frame's viewport. Without a document the stored place is the best guess. */
function viewportRect(rect: MarkRect, document: Document | null): MarkRect {
  const view = document?.defaultView
  return { x: rect.x - (view?.scrollX ?? 0), y: rect.y - (view?.scrollY ?? 0), width: rect.width, height: rect.height }
}
