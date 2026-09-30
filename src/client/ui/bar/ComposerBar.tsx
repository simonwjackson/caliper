import { useLayoutEffect, useRef, useState } from "react"
import type { DragEvent } from "react"
import type { ChromeActions, ChromeView } from "../contract"
import { CAL } from "../hooks"
import { fitComposer, type ComposerFit } from "../layout"
import { Button } from "../atoms/Button"
import { Icon } from "../atoms/Icon"
import { Notices } from "../atoms/Notices"
import { NewTakeMenu } from "./NewTakeMenu"
import { TakeActions } from "./TakeActions"
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
 */
export function ComposerBar({ view, actions, hidden = false }: { readonly view: ChromeView; readonly actions: ChromeActions; readonly hidden?: boolean }) {
  const composer = view.composer
  const plan = view.plan
  const focused = plan._tag === "None" ? view.focusedTake : null
  const form = useRef<HTMLFormElement>(null)
  const lead = useRef<HTMLDivElement>(null)
  const go = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const drags = useRef(0)
  const [fit, setFit] = useState<ComposerFit>("Inline")
  const [dropping, setDropping] = useState(false)
  useLayoutEffect(() => {
    const node = form.current
    if (!node) return
    const measure = () => {
      const style = getComputedStyle(node)
      const width = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const next = fitComposer(width, { field: FIELD_W, gap: GAP, take: lead.current?.offsetWidth ?? 0, go: go.current?.offsetWidth ?? 0 })
      setFit(previous => previous === next ? previous : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    if (lead.current) observer.observe(lead.current)
    if (go.current) observer.observe(go.current)
    return () => observer.disconnect()
  }, [focused?.id, plan._tag])
  const canAttach = composer.attach._tag === "Enabled"
  const startNow = () => { if (plan._tag === "None" && composer.start._tag === "Enabled") actions.onStart(); else if (plan._tag === "Review" && plan.start._tag === "Enabled") actions.onStart() }
  const follow = composer.follow
  const agent = composer.agent
  const pick = () => picker.current?.click()
  const files = (event: DragEvent) => event.dataTransfer.types.includes("Files")
  return <form ref={form} className="dr-bar" data-cal={CAL.composer} data-fit={fit} data-plan={plan._tag} hidden={hidden} aria-label="Composer"
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
    <div className="dr-bar__layout">
      {focused && <div ref={lead} className="dr-bar__take"><TakeActions take={focused} actions={actions} /></div>}
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
          {plan._tag === "None" && <NewTakeMenu composer={composer} actions={actions} />}
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
