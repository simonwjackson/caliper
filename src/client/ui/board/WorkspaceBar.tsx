import { useLayoutEffect, useRef, useState } from "react"
import type { ChromeActions, ChromeView } from "../contract"
import { CAL } from "../hooks"
import { fitComposer, type ComposerFit } from "../layout"
import { Button } from "../atoms/Button"
import { Icon } from "../atoms/Icon"
import { MenuButton } from "../atoms/MenuButton"
import { Notices } from "../atoms/Notices"
import { ModelChooser } from "../bar/ModelChooser"
import "../tokens.css"
import "../bar/bar.css"
import "./board.css"

/** The narrowest useful prompt, with its attach button, on a shared row, in px. The composer bar uses the same. */
const FIELD_W = 300
const GAP = 10
const COUNTS = [1, 2, 3, 4] as const

/**
 * The bar under a workspace's board (decision 45), shaped as the composer bar
 * is, so the hands know it. Ask: you write the question, and the main button
 * plans the ideas. More: the prompt describes another idea. Idea: the
 * prompt goes to the focused idea, whose Discard and Stop sit beside the well.
 * NewRow: the prompt says what a new row must show and check, and Cancel
 * leaves. Row: the prompt goes to the focused row's agent, whose Delete row
 * and Stop sit beside the well (slice 2). While the planner works, the well
 * holds the status and Cancel.
 */
