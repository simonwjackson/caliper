import { useState } from "react"
import type { ComposerView, ModelsView } from "../contract"
import { CAL } from "../hooks"
import "../tokens.css"
import "./bar.css"

/** How many matches the filter shows at once; the rest are one more letter away. */
const SHOWN = 8

/**
 * The agent's model, inside the New take menu (decision 43). Folded, it is the
 * agent line: the model and its reasoning. Unfolded, it lists pi's favorites,
 * then a filter over every model the endpoint serves, which also takes a typed
 * model id. Choosing closes the menu and applies to every project.
 * `unfolded` and `typed` set where the disclosure starts, for part states.
 */
export function ModelChooser({ agent, models, onModels, onModel, unfolded = false, typed: startTyped = "" }: {
  readonly agent: Extract<ComposerView["agent"], { _tag: "Ready" }>
  readonly models: ModelsView
  readonly onModels: () => void
  readonly onModel: (model: string) => void
  readonly unfolded?: boolean
  readonly typed?: string
}) {
  const [open, setOpen] = useState(unfolded)
  const [filter, setFilter] = useState(startTyped)
  const title = `${agent.baseUrl} (${agent.api}) from ${agent.baseUrlFrom}. Key from ${agent.keyFrom}.`
  const ready = models._tag === "Ready" ? models : null
  const current = ready?.choosing ?? ready?.current ?? agent.model
  const needle = filter.trim().toLowerCase()
  const favorites = ready ? [...(ready.favorites.includes(ready.current) || ready.models.includes(ready.current) ? [] : [ready.current]), ...ready.favorites] : []
  const all = ready ? [...ready.favorites, ...ready.models] : []
  const matches = needle === "" ? (favorites.length === 0 ? ready?.models ?? [] : []) : all.filter(id => id.toLowerCase().includes(needle))
  const typed = filter.trim()
  // A typed id that no listed model matches; with a match, the match is the likelier choice.
  const offerTyped = /^\S{1,200}$/.test(typed) && matches.length === 0
  const choose = (id: string) => { onModel(id); setFilter(""); setOpen(false) }
  const item = (id: string) => <button key={id} type="button" role="menuitemradio" className="dr-split__item dr-split__model" aria-checked={id === current}
    aria-busy={ready?.choosing === id || undefined} disabled={ready?.choosing !== null && ready?.choosing !== undefined} data-model={id} onClick={() => choose(id)}>
    {ready?.choosing === id && <i className="dr-dot dr-dot--running" aria-hidden="true" />}{id}
  </button>
  return <div className="dr-split__models" data-cal={CAL.models}>
    <button type="button" role="menuitem" className="dr-split__item dr-split__item--quiet" data-cal={CAL.agent} data-keep-open="" aria-expanded={open} title={title}
      onClick={() => { if (!open) onModels(); setOpen(!open) }}>
      <span className="dr-split__model">{agent.model} · reasoning {agent.reasoning}</span><i className="dr-chev" aria-hidden="true" />
    </button>
    {open && <div role="group" aria-label="Model">
      {models._tag === "Loading" || models._tag === "Idle" ? <p className="dr-split__agent">Loading the endpoint's models…</p> : null}
      {models._tag === "Failed" && <>
        <p className="dr-split__agent dr-split__problem">{models.reason}</p>
        <button type="button" role="menuitem" className="dr-split__item dr-split__item--quiet" data-keep-open="" onClick={onModels}>Try again</button>
      </>}
      {ready && <>
        {/* While filtering, the matches replace the favorites, so no model shows twice. */}
        {needle === "" && favorites.map(item)}
        <input className="dr-split__filter" data-cal={CAL.modelFilter} type="search" value={filter} aria-label="Filter models or type a model id"
          placeholder={ready.models.length + ready.favorites.length > 0 ? `Filter ${all.length} models, or type an id` : "Type a model id"}
          onChange={event => setFilter(event.currentTarget.value)}
          onKeyDown={event => {
            // The menu moves focus on Home and End; in the field they move the caret.
            if (event.key === "Home" || event.key === "End") event.stopPropagation()
            if (event.key === "Enter" && typed !== "") { event.preventDefault(); choose(matches[0] ?? typed) }
          }} />
        {matches.slice(0, SHOWN).map(item)}
        {matches.length > SHOWN && <p className="dr-split__agent">{matches.length - SHOWN} more {matches.length - SHOWN === 1 ? "model matches" : "models match"}. Type more of the id.</p>}
        {offerTyped && <button type="button" role="menuitem" className="dr-split__item" data-model={typed} onClick={() => choose(typed)}>Use “{typed}”</button>}
        {ready.problem !== "" && <p className="dr-split__agent dr-split__problem">{ready.problem}</p>}
      </>}
    </div>}
  </div>
}
