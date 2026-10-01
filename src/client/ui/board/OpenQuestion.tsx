import { useLayoutEffect, useRef, useState } from "react"
import type { Availability, ChromeActions, QuestionView } from "../contract"
import { CAL } from "../hooks"
import { Button } from "../atoms/Button"
import "../tokens.css"
import "./board.css"

/**
 * An open question of a workspace, with Answer. Answering unfolds two fields,
 * the answer and its reason, and both are needed: a decision without its
 * reason does not survive the next person who reads it.
 */
export function OpenQuestion({ question, answering, answer: availability, onAnswering, actions }: {
  readonly question: Extract<QuestionView, { _tag: "Open" }>; readonly answering: boolean; readonly answer: Availability
  readonly onAnswering: (id: string | null) => void; readonly actions: Pick<ChromeActions, "onAnswer">
}) {
  const [answer, setAnswer] = useState("")
  const [reason, setReason] = useState("")
  const item = useRef<HTMLLIElement>(null)
  const first = useRef<HTMLTextAreaElement>(null)
  // The question you answer comes into view in its own scroller, and the answer field takes focus.
  useLayoutEffect(() => {
    const node = item.current
    if (!answering || !node) return
    let scroller = node.parentElement
    while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement
    if (scroller) scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8
    first.current?.focus()
  }, [answering])
  const ready = answer.trim() !== "" && reason.trim() !== ""
  const save = () => { if (ready && availability._tag === "Enabled") { actions.onAnswer(question.id, answer, reason); onAnswering(null) } }
  return <li ref={item} className="ws-q__item" data-answering={answering || undefined}>
    <p className="ws-q__asked">{question.text}</p>
    <p className="ws-q__by">{question.by}</p>
    {answering
      ? <form className="ws-answer" onSubmit={event => { event.preventDefault(); save() }}
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onAnswering(null) } }}>
        <label className="ws-answer__field">Answer<textarea ref={first} rows={2} value={answer} onChange={event => setAnswer(event.currentTarget.value)} /></label>
        <label className="ws-answer__field">Reason<textarea rows={3} value={reason} onChange={event => setReason(event.currentTarget.value)} /></label>
        <div className="ws-answer__actions">
          <Button tone="primary" small hook={CAL.questionAnswer} availability={ready ? availability : { _tag: "Disabled", reason: "Write the answer and its reason" }} onClick={save}>Save answer</Button>
          <Button small onClick={() => onAnswering(null)}>Cancel</Button>
        </div>
      </form>
      : <div className="ws-q__actions"><Button small availability={availability} onClick={() => onAnswering(question.id)}>Answer</Button></div>}
  </li>
}
