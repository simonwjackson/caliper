import { useLayoutEffect, useRef, useState } from "react"
import type { DragEvent } from "react"
import type { Availability, ChromeActions, ChromeView } from "../contract"
import { CAL } from "../hooks"
import { fitComposer, type ComposerFit } from "../layout"
import { Button } from "../atoms/Button"
import { Icon } from "../atoms/Icon"
import { Notices } from "../atoms/Notices"
import { NewTakeMenu } from "./NewTakeMenu"
import { TakeActions } from "./TakeActions"
import { MarkModeButton } from "./MarkModeButton"
import { DraftButton } from "./DraftButton"
import { Draft } from "./Draft"
import { NoteEditor } from "../canvas/NoteEditor"
import { NoteText } from "../atoms/NoteText"
import "../tokens.css"
import "./bar.css"

/** The narrowest useful prompt, with its attach button, on a shared row, in px. */
const FIELD_W = 300
const GAP = 10

/**
 * The bar under the canvas. Two things live here: the focused take's actions,
 * and one well that holds everything about the next prompt, as a chat composer
 * does: the images you attach, the text, the attach button and the primary
 * button. `fitComposer` decides from the bar's own width whether the take's
 * actions sit beside the well or above it, and whether the well is one row or
 * stacks its text over its buttons. During a plan the prompt is read only and
 * the well holds Back and Start. An agent that failed to load shows above,
 * because this is where it is missed.
 *
 * Take markup lives here too (decision 35): the pin button at the left, the
 * draft's count and Send at the right, and the draft unfolded above. A note
 * whose mark no frame on the canvas shows is edited here, above the well.
 * Marks on the real files that go with a typed prompt (planner choice 14)
 * are named at the top of the well, with the prompt they go with.
 */
