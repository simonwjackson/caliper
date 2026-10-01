import type { Badge, ChromeActions, NavPart } from "../contract"
import { CAL } from "../hooks"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "./nav.css"

function badgeTone(badge: Badge | undefined): string | null {
  if (!badge) return null
  if (badge.status === "Failed") return "bad"
  if (badge.status === "Review" || badge.status === "Stale" || badge.status === "Inconclusive") return "warn"
  return null
}

/**
 * A part's states under its row: every state at once, each state, and each
 * state's takes. A state's badge is a dot only when a check needs you; its
 * words are in the title and the accessible name.
 */
export function NavStates({ id, part, actions, picked }: { readonly id: string; readonly part: NavPart; readonly actions: ChromeActions; readonly picked: () => void }) {
  return <ul id={id} className="dr-states" aria-label={`${part.name} states`}>
    {part.states.map(state => {
      const tone = badgeTone(state.badge)
      const pin = state.pin
      return <li key={state.ref.state} className="dr-states__group" data-pin={pin._tag === "Pin" || undefined}>
        <div className="ws-pin-row">
          <button type="button" className="dr-states__item" data-cal={CAL.state} data-part={state.ref.part} data-state={state.ref.state}
            aria-current={state.selected || undefined} title={[state.site, state.badge?.detail].filter(Boolean).join("\n")}
            onClick={() => { actions.onState(state.ref); picked() }}>
            <span>{state.label}</span>
            {state.badge && <span className="dr-sr">, {state.badge.label}</span>}
            {tone && <i className={`dr-dot dr-dot--${tone}`} aria-hidden="true" />}
          </button>
          {/* Decision 45: a pinned state is a row on the selected workspace's board. */}
          {pin._tag === "Pin" && <button type="button" className="ws-pin" data-cal={CAL.pin} data-part={state.ref.part} data-state={state.ref.state}
            aria-pressed={pin.pinned} aria-label={`${pin.pinned ? "Unpin" : "Pin"} ${part.name}, ${state.label}`} disabled={pin.availability._tag === "Disabled"}
            title={pin.availability._tag === "Disabled" ? pin.availability.reason : pin.pinned ? "On the board. Press to unpin." : "Pin to the board"}
            onClick={() => actions.onPin(state.ref, !pin.pinned)}><Icon name="pin" /></button>}
        </div>
        {state.takes.length > 0 && <div className="dr-states__takes">
          <button type="button" className="dr-states__take dr-states__compare" data-cal={CAL.compare} data-part={state.ref.part} data-state={state.ref.state}
            aria-current={state.comparing || undefined} onClick={() => { actions.onCompare(state.ref); picked() }}>
            Compare {state.takes.length} {state.takes.length === 1 ? "take" : "takes"}
          </button>
          {state.takes.map(take => {
            const takeTone = badgeTone(take.badge)
            return <button key={take.id} type="button" className="dr-states__take" data-cal={CAL.navTake} data-take={take.id}
              aria-current={take.selected || undefined} title={take.badge?.detail} onClick={() => { actions.onTake(take.id); picked() }}>
              <span>{take.label}</span>
              {take.badge && <span className="dr-sr">, {take.badge.label}</span>}
              {takeTone && <i className={`dr-dot dr-dot--${takeTone}`} aria-hidden="true" />}
            </button>
          })}
        </div>}
      </li>
    })}
  </ul>
}
