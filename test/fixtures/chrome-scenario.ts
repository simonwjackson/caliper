import type { ChromeActions, ChromeView } from "../../src/client/ui/contract"

export type ObservedCall = { readonly name: keyof ChromeActions; readonly args: readonly unknown[] }
/** Local action implementation for contract tests. Records calls and updates explicit scenario inputs. */
export function createChromeScenario(initial: ChromeView) {
  let view = initial
  const calls: ObservedCall[] = []
  const listeners = new Set<() => void>()
  function update(next: ChromeView) { view = next; for (const listener of listeners) listener() }
  function record<K extends keyof ChromeActions>(name: K) {
    return (...args: Parameters<ChromeActions[K]>) => { calls.push({ name, args }) }
  }
  const observed = {
    onTool: record("onTool"), onNavOpen: record("onNavOpen"), onFilter: record("onFilter"), onPart: record("onPart"), onPartExpanded: record("onPartExpanded"),
    onState: record("onState"), onCompare: record("onCompare"), onTake: record("onTake"), onContext: record("onContext"), onSubject: record("onSubject"), onWholeScenario: record("onWholeScenario"), onDevice: record("onDevice"),
    onPrompt: record("onPrompt"), onCount: record("onCount"), onAttach: record("onAttach"), onRemoveAttachment: record("onRemoveAttachment"), onStart: record("onStart"), onFollow: record("onFollow"), onPlanBack: record("onPlanBack"), onDirection: record("onDirection"), onRemoveDirection: record("onRemoveDirection"),
    onAccept: record("onAccept"), onDiscard: record("onDiscard"), onStop: record("onStop"), onPrepareAlternate: record("onPrepareAlternate"), onRecordClose: record("onRecordClose"), onReview: record("onReview"), onIntegrationCheck: record("onIntegrationCheck"), onBehaviorReviewed: record("onBehaviorReviewed"), onApplyAlternate: record("onApplyAlternate"),
    onOpenFile: record("onOpenFile"), onFileFilter: record("onFileFilter"), onCodeRetry: record("onCodeRetry"), onCodeEdit: record("onCodeEdit"), onCodeSave: record("onCodeSave"), onPreviousChange: record("onPreviousChange"), onNextChange: record("onNextChange"), onCodeShare: record("onCodeShare"),
    onKnobInput: record("onKnobInput"), onKnobCommit: record("onKnobCommit"), onKnobCancel: record("onKnobCancel"), onLiteralsOpen: record("onLiteralsOpen"), onLiteralDraft: record("onLiteralDraft"), onLiteralName: record("onLiteralName"), onLiteralHome: record("onLiteralHome"), onPromote: record("onPromote"),
    onChecksClose: record("onChecksClose"), onCheckRun: record("onCheckRun"), onCheckStop: record("onCheckStop"), onImageLoaded: record("onImageLoaded"), onImageFailed: record("onImageFailed"), onImageReviewed: record("onImageReviewed"), onApproveImage: record("onApproveImage"),
    onPxPerMm: record("onPxPerMm"), onResetCalibration: record("onResetCalibration"), onCalibrationClose: record("onCalibrationClose"), onFrameMount: record("onFrameMount"), onFrameGeometry: record("onFrameGeometry"), onEditorMount: record("onEditorMount"), onReviewDiffMount: record("onReviewDiffMount"),
  } satisfies ChromeActions
  const actions: ChromeActions = {
    ...observed,
    onPrompt(text) { observed.onPrompt(text); update({ ...view, composer: { ...view.composer, prompt: text } }) },
    onFilter(filter) { observed.onFilter(filter); update({ ...view, navigation: { ...view.navigation, filter } }) },
    onNavOpen(navOpen) { observed.onNavOpen(navOpen); update({ ...view, tools: { ...view.tools, navOpen } }) },
    onCount(count) { observed.onCount(count); update({ ...view, composer: { ...view.composer, count } }) },
    onRemoveAttachment(id) { observed.onRemoveAttachment(id); update({ ...view, composer: { ...view.composer, attachments: view.composer.attachments.filter(image => image.id !== id) } }) },
    onDirection(id, field, text) {
      observed.onDirection(id, field, text)
      if (view.plan._tag === "Review") update({ ...view, plan: { ...view.plan, directions: view.plan.directions.map(item => item.id === id ? { ...item, direction: { ...item.direction, [field]: text } } : item) } })
    },
    onRemoveDirection(id) {
      observed.onRemoveDirection(id)
      if (view.plan._tag === "Review") update({ ...view, plan: { ...view.plan, directions: view.plan.directions.filter(item => item.id !== id) } })
    },
    onPlanBack() { observed.onPlanBack(); update({ ...view, plan: { _tag: "None" } }) },
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
