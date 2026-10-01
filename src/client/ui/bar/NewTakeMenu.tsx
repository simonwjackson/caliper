import { useState } from "react"
import type { ChromeActions, ComposerView, MarkupSend } from "../contract"
import { CAL } from "../hooks"
import { MenuButton } from "../atoms/MenuButton"
import { Icon } from "../atoms/Icon"
import { ModelChooser } from "./ModelChooser"
import "../tokens.css"
import "./bar.css"

const COUNTS = [1, 2, 3, 4] as const
const countLabel = (count: 1 | 2 | 3 | 4) => count === 1 ? "1 take" : `${count} takes`

/** The agent line when there is no model to choose. */
function agentLine(composer: ComposerView): string {
  const agent = composer.agent
  if (agent._tag === "Ready") return `${agent.model} · reasoning ${agent.reasoning}`
  if (agent._tag === "Connecting") return "Connecting to the agent…"
  if (agent._tag === "Off") return `No agent. ${agent.hint}`
  return `The agent did not load. ${agent.hint}`
}

/**
 * The draft's Send, when the draft holds marks. `revision` is the draft the button shows.
 * `first`: Send is the main half. It is not while marks on the real files go with a typed
 * prompt (planner choice 14): then New take is what the draft says happens next.
 */
export type SendChoice = { readonly send: MarkupSend; readonly revision: number; readonly first?: boolean }

/**
 * New take is a split button. The main half starts; the menu chooses how many
 * takes (2 to 4 start from one plan, all at once), sends the prompt to the focused take,
 * chooses the agent's model, and names its skills in the dimmest ink.
 *
 * While the draft holds marks, the main half is Send, with its count, as
 * decision 35 draws it, and New take moves to the top of the menu. Ctrl+Enter
 * in the prompt still starts a new take. While marks on the real files go
 * with a typed prompt, New take stays the main half and Send is at the top
 * of the menu.
 */
export function NewTakeMenu({ composer, actions, send = null }: { readonly composer: ComposerView; readonly actions: ChromeActions; readonly send?: SendChoice | null }) {
  const agent = composer.agent
  const follow = composer.follow
  const start = composer.start
  const [skillsOpen, setSkillsOpen] = useState(false)
  const sending = send?.send._tag === "Sending"
  const sendReason = !send ? undefined : send.send._tag === "Sending" ? "The draft is being sent" : send.send.availability._tag === "Disabled" ? send.send.availability.reason : undefined
  const sendFirst = send !== null && send.first !== false
  return <span className="dr-split">
    {send && sendFirst
      ? <button type="button" className="dr-btn dr-btn--primary dr-split__main" data-cal={CAL.send} data-revision={send.revision} disabled={sendReason !== undefined}
        aria-busy={sending || undefined} title={sendReason ?? "Make a new take from each marked take"} onClick={() => actions.onSend(send.revision)}>
        {sending && <i className="dr-dot dr-dot--running" aria-hidden="true" />}{send.send.label}
      </button>
      : <button type="button" className="dr-btn dr-btn--primary dr-split__main" data-cal={CAL.start} disabled={start._tag === "Disabled"}
        title={start._tag === "Disabled" ? start.reason : "Ctrl+Enter"} onClick={() => actions.onStart()}>{composer.startLabel}</button>}
    <MenuButton label="New take options" triggerClass="dr-btn dr-btn--primary dr-split__more" menuClass="dr-split__menu" trigger={<Icon name="chevron-down" />}>
      {send && sendFirst && <>
        <button type="button" role="menuitem" className="dr-split__item" data-cal={CAL.start} disabled={start._tag === "Disabled"}
          title={start._tag === "Disabled" ? start.reason : undefined} onClick={() => actions.onStart()}>{composer.startLabel} from the prompt<kbd>Ctrl+Enter</kbd></button>
        <hr className="dr-split__rule" />
      </>}
      {send && !sendFirst && <>
        <button type="button" role="menuitem" className="dr-split__item" data-cal={CAL.send} data-revision={send.revision} disabled={sendReason !== undefined}
          aria-busy={sending || undefined} title={sendReason ?? "Make a new take from each marked take instead"} onClick={() => actions.onSend(send.revision)}>{send.send.label}</button>
        <hr className="dr-split__rule" />
      </>}
      <div role="group" aria-label="How many takes" data-cal={CAL.count}>
        {COUNTS.map(count => <button key={count} type="button" role="menuitemradio" className="dr-split__item" aria-checked={composer.count === count}
          data-count={count} onClick={() => actions.onCount(count)}>{countLabel(count)}</button>)}
      </div>
      {follow && <>
        <hr className="dr-split__rule" />
        <button type="button" role="menuitem" className="dr-split__item" data-cal={CAL.follow} data-take={follow.take} disabled={follow.availability._tag === "Disabled"}
          title={follow.availability._tag === "Disabled" ? follow.availability.reason : undefined} onClick={() => actions.onFollow(follow.take)}>
          {follow.label}<kbd>Ctrl+Shift+Enter</kbd>
        </button>
      </>}
      <hr className="dr-split__rule" />
      {agent._tag === "Ready"
        ? <ModelChooser agent={agent} models={composer.models} onModels={actions.onModels} onModel={actions.onModel} />
        : <p className="dr-split__agent" data-cal={CAL.agent}>{agentLine(composer)}</p>}
      <div className="dr-split__skills" data-cal={CAL.skills}>
        <button type="button" role="menuitem" className="dr-split__item dr-split__item--quiet" data-keep-open="" aria-expanded={skillsOpen} onClick={() => setSkillsOpen(!skillsOpen)}>
          {composer.skills.skills.length === 0 ? "No skills" : `Skills (${composer.skills.skills.length})`}{composer.skills.problems.length > 0 && ` · ${composer.skills.problems.length} ${composer.skills.problems.length === 1 ? "problem" : "problems"}`}<i className="dr-chev" aria-hidden="true" />
        </button>
        {skillsOpen && <ul>
          {composer.skills.skills.map(skill => <li key={skill.name}><b>{skill.name}</b> <span>{skill.description}</span> <span className="dr-split__where">{skill.scope} · {skill.location}</span></li>)}
          {composer.skills.problems.map(problem => <li key={problem} className="dr-split__problem">{problem}</li>)}
        </ul>}
      </div>
    </MenuButton>
  </span>
}