export function WorkspaceBar({ view, actions, hidden = false }: { readonly view: ChromeView; readonly actions: ChromeActions; readonly hidden?: boolean }) {
  const board = view.workspace
  const form = useRef<HTMLFormElement>(null)
  const lead = useRef<HTMLDivElement>(null)
  const go = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [fit, setFit] = useState<ComposerFit>("Inline")
  const bar = board._tag === "Open" ? board.bar : null
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
  }, [bar?.mode, bar?.idea?.take, bar?.row?.id, view.plan._tag])
  if (!bar) return null
  const composer = view.composer
  const planning = view.plan._tag === "Planning" ? view.plan : null
  const idea = bar.idea
  const row = bar.mode === "Row" ? bar.row : null
  const rowMode = bar.mode === "NewRow" || bar.mode === "Row"
  const goNow = () => {
    if (planning || bar.go.availability._tag !== "Enabled") return
    if (bar.mode === "Idea" && idea) actions.onIdeaFollow(idea.take)
    else if (rowMode) actions.onRowWrite()
    else if (bar.mode === "Ask" || bar.mode === "More") actions.onWorkspaceStart()
  }
  const canAttach = composer.attach._tag === "Enabled" && bar.mode !== "Closed"
  const agent = composer.agent
  return <form ref={form} className="dr-bar ws-bar" data-cal={CAL.composer} data-fit={fit} data-plan={planning ? "Planning" : "None"} data-mode={bar.mode} hidden={hidden} aria-label="Workspace composer"
    onSubmit={event => { event.preventDefault(); goNow() }}>
    {agent._tag === "Failed" && <p className="dr-bar__agent dr-bar__agent--failed" data-cal={CAL.agent} role="alert"><b>The agent did not load.</b> {agent.reason} <span className="dr-bar__hint">{agent.hint}</span></p>}
    {agent._tag === "Off" && <p className="dr-bar__agent" data-cal={CAL.agent} role="status">No agent. {agent.hint}</p>}
    <Notices notices={bar.notices} />
    <div className="dr-bar__layout">
      {bar.mode === "Idea" && idea && !planning && <div ref={lead} className="dr-bar__take">
        <div className="dr-take-actions" data-take={idea.take} role="group" aria-label={idea.label}>
          <span className="dr-take-actions__name"><b>{idea.label}</b></span>
          {idea.stop._tag === "Enabled" && <Button hook={CAL.stop} take={idea.take} availability={idea.stop} onClick={() => actions.onStop(idea.take)}><Icon name="stop" />Stop</Button>}
          <Button hook={CAL.ideaDiscard} take={idea.take} availability={idea.discard} onClick={() => actions.onIdeaDiscard(idea.take)}>Discard</Button>
        </div>
      </div>}
      {bar.mode === "NewRow" && !planning && <div ref={lead} className="dr-bar__take">
        <div className="dr-take-actions" role="group" aria-label="New row">
          <span className="dr-take-actions__name"><b>New row</b></span>
          <Button hook={CAL.rowNew} onClick={() => actions.onRowNew(false)}>Cancel</Button>
        </div>
      </div>}
      {row && !planning && <div ref={lead} className="dr-bar__take">
        <div className="dr-take-actions" data-row={row.id} role="group" aria-label={row.label}>
          <span className="dr-take-actions__name"><b>{row.label}</b></span>
          {row.stop._tag === "Enabled" && <Button hook={CAL.stop} availability={row.stop} onClick={() => actions.onRowStop(row.id)}><Icon name="stop" />Stop</Button>}
          <Button hook={CAL.rowDelete} availability={row.remove} onClick={() => actions.onRowDelete(row.id)}>Delete row</Button>
        </div>
      </div>}
      <div className="dr-well" data-disabled={bar.edit._tag === "Disabled" || undefined}>
        {composer.attachments.length > 0 && <ul className="dr-well__images" data-cal={CAL.attachments} aria-label="Images">
          {composer.attachments.map(image => <li key={image.id} className="dr-well__image" title={image.name}>
            <img src={image.url} alt={image.name} />
            <button type="button" className="dr-well__unattach" data-cal={CAL.attachmentRemove} disabled={image.remove._tag === "Disabled"}
              title={image.remove._tag === "Disabled" ? image.remove.reason : `Remove ${image.name}`} aria-label={`Remove ${image.name}`}
              onClick={() => actions.onRemoveAttachment(image.id)}><Icon name="close" /></button>
          </li>)}
        </ul>}
        <textarea className="dr-well__text" data-cal={CAL.prompt} aria-label={bar.mode === "Ask" ? "Question" : bar.mode === "NewRow" ? "What the new row shows and checks" : "Prompt"} rows={1} placeholder={bar.placeholder} value={bar.prompt}
          readOnly={bar.edit._tag === "Disabled"} aria-readonly={bar.edit._tag === "Disabled" || undefined}
          title={bar.edit._tag === "Disabled" ? bar.edit.reason : undefined}
          onChange={event => actions.onPrompt(event.currentTarget.value)}
          onPaste={event => { if (event.clipboardData.files.length && canAttach) { event.preventDefault(); actions.onAttach([...event.clipboardData.files]) } }}
          onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); goNow() } }} />
        {!planning && bar.mode !== "Closed" && <>
          <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
            onChange={event => { actions.onAttach([...event.currentTarget.files ?? []]); event.currentTarget.value = "" }} />
          <button type="button" className="dr-well__clip" data-cal={CAL.attach} disabled={!canAttach}
            title={canAttach ? "Add an image. You can also paste one." : composer.attach._tag === "Disabled" ? composer.attach.reason : "This workspace is closed."} aria-label="Add image"
            onClick={() => picker.current?.click()}><Icon name="clip" /></button>
        </>}
        <div ref={go} className="dr-well__go">
          {planning && <>
            <span className="dr-bar__planning" role="status"><i className="dr-dot dr-dot--running" aria-hidden="true" />{planning.message}</span>
            <Button hook={CAL.planCancel} onClick={actions.onPlanCancel}>Cancel</Button>
          </>}
          {!planning && bar.mode !== "Closed" && <span className="dr-split">
            <button type="button" className="dr-btn dr-btn--primary dr-split__main" data-cal={bar.mode === "Idea" ? CAL.ideaFollow : rowMode ? CAL.rowWrite : CAL.workspaceStart} data-take={bar.mode === "Idea" ? idea?.take : undefined}
              disabled={bar.go.availability._tag === "Disabled"} title={bar.go.availability._tag === "Disabled" ? bar.go.availability.reason : "Ctrl+Enter"} onClick={goNow}>{bar.go.label}</button>
            <MenuButton label="More ways to start" triggerClass="dr-btn dr-btn--primary dr-split__more" menuClass="dr-split__menu" trigger={<Icon name="chevron-down" />}>
              {bar.mode === "Ask" && <><div role="group" aria-label="How many ideas" data-cal={CAL.count}>
                {COUNTS.map(count => <button key={count} type="button" role="menuitemradio" className="dr-split__item" aria-checked={bar.count === count}
                  data-count={count} onClick={() => actions.onCount(count)}>{count === 1 ? "1 idea" : `${count} ideas, planned`}</button>)}
              </div><hr className="dr-split__rule" /></>}
              {agent._tag === "Ready"
                ? <ModelChooser agent={agent} models={composer.models} onModels={actions.onModels} onModel={actions.onModel} />
                : <p className="dr-split__agent" data-cal={CAL.agent}>{agent._tag === "Connecting" ? "Connecting to the agent…" : `No agent. ${agent.hint}`}</p>}
            </MenuButton>
          </span>}
        </div>
      </div>
    </div>
  </form>
}
