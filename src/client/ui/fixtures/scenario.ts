/**
 * Local action behavior for the gallery and the part files (decision 18).
 * Each action records its call and makes the change a real app would show
 * next, from explicit local inputs. It performs no I/O: no fetch, storage or
 * server call, and it is not core's app state. A no-op would not show that
 * the chrome's controls reach their actions, so the common ones change the view.
 */
import type { ChainView, ChromeActions, ChromeView, KnobView } from "../contract"
import { DEFAULT_PX_PER_MM } from "../../device-frame.js"
import { CHAIN_FAMILIES, frameSource } from "./views"
import { markupState, nameOf, nextLetter, readMarks, sameSource, sourceOf, withMarkup } from "./markup"
import type { LocalMark, MarkupState } from "./markup"
import { chainFacts, familyOf, readChoices, takeKey, withChains } from "./chains"
import type { ChainChoices } from "./chains"
import { createLocalTools } from "./tools"
import { answerLocally, askLocally, discardLocally, focusLocally, pinLocally, promptLocally } from "./workspace-actions"
import type { MarkRect } from "../contract"

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
  // Tool presses and Closes follow the app's tool rule.
  const tools = createLocalTools(initial)

  // Take markup: every change goes through the shared Send policy, and a change to the draft moves its revision.
  const markup = (change: (marks: LocalMark[], state: MarkupState) => { readonly marks?: LocalMark[]; readonly state?: Partial<MarkupState> } | null) => {
    if (view.markup._tag !== "Ready") return
    const marks = readMarks(view)
    const state = markupState(view)
    const next = change(marks, state)
    if (!next) return
    update(withMarkup(view, next.marks ?? marks, { ...state, ...(next.marks ? { revision: state.revision + 1 } : {}), ...next.state }))
  }
  const editable = (marks: readonly LocalMark[], id: string) => view.markup._tag === "Ready" && view.markup.send._tag !== "Sending" && marks.some(mark => mark.id === id)
  const place = (frameKey: string, kind: LocalMark["kind"], rect: MarkRect) => markup((marks, state) => {
    const frame = view.canvas._tag === "Frames" ? view.canvas.frames.find(item => item.key === frameKey) : undefined
    // Phase 6: a frame of the real files marks the original, 0A, 0B.
    const source = frame ? sourceOf(frame) : null
    if (!frame || !source || frame.markable._tag !== "Enabled" || state.mode._tag === "Off") return null
    const mode = state.mode
    if (mode._tag === "Replacing") {
      const moving = marks.find(mark => mark.id === mode.id)
      if (!moving || !sameSource(moving.source, source)) return null
      return { marks: marks.map(mark => mark.id === mode.id ? { ...mark, frame: frameKey, kind, rect, location: { _tag: "Located" } } : mark), state: { mode: { _tag: "Off" }, editor: mode.id } }
    }
    const letter = nextLetter(marks.filter(mark => sameSource(mark.source, source)).map(mark => mark.letter))
    const id = `local-${source.take}-${letter}-${marks.length}`
    const previewLabel = view.selection._tag === "State" ? view.selection.label : frame.label
    return { marks: [...marks, { id, source, frame: frameKey, letter, kind, rect, location: { _tag: "Located" }, note: "", previewLabel, deviceLabel: view.device.name }], state: { editor: id } }
  })

  // Chains: a change of choice rebuilds the chains through the shared policy, from the family of take records the view shows.
  const chains = (change: (choices: ChainChoices) => ChainChoices): boolean => {
    const family = familyOf(view, CHAIN_FAMILIES)
    if (!family) return false
    update(withChains(view, family, change(readChoices(view))))
    return true
  }
  /** A view with no family: the swap and a fold still change the chain in place. */
  const chainInPlace = (id: string, change: (chain: ChainView) => ChainView) => {
    if (view.canvas._tag === "Frames") update({ ...view, canvas: { ...view.canvas, chains: view.canvas.chains.map(chain => chain.id === id ? change(chain) : chain) } })
  }
  /** Selecting a take of a chain opens it in the pair beside its nearest ancestor (planner choice 16), and focuses it. */
  const pickTake = (take: string): boolean => {
    const family = familyOf(view, CHAIN_FAMILIES)
    const picked = family?.takes.find(item => item.take === take)
    if (!family || !picked) return false
    const next = withChains(view, family, { ...readChoices(view), selected: picked })
    const name = next.canvas._tag === "Frames" ? next.canvas.frames.find(frame => frame.key === takeKey(picked))?.label ?? `Take ${take}` : `Take ${take}`
    const facts = { id: take, name, ...chainFacts(family, picked) }
    update({
      ...next,
      focusedTake: next.focusedTake ? { ...next.focusedTake, ...facts } : null,
      record: next.record._tag === "Open" ? { ...next.record, take: { ...next.record.take, ...facts } } : next.record,
      composer: { ...next.composer, follow: next.composer.follow ? { ...next.composer.follow, take, label: `Send to take ${take}` } : null },
    })
    return true
  }

  const record = <K extends keyof ChromeActions>(name: K, effect?: (...args: Parameters<ChromeActions[K]>) => void) =>
    ((...args: Parameters<ChromeActions[K]>) => { calls.push({ name, args }); effect?.(...args) }) as ChromeActions[K]

  const actions: ChromeActions = {
    onMarkMode: record("onMarkMode", on => markup((_, state) => state.send?._tag === "Sending" ? null : { state: { mode: { _tag: on ? "Marking" : "Off" } } })),
    onMarkPoint: record("onMarkPoint", (key, point) => place(key, "Point", { ...point, width: 0, height: 0 })),
    onMarkRegion: record("onMarkRegion", (key, rect) => place(key, "Region", rect)),
    onMarkEdit: record("onMarkEdit", id => markup(marks => id === null ? { state: { editor: null } } : editable(marks, id) ? { state: { editor: id } } : null)),
    onMarkNote: record("onMarkNote", (id, note) => markup(marks => editable(marks, id) ? { marks: marks.map(mark => mark.id === id ? { ...mark, note } : mark) } : null)),
    onMarkRemove: record("onMarkRemove", id => markup((marks, state) => editable(marks, id) ? {
      marks: marks.filter(mark => mark.id !== id),
      state: { editor: state.editor === id ? null : state.editor, mode: state.mode._tag === "Replacing" && state.mode.id === id ? { _tag: "Off" } : state.mode },
    } : null)),
    onMarkReplace: record("onMarkReplace", id => markup(marks => editable(marks, id) ? { state: { mode: { _tag: "Replacing", id } } } : null)),
    onDraftOpen: record("onDraftOpen", draftOpen => markup(() => ({ state: { draftOpen } }))),
    onChainHistory: record("onChainHistory", (id, open) => {
      if (!chains(choices => ({ ...choices, open: open ? [...new Set([...choices.open, id])] : choices.open.filter(item => item !== id) })) && !open) {
        chainInPlace(id, chain => chain.history._tag === "Open" ? { ...chain, history: { _tag: "Folded", label: chain.history.label } } : chain)
      }
    }),
    // Core ignores "Parent" for a chain with no parent; so does the rebuild.
    onChainSolo: record("onChainSolo", (id, solo) => {
      if (!chains(choices => ({ ...choices, solo: { ...choices.solo, [id]: solo } }))) chainInPlace(id, chain => chain.parent ? { ...chain, solo } : chain)
    }),
    onSend: record("onSend", revision => {
      const ready = view.markup._tag === "Ready" && view.markup.revision === revision && view.markup.send._tag !== "Sending" && view.markup.send.availability._tag === "Enabled"
      if (ready) markup(marks => ({ state: { editor: null, send: { _tag: "Sending", label: `Sending ${marks.length} ${marks.length === 1 ? "mark" : "marks"}` } } }))
    }),
    onProject: record("onProject"),
    onTool: record("onTool", tool => update(tools.press(view, tool))),
    onNavOpen: record("onNavOpen", navOpen => update({ ...view, tools: { ...view.tools, navOpen } })),
    onFilter: record("onFilter", filter => update({ ...view, navigation: { ...view.navigation, filter } })),
    onPart: record("onPart"),
    onPartExpanded: record("onPartExpanded", (file, open) => update({ ...view, navigation: { ...view.navigation, parts: view.navigation.parts.map(part => part.file === file ? { ...part, expanded: open } : part) } })),
    onState: record("onState"), onCompare: record("onCompare"),
    onTake: record("onTake", take => {
      if (pickTake(take)) return
      const frames = view.canvas._tag === "Frames" ? view.canvas.frames.map(frame => ({ ...frame, selected: frame.take === take })) : null
      update({ ...view, canvas: view.canvas._tag === "Frames" && frames ? { ...view.canvas, frames } : view.canvas })
    }),
    onContext: record("onContext", key => { if (view.navigation.scenario._tag === "Selected") update({ ...view, navigation: { ...view.navigation, scenario: { ...view.navigation.scenario, chosen: key } } }) }),
    onSubject: record("onSubject"), onWholeScenario: record("onWholeScenario"),
    onDevice: record("onDevice", id => { const device = view.devices.find(item => item.id === id); if (device) update({ ...view, device }) }),
    onPrompt: record("onPrompt", prompt => {
      if (view.workspace._tag === "Open") { update(promptLocally({ ...view, composer: { ...view.composer, prompt } }, prompt)); return }
      const ready = view.composer.agent._tag === "Ready" && prompt.trim() !== ""
      const availability = ready ? { _tag: "Enabled" } as const : { _tag: "Disabled", reason: prompt.trim() ? "The agent is not ready" : "Describe a change first" } as const
      const follow = view.composer.follow && view.focusedTake?.run._tag !== "Running" ? { ...view.composer.follow, availability } : view.composer.follow
      const next: ChromeView = { ...view, composer: { ...view.composer, prompt, start: availability, follow } }
      // Marks on the real files go with a typed prompt and not with an empty one (planner choice 14).
      update(next.markup._tag === "Ready" ? withMarkup(next, readMarks(next), markupState(next)) : next)
    }),
    onCount: record("onCount", count => update({ ...view, composer: { ...view.composer, count, startLabel: count === 1 ? "New take" : `${count} new takes` } })),
    // The fixture's list is already loaded; a choice moves the check and names the model, as the snapshot would.
    onModels: record("onModels"),
    onModel: record("onModel", model => {
      const { agent, models } = view.composer
      update({ ...view, composer: { ...view.composer, agent: agent._tag === "Ready" ? { ...agent, model } : agent, models: models._tag === "Ready" ? { ...models, current: model } : models } })
    }),
    onAttach: record("onAttach", files => update({ ...view, composer: { ...view.composer, attachments: [...view.composer.attachments, ...files.map((file, index) => ({ id: `local-${Date.now()}-${index}`, name: file.name, url: frameSource(), remove: { _tag: "Enabled" } as const }))] } })),
    onRemoveAttachment: record("onRemoveAttachment", id => update({ ...view, composer: { ...view.composer, attachments: view.composer.attachments.filter(image => image.id !== id) } })),
    // New take takes the marks that go with the prompt; they leave the draft (planner choice 14). Starting the take is core's.
    onStart: record("onStart", () => {
      const going = view.plan._tag === "None" && view.composer.start._tag === "Enabled" && view.composer.marks._tag === "WithPrompt" ? view.composer.marks.names : []
      if (going.length) markup(marks => ({ marks: marks.filter(mark => !going.includes(nameOf(mark))) }))
    }),
    onFollow: record("onFollow"),
    onPlanCancel: record("onPlanCancel", () => update({ ...view, plan: { _tag: "None" }, composer: { ...view.composer, edit: { _tag: "Enabled" }, attach: { _tag: "Enabled" } } })),
    onAccept: record("onAccept"), onDiscard: record("onDiscard"), onStop: record("onStop"), onPrepareAlternate: record("onPrepareAlternate"),
    onRecordClose: record("onRecordClose", () => update(tools.close(view, "record"))),
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
    onCodeClose: record("onCodeClose", () => update(tools.close(view, "code"))),
    onKnobsClose: record("onKnobsClose", () => update(tools.close(view, "knobs"))),
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
    onChecksClose: record("onChecksClose", () => update(tools.close(view, "checks"))),
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
    onCalibrationClose: record("onCalibrationClose", () => update(tools.close(view, "calibrate"))),
    onFrameMount: record("onFrameMount"), onFrameGeometry: record("onFrameGeometry"),
    onEditorMount: record("onEditorMount", host => editor?.mount(host, view)),
    onReviewDiffMount: record("onReviewDiffMount"),
    // Decision 45. Selecting another workspace or making one is core's; the board's own changes are local.
    onWorkspace: record("onWorkspace"), onWorkspaceNew: record("onWorkspaceNew"),
    onPin: record("onPin", (ref, pinned) => update(pinLocally(view, ref, pinned))),
    onIdea: record("onIdea", take => update(focusLocally(view, take))),
    onQuestions: record("onQuestions", open => update(open ? tools.questions(view) : tools.close(view, "record"))),
    onAsk: record("onAsk", text => update(askLocally(view, text))),
    onAnswer: record("onAnswer", (id, answer, reason) => update(answerLocally(view, id, answer, reason))),
    onWorkspaceStart: record("onWorkspaceStart"), onIdeaFollow: record("onIdeaFollow"), onIdeaDiscard: record("onIdeaDiscard"),
    onWorkspaceDiscard: record("onWorkspaceDiscard", () => update(discardLocally(view))),
  }
  return {
    actions, calls, getView: () => view, update,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}
