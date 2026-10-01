import type { CodeChange, CodeDocument, CodeFile, Part, TakeView } from "../../types"
import type { CodeView, SaveState } from "../ui/contract"
import type { Lens, Mode } from "../code-editor.js"

type EditorModule = typeof import("../code-editor.js")
type Editor = ReturnType<EditorModule["createEditor"]>
export type CodeSubject = { part: Part; take: TakeView | null; state: string | null }
type Doc = {
  key: string; file: string; take: string | null; saved: string; local: string
  original: string | null | undefined; sending: string | null; inflight: Promise<boolean> | null; save: SaveState
  watching: boolean; obsolete: boolean
}
export type CodeModel = {
  open: boolean; subject: CodeSubject | null; load: "Closed" | "Loading" | "Ready" | "Failed"
  failure: string; files: readonly CodeFile[]; current: Doc | null
  stats: ReadonlyMap<string, { added: number; removed: number }>; filter: string; notice: string; changes: number
}
export type CodeDependencies = {
  request: <T>(path: string, data?: object) => Promise<T>
  changed: () => void
  selectState: (state: string) => void
  stopTake: (take: string) => void
  /** Explicit local dependency for lifecycle tests. Production keeps the editor lazy. */
  loadEditor?: () => Promise<EditorModule>
}

const SAVE_DELAY_MS = 350
const FILES_DELAY_MS = 150
const reason = (error: unknown) => error instanceof Error ? error.message : String(error)
const takeKey = (take: TakeView | null) => take ? `${take.take}@${take.created}` : "real"
const listKey = (subject: CodeSubject) => `${subject.part.file}|${takeKey(subject.take)}`
const docKey = (subject: CodeSubject, file: string) => `${takeKey(subject.take)}|${file}`
const baseName = (file: string) => file.slice(file.lastIndexOf("/") + 1)

function modeFor(subject: CodeSubject, doc: Doc): Mode {
  if (doc.take === null || !subject.take) return { _tag: "Real" }
  return { _tag: subject.take.run._tag === "Running" ? "Watching" : "Take", original: doc.original ?? null }
}
function lensesFor(subject: CodeSubject, file: string): Lens[] {
  if (file !== subject.part.file || subject.part.states.length < 2) return []
  return subject.part.states.map(state => ({ export: state.export, label: state.label, current: state.export === subject.state }))
}

/** Pure conversion. Snapshots never expose mutable documents, file lists or statistics. */
export function toCodeView(model: CodeModel): CodeView {
  if (!model.open) return { _tag: "Closed" }
  if (!model.subject) return { _tag: "Empty", message: "Pick a part to see its code." }
  if (model.load === "Failed") return { _tag: "Failed", reason: model.failure, retry: { _tag: "Enabled" } }
  if (model.load !== "Ready" || !model.current) return { _tag: "Loading", message: "Loading the editor…" }
  const doc = model.current
  const names = new Map<string, number>()
  for (const entry of model.files) names.set(baseName(entry.file), (names.get(baseName(entry.file)) ?? 0) + 1)
  return {
    _tag: "Ready", files: model.files.map(entry => ({ ...entry,
      label: names.get(baseName(entry.file)) === 1 ? baseName(entry.file) : entry.file.split("/").slice(-2).join("/"),
      ...model.stats.get(entry.file),
    })),
    tabs: model.files.filter(entry => entry.depth !== null && entry.depth <= 1 || entry.changed || entry.file === doc.file).map(entry => entry.file),
    filter: model.filter, selectedFile: doc.file, documentKey: doc.key,
    document: { file: doc.file, content: doc.local, ...(doc.original === undefined ? {} : { original: doc.original }) },
    mode: modeFor(model.subject, doc), save: { ...doc.save }, notice: model.notice, changes: model.changes,
    take: doc.take, stop: model.subject.take?.run._tag === "Running" ? { _tag: "Enabled" } : { _tag: "Disabled", reason: "No agent is running." },
    lenses: lensesFor(model.subject, doc.file),
  }
}

