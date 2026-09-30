import type { ChromeActions, ChromeView, FrameView } from "../ui/contract"
import type { StateRef, TakeView, CodeChange } from "../../types"
import { Check } from "typebox/value"
import { Type } from "typebox"
import { ChecksViewSchema, CodeChangeSchema, FrameReportSchema, PlanSchema, parseProject, parseTakes, parseWire } from "./wire"
import { createAppState, clampShare, currentPart, currentTake, subjectRef, previewRef, reconcileSelection, locationHash, takeName, refLabel, askAvailable } from "./state"
import type { AppState, Ask, Plan, Preferences, Submission } from "./state"
import { toChromeView, takeSummary, disabled, acceptConfirmNote, chainHasParent } from "./view"
import { identityKey } from "../../takes/chains.js"
import { sameState, subjectsOf, stateExists } from "../scenarios.js"
import { DEFAULT_PX_PER_MM, DEVICES } from "../device-frame.js"
import { imageName, imageProblem, MAX_IMAGES } from "../images.js"
import { createCodeController } from "./code"
import { createKnobsController } from "./knobs"
import { createChecksController } from "./checks"
import { createIntegrationController } from "./integration"
import { createMarkupController } from "./markup"

export type Request = <T>(path: string, data?: object) => Promise<T>
export type RuntimeInput = {
  request: Request
  hash?: string
  storage?: Preferences & { setItem(key: string, value: string): void; removeItem(key: string): void }
  saveLocation?: (hash: string) => void
  confirm?: (text: string) => boolean
  origin?: string
  imageData?: (file: File) => Promise<{ data: string; url: string }>
  revokeImage?: (url: string) => void
  /** This tab's project in the Caliper app, and how to open another one. */
  project?: { id: string; open: (id: string) => void }
}
/** Explicit effect wiring. No rendering, element selection or appearance lives here. */
export function createChromeApp(input: RuntimeInput) {
  let state = { ...createAppState(input.hash, input.storage), projectId: input.project?.id ?? null }
  let snapshot: ChromeView
  const subscribers = new Set<() => void>()
  const frames = new Map<string, HTMLIFrameElement>()
  const loads = new Map<string, () => void>()
  const geometries = new Map<string, import("../device-frame.js").FrameGeometry>()
  const reportDocuments = new Map<string, Document | null>()
  const operations = new Map<symbol, string>()
  let publishing = false, queued = false, disposed = false
  let generation = 0, nextImage = 1
  let codeSync = "", knobSync: boolean | null = null, integrationSync = ""
  const changed = () => {
    if (disposed || queued) return
    queued = true
    queueMicrotask(() => { queued = false; publish() })
  }
  const code = createCodeController({ request: input.request, changed, selectState: exported => { if (state.part) selectState({ part: state.part, state: exported }) }, stopTake: take => actions.onStop(take) })
  const selectedTarget = () => {
    const part = currentPart(state)
    if (!part) return null
    const take = currentTake(state), base = previewRef(state) ?? { part: part.file, state: "*" }
    const preview = take?.integration?._tag === "Review" ? take.integration.proposal.preview : base
    return { ...preview, ...(take ? { take: take.take } : {}), label: `${preview.state === "*" ? `${part.name} · All states` : refLabel(state, preview)} · ${take ? takeName(take) : "Real files"}` }
  }
  const checks = createChecksController({ request: input.request, changed, target: selectedTarget })
  const integration = createIntegrationController({ request: input.request, changed })
  const markup = createMarkupController({
    request: input.request, changed, notify: reason => notify(reason),
    inform: text => set({ ...state, notices: [{ kind: "info", text }] }),
    state: () => state, canvas: () => snapshot?.canvas ?? { _tag: "Empty", message: "" }, frames: () => frames,
    refreshTakes: () => refreshTakes(),
  })
  const knobs = createKnobsController({ request: input.request, changed, frames: () => [...frames.values()], variant: () => {
    if (!currentPart(state)) return null
    const take = currentTake(state)
    return { take: take?.take ?? null, label: take ? `${takeName(take)} · its own copies` : "Real files" }
  } })
  function publish() {
    if (publishing || disposed) return
    publishing = true
    try {
      const part = currentPart(state)
      const selectedTake = currentTake(state)
      const codeSubject = part ? { part, take: selectedTake, state: subjectRef(state)?.state ?? null } : null
      const codeKey = JSON.stringify([state.tools.codeOpen, part, selectedTake && [selectedTake.take, selectedTake.created, selectedTake.files, selectedTake.run], codeSubject?.state])
      if (codeSync !== codeKey) { codeSync = codeKey; code.sync(codeSubject, state.tools.codeOpen) }
      const knobsOpen = state.tools.side === "knobs"
      if (knobSync !== knobsOpen) { knobSync = knobsOpen; knobs.sync(knobsOpen) }
      const integrationKey = JSON.stringify(selectedTake && [selectedTake.take, selectedTake.created, selectedTake.integration, selectedTake.run, selectedTake.files])
      if (integrationSync !== integrationKey) { integrationSync = integrationKey; integration.sync(selectedTake) }
      const badges = (state.takes?.takes ?? []).map(take => ({ part: take.part, state: take.state, take: take.take, badge: checks.badge(take.part, take.state, take.take) })).concat([])
      const originalBadges = (state.project?.parts ?? []).flatMap(part => part.states.map(item => ({ part: part.file, state: item.export, badge: checks.badge(part.file, item.export) })))
      let integrationView = integration.getView()
      if (integrationView._tag === "Review" && selectedTake) {
        const unavailable = takeSummary(state, selectedTake).unavailableReason
        if (unavailable || state.connection._tag !== "Ready") integrationView = { ...integrationView, apply: disabled(unavailable || "Vite is not reachable.") }
      }
      const current = state
      snapshot = toChromeView(state, {
        code: code.getView(), knobs: knobs.getView(), checks: checks.getView(), integration: integrationView, badges: [...badges, ...originalBadges].flatMap(row => row.badge ? [{ ...row, badge: row.badge }] : []),
        markup: { view: markup.getView(), frame: (key, frame) => ({ markable: markup.markable(frame, current), marks: markup.pins(key, frame, current) }), withPrompt: markup.withPrompt(current).names },
      })
      for (const listener of subscribers) listener()
    } finally { publishing = false }
  }
  function set(next: AppState) { state = next; publish() }
  function save() { input.saveLocation?.(locationHash(state)) }
  function selected(next: AppState, plan: Plan = { _tag: "None" }) {
    generation++
    set(reconcileSelection({ ...next, takeCreated: next.take ? next.takeCreated : null, plan, tools: { ...next.tools, side: !next.take && next.tools.side === "record" ? "closed" : next.tools.side } }))
    save(); knobs.refresh()
  }
  function selectState(ref: StateRef) {
    if (!stateExists(state.project?.parts ?? [], ref)) return
    selected({ ...state, part: ref.part, shown: { _tag: "One", export: ref.state }, context: state.part === ref.part ? state.context : null, contextNote: "", take: null })
  }
  function selectTake(id: string) {
    const take = state.takes?.takes.find(take => take.take === id)
    if (!take) return
    selected({ ...state, part: take.part, shown: { _tag: "Takes", export: take.state }, context: take.context ?? null, contextNote: "", take: id, takeCreated: take.created, expanded: new Map(state.expanded).set(take.part, true), tools: { ...state.tools, side: "record", active: "takes" } })
  }
  function notify(reason: unknown) { set({ ...state, notices: [{ kind: "error", text: reason instanceof Error ? reason.message : String(reason) }] }) }
  function immediate(effect: () => Promise<unknown>) { void effect().catch(notify) }
  function remember(key: string, value: string) { input.storage?.setItem(`caliper:${key}`, value) }
  const wireImages = () => state.attachments.map(({ name, mimeType, data }) => ({ name, mimeType, data }))
  function clearImages() { for (const image of state.attachments) input.revokeImage?.(image.url); state = { ...state, attachments: [] } }
  const submission = (): Submission => ({ rawPrompt: state.prompt, attachmentIds: state.attachments.map(image => image.id) })
  function consumeSubmission(submitted: Submission) {
    for (const image of state.attachments) if (submitted.attachmentIds.includes(image.id)) input.revokeImage?.(image.url)
    state = { ...state, prompt: state.prompt === submitted.rawPrompt ? "" : state.prompt, attachments: state.attachments.filter(image => !submitted.attachmentIds.includes(image.id)) }
  }
  const enabled = (value: { _tag: string }) => value._tag === "Enabled"
  async function takeRequest<T>(name: string, work: () => Promise<T>): Promise<T> {
    const token = Symbol(name)
    operations.set(token, name)
    set({ ...state, operation: { _tag: "Working", name }, notices: [] })
    try { return await work() }
    finally {
      operations.delete(token)
      const pending = [...operations.values()].at(-1)
      set({ ...state, operation: pending ? { _tag: "Working", name: pending } : { _tag: "Idle" } })
    }
  }
  async function refreshTakes() { receiveTakes(await input.request<unknown>("takes.json")) }
  const takeResponse = Type.Object({ take: Type.String({ pattern: "^[1-9][0-9]*$" }) })
  /**
   * Start one take per direction, at once. A plan has no review step: its
   * directions start as soon as the planner answers (decision 16, changed
   * 2026-09-30). `notes` are info notices to show with the result.
   */
  async function launch(ask: Ask, directions: readonly (import("../../types").Direction | undefined)[], submitted: Submission, notes: readonly string[] = []) {
    if (state.connection._tag !== "Ready" || state.takes?.agent._tag !== "Ready" || state.operation._tag !== "Idle" || !askAvailable(state, ask)) {
      if (state.plan._tag === "Planning") set({ ...state, plan: { _tag: "None" }, notices: [{ kind: "error", text: "The takes could not start: Vite, the agent or the state changed while planning. Press New take again." }] })
      return
    }
    const epoch = generation
    const titles = directions.flatMap(direction => direction ? [direction.title.trim()] : [])
    await takeRequest("Starting takes", async () => {
      const results = await Promise.allSettled(directions.map(async direction => parseWire(takeResponse, await input.request<unknown>("takes", direction ? { ...ask, direction, others: titles.filter(title => title !== direction.title.trim()) } : ask))))
      const ids = results.flatMap(result => result.status === "fulfilled" ? [result.value.take] : [])
      const failures = results.flatMap(result => result.status === "rejected" ? [String(result.reason)] : [])
      // Planner choice 14: marks on the original that went with the prompt leave the draft once a take started.
      if (ids.length && ask.marks?.length) await markup.release(ask.marks).catch(error => failures.push(`Started takes ${ids.join(", ")}, but the marks that went with the prompt are still in the draft: ${error instanceof Error ? error.message : String(error)} Remove them before Send.`))
      if (generation === epoch) {
        if (ids.length) consumeSubmission(submitted)
        set({ ...state, plan: { _tag: "None" }, notices: [...notes.map(text => ({ kind: "info" as const, text })), ...failures.map(text => ({ kind: "error" as const, text }))] })
      }
      try { await refreshTakes() }
      catch (error) {
        if (generation === epoch) set({ ...state, notices: [...state.notices, ...(ids.length ? [{ kind: "info" as const, text: `Started takes ${ids.join(", ")}. The take list could not refresh; do not relaunch those directions.` }] : []), { kind: "error", text: error instanceof Error ? error.message : String(error) }] })
        return
      }
      if (generation !== epoch || !ids.length) return
      const first = state.takes?.takes.find(take => take.take === ids[0])
      if (first) selected({ ...state, part: ask.part, take: first.take, takeCreated: first.created, shown: { _tag: "Takes", export: ask.state }, context: ask.context ?? null, tools: { ...state.tools, side: "record", active: "takes" } })
    })
  }
  async function start() {
    if (state.plan._tag === "Planning" || state.operation._tag !== "Idle") return
    if (!enabled(snapshot.composer.start)) return
    const subject = subjectRef(state)
    if (!subject) return
    const images = wireImages()
    const going = markup.withPrompt(state).ids
    const ask: Ask = { ...subject, device: state.device.id, prompt: state.prompt.trim(), ...(state.context ? { context: state.context } : {}), ...(images.length ? { images } : {}), ...(going.length ? { marks: going } : {}) }
    const submitted = submission()
    if (state.count === 1) return launch(ask, [undefined], submitted)
    const id = ++generation, count = state.count
    set({ ...state, plan: { _tag: "Planning", ask, submitted, count, id }, notices: [] })
    try {
      const plan = parseWire(PlanSchema, await input.request<unknown>("takes/plan", { ...ask, count }))
      if (!isPlanning(id)) return
      const directions = plan.directions.filter(direction => direction.title.trim() && direction.brief.trim())
      if (!directions.length) { set({ ...state, plan: { _tag: "None" }, notices: [{ kind: "error", text: plan.note || "The planner found no way to answer this prompt." }] }); return }
      await launch(ask, directions, submitted, directions.length < count && plan.note ? [plan.note] : [])
    } catch (error) {
      if (isPlanning(id)) { set({ ...state, plan: { _tag: "None" } }); notify(error) }
    }
  }
  function isPlanning(id: number) { return state.plan._tag === "Planning" && state.plan.id === id }
  /** A numeric id is reusable. Re-read after flushing and bind every write to its creation identity. */
  async function preflight(take: TakeView): Promise<TakeView | null> {
    if (!await code.flush()) return null
    const [project, takes] = await Promise.all([input.request<unknown>("project.json"), input.request<unknown>("takes.json")])
    receiveProject(project); receiveTakes(takes)
    const current = state.takes?.takes.find(item => item.take === take.take && item.created === take.created)
    return current ?? null
  }
  async function actOnTake(id: string, operation: "accept" | "discard" | "stop" | "alternate") {
    const captured = state.takes?.takes.find(take => take.take === id)
    if (!captured) return
    let take = captured
    if (operation === "accept" || operation === "alternate") {
      const exact = await preflight(captured)
      if (!exact) return
      take = exact
    }
    const summary = takeSummary(state, take)
    const availability = operation === "alternate" ? summary.prepareAlternate : summary[operation]
    if (!enabled(availability)) return
    if (operation === "accept" && !input.confirm?.(`Replace the real files with ${takeName(take)} (take ${take.take})?\n\n${take.files.join("\n")}${acceptConfirmNote(state, take) ? `\n\n${acceptConfirmNote(state, take)}` : ""}`)) return
    if (operation === "discard" && take.files.length && !input.confirm?.(`Throw away take ${take.take} and its changes to ${take.files.length} files?`)) return
    await takeRequest(operation, async () => {
      const response = await input.request<unknown>(`takes/${id}/${operation}`, {})
      await refreshTakes()
      if (operation === "alternate") selectTake(parseWire(takeResponse, response).take)
    })
  }
  async function follow(id: string) {
    const captured = currentTake(state), submitted = submission(), prompt = state.prompt.trim(), images = wireImages()
    if (!captured || captured.take !== id || !snapshot.composer.follow || !enabled(snapshot.composer.follow.availability)) return
    const take = await preflight(captured)
    if (!take || !snapshot.composer.follow || snapshot.composer.follow.take !== id || !enabled(snapshot.composer.follow.availability)) return
    await takeRequest("Sending follow-up", async () => {
      await input.request(`takes/${id}/prompt`, { prompt, ...(images.length ? { images } : {}) })
      consumeSubmission(submitted); publish()
    })
  }
  async function attach(files: readonly File[]) {
    if (!enabled(snapshot.composer.attach) || !input.imageData) return
    const failures: string[] = []
    for (const file of files) {
      const name = imageName(file.name)
      const problem = imageProblem({ name, type: file.type, size: file.size })
      if (problem) { failures.push(problem); continue }
      if (state.attachments.length >= MAX_IMAGES) { failures.push(`A prompt can carry at most ${MAX_IMAGES} images. "${name}" was not attached.`); continue }
      const data = await input.imageData(file)
      if (disposed || state.plan._tag !== "None" || state.takes?.agent._tag !== "Ready" || state.attachments.length >= MAX_IMAGES) { input.revokeImage?.(data.url); continue }
      set({ ...state, attachments: [...state.attachments, { id: String(nextImage++), name, mimeType: file.type, ...data }] })
    }
    set({ ...state, notices: failures.map(text => ({ kind: "error", text })) })
  }
  const actions: ChromeActions = {
    ...markup.actions,
    onChainHistory: (chain, open) => {
      const chainsOpen = new Set(state.chainsOpen)
      if (open) chainsOpen.add(chain); else chainsOpen.delete(chain)
      set({ ...state, chainsOpen })
    },
    onChainSolo: (chain, solo) => {
      if (solo === "Parent" && !chainHasParent(state, chain)) return
      const chainSolo = new Set(state.chainSolo)
      if (solo === "Parent") chainSolo.add(chain); else chainSolo.delete(chain)
      // Keep only chains that still exist, so the preference does not grow with every take ever made.
      const alive = new Set((state.takes?.takes ?? []).map(take => identityKey(take.chain ?? take)))
      remember("chain-solo", JSON.stringify([...chainSolo].filter(id => alive.has(id))))
      set({ ...state, chainSolo })
    },
    onTool: tool => {
      const tools = { ...state.tools, active: tool }
      // An open pane that another pane covers comes to the front; only a pane already in front closes.
      const behind = state.tools.active !== tool
      if (tool === "code" && !(tools.codeOpen && behind)) { tools.codeOpen = !tools.codeOpen; remember("code-open", String(tools.codeOpen)) }
      if (tool === "knobs" && !(tools.side === "knobs" && behind)) { tools.side = tools.side === "knobs" ? "closed" : "knobs"; remember("side", "knobs"); remember("knobs-open", String(tools.side === "knobs")) }
      if (tool === "takes") tools.side = currentTake(state) ? "record" : "closed"
      if (tool === "preview" || tool === "code" && !tools.codeOpen || tool === "knobs" && tools.side !== "knobs") tools.active = "preview"
      if (tool !== "checks" && tool !== "calibrate") remember("view", tools.active)
      set({ ...state, tools, checksOpen: tool === "checks" ? true : state.checksOpen, calibrationOpen: tool === "calibrate" ? !state.calibrationOpen : state.calibrationOpen })
      if (tool === "checks") checks.open()
    },
    onProject: id => { if (id !== state.projectId && state.projects.some(project => project.id === id && project.problem === "")) input.project?.open(id) },
    onNavOpen: navOpen => { remember("nav-open", String(navOpen)); set({ ...state, tools: { ...state.tools, navOpen } }) }, onFilter: filter => set({ ...state, filter }),
    onPart: file => { if (state.project?.parts.some(part => part.file === file)) selected({ ...state, part: file, shown: { _tag: "All" }, context: null, contextNote: "", take: null, expanded: new Map(state.expanded).set(file, true) }) },
    onPartExpanded: (file, open) => set({ ...state, expanded: new Map(state.expanded).set(file, open) }), onState: selectState,
    onCompare: ref => { if (stateExists(state.project?.parts ?? [], ref)) selected({ ...state, part: ref.part, shown: { _tag: "Takes", export: ref.state }, context: state.part === ref.part ? state.context : null, contextNote: "", take: null, expanded: new Map(state.expanded).set(ref.part, true) }) }, onTake: selectTake,
    onContext: key => { const scenario = snapshot.navigation.scenario; const choice = scenario._tag === "Selected" ? scenario.choices.find(choice => choice.key === key) : null; if (choice) selected({ ...state, context: choice.context, contextNote: "" }) },
    onSubject: ref => { const preview = previewRef(state); if (preview && subjectsOf(state.project?.parts ?? [], preview).some(child => sameState(child, ref))) selected({ ...state, part: ref.part, shown: { _tag: "One", export: ref.state }, context: preview, contextNote: "", take: null, expanded: new Map(state.expanded).set(ref.part, true) }) },
    onWholeScenario: () => { const preview = state.context; if (preview) selected({ ...state, part: preview.part, shown: { _tag: "One", export: preview.state }, context: null, contextNote: "", take: null }) },
    onDevice: id => { const device = DEVICES.find(device => device.id === id); if (device) { set({ ...state, device }); remember("device", id); save(); markup.schedule() } },
    onPrompt: prompt => { if (enabled(snapshot.composer.edit)) set({ ...state, prompt }) }, onCount: count => { if (state.plan._tag === "None") set({ ...state, count }) }, onAttach: files => immediate(() => attach(files)),
    onRemoveAttachment: id => { if (state.plan._tag !== "None") return; const image = state.attachments.find(image => image.id === id); if (image) input.revokeImage?.(image.url); set({ ...state, attachments: state.attachments.filter(image => image.id !== id), notices: [] }) },
    onStart: () => immediate(start), onFollow: id => immediate(() => follow(id)),
    onPlanCancel: () => { if (state.plan._tag !== "Planning") return; generation++; set({ ...state, plan: { _tag: "None" } }) },
    onAccept: id => immediate(() => actOnTake(id, "accept")), onDiscard: id => immediate(() => actOnTake(id, "discard")), onStop: id => immediate(() => actOnTake(id, "stop")), onPrepareAlternate: id => immediate(() => actOnTake(id, "alternate")),
    onRecordClose: () => set({ ...state, tools: { ...state.tools, side: "closed" } }), onReview: integration.review, onIntegrationCheck: integration.check, onBehaviorReviewed: integration.behaviorReviewed,
    onApplyAlternate: (id, revision) => immediate(async () => {
      const captured = currentTake(state)
      if (!captured || captured.take !== id) return
      const exact = await preflight(captured)
      if (!exact || takeSummary(state, exact).unavailableReason || state.connection._tag !== "Ready") return
      const record = snapshot.record
      if (record._tag !== "Open" || record.integration._tag !== "Review" || record.integration.review.revision !== revision || !enabled(record.integration.apply)) return
      if (await integration.apply(id, revision)) await refreshTakes()
    }),
    onOpenFile: file => { set({ ...state, tools: { ...state.tools, codeOpen: true } }); remember("code-open", "true"); code.openFile(file) }, onFileFilter: value => code.setFilter(value), onCodeRetry: code.retry, onCodeEdit: code.edit, onCodeSave: code.save, onPreviousChange: code.previousChange, onNextChange: code.nextChange,
    onCodeShare: (value, commit) => { if (!Number.isFinite(value)) return; const share = clampShare(value); set({ ...state, tools: { ...state.tools, codeShare: share } }); if (commit) remember("code-share", String(share)) },
    onKnobInput: knobs.input, onKnobCommit: knobs.commit, onKnobCancel: knobs.cancel, onLiteralsOpen: knobs.literalsOpen, onLiteralDraft: knobs.literalDraft, onLiteralName: knobs.literalName, onLiteralHome: knobs.literalHome, onPromote: knobs.promote,
    onChecksClose: () => { checks.close(); set({ ...state, checksOpen: false }) }, onCheckRun: checks.run, onCheckStop: checks.stop, onImageLoaded: checks.imageLoaded, onImageFailed: checks.imageFailed, onImageReviewed: checks.imageReviewed, onApproveImage: checks.approve,
    onPxPerMm: value => { if (Number.isFinite(value) && value > 0) { set({ ...state, pxPerMm: value, calibrated: true }); remember("px-per-mm", String(value)) } },
    onResetCalibration: () => { input.storage?.removeItem("caliper:px-per-mm"); set({ ...state, pxPerMm: DEFAULT_PX_PER_MM, calibrated: false }) }, onCalibrationClose: () => set({ ...state, calibrationOpen: false }),
    onFrameMount: (key, node) => {
      const before = frames.get(key)
      if (before === node) return
      const load = loads.get(key)
      if (before && load) before.removeEventListener("load", load)
      frames.delete(key); loads.delete(key); geometries.delete(key); reportDocuments.delete(key); markup.frameRemoved(key)
      if (state.reports.has(key)) { const reports = new Map(state.reports); reports.delete(key); state = { ...state, reports }; changed() }
      if (node) {
        frames.set(key, node)
        const onLoad = () => {
          if (!reportDocuments.has(key) || reportDocuments.get(key) !== node.contentDocument) {
            const reports = new Map(state.reports); reports.delete(key); state = { ...state, reports }; reportDocuments.delete(key); changed()
          }
          markup.frameLoaded(key, node)
          knobs.refresh()
        }
        node.addEventListener("load", onLoad); loads.set(key, onLoad)
        // A frame can finish loading before React hands it over.
        try { if (node.contentDocument?.readyState === "complete") markup.frameLoaded(key, node) } catch { /* cross-origin frames have no markup */ }
      }
      knobs.refresh()
    },
    onFrameGeometry: (key, geometry) => { geometries.set(key, geometry) }, onEditorMount: code.mount, onReviewDiffMount: integration.mountDiff,
  }
  function reloadFrames(onlyTake?: string, file?: string) {
    const canvas = snapshot.canvas
    if (canvas._tag !== "Frames") return
    const reports = new Map(state.reports)
    for (const frame of canvas.frames) {
      if (onlyTake !== undefined && frame.take !== onlyTake) continue
      if (file?.endsWith(".css")) continue
      reports.delete(frame.key); reportDocuments.delete(frame.key)
      try { frames.get(frame.key)?.contentWindow?.location.reload() } catch (error) { notify(error) }
    }
    state = { ...state, reports }; changed()
  }
  function receiveProject(value: unknown) {
    const project = parseProject(value), before = state.project
    state = reconcileSelection({ ...state, project, connection: { _tag: "Ready" } })
    save(); publish()
    if (before && JSON.stringify([before.css, before.wrapper]) !== JSON.stringify([project.css, project.wrapper])) reloadFrames()
  }
  function receiveTakes(value: unknown) {
    const takes = parseTakes(value), before = state.takes
    state = { ...state, takes }
    state = reconcileSelection(state); save(); publish()
    for (const take of takes.takes) {
      const prior = before?.takes.find(candidate => candidate.take === take.take && candidate.created === take.created)
      if (prior && (prior.files.join(",") !== take.files.join(",") || prior.run._tag === "Running" && take.run._tag !== "Running")) reloadFrames(take.take)
    }
    markup.schedule()
  }
  function receiveCode(value: unknown) {
    const change: CodeChange = parseWire(CodeChangeSchema, value)
    code.receive(change)
    const take = currentTake(state)
    if (take?.integration && (change.take === null || change.take === take.take)) {
      integration.sync(null); integration.sync(take)
    }
    // Vite handles both source and stylesheet HMR. CSS must retain scenario input state.
    knobs.refresh()
  }
  function receiveFrame(event: { origin: string; source: MessageEventSource | null; data: unknown }) {
    if (event.origin !== input.origin || !Check(FrameReportSchema, event.data)) return
    const report = event.data
    const key = [...frames].find(([, frame]) => frame.contentWindow === event.source)?.[0]
    const frame: FrameView | undefined = snapshot.canvas._tag === "Frames" ? snapshot.canvas.frames.find(frame => frame.key === key) : undefined
    if (!key || !frame || report.part !== frame.preview.part || report.partState !== frame.preview.state || report.take !== frame.take) return
    const node = frames.get(key)
    try {
      // A WindowProxy survives navigation. Read the current document's own
      // report so a queued message from its previous document cannot win.
      const current: unknown = node?.contentWindow && Reflect.get(node.contentWindow, "caliperReport")
      if (!current || typeof current !== "object") return
      const latest = { ...current, source: "caliper-frame" }
      if (!Check(FrameReportSchema, latest) || latest.part !== report.part || latest.partState !== report.partState || latest.take !== report.take || latest.state !== report.state || JSON.stringify(latest.problems) !== JSON.stringify(report.problems)) return
    } catch { return }
    reportDocuments.set(key, node?.contentDocument ?? null)
    set({ ...state, reports: new Map(state.reports).set(key, report) }); knobs.refresh(); markup.schedule()
  }
  publish()
  return {
    actions, getSnapshot: () => snapshot, subscribe: (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener) } },
    receiveProject, receiveTakes, receiveCode, receiveFrame, receiveMarks: (value: unknown) => markup.receive(value), loadMarks: () => markup.reload(), receiveChecks: (value: unknown) => checks.receive(parseWire(ChecksViewSchema, value)),
    receiveProjects: (value: unknown) => {
      const list = (value as { projects?: unknown } | null)?.projects
      if (!Array.isArray(list)) return
      const projects = list.flatMap(item => {
        const { id, name, status, problem } = (item ?? {}) as Record<string, unknown>
        return typeof id === "string" && typeof name === "string" ? [{ id, name, problem: status === "Ready" ? "" : typeof problem === "string" ? problem : "It cannot open." }] : []
      })
      set({ ...state, projects })
    },
    unreachable: (reason = "Vite is not reachable.") => set({ ...state, connection: { _tag: "Unreachable", reason } }),
    dispose: () => { disposed = true; generation++; for (const [key, node] of frames) { const load = loads.get(key); if (load) node.removeEventListener("load", load) } frames.clear(); loads.clear(); geometries.clear(); reportDocuments.clear(); subscribers.clear(); clearImages(); code.destroy(); knobs.destroy(); checks.destroy(); integration.destroy(); markup.dispose() },
  }
}
