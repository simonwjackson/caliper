import { useState } from "react"
import type { ChromeActions, ComposerView } from "../contract"
import { CAL } from "../hooks"
import { MenuButton } from "../atoms/MenuButton"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "./bar.css"

const COUNTS = [1, 2, 3, 4] as const
const countLabel = (count: 1 | 2 | 3 | 4) => count === 1 ? "1 take" : `${count} takes, planned`

function agentLine(composer: ComposerView): string {
  const agent = composer.agent
  const skills = `${composer.skills.skills.length} ${composer.skills.skills.length === 1 ? "skill" : "skills"}`
  if (agent._tag === "Ready") return `${agent.model} · reasoning ${agent.reasoning} · ${skills}`
  if (agent._tag === "Connecting") return "Connecting to the agent…"
  if (agent._tag === "Off") return `No agent. ${agent.hint}`
  return `The agent did not load. ${agent.hint}`
}

/**
 * New take is a split button. The main half starts; the menu chooses how many
 * takes (2 to 4 start from a plan), sends the prompt to the focused take, and
 * names the agent and its skills in the dimmest ink.
 */
export function NewTakeMenu({ composer, actions }: { readonly composer: ComposerView; readonly actions: ChromeActions }) {
  const agent = composer.agent
  const title = agent._tag === "Ready" ? `${agent.baseUrl} (${agent.api}) from ${agent.baseUrlFrom}. Key from ${agent.keyFrom}.` : undefined
  const follow = composer.follow
  const start = composer.start
  const [skillsOpen, setSkillsOpen] = useState(false)
  return <span className="dr-split">
    <button type="button" className="dr-btn dr-btn--primary dr-split__main" data-cal={CAL.start} disabled={start._tag === "Disabled"}
      title={start._tag === "Disabled" ? start.reason : "Ctrl+Enter"} onClick={() => actions.onStart()}>{composer.startLabel}</button>
    <MenuButton label="New take options" triggerClass="dr-btn dr-btn--primary dr-split__more" menuClass="dr-split__menu" trigger={<Icon name="chevron-down" />}>
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
      <p className="dr-split__agent" data-cal={CAL.agent} title={title}>{agentLine(composer)}</p>
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
