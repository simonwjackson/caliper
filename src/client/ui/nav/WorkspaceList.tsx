import type { ChromeActions, WorkspacesView } from "../contract"
import { CAL } from "../hooks"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "./nav.css"

/**
 * The workspaces, above the parts (decision 45). A workspace is a scratch
 * area for one question; its board replaces the canvas. New starts an empty
 * one, and the list shows how far each one is. While an open one is
 * selected, a line says how its rows are made.
 */
export function WorkspaceList({ workspaces, pinning, actions, picked }: {
  readonly workspaces: WorkspacesView; readonly pinning: boolean; readonly actions: ChromeActions; readonly picked: () => void
}) {
  return <section className="dr-layer ws-spaces" data-cal={CAL.workspaces} aria-label="Workspaces">
    <h3 className="dr-layer__name ws-spaces__head"><span>Workspaces</span>
      <button type="button" className="ws-spaces__new" data-cal={CAL.workspaceNew} disabled={workspaces.create._tag === "Disabled"}
        title={workspaces.create._tag === "Disabled" ? workspaces.create.reason : "Start a workspace for a new question"} onClick={() => { actions.onWorkspaceNew(); picked() }}>
        <Icon name="plus" />New
      </button></h3>
    {workspaces.items.length > 0 && <ul className="ws-spaces__list">
      {workspaces.items.map(item => <li key={item.id}>
        <button type="button" className="ws-space" data-cal={CAL.workspace} data-workspace={item.id} aria-current={item.selected || undefined}
          title={item.problem || item.name} onClick={() => { actions.onWorkspace(item.selected ? null : item.id); picked() }}>
          <span className="ws-space__name">{item.name}</span><span className="ws-space__meta" data-problem={item.problem ? "" : undefined}>{item.meta}</span>
        </button>
      </li>)}
    </ul>}
    {pinning && <p className="ws-spaces__hint">Pin a state to make it a row on the board.</p>}
  </section>
}
