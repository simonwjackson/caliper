import { useState } from "react"
import type { ChromeActions, ChromeView } from "../contract"
import { CAL } from "../hooks"
import { Button } from "../atoms/Button"
import { Panel } from "../atoms/Panel"
import { OpenQuestion } from "./OpenQuestion"
import { DiscardDialog } from "./DiscardDialog"
import "../tokens.css"
import "../side/side.css"
import "./board.css"

/**
 * A workspace's questions, where a take's record sits (decision 45): the
 * question it answers, the open questions with Answer, the answered ones
 * with their reasons, a field to add one, and Discard, which asks first.
 */
export function Questions({ view, actions, sheet }: { readonly view: ChromeView; readonly actions: ChromeActions; readonly sheet: boolean }) {
  const [answering, setAnswering] = useState<string | null>(null)
  const [asking, setAsking] = useState("")
  const [confirm, setConfirm] = useState(false)
  const board = view.workspace
  if (board._tag !== "Open") return null
  const open = board.questions.filter(question => question._tag === "Open")
  const answered = board.questions.filter(question => question._tag === "Answered")
  const ideas = board.columns.filter(column => column._tag === "Idea").length
  const ask = () => { if (asking.trim() && board.ask._tag === "Enabled") { actions.onAsk(asking.trim()); setAsking("") } }
  return <Panel hook={CAL.questions} label="Questions" className="dr-record" title="Questions" sub={`${answered.length} answered · ${open.length} open`}
    onClose={() => actions.onQuestions(false)} closeLabel="Close the questions">
    <div className="dr-record__body ws-q" data-sheet={sheet || undefined}>
      <section className="ws-q__ask" aria-label="The question">
        <p className="ws-q__text">{board.question || "No question yet. Write it in the bar under the board."}</p>
        {board.asked && <p className="ws-q__meta">{board.asked} {ideas === 0 ? "" : ideas === 1 ? "One idea answers it." : `${ideas} ideas answer it.`}</p>}
      </section>
      <section aria-label="Open questions">
        <h3 className="ws-q__head">Open</h3>
        {open.length === 0 ? <p className="ws-q__none">None. You and the ideas' agents can add one.</p>
          : <ul className="ws-q__list">{open.map(question => question._tag === "Open" && <OpenQuestion key={question.id} question={question} answering={answering === question.id}
            answer={board.answer} onAnswering={setAnswering} actions={actions} />)}</ul>}
      </section>
      {answered.length > 0 && <section aria-label="Answered questions">
        <h3 className="ws-q__head">Answered</h3>
        <ul className="ws-q__list">{answered.map(question => question._tag === "Answered" && <li key={question.id} className="ws-q__item" data-answered="">
          <p className="ws-q__asked">{question.text}</p>
          <p className="ws-q__answer">{question.answer}</p>
          <p className="ws-q__reason"><span>Because</span> {question.reason}</p>
          <p className="ws-q__by">{question.by}</p>
        </li>)}</ul>
      </section>}
      {board.status !== "Closed" && <form className="ws-q__add" onSubmit={event => { event.preventDefault(); ask() }}>
        <input data-cal={CAL.questionAsk} type="text" aria-label="Add a question" placeholder="Add a question" value={asking} disabled={board.ask._tag === "Disabled"}
          title={board.ask._tag === "Disabled" ? board.ask.reason : undefined} onChange={event => setAsking(event.currentTarget.value)} />
        <Button small availability={asking.trim() ? board.ask : { _tag: "Disabled", reason: "Write the question first" }} onClick={ask}>Add</Button>
      </form>}
      {board.status !== "Closed" && <footer className="ws-q__foot">
        <Button tone="danger" small hook={CAL.workspaceDiscard} availability={board.discard.availability} onClick={() => setConfirm(true)}>Discard ideas</Button>
        <span>The questions and answers stay.</span>
      </footer>}
    </div>
    {confirm && <DiscardDialog discard={board.discard} onCancel={() => setConfirm(false)} onDiscard={() => { setConfirm(false); actions.onWorkspaceDiscard(board.id) }} />}
  </Panel>
}