export function ComposerBar({ view, actions, hidden = false }: { readonly view: ChromeView; readonly actions: ChromeActions; readonly hidden?: boolean }) {
  const composer = view.composer
  const plan = view.plan
  const focused = plan._tag === "None" ? view.focusedTake : null
  const markup = plan._tag === "None" && view.markup._tag === "Ready" ? view.markup : null
  const frames = view.canvas._tag === "Frames" ? view.canvas.frames : []
  const markable = frames.find(frame => frame.markable._tag === "Enabled")
  const drafted = markup ? markup.groups.reduce((sum, group) => sum + group.marks.length, 0) : 0
  const marking = markup && (markable || markup.mode._tag !== "Off" || drafted > 0) ? markup : null
  const why = frames.map(frame => frame.markable).find(item => item._tag === "Disabled")
  const markAvailability: Availability = markable ? { _tag: "Enabled" } : why ?? { _tag: "Disabled", reason: "No frame here can take a mark" }
  const editor = markup && !markup.draftOpen && markup.editor._tag === "Open" ? markup.editor : null
  const stray = editor && !frames.some(frame => frame.marks.some(mark => mark.id === editor.id)) ? editor : null
  const failed = markup?.send._tag === "Failed" ? markup.send : null
  const withPrompt = plan._tag === "None" && composer.marks._tag === "WithPrompt" ? composer.marks : null
  const strayRefs = stray && markup ? new Map(markup.groups.flatMap(group => group.marks.map(mark => [mark.id, mark.references] as const))) : undefined
  const form = useRef<HTMLFormElement>(null)
  const lead = useRef<HTMLDivElement>(null)
  const go = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const drags = useRef(0)
  const [fit, setFit] = useState<ComposerFit>("Inline")
  const [room, setRoom] = useState(0)
  const [dropping, setDropping] = useState(false)
  useLayoutEffect(() => {
    const node = form.current
    if (!node) return
    const measure = () => {
      const style = getComputedStyle(node)
      const width = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const next = fitComposer(width, { field: FIELD_W, gap: GAP, take: lead.current?.offsetWidth ?? 0, go: go.current?.offsetWidth ?? 0 })
      setFit(previous => previous === next ? previous : next)
      // The draft unfolds upward over the canvas; it may use the room between the stage's top and the bar.
      const above = Math.max(0, Math.floor(node.offsetTop))
      setRoom(previous => previous === above ? previous : above)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    // The room above the bar changes with the stage's height, not only the bar's.
    if (node.offsetParent) observer.observe(node.offsetParent)
    if (lead.current) observer.observe(lead.current)
    if (go.current) observer.observe(go.current)
    return () => observer.disconnect()
  }, [focused?.id, plan._tag, marking !== null])
  const canAttach = composer.attach._tag === "Enabled"
  const startNow = () => { if (plan._tag === "None" && composer.start._tag === "Enabled") actions.onStart(); else if (plan._tag === "Review" && plan.start._tag === "Enabled") actions.onStart() }
  const follow = composer.follow
  const agent = composer.agent
  const pick = () => picker.current?.click()
  const files = (event: DragEvent) => event.dataTransfer.types.includes("Files")
  return <form ref={form} className="dr-bar" data-cal={CAL.composer} data-fit={fit} data-plan={plan._tag} hidden={hidden} aria-label="Composer"
    style={room > 0 ? { ["--dr-draft-room" as string]: `${room}px` } : undefined}
    onSubmit={event => { event.preventDefault(); startNow() }}
    onDragEnter={event => { if (files(event) && canAttach) { drags.current++; setDropping(true) } }}
    onDragLeave={event => { if (files(event) && --drags.current <= 0) { drags.current = 0; setDropping(false) } }}
    onDragOver={event => { if (canAttach && files(event)) event.preventDefault() }}
    onDrop={event => { drags.current = 0; setDropping(false); if (event.dataTransfer.files.length) { event.preventDefault(); if (canAttach) actions.onAttach([...event.dataTransfer.files]) } }}>
    {agent._tag === "Failed" && <p className="dr-bar__agent dr-bar__agent--failed" data-cal={CAL.agent} role="alert">
      <b>The agent did not load.</b> {agent.reason} <span className="dr-bar__hint">{agent.hint}</span>
    </p>}
    {agent._tag === "Off" && <p className="dr-bar__agent" data-cal={CAL.agent} role="status">No agent. {agent.hint}</p>}
    <Notices notices={composer.notices} />
    {failed && <p className="dr-bar__agent dr-bar__agent--failed" role="alert"><b>Send did not go through.</b> {failed.reason}</p>}
    {markup && markup.draftOpen && drafted > 0 && <Draft markup={markup} view={view} actions={actions} />}
    {stray && <div className="dr-bar__note"><NoteEditor id={stray.id} name={stray.name} note={stray.note} edit={stray.edit} onNote={actions.onMarkNote}
      references={stray.references} referencesOf={strayRefs} onClose={() => actions.onMarkEdit(null)} /></div>}
    <div className="dr-bar__layout">
      {(focused || marking) && <div ref={lead} className="dr-bar__take">
        {marking && <span className="dr-bar__mark" data-cal={CAL.markup} role="group" aria-label="Take markup">
          <MarkModeButton mode={marking.mode} availability={markAvailability} onMarkMode={actions.onMarkMode} />
        </span>}
        {focused && <TakeActions take={focused} actions={actions} />}
      </div>}
      <div className="dr-well" data-disabled={composer.edit._tag === "Disabled" || undefined} data-dropping={dropping || undefined}>
        {composer.attachments.length > 0 && <ul className="dr-well__images" data-cal={CAL.attachments} aria-label="Images">
          {composer.attachments.map(image => <li key={image.id} className="dr-well__image" title={image.name}>
            <img src={image.url} alt={image.name} />
            <button type="button" className="dr-well__unattach" data-cal={CAL.attachmentRemove} disabled={image.remove._tag === "Disabled"}
              title={image.remove._tag === "Disabled" ? image.remove.reason : `Remove ${image.name}`} aria-label={`Remove ${image.name}`}
              onClick={() => actions.onRemoveAttachment(image.id)}><Icon name="close" /></button>
          </li>)}
          {canAttach && <li><button type="button" className="dr-well__more" aria-label="Add another image" title="Add another image" onClick={pick}><Icon name="plus" /></button></li>}
        </ul>}
        {withPrompt && <p className="dr-well__marks" data-cal={CAL.promptMarks} role="status"><NoteText text={withPrompt.label} names={withPrompt.names} /></p>}
        <textarea className="dr-well__text" data-cal={CAL.prompt} aria-label="Prompt" rows={1} placeholder={composer.placeholder} value={composer.prompt}
          readOnly={composer.edit._tag === "Disabled"} aria-readonly={composer.edit._tag === "Disabled" || undefined}
          title={composer.edit._tag === "Disabled" ? composer.edit.reason : undefined}
          onChange={event => actions.onPrompt(event.currentTarget.value)}
          onPaste={event => { if (event.clipboardData.files.length && canAttach) { event.preventDefault(); actions.onAttach([...event.clipboardData.files]) } }}
          onKeyDown={event => {
            if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return
            event.preventDefault()
            if (event.shiftKey) { if (follow && follow.availability._tag === "Enabled") actions.onFollow(follow.take) }
            else startNow()
          }} />
        {plan._tag === "None" && <>
          <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
            onChange={event => { actions.onAttach([...event.currentTarget.files ?? []]); event.currentTarget.value = "" }} />
          <button type="button" className="dr-well__clip" data-cal={CAL.attach} disabled={!canAttach}
            title={composer.attach._tag === "Disabled" ? composer.attach.reason : "Add an image. You can also paste or drop one."} aria-label="Add image"
            onClick={pick}><Icon name="clip" /></button>
        </>}
        <div ref={go} className="dr-well__go">
          {markup && drafted > 0 && <DraftButton marks={drafted} open={markup.draftOpen} blocked={markup.groups.some(group => group.decision._tag === "Blocked")} onDraftOpen={actions.onDraftOpen} />}
          {plan._tag === "None" && <NewTakeMenu composer={composer} actions={actions} send={markup && drafted > 0 ? { send: markup.send, revision: markup.revision, first: !withPrompt } : null} />}
          {plan._tag === "Review" && <>
            <Button hook={CAL.planBack} onClick={actions.onPlanBack}>Back</Button>
            <Button hook={CAL.planStart} tone="primary" availability={plan.start} onClick={actions.onStart}>{plan.startLabel}</Button>
          </>}
          {plan._tag === "Planning" && <>
            <span className="dr-bar__planning" role="status"><i className="dr-dot dr-dot--running" aria-hidden="true" />{plan.message}</span>
            <Button hook={CAL.planBack} onClick={actions.onPlanBack}>Cancel</Button>
          </>}
        </div>
        {dropping && <p className="dr-well__drop" aria-hidden="true"><Icon name="image" />Drop to attach</p>}
      </div>
    </div>
  </form>
}
