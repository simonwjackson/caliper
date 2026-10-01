import type { ChromeActions, ChromeView } from "../../src/client/ui/contract"
import { planSend, referencesIn } from "../../src/takes/send-plan.js"
import { chainsView } from "./chrome-view"

export type ObservedCall = { [K in keyof ChromeActions]: { readonly name: K; readonly args: Parameters<ChromeActions[K]> } }[keyof ChromeActions]
/** Local action implementation for contract tests. Records calls and updates explicit scenario inputs. */
export function createChromeScenario(initial: ChromeView) {
  let view = initial
  const calls: ObservedCall[] = []
  const listeners = new Set<() => void>()
  function update(next: ChromeView) { view = next; for (const listener of listeners) listener() }
  function record<K extends keyof ChromeActions>(name: K) {
    return (...args: Parameters<ChromeActions[K]>) => { calls.push({ name, args } as ObservedCall) }
  }
  const observed = {
    onMarkMode: record("onMarkMode"), onMarkPoint: record("onMarkPoint"), onMarkRegion: record("onMarkRegion"),
    onMarkEdit: record("onMarkEdit"), onMarkNote: record("onMarkNote"), onMarkRemove: record("onMarkRemove"),
    onMarkReplace: record("onMarkReplace"), onDraftOpen: record("onDraftOpen"), onSend: record("onSend"),
    onChainHistory: record("onChainHistory"), onChainSolo: record("onChainSolo"),
    onProject: record("onProject"), onTool: record("onTool"), onNavOpen: record("onNavOpen"), onFilter: record("onFilter"), onPart: record("onPart"), onPartExpanded: record("onPartExpanded"),
    onState: record("onState"), onCompare: record("onCompare"), onTake: record("onTake"), onContext: record("onContext"), onSubject: record("onSubject"), onWholeScenario: record("onWholeScenario"), onDevice: record("onDevice"),
    onPrompt: record("onPrompt"), onCount: record("onCount"), onModels: record("onModels"), onModel: record("onModel"), onAttach: record("onAttach"), onRemoveAttachment: record("onRemoveAttachment"), onStart: record("onStart"), onFollow: record("onFollow"), onPlanCancel: record("onPlanCancel"),
    onAccept: record("onAccept"), onDiscard: record("onDiscard"), onStop: record("onStop"), onPrepareAlternate: record("onPrepareAlternate"), onRecordClose: record("onRecordClose"), onReview: record("onReview"), onIntegrationCheck: record("onIntegrationCheck"), onBehaviorReviewed: record("onBehaviorReviewed"), onApplyAlternate: record("onApplyAlternate"),
    onOpenFile: record("onOpenFile"), onFileFilter: record("onFileFilter"), onCodeRetry: record("onCodeRetry"), onCodeEdit: record("onCodeEdit"), onCodeSave: record("onCodeSave"), onPreviousChange: record("onPreviousChange"), onNextChange: record("onNextChange"), onCodeShare: record("onCodeShare"),
    onKnobInput: record("onKnobInput"), onKnobCommit: record("onKnobCommit"), onKnobCancel: record("onKnobCancel"), onLiteralsOpen: record("onLiteralsOpen"), onLiteralDraft: record("onLiteralDraft"), onLiteralName: record("onLiteralName"), onLiteralHome: record("onLiteralHome"), onPromote: record("onPromote"),
    onChecksClose: record("onChecksClose"), onCheckRun: record("onCheckRun"), onCheckStop: record("onCheckStop"), onImageLoaded: record("onImageLoaded"), onImageFailed: record("onImageFailed"), onImageReviewed: record("onImageReviewed"), onApproveImage: record("onApproveImage"),
    onPxPerMm: record("onPxPerMm"), onResetCalibration: record("onResetCalibration"), onCalibrationClose: record("onCalibrationClose"), onFrameMount: record("onFrameMount"), onFrameGeometry: record("onFrameGeometry"), onEditorMount: record("onEditorMount"), onReviewDiffMount: record("onReviewDiffMount"),
  } satisfies ChromeActions
  const actions: ChromeActions = {
    ...observed,
    onChainSolo(chain, solo) {
      observed.onChainSolo(chain, solo)
      if (view.canvas._tag !== "Frames") return
      update({ ...view, canvas: { ...view.canvas, chains: view.canvas.chains.map(item => item.id === chain && (solo === "Shown" || item.parent) ? { ...item, solo } : item) } })
    },
    onChainHistory(chain, open) {
      observed.onChainHistory(chain, open)
      if (view.canvas._tag !== "Frames") return
      const opened = chainsView("open")
      const stepsOf = (id: string) => opened.canvas._tag === "Frames" ? opened.canvas.chains.find(item => item.id === id)?.history : undefined
      update({ ...view, canvas: { ...view.canvas, chains: view.canvas.chains.map(item => {
        if (item.id !== chain || item.history._tag === "None") return item
        const steps = stepsOf(chain)
        return { ...item, history: open && steps?._tag === "Open" ? steps : { _tag: "Folded" as const, label: item.history.label } }
      }) } })
    },
    onMarkMode(on) { observed.onMarkMode(on); if (view.markup._tag === "Ready") update({ ...view, markup: { ...view.markup, mode: { _tag: on ? "Marking" : "Off" } } }) },
    onDraftOpen(draftOpen) { observed.onDraftOpen(draftOpen); if (view.markup._tag === "Ready") update({ ...view, markup: { ...view.markup, draftOpen } }) },
    onMarkEdit(id) {
      observed.onMarkEdit(id)
      if (view.markup._tag !== "Ready") return
      const mark = view.markup.groups.flatMap(group => group.marks).find(mark => mark.id === id)
      if (id !== null && (!mark || mark.edit._tag === "Disabled")) return
      const own = view.markup.groups.find(group => group.marks.some(item => item.id === id))?.source.take
      const references = view.markup.groups.filter(group => group.source.take !== own).flatMap(group => group.marks.map(item => ({ id: item.id, name: item.name, note: item.note, label: group.label, crop: null })))
      update({ ...view, markup: { ...view.markup, editor: mark ? { _tag: "Open", id: mark.id, name: mark.name, note: mark.note, edit: mark.edit, references } : { _tag: "Closed" } } })
    },
    onMarkNote(id, note) {
      observed.onMarkNote(id, note)
      if (view.markup._tag !== "Ready" || !view.markup.groups.some(group => group.marks.some(mark => mark.id === id && mark.edit._tag === "Enabled"))) return
      const names = view.markup.groups.flatMap(group => group.marks.map(mark => mark.name))
      update({ ...view, markup: { ...view.markup, revision: view.markup.revision + 1,
        groups: view.markup.groups.map(group => ({ ...group, marks: group.marks.map(mark => mark.id === id ? { ...mark, note, references: referencesIn(note, group.source.take, names) } : mark) })),
        editor: view.markup.editor._tag === "Open" && view.markup.editor.id === id ? { ...view.markup.editor, note } : view.markup.editor,
      } })
    },
    onMarkReplace(id) {
      observed.onMarkReplace(id)
      if (view.markup._tag === "Ready" && view.markup.groups.some(group => group.marks.some(mark => mark.id === id && mark.replace._tag === "Enabled"))) update({ ...view, markup: { ...view.markup, mode: { _tag: "Replacing", id } } })
    },
    onMarkRemove(id) {
      observed.onMarkRemove(id)
      if (view.markup._tag !== "Ready" || !view.markup.groups.some(group => group.marks.some(mark => mark.id === id && mark.remove._tag === "Enabled"))) return
      const groups = view.markup.groups.map(group => ({ ...group, marks: group.marks.filter(mark => mark.id !== id) })).filter(group => group.marks.length)
      const takes = groups.flatMap(group => {
        const frame = view.canvas._tag === "Frames" ? view.canvas.frames.find(frame => frame.key === `${group.source.take}@${group.source.created}`) : undefined
        return frame ? [{ ...group.source, kind: "Experiment" as const, run: frame.run ?? { _tag: "Idle" as const } }] : []
      })
      const plan = planSend(groups.flatMap(group => group.marks.map(mark => ({ id: mark.id, name: mark.name, note: mark.note, source: group.source, location: mark.location }))), takes)
      const refreshed = groups.map(group => {
        const planned = plan.groups.find(row => row.source.take === group.source.take && row.source.created === group.source.created)
        if (!planned) throw new Error("The Send policy omitted a draft group")
        return { ...group, decision: planned.reasons.length ? { _tag: "Blocked" as const, reasons: planned.reasons } : { _tag: "Ready" as const } }
      })
      update({ ...view, canvas: view.canvas._tag === "Frames" ? { ...view.canvas, frames: view.canvas.frames.map(frame => ({ ...frame, marks: frame.marks.filter(mark => mark.id !== id) })) } : view.canvas,
        markup: { ...view.markup, revision: view.markup.revision + 1, groups: refreshed,
          mode: view.markup.mode._tag === "Replacing" && view.markup.mode.id === id ? { _tag: "Off" } : view.markup.mode,
          editor: view.markup.editor._tag === "Open" && view.markup.editor.id === id ? { _tag: "Closed" } : view.markup.editor,
          send: { _tag: "Idle", label: plan.label, availability: plan._tag === "Ready" ? { _tag: "Enabled" } : { _tag: "Disabled", reason: plan._tag === "Empty" ? "Add a mark first" : plan.reasons.join(" ") } },
        } })
    },
    onSend(revision) {
      observed.onSend(revision)
      if (view.markup._tag !== "Ready" || revision !== view.markup.revision || view.markup.send._tag === "Sending" || view.markup.send.availability._tag === "Disabled") return
      const locked = { _tag: "Disabled", reason: "The draft is being sent" } as const
      update({ ...view, canvas: view.canvas._tag === "Frames" ? { ...view.canvas, frames: view.canvas.frames.map(frame => ({ ...frame, markable: locked })) } : view.canvas,
        markup: { ...view.markup, mode: { _tag: "Off" },
          groups: view.markup.groups.map(group => ({ ...group, marks: group.marks.map(mark => ({ ...mark, edit: locked, remove: locked, replace: locked })) })),
          editor: view.markup.editor._tag === "Open" ? { ...view.markup.editor, edit: locked } : view.markup.editor,
          send: { _tag: "Sending", label: "Sending…" },
        } })
    },
    onPrompt(text) { observed.onPrompt(text); update({ ...view, composer: { ...view.composer, prompt: text } }) },
    onFilter(filter) { observed.onFilter(filter); update({ ...view, navigation: { ...view.navigation, filter } }) },
    onNavOpen(navOpen) { observed.onNavOpen(navOpen); update({ ...view, tools: { ...view.tools, navOpen } }) },
    onCount(count) { observed.onCount(count); update({ ...view, composer: { ...view.composer, count } }) },
    onRemoveAttachment(id) { observed.onRemoveAttachment(id); update({ ...view, composer: { ...view.composer, attachments: view.composer.attachments.filter(image => image.id !== id) } }) },
    onPlanCancel() { observed.onPlanCancel(); update({ ...view, plan: { _tag: "None" } }) },
    onKnobInput(id, value) {
      observed.onKnobInput(id, value)
      if (view.knobs._tag === "Ready") update({ ...view, knobs: { ...view.knobs, knobs: view.knobs.knobs.map(knob => knob.id === id ? { ...knob, value } : knob) } })
    },
    onKnobCommit(id, value) {
      observed.onKnobCommit(id, value)
      if (view.knobs._tag === "Ready") update({ ...view, knobs: { ...view.knobs, knobs: view.knobs.knobs.map(knob => knob.id === id ? { ...knob, value, write: { _tag: "Saved" } } : knob) } })
    },
    onFileFilter(filter) { observed.onFileFilter(filter); if (view.code._tag === "Ready") update({ ...view, code: { ...view.code, filter } }) },
    onImageReviewed(run, index, reviewed) {
      observed.onImageReviewed(run, index, reviewed)
      if (view.checks._tag === "Open" && view.checks.run._tag === "Ready" && view.checks.run.id === run) update({ ...view, checks: { ...view.checks, run: { ...view.checks.run, rows: view.checks.run.rows.map(row => row.index === index ? { ...row, reviewed } : row) } } })
    },
    onBehaviorReviewed(take, revision, behaviorReviewed) {
      observed.onBehaviorReviewed(take, revision, behaviorReviewed)
      if (view.record._tag === "Open" && view.record.take.id === take && view.record.integration._tag === "Review" && view.record.integration.review.revision === revision) update({ ...view, record: { ...view.record, integration: { ...view.record.integration, behaviorReviewed, apply: behaviorReviewed ? { _tag: "Enabled" } : { _tag: "Disabled", reason: "Attestation required" } } } })
    },
    onChecksClose() { observed.onChecksClose(); update({ ...view, checks: { _tag: "Closed" } }) },
    onPxPerMm(pxPerMm) { observed.onPxPerMm(pxPerMm); update({ ...view, pxPerMm, calibrated: true, calibration: { _tag: "Open", pxPerMm, calibrated: true } }) },
    onCalibrationClose() { observed.onCalibrationClose(); update({ ...view, calibration: { _tag: "Closed" } }) },
  }
  return {
    actions, calls, getView: () => view, update,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}