/** Owns source I/O and editor lifetime; React owns only the host's placement. */
export function createCodeController(deps: CodeDependencies) {
  const model: CodeModel = { open: false, subject: null, load: "Closed", failure: "", files: [], current: null,
    stats: new Map(), filter: "", notice: "", changes: 0 }
  const docs = new Map<string, Doc>()
  const lastFile = new Map<string, string>()
  let module: EditorModule | null = null
  let modulePromise: Promise<EditorModule> | null = null
  let editor: Editor | null = null
  let host: HTMLDivElement | null = null
  let surface: HTMLDivElement | null = null
  let destroyed = false
  let stale = true
  let following = true
  let requested: string | null = null
  let syncKey = ""
  let generation = 0
  let statsGeneration = 0
  let reconcileGeneration = 0
  let filesGeneration = 0
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let filesTimer: ReturnType<typeof setTimeout> | undefined
  let flushing: Promise<boolean> | null = null

  const publish = () => { if (!destroyed) deps.changed() }
  const getView = () => toCodeView(model)
  const fetchDoc = (subject: CodeSubject, file: string) => {
    const query = new URLSearchParams({ file })
    if (subject.take) query.set("take", subject.take.take)
    return deps.request<CodeDocument>(`code/file?${query}`)
  }
  const fetchFiles = async (subject: CodeSubject) => {
    const query = new URLSearchParams({ part: subject.part.file })
    if (subject.take) query.set("take", subject.take.take)
    return (await deps.request<{ files: CodeFile[] }>(`code/files?${query}`)).files
  }
  const active = (subject: CodeSubject) => !destroyed && model.subject !== null && listKey(model.subject) === listKey(subject)
  const currentMode = () => model.current && model.subject ? modeFor(model.subject, model.current) : { _tag: "Real" } as Mode

  function updateEditor(reveal = false) {
    if (!model.current || !model.subject || model.load !== "Ready" || !module || !host) return
    if (!editor) {
      surface = host.ownerDocument.createElement("div")
      editor = module.createEditor(surface, {
        onEdit: edit, onSave: save, onSelectState: state => deps.selectState(state),
        onChanges: count => { if (model.changes !== count) { model.changes = count; publish() } },
      })
      host.append(surface)
    }
    const doc = model.current
    editor.open({ key: doc.key, file: doc.file, content: doc.local, mode: currentMode(), lenses: lensesFor(model.subject, doc.file) })
    if (reveal && doc.file === model.subject.part.file && model.subject.state) editor.revealState(model.subject.state)
  }

  function mount(next: HTMLDivElement | null) {
    if (destroyed || next === host) return
    host = next
    // Keep the editor, its undo history, selection and scroll while its region is closed.
    if (surface) {
      if (next) next.append(surface)
      else surface.remove()
    }
    try { updateEditor() } catch (error) {
      model.load = "Failed"
      model.failure = reason(error)
      publish()
    }
  }

  async function ensureModule() {
    if (module) return module
    modulePromise ??= (deps.loadEditor ?? (() => import("../code-editor.js")))()
    try {
      const loaded = await modulePromise
      if (!destroyed) module = loaded
      return loaded
    } catch (error) {
      modulePromise = null
      throw error
    }
  }

  function chooseFile(subject: CodeSubject, list: readonly CodeFile[], keep: string | null): string {
    const listed = (candidate: string | null | undefined): candidate is string => candidate != null && list.some(entry => entry.file === candidate)
    if (listed(keep)) return keep
    const previous = lastFile.get(subject.part.file)
    const changed = list.filter(entry => entry.changed)
    if (subject.take && changed.length) {
      if (previous && changed.some(entry => entry.file === previous)) return previous
      return (changed.find(entry => entry.depth !== null) ?? changed[0]!).file
    }
    if (listed(previous)) return previous
    const stem = baseName(subject.part.file).split(".")[0]
    const candidates = list.filter(entry => entry.depth === 1 && baseName(entry.file).split(".")[0] === stem)
    return (candidates.find(entry => /\.(m|c)?(t|j)sx?$/.test(entry.file)) ?? candidates[0])?.file ?? subject.part.file
  }

  async function refreshStats(subject: CodeSubject, list = model.files) {
    if (!module) return
    const run = ++statsGeneration
    const stats = new Map<string, { added: number; removed: number }>()
    await Promise.all((subject.take ? list.filter(entry => entry.changed) : []).map(async entry => {
      const fresh = await fetchDoc(subject, entry.file).catch(() => null)
      if (fresh && module) stats.set(entry.file, module.lineChanges(fresh.original ?? null, fresh.content))
    }))
    if (!active(subject) || run !== statsGeneration) return
    model.stats = stats
    publish()
  }

  async function loadFile(subject: CodeSubject, file: string, run: number) {
    const key = docKey(subject, file)
    const savedAtStart = docs.get(key)?.saved
    const fresh = await fetchDoc(subject, file)
    if (!active(subject) || run !== generation || !model.open) return
    const known = docs.get(key)
    const savedWhileLoading = known !== undefined && known.saved !== savedAtStart
    const dirty = known !== undefined && (known.local !== known.saved || known.inflight !== null)
    const doc: Doc = known ?? { key, file, take: subject.take?.take ?? null, saved: fresh.content, local: fresh.content,
      original: fresh.original, sending: null, inflight: null, save: { _tag: "Idle" }, watching: subject.take?.run._tag === "Running", obsolete: false }
    if (!dirty && !savedWhileLoading) { doc.saved = fresh.content; doc.local = fresh.content }
    else if (!savedWhileLoading && fresh.content !== doc.saved && fresh.content !== doc.sending && fresh.content !== doc.local) {
      model.notice = diskNotice
    }
    doc.original = fresh.original
    doc.watching = model.subject?.take?.run._tag === "Running"
    docs.set(key, doc)
    model.current = doc
    model.load = "Ready"
    model.changes = 0
    lastFile.set(subject.part.file, file)
    updateEditor(true)
    publish()
    if (dirty && doc.save._tag !== "Failed") scheduleSave()
  }

  async function openSubject(keep: string | null) {
    const subject = model.subject
    if (!subject || destroyed || !model.open) return
    const run = ++generation
    ++filesGeneration
    ++reconcileGeneration
    model.load = "Loading"
    model.notice = ""
    stale = false
    publish()
    try {
      await ensureModule()
      if (!active(subject) || run !== generation || !model.open) return
      const list = await fetchFiles(subject)
      if (!active(subject) || run !== generation || !model.open) return
      model.files = list
      model.stats = new Map()
      const wanted = requested && list.some(entry => entry.file === requested) ? requested : null
      requested = null
      following = wanted === null
      stale = false
      await loadFile(subject, chooseFile(subject, list, wanted ?? keep), run)
      if (run === generation && active(subject)) void refreshStats(subject, list)
    } catch (error) {
      if (!active(subject) || run !== generation || !model.open) return
      model.load = "Failed"
      model.failure = reason(error)
      stale = true
      publish()
    }
  }

  function sync(subject: CodeSubject | null, open: boolean) {
    if (destroyed) return
    // Stream logs and unrelated app publications do not change editor inputs.
    const take = subject?.take
    const key = JSON.stringify([open, subject?.part, take && [take.take, take.created, take.files, take.run], subject?.state])
    if (syncKey === key) return
    syncKey = key
    const before = model.subject
    const wasOpen = model.open
    const switched = before === null || subject === null || listKey(before) !== listKey(subject)
    if (subject?.take) {
      for (const doc of docs.values()) if (doc.take === subject.take.take) {
        if (!doc.key.startsWith(`${takeKey(subject.take)}|`)) doc.obsolete = true
        else doc.watching = subject.take.run._tag === "Running"
      }
    }
    if (switched || !open && wasOpen) {
      void flush()
      ++generation
      ++filesGeneration
      ++reconcileGeneration
      clearTimeout(filesTimer)
      stale = true
    }
    model.subject = subject
    model.open = open
    if (!subject) {
      model.current = null
      model.files = []
      model.stats = new Map()
      model.load = "Closed"
      publish()
      return
    }
    if (!open) { publish(); return }
    if (model.load === "Failed" && wasOpen && !switched) { publish(); return }
    if (stale || model.load === "Closed") {
      const keep = before?.part.file === subject.part.file && subject.take === null ? model.current?.file ?? null : null
      void openSubject(keep)
      return
    }
    if (before?.take?.run._tag !== subject.take?.run._tag) editor?.setMode(currentMode())
    if ((before?.take?.files ?? []).join("\n") !== (subject.take?.files ?? []).join("\n")) scheduleFiles()
    if (before?.state !== subject.state && model.current) {
      editor?.setLenses(lensesFor(subject, model.current.file))
      if (model.current.file === subject.part.file && subject.state) editor?.revealState(subject.state)
    }
    publish()
  }

  function openFile(file: string) {
    if (destroyed) return
    following = false
    if (!model.open || model.load !== "Ready" || stale || !model.files.some(entry => entry.file === file)) {
      requested = file
      if (model.open && model.subject) void openSubject(model.current?.file ?? null)
      return
    }
    const subject = model.subject
    if (!subject || file === model.current?.file) return
    void flush()
    const run = ++generation
    model.notice = ""
    // Clear the previous document while loading: actions cannot write to an old file under a new tab.
    model.current = null
    model.load = "Loading"
    publish()
    void loadFile(subject, file, run).catch(error => {
      if (run !== generation || !active(subject)) return
      model.load = "Failed"; model.failure = reason(error); publish()
    })
  }

  function edit(content: string) {
    const doc = model.current
    if (destroyed || !model.open || model.load !== "Ready" || !doc || currentMode()._tag === "Watching") return
    doc.local = content
    doc.save = { _tag: "Edited" }
    scheduleSave()
    publish()
  }
  function scheduleSave() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void flush() }, SAVE_DELAY_MS)
  }

  async function saveDoc(doc: Doc): Promise<boolean> {
    if (doc.inflight && !await doc.inflight) return false
    while (doc.local !== doc.saved) {
      if (destroyed) return false
      // A new run may have made this take read-only while a save was queued.
      if (doc.watching || doc.obsolete) {
        doc.save = { _tag: "Failed", reason: doc.obsolete ? "This take was replaced. Caliper keeps your unsaved text but cannot save it to the new take." : "Stop the take's agent before saving your text." }
        publish()
        return false
      }
      const content = doc.local
      doc.save = { _tag: "Saving" }
      doc.sending = content
      // Set inflight before request or publication can synchronously call another action.
      const inflight = Promise.resolve().then(async () => {
        try {
          await deps.request(doc.take === null ? "code/file" : `takes/${doc.take}/file`, { file: doc.file, content })
          if (model.current === doc) ++reconcileGeneration
          doc.saved = content
          doc.save = doc.local === content ? { _tag: "Saved", label: doc.take === null ? "Saved" : "Saved to the take" } : { _tag: "Edited" }
          if (model.current === doc && doc.original !== undefined && module) {
            model.stats = new Map(model.stats).set(doc.file, module.lineChanges(doc.original, content))
          }
          return true
        } catch (error) {
          doc.save = { _tag: "Failed", reason: reason(error) }
          return false
        } finally {
          doc.inflight = null
          doc.sending = null
          publish()
        }
      })
      doc.inflight = inflight
      publish()
      if (!await inflight) return false
      // Another flush can have started the next write while this one resumed.
      if (doc.inflight && !await doc.inflight) return false
    }
    return true
  }

  /** Drains all retained dirty documents, including edits made during an in-flight save. */
  function flush(): Promise<boolean> {
    clearTimeout(saveTimer)
    if (flushing) return flushing
    const work = Promise.resolve().then(async () => {
      let ok = true
      for (const doc of docs.values()) if (!await saveDoc(doc)) ok = false
      return ok
    })
    flushing = work.finally(() => { flushing = null })
    return flushing
  }
  function save() { void flush() }
  const diskNotice = "The file changed on disk while you typed. Caliper keeps your text, and saves it over the file on disk."

  async function reconcile(subject: CodeSubject) {
    const doc = model.current
    if (!doc) return
    const run = generation
    const reply = ++reconcileGeneration
    const fresh = await fetchDoc(subject, doc.file).catch(() => null)
    if (!fresh || !active(subject) || run !== generation || reply !== reconcileGeneration || model.current !== doc) return
    if (doc.original !== fresh.original) { doc.original = fresh.original; editor?.setMode(currentMode()) }
    if (fresh.content === doc.saved || fresh.content === doc.sending) { publish(); return }
    if (fresh.content === doc.local) {
      doc.saved = fresh.content
      if (!doc.inflight) doc.save = { _tag: "Saved", label: doc.take === null ? "Saved" : "Saved to the take" }
      publish(); return
    }
    if (doc.local !== doc.saved || doc.inflight) { model.notice = diskNotice; publish(); return }
    doc.saved = fresh.content
    doc.local = fresh.content
    editor?.replaceFromDisk(fresh.content, true)
    publish()
  }

  function scheduleFiles() {
    clearTimeout(filesTimer)
    const requestId = ++filesGeneration
    filesTimer = setTimeout(async () => {
      const subject = model.subject
      if (!subject || !model.open || destroyed) return
      const list = await fetchFiles(subject).catch(() => null)
      if (!list || !active(subject) || !model.open || requestId !== filesGeneration) return
      const known = new Set(model.files.filter(entry => entry.changed).map(entry => entry.file))
      model.files = list
      void refreshStats(subject, list)
      publish()
      const fresh = list.find(entry => entry.changed && !known.has(entry.file))
      if (following && model.subject?.take?.run._tag === "Running" && fresh && fresh.file !== model.current?.file) {
        const run = ++generation
        void loadFile(subject, fresh.file, run).catch(error => { if (run === generation && active(subject)) { model.notice = reason(error); publish() } })
      }
    }, FILES_DELAY_MS)
  }

  function receive(change: CodeChange) {
    const subject = model.subject
    if (destroyed || !subject) return
    const take = subject.take?.take ?? null
    if (change.take !== take && !(change.take === null && take !== null)) return
    if (!model.open) { stale = true; return }
    if (model.load !== "Ready") return
    if (change.take !== null && change.take === take || model.files.some(entry => entry.file === change.file)) scheduleFiles()
    if (change.file === model.current?.file) void reconcile(subject)
  }

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if ([...docs.values()].some(doc => doc.local !== doc.saved || doc.inflight)) event.preventDefault()
  }
  if (typeof window !== "undefined") window.addEventListener("beforeunload", beforeUnload)
  function destroy() {
    if (destroyed) return
    destroyed = true
    ++generation; ++statsGeneration; ++filesGeneration; ++reconcileGeneration
    clearTimeout(saveTimer); clearTimeout(filesTimer)
    if (typeof window !== "undefined") window.removeEventListener("beforeunload", beforeUnload)
    editor?.destroy()
    surface?.remove()
    editor = null; surface = null; host = null
  }

  return { sync, getView, receive, openFile, retry: () => { stale = true; void openSubject(model.current?.file ?? null) },
    edit, save, flush, previousChange: () => editor?.previousChange(), nextChange: () => editor?.nextChange(), mount, destroy,
    setFilter: (filter: string) => { model.filter = filter; publish() },
    stop: () => { if (model.subject?.take?.run._tag === "Running") deps.stopTake(model.subject.take.take) },
  }
}
