import { useEffect, useRef } from "react"
import type { BoardView } from "../contract"
import { Button } from "../atoms/Button"
import "../tokens.css"
import "./board.css"

/**
 * Discard asks first. It says what goes (the ideas and the files they
 * edited) and what stays (the question and every question and answer). A
 * modal dialog sits in the browser's top layer, so no panel or sheet clips it.
 */
export function DiscardDialog({ discard, onCancel, onDiscard }: {
  readonly discard: Extract<BoardView, { _tag: "Open" }>["discard"]; readonly onCancel: () => void; readonly onDiscard: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (node && !node.open && typeof node.showModal === "function") node.showModal()
    return () => { if (node?.open) node.close() }
  }, [])
  const { ideas, files, answered, open } = discard
  const kept = [answered === 1 ? "1 answer" : `${answered} answers`, open === 1 ? "1 open question" : `${open} open questions`]
  return <dialog ref={dialog} className="ws-dialog" aria-labelledby="ws-discard-title" onCancel={event => { event.preventDefault(); onCancel() }}>
    <h2 id="ws-discard-title">Discard the ideas in this workspace?</h2>
    <p>Caliper deletes {ideas === 1 ? "1 idea" : `${ideas} ideas`} and the {files === 1 ? "1 file" : `${files} files`} they edited. Your project's files do not change.</p>
    <p>The question, {kept.join(" and ")} stay. The workspace moves to Closed.</p>
    <div className="ws-dialog__actions">
      <Button onClick={onCancel}>Cancel</Button>
      <Button tone="danger" availability={discard.availability} onClick={onDiscard}>{ideas === 0 ? "Close the workspace" : `Discard ${ideas === 1 ? "1 idea" : `${ideas} ideas`}`}</Button>
    </div>
  </dialog>
}
