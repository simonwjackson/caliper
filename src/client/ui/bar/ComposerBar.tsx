import { useLayoutEffect, useRef, useState } from "react"
import type { ChromeActions, ChromeView } from "../contract"
import { CAL } from "../hooks"
import { fitBar } from "../layout"
import { Button } from "../atoms/Button"
import { Icon } from "../atoms/Icon"
import { Notices } from "../atoms/Notices"
import { NewTakeMenu } from "./NewTakeMenu"
import { TakeActions } from "./TakeActions"
import "../tokens.css"
import "./bar.css"

/** The narrowest useful prompt field on a shared row, in px. */
const FIELD_W = 256
const GAP = 10

/**
 * The bar under the canvas: the focused take's actions, the prompt with its
 * images, and one primary button. A row holds only what has something in it.
 * `fitBar` stacks the rows from the bar's own width. During a plan, the
 * prompt is read only and the bar holds Back and Start. An agent that failed
 * to load shows here, above the prompt, because this is where it is missed.
 */
export function ComposerBar({ view, actions, hidden = false }: { readonly view: ChromeView; readonly actions: ChromeActions; readonly hidden?: boolean }) {
  const composer = view.composer
  const plan = view.plan
  const focused = plan._tag === "None" ? view.focusedTake : null
  const form = useRef<HTMLFormElement>(null)
  const lead = useRef<HTMLDivElement>(null)
  const go = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<1 | 2 | 3>(1)
  useLayoutEffect(() => {
    const node = form.current
    if (!node) return
    const measure = () => {
      const style = getComputedStyle(node)
      const width = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const next = fitBar(width, { field: FIELD_W, gap: GAP, groups: [lead.current?.offsetWidth ?? 0, go.current?.offsetWidth ?? 0] })
      setRows(previous => previous === next ? previous : next)
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
  return <form ref={form} className="dr-bar" data-cal={CAL.composer} data-rows={rows} data-plan={plan._tag} hidden={hidden} aria-label="Composer"
    onSubmit={event => { event.preventDefault(); startNow() }}
    onDragOver={event => { if (canAttach && event.dataTransfer.types.includes("Files")) event.preventDefault() }}
    onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); if (canAttach) actions.onAttach([...event.dataTransfer.files]) } }}>
    {agent._tag === "Failed" && <p className="dr-bar__agent dr-bar__agent--failed" data-cal={CAL.agent} role="alert">
      <b>The agent did not load.</b> {agent.reason} <span className="dr-bar__hint">{agent.hint}</span>
    </p>}
    {agent._tag === "Off" && <p className="dr-bar__agent" data-cal={CAL.agent} role="status">No agent. {agent.hint}</p>}
    <Notices notices={composer.notices} />
    <div className="dr-bar__row">
      {focused && <div ref={lead} className="dr-bar__lead"><TakeActions take={focused} actions={actions} /></div>}
      <div className="dr-bar__field">
        <div className="dr-bar__input" data-disabled={composer.edit._tag === "Disabled" || undefined}>
        {composer.attachments.length > 0 && <ul className="dr-bar__attachments" data-cal={CAL.attachments} aria-label="Images">
          {composer.attachments.map(image => <li key={image.id}>
            <img src={image.url} alt={image.name} title={image.name} />
            <button type="button" className="dr-bar__unattach" data-cal={CAL.attachmentRemove} disabled={image.remove._tag === "Disabled"}
              title={image.remove._tag === "Disabled" ? image.remove.reason : `Remove ${image.name}`} aria-label={`Remove ${image.name}`}
              onClick={() => actions.onRemoveAttachment(image.id)}><Icon name="close" /></button>
          </li>)}
        </ul>}
          {plan._tag === "None" && <>
            <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
              onChange={event => { actions.onAttach([...event.currentTarget.files ?? []]); event.currentTarget.value = "" }} />
            <button type="button" className="dr-bar__clip" data-cal={CAL.attach} disabled={!canAttach}
              title={composer.attach._tag === "Disabled" ? composer.attach.reason : "Add an image. You can also paste or drop one."} aria-label="Add image"
              onClick={() => picker.current?.click()}><Icon name="clip" /></button>
          </>}
          <textarea data-cal={CAL.prompt} aria-label="Prompt" rows={1} placeholder={composer.placeholder} value={composer.prompt}
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
        </div>
      </div>
      <div ref={go} className="dr-bar__go">
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
    </div>
  </form>
}
