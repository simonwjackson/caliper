/**
 * Local action behavior for the gallery and the part files (decision 18).
 * Each action records its call and makes the change a real app would show
 * next, from explicit local inputs. It performs no I/O: no fetch, storage or
 * server call, and it is not core's app state. A no-op would not show that
 * the chrome's controls reach their actions, so the common ones change the view.
 */
import type { ChromeActions, ChromeView, KnobView, Tool } from "../contract"
import { DEFAULT_PX_PER_MM } from "../../device-frame.js"
import { frameSource } from "./views"

export type Call = { readonly name: keyof ChromeActions; readonly args: readonly unknown[] }
export type Scenario = {
  readonly actions: ChromeActions
  readonly calls: Call[]
  readonly getView: () => ChromeView
  readonly update: (next: ChromeView) => void
  readonly subscribe: (listener: () => void) => () => void
}
type Editor = { readonly mount: (host: HTMLDivElement | null, view: ChromeView) => void }

/** @param editor optional fixture editor; the gallery supplies CodeMirror with the Darkroom appearance. */
export function createScenario(initial: ChromeView, editor?: Editor): Scenario {
  let view = initial
  const calls: Call[] = []
  const listeners = new Set<() => void>()
  const update = (next: ChromeView) => { view = next; for (const listener of listeners) listener() }
  const knobs = (change: (knob: KnobView) => KnobView, id: string) => {
    if (view.knobs._tag !== "Ready") return
    update({ ...view, knobs: { ...view.knobs, knobs: view.knobs.knobs.map(knob => knob.id === id ? change(knob) : knob) } })
  }
  const literal = (id: string, change: (draft: Extract<ChromeView["knobs"], { _tag: "Ready" }>["literals"]) => ChromeView["knobs"]) => {
    void id
    if (view.knobs._tag === "Ready") update({ ...view, knobs: change(view.knobs.literals) })
  }
  const tool = (active: Tool): ChromeView => {
    const tools = { ...view.tools, active }
    if (active === "preview") return { ...view, tools: { ...tools, side: "closed" } }
    if (active === "knobs") return { ...view, tools: { ...tools, side: "knobs" }, knobs: view.knobs._tag === "Closed" ? { _tag: "Finding", target: "Game Detail, Default" } : view.knobs }
    if (active === "takes") return { ...view, tools: { ...tools, side: view.record._tag === "Open" ? "record" : "closed" } }
    if (active === "code") return { ...view, tools: { ...tools, codeOpen: true }, code: view.code._tag === "Closed" ? { _tag: "Loading", message: "Loading the editor" } : view.code }
    if (active === "calibrate") return { ...view, tools, calibration: { _tag: "Open", pxPerMm: view.pxPerMm, calibrated: view.calibrated } }
    if (active === "checks") return { ...view, tools, checks: view.checks._tag === "Closed" ? { _tag: "Open", targetLabel: "Game Detail · real files", runSelected: { _tag: "Enabled" }, runAll: { _tag: "Enabled" }, notices: [], run: { _tag: "Idle" } } : view.checks }
    return { ...view, tools }
  }

  const record = <K extends keyof ChromeActions>(name: K, effect?: (...args: Parameters<ChromeActions[K]>) => void) =>
    ((...args: Parameters<ChromeActions[K]>) => { calls.push({ name, args }); effect?.(...args) }) as ChromeActions[K]

  const actions: ChromeActions = {
    onMarkMode: record("onMarkMode"), onMarkPoint: record("onMarkPoint"), onMarkRegion: record("onMarkRegion"),
    onMarkEdit: record("onMarkEdit"), onMarkNote: record("onMarkNote"), onMarkRemove: record("onMarkRemove"),
    onMarkReplace: record("onMarkReplace"), onDraftOpen: record("onDraftOpen"), onSend: record("onSend"),
    onTool: record("onTool", active => update(tool(active))),
    onNavOpen: record("onNavOpen", navOpen => update({ ...view, tools: { ...view.tools, navOpen } })),
    onFilter: record("onFilter", filter => update({ ...view, navigation: { ...view.navigation, filter } })),
    onPart: record("onPart"),
    onPartExpanded: record("onPartExpanded", (file, open) => update({ ...view, navigation: { ...view.navigation, parts: view.navigation.parts.map(part => part.file === file ? { ...part, expanded: open } : part) } })),
    onState: record("onState"), onCompare: record("onCompare"),
    onTake: record("onTake", take => {
      const frames = view.canvas._tag === "Frames" ? view.canvas.frames.map(frame => ({ ...frame, selected: frame.take === take })) : null
      update({ ...view, canvas: view.canvas._tag === "Frames" && frames ? { ...view.canvas, frames } : view.canvas })
    }),
    onContext: record("onContext", key => { if (view.navigation.scenario._tag === "Selected") update({ ...view, navigation: { ...view.navigation, scenario: { ...view.navigation.scenario, chosen: key } } }) }),
    onSubject: record("onSubject"), onWholeScenario: record("onWholeScenario"),
    onDevice: record("onDevice", id => { const device = view.devices.find(item => item.id === id); if (device) update({ ...view, device }) }),
    onPrompt: record("onPrompt", prompt => {
      const ready = view.composer.agent._tag === "Ready" && prompt.trim() !== ""
      const availability = ready ? { _tag: "Enabled" } as const : { _tag: "Disabled", reason: prompt.trim() ? "The agent is not ready" : "Describe a change first" } as const
      const follow = view.composer.follow && view.focusedTake?.run._tag !== "Running" ? { ...view.composer.follow, availability } : view.composer.follow
      update({ ...view, composer: { ...view.composer, prompt, start: availability, follow } })
    }),
    onCount: record("onCount", count => update({ ...view, composer: { ...view.composer, count, startLabel: count === 1 ? "New take" : `Plan ${count} takes` } })),
    onAttach: record("onAttach", files => update({ ...view, composer: { ...view.composer, attachments: [...view.composer.attachments, ...files.map((file, index) => ({ id: `local-${Date.now()}-${index}`, name: file.name, url: frameSource(), remove: { _tag: "Enabled" } as const }))] } })),
    onRemoveAttachment: record("onRemoveAttachment", id => update({ ...view, composer: { ...view.composer, attachments: view.composer.attachments.filter(image => image.id !== id) } })),
    onStart: record("onStart"), onFollow: record("onFollow"),
    onPlanBack: record("onPlanBack", () => update({ ...view, plan: { _tag: "None" }, composer: { ...view.composer, edit: { _tag: "Enabled" }, attach: { _tag: "Enabled" } } })),
    onDirection: record("onDirection", (id, field, text) => {
      if (view.plan._tag === "Review") update({ ...view, plan: { ...view.plan, directions: view.plan.directions.map(item => item.id === id ? { ...item, direction: { ...item.direction, [field]: text } } : item) } })
    }),
    onRemoveDirection: record("onRemoveDirection", id => {
      if (view.plan._tag !== "Review") return
      const directions = view.plan.directions.filter(item => item.id !== id)
      update({ ...view, plan: { ...view.plan, directions, startLabel: directions.length === 1 ? "Start 1 take" : `Start ${directions.length} takes` } })
    }),
    onAccept: record("onAccept"), onDiscard: record("onDiscard"), onStop: record("onStop"), onPrepareAlternate: record("onPrepareAlternate"),
    onRecordClose: record("onRecordClose", () => update({ ...view, record: { _tag: "Closed" }, tools: { ...view.tools, side: "closed" } })),
    onReview: record("onReview"), onIntegrationCheck: record("onIntegrationCheck"),
    onBehaviorReviewed: record("onBehaviorReviewed", (take, revision, behaviorReviewed) => {
      if (view.record._tag === "Open" && view.record.take.id === take && view.record.integration._tag === "Review" && view.record.integration.review.revision === revision) {
        update({ ...view, record: { ...view.record, integration: { ...view.record.integration, behaviorReviewed, apply: behaviorReviewed ? { _tag: "Enabled" } : { _tag: "Disabled", reason: "Confirm that you reviewed product behavior" } } } })
      }
    }),
    onApplyAlternate: record("onApplyAlternate"),
    onOpenFile: record("onOpenFile", file => { if (view.code._tag === "Ready") update({ ...view, code: { ...view.code, selectedFile: file, tabs: view.code.tabs.includes(file) ? view.code.tabs : [...view.code.tabs, file] } }) }),
    onFileFilter: record("onFileFilter", filter => { if (view.code._tag === "Ready") update({ ...view, code: { ...view.code, filter } }) }),
    onCodeRetry: record("onCodeRetry"), onCodeEdit: record("onCodeEdit"), onCodeSave: record("onCodeSave"),
    onPreviousChange: record("onPreviousChange"), onNextChange: record("onNextChange"),
    onCodeShare: record("onCodeShare", (codeShare, commit) => { if (commit) update({ ...view, tools: { ...view.tools, codeShare } }) }),
    onKnobInput: record("onKnobInput", (id, value) => knobs(knob => ({ ...knob, value }), id)),
    onKnobCommit: record("onKnobCommit", (id, value) => knobs(knob => ({ ...knob, value, write: { _tag: "Saved" } }), id)),
    onKnobCancel: record("onKnobCancel"),
    onLiteralsOpen: record("onLiteralsOpen", open => { if (view.knobs._tag === "Ready") update({ ...view, knobs: { ...view.knobs, literals: open ? (view.knobs.literals._tag === "Closed" ? { _tag: "Finding" } : view.knobs.literals) : { _tag: "Closed" } } }) }),
    onLiteralDraft: record("onLiteralDraft", (id, open) => literal(id, literals => {
      if (view.knobs._tag !== "Ready" || literals._tag !== "Ready") return view.knobs
      return { ...view.knobs, literals: { ...literals, literals: literals.literals.map(item => item.id !== id ? item : {
        ...item, draft: open ? { _tag: "Editing" as const, name: `--pico-${item.property}`, home: item.homes[0]?.id ?? "", preview: `Adds --pico-${item.property}: ${item.value}.`, problem: "", create: { _tag: "Enabled" as const } } : { _tag: "Closed" as const },
      }) } }
    })),
    onLiteralName: record("onLiteralName", (id, name) => literal(id, literals => {
      if (view.knobs._tag !== "Ready" || literals._tag !== "Ready") return view.knobs
      return { ...view.knobs, literals: { ...literals, literals: literals.literals.map(item => item.id === id && item.draft._tag !== "Closed" ? { ...item, draft: { ...item.draft, name } } : item) } }
    })),
    onLiteralHome: record("onLiteralHome", (id, home) => literal(id, literals => {
      if (view.knobs._tag !== "Ready" || literals._tag !== "Ready") return view.knobs
      return { ...view.knobs, literals: { ...literals, literals: literals.literals.map(item => item.id === id && item.draft._tag !== "Closed" ? { ...item, draft: { ...item.draft, home } } : item) } }
    })),
    onPromote: record("onPromote"),
    onChecksClose: record("onChecksClose", () => update({ ...view, checks: { _tag: "Closed" }, tools: { ...view.tools, active: view.tools.active === "checks" ? "takes" : view.tools.active } })),
    onCheckRun: record("onCheckRun"), onCheckStop: record("onCheckStop"),
    onImageLoaded: record("onImageLoaded"), onImageFailed: record("onImageFailed"),
    onImageReviewed: record("onImageReviewed", (run, index, reviewed) => {
      if (view.checks._tag === "Open" && view.checks.run._tag === "Ready" && view.checks.run.id === run) {
        update({ ...view, checks: { ...view.checks, run: { ...view.checks.run, rows: view.checks.run.rows.map(row => row.index === index ? { ...row, reviewed } : row) } } })
      }
    }),
    onApproveImage: record("onApproveImage", (run, index) => {
      if (view.checks._tag === "Open" && view.checks.run._tag === "Ready" && view.checks.run.id === run) {
        update({ ...view, checks: { ...view.checks, run: { ...view.checks.run, rows: view.checks.run.rows.map(row => row.index === index ? { ...row, approved: true } : row) } } })
      }
    }),
    onPxPerMm: record("onPxPerMm", pxPerMm => update({ ...view, pxPerMm, calibrated: true, calibration: { _tag: "Open", pxPerMm, calibrated: true } })),
    onResetCalibration: record("onResetCalibration", () => update({ ...view, pxPerMm: DEFAULT_PX_PER_MM, calibrated: false, calibration: { _tag: "Open", pxPerMm: DEFAULT_PX_PER_MM, calibrated: false } })),
    onCalibrationClose: record("onCalibrationClose", () => update({ ...view, calibration: { _tag: "Closed" }, tools: { ...view.tools, active: view.tools.active === "calibrate" ? "takes" : view.tools.active } })),
    onFrameMount: record("onFrameMount"), onFrameGeometry: record("onFrameGeometry"),
    onEditorMount: record("onEditorMount", host => editor?.mount(host, view)),
    onReviewDiffMount: record("onReviewDiffMount"),
  }
  return {
    actions, calls, getView: () => view, update,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}
