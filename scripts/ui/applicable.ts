/**
 * Which behavioral hooks apply to a view: an independent statement of when
 * each capability exists, read from the contract, not from the Darkroom
 * code. The browser gate compares it with the hooks the chrome renders after
 * opening each UI-owned disclosure (the New take menu, the parts drawer).
 *
 * Three facts come from the rendered layout because they are layout choices:
 * whether the bar is shown (decision 34: with Takes, Preview or a plan in
 * front), whether the code pane is under the canvas, where its divider
 * applies, or a sheet, and whether a chain's pair fits the canvas, where the
 * swap does not apply (decision 35, planner choice 19).
 */
import type { ChromeView } from "../../src/client/ui/contract"
import { CAL } from "../../src/client/ui/hooks"
import type { CalHook } from "../../src/client/ui/hooks"

export function applicableHooks(view: ChromeView, layout: { readonly bar: boolean; readonly code: string; readonly pairs?: string }): CalHook[] {
  const hooks = new Set<CalHook>([CAL.root, CAL.connection, CAL.tool, CAL.navToggle, CAL.canvas])
  const add = (...list: CalHook[]) => { for (const hook of list) hooks.add(hook) }

  // Navigation (the drawer is opened before hooks are read on small sizes).
  {
    add(CAL.nav, CAL.filter, CAL.setup)
    if (view.navigation.parts.length) add(CAL.partExpand, CAL.part)
    for (const part of view.navigation.parts.filter(item => item.expanded)) {
      if (part.states.length) add(CAL.state)
      if (part.states.some(state => state.takes.length)) add(CAL.compare, CAL.navTake)
    }
    const scenario = view.navigation.scenario
    if (scenario._tag === "Selected") {
      add(CAL.context)
      if (scenario.whole) add(CAL.whole)
      if (scenario.children.length) add(CAL.subject)
    }
    if (view.navigation.unavailable.length) add(CAL.unavailable, CAL.navTake)
  }

  if (view.canvas._tag === "Frames") {
    add(CAL.caption, CAL.device)
    if (view.canvas.frames.length) add(CAL.frame, CAL.frameSelect)
    if (view.canvas.frames.some(frame => frame.problems.length)) add(CAL.frameProblem)
    // Chains (plan decisions 11 to 13): only the Takes canvas has them. The swap exists only while a pair does not fit.
    const chains = view.canvas.mode === "Takes" ? view.canvas.chains : []
    if (chains.length) add(CAL.chain)
    if (chains.some(chain => chain.history._tag !== "None")) add(CAL.chainHistory)
    if (chains.some(chain => chain.history._tag === "Open" && chain.history.steps.length)) add(CAL.chainStep)
    if (chains.some(chain => chain.flag._tag === "Before")) add(CAL.chainFlag)
    if (layout.pairs === "solo" && chains.some(chain => chain.parent !== null)) add(CAL.chainSolo)
  }
  // Take markup (decision 35). Pins show on every frame that has marks; the surface and its key
  // controls only in mark mode, on frames that can take a mark.
  const markup = view.markup._tag === "Ready" ? view.markup : null
  const frames = view.canvas._tag === "Frames" ? view.canvas.frames : []
  if (markup) {
    if (frames.some(frame => frame.marks.length)) add(CAL.markPin)
    if (markup.mode._tag !== "Off" && frames.some(frame => frame.markable._tag === "Enabled")) add(CAL.markSurface, CAL.markPoint, CAL.markRegion)
  }
  const barMarkup = layout.bar && view.plan._tag === "None" ? markup : null
  const drafted = markup ? markup.groups.flatMap(group => group.marks) : []
  if (markup && markup.editor._tag === "Open") {
    const editor = markup.editor
    const id = editor.id
    // In the draft when it is open, under the frame that shows the mark, or else in the bar.
    const where = markup.draftOpen ? (barMarkup && drafted.length ? "draft" : null) : frames.some(frame => frame.marks.some(mark => mark.id === id)) ? "frame" : barMarkup ? "bar" : null
    if (where) add(CAL.markNote, CAL.markEditorClose)
    // Phase 6 type-ahead: the note, which has focus when it opens with the caret at its end, ends in a
    // take number and up to three letters, and some mark the note can point to has a name that starts so.
    const typing = /(?:^|[^\p{L}\p{N}_.])(\d+[A-Za-z]{0,3})$/u.exec(editor.note)?.[1]?.toUpperCase()
    if (where && editor.edit._tag === "Enabled" && typing && editor.references.some(option => option.name.toUpperCase().startsWith(typing))) add(CAL.markReference)
  }
  if (barMarkup) {
    if (frames.some(frame => frame.markable._tag === "Enabled") || barMarkup.mode._tag !== "Off" || drafted.length) add(CAL.markup, CAL.markMode)
    if (drafted.length) add(CAL.draftOpen, CAL.send)
    if (barMarkup.draftOpen && drafted.length) {
      // Phase 6: each group in the draft says what Send, or New take, does with it.
      add(CAL.draft, CAL.markRemove, CAL.draftOutcome)
      const editing = barMarkup.editor._tag === "Open" ? barMarkup.editor.id : null
      if (drafted.some(mark => mark.id !== editing)) add(CAL.markEdit)
      const replacing = barMarkup.mode._tag === "Replacing" ? barMarkup.mode.id : null
      if (drafted.some(mark => mark.location._tag !== "Located" && mark.id !== replacing)) add(CAL.markReplace)
    }
  }

  if (view.plan._tag !== "None") add(CAL.plan)
  if (view.plan._tag === "Review" && view.plan.directions.length) add(CAL.directionTitle, CAL.directionBrief, CAL.directionRemove)

  if (layout.bar) {
    const composer = view.composer
    add(CAL.composer, CAL.prompt)
    if (view.plan._tag === "None") {
      add(CAL.start, CAL.count, CAL.agent, CAL.skills, CAL.attach)
      // Phase 6 (planner choice 14): marks on the real files that go with the typed prompt are named beside it.
      if (composer.marks._tag === "WithPrompt") add(CAL.promptMarks)
      if (composer.follow) add(CAL.follow)
      const take = view.focusedTake
      if (take) {
        add(CAL.discard)
        if (take.kind === "Experiment") add(CAL.accept)
        if (take.run._tag === "Running") add(CAL.stop)
      }
    } else {
      add(CAL.planBack)
      if (view.plan._tag === "Review") add(CAL.planStart)
    }
    if (composer.attachments.length) add(CAL.attachments, CAL.attachmentRemove)
    if (composer.agent._tag === "Failed" || composer.agent._tag === "Off") add(CAL.agent)
  }

  if (view.tools.side === "record" && view.record._tag === "Open") {
    const { take, integration } = view.record
    add(CAL.record, CAL.recordClose, CAL.log, CAL.discard)
    if (take.files.length) add(CAL.file)
    if (take.kind === "Experiment") add(CAL.accept, CAL.alternate)
    if (take.run._tag === "Running") add(CAL.stop)
    if (integration._tag !== "None") add(CAL.integration)
    if (integration._tag === "Unloaded" || integration._tag === "Review") add(CAL.review)
    if (integration._tag === "Review") {
      add(CAL.integrationCheck, CAL.behaviorReviewed, CAL.applyAlternate)
      if (integration.review.files.length) add(CAL.reviewDiff, CAL.file)
    }
  }

  if (view.tools.side === "knobs" && view.knobs._tag !== "Closed") {
    add(CAL.knobs)
    if (view.knobs._tag === "Ready") {
      add(CAL.literals)
      for (const knob of view.knobs.knobs) {
        add(CAL.knob, CAL.knobStatus, CAL.sourceFile)
        const control = knob.control
        if (control._tag === "Number") { add(CAL.knobValue); if (control.min !== undefined && control.max !== undefined) add(CAL.knobSlider) }
        if (control._tag === "Color") { add(CAL.knobValue); if (control.hex) add(CAL.knobColor) }
        if (control._tag === "Choice") add(CAL.knobChoice)
        if (control._tag === "Token") add(CAL.knobToken)
      }
      const literals = view.knobs.literals
      if (literals._tag === "Ready") for (const literal of literals.literals) {
        add(CAL.literal, CAL.literalOpen, CAL.sourceFile)
        if (literal.draft._tag !== "Closed") add(CAL.literalName, CAL.literalHome, CAL.literalCancel, CAL.promote)
      }
    }
  }

  if (view.tools.codeOpen && view.code._tag !== "Closed") {
    const code = view.code
    add(CAL.code)
    if (code._tag === "Failed") add(CAL.codeRetry)
    if (code._tag === "Ready") {
      add(CAL.fileMenu, CAL.fileFilter, CAL.file, CAL.codeStatus, CAL.editor, CAL.codeSave)
      if (code.changes > 0) add(CAL.previousChange, CAL.nextChange)
      if (code.mode._tag === "Watching" && code.take) add(CAL.stop)
      if (layout.code === "below") add(CAL.codeShare)
    }
  }

  if (view.checks._tag === "Open") {
    const run = view.checks.run
    add(CAL.checks, CAL.checksClose)
    if (run._tag === "Running") add(CAL.checkStop)
    else add(CAL.checkRun)
    if (run._tag === "Ready") {
      add(CAL.report)
      if (run.rows.length) add(CAL.checkRow)
      if (run.rows.some(row => row.findings.length + row.authored.length)) add(CAL.finding)
      if (run.rows.some(row => row.images.length || [...row.findings, ...row.authored].some(finding => finding.image))) add(CAL.evidence)
      if (run.rows.some(row => row.images.length || row.approval._tag === "Enabled")) add(CAL.imageReviewed, CAL.approveImage)
    }
  }

  if (view.calibration._tag === "Open") add(CAL.calibration, CAL.calibrationScale, CAL.calibrationReset, CAL.calibrationClose)
  return [...hooks].sort()
}
