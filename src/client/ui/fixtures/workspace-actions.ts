/**
 * Local behaviour of a workspace's actions for the gallery (decisions 18 and
 * 45): each makes the change the app shows next, from the view alone. It
 * performs no I/O and is not core's app state.
 */
import type { BoardView, ChromeView, QuestionView } from "../contract"
import type { StateRef } from "../../../types"

type Open = Extract<BoardView, { _tag: "Open" }>
const onBoard = (view: ChromeView, change: (board: Open) => Open): ChromeView =>
  view.workspace._tag === "Open" ? { ...view, workspace: change(view.workspace) } : view

/** A pin turns on or off in the parts panel, and its part counts it. */
export function pinLocally(view: ChromeView, ref: StateRef, pinned: boolean): ChromeView {
  const parts = view.navigation.parts.map(part => {
    if (part.file !== ref.part) return part
    const states = part.states.map(state => state.ref.state === ref.state && state.pin._tag === "Pin" ? { ...state, pin: { ...state.pin, pinned } } : state)
    return { ...part, states, pinned: states.filter(state => state.pin._tag === "Pin" && state.pin.pinned).length }
  })
  return { ...view, navigation: { ...view.navigation, parts } }
}

/** Focus an idea's column, so the bar talks to it, or none. */
export function focusLocally(view: ChromeView, take: string | null): ChromeView {
  return onBoard(view, board => {
    if (board.bar.mode === "Closed" || take !== null && !board.columns.some(column => column._tag === "Idea" && column.take === take)) return board
    const columns = board.columns.map(column => column._tag === "Idea" ? { ...column, focused: column.take === take } : column)
    const cells = board.cells.map(cell => cell.frame?.take ? { ...cell, frame: { ...cell.frame, selected: cell.frame.take === take } } : cell)
    const prompt = board.bar.prompt.trim()
    const bar = take === null
      ? { ...board.bar, mode: "More" as const, idea: null, placeholder: "Describe another idea for this question", go: { label: "New idea", availability: prompt ? { _tag: "Enabled" as const } : { _tag: "Disabled" as const, reason: "Describe the idea first." } } }
      : { ...board.bar, mode: "Idea" as const, placeholder: `Tell idea ${take} what to change`, idea: { take, label: `Idea ${take}`, discard: { _tag: "Enabled" as const }, stop: { _tag: "Disabled" as const, reason: "No agent is running." } },
        go: { label: `Send to idea ${take}`, availability: prompt ? { _tag: "Enabled" as const } : { _tag: "Disabled" as const, reason: "Write what to change first." } } }
    return { ...board, columns, cells, bar }
  })
}

/** New row puts the bar in New row, or takes it out (slice 2). */
export function rowNewLocally(view: ChromeView, open: boolean): ChromeView {
  return onBoard(view, board => {
    if (board.newRow._tag === "Disabled" || board.bar.mode === "Closed") return board
    const bar = open
      ? { ...board.bar, mode: "NewRow" as const, prompt: "", idea: null, row: null, placeholder: "Say what the new row shows, and what its checks press and expect",
        go: { label: "Write row", availability: { _tag: "Disabled" as const, reason: "Say what the row must show and check first." } } }
      : { ...board.bar, mode: "More" as const, prompt: "", idea: null, row: null, placeholder: "Describe another idea for this question",
        go: { label: "New idea", availability: { _tag: "Disabled" as const, reason: "Describe the idea first." } } }
    return { ...board, bar }
  })
}

/** A row's record unfolds another column, or closes; the side slot then holds nothing. */
export function rowRecordLocally(view: ChromeView, row: string | null, column?: string): ChromeView {
  if (view.workspace._tag !== "Open") return view
  const record = view.workspace.record
  if (row === null) return { ...onBoard(view, board => ({ ...board, record: { _tag: "Closed" }, rows: board.rows.map(item => ({ ...item, open: false })) })), tools: { ...view.tools, side: "closed" } }
  if (record._tag !== "Open" || record.row !== row) return view
  return { ...onBoard(view, board => ({ ...board, record: { ...record, column: column ?? record.column } })), tools: { ...view.tools, side: "record" } }
}

/** The bar's prompt, and what its main button can do with it. */
export function promptLocally(view: ChromeView, prompt: string): ChromeView {
  return onBoard(view, board => {
    if (board.bar.edit._tag === "Disabled") return board
    const why = !prompt.trim() ? (board.bar.mode === "Ask" ? "Pin a state and write the question first." : board.bar.mode === "Idea" || board.bar.mode === "Row" ? "Write what to change first."
      : board.bar.mode === "NewRow" ? "Say what the row must show and check first." : "Describe the idea first.")
      : board.bar.mode === "Ask" && board.rows.length === 0 ? "Pin a state and write the question first." : ""
    return { ...board, bar: { ...board.bar, prompt, go: { ...board.bar.go, availability: why ? { _tag: "Disabled", reason: why } : { _tag: "Enabled" } } } }
  })
}

export function askLocally(view: ChromeView, text: string): ChromeView {
  return onBoard(view, board => {
    if (board.ask._tag === "Disabled" || !text.trim()) return board
    const next = String(Math.max(0, ...board.questions.map(question => Number(question.id))) + 1)
    const questions: QuestionView[] = [...board.questions, { _tag: "Open", id: next, text: text.trim(), by: "You · today" }]
    return { ...board, questions, discard: { ...board.discard, open: board.discard.open + 1 } }
  })
}

export function answerLocally(view: ChromeView, id: string, answer: string, reason: string): ChromeView {
  return onBoard(view, board => {
    const found = board.questions.find(question => question.id === id)
    if (board.answer._tag === "Disabled" || found?._tag !== "Open" || !answer.trim() || !reason.trim()) return board
    const questions = board.questions.map(question => question.id === id ? { _tag: "Answered" as const, id, text: found.text, by: found.by, answer: answer.trim(), reason: reason.trim() } : question)
    return { ...board, questions, discard: { ...board.discard, answered: board.discard.answered + 1, open: board.discard.open - 1 } }
  })
}

/** Discard: the ideas go; the question, the rows and every question stay, and the workspace closes. */
export function discardLocally(view: ChromeView): ChromeView {
  const next = onBoard(view, board => {
    if (board.discard.availability._tag === "Disabled") return board
    const closed = { _tag: "Disabled" as const, reason: "This workspace is closed." }
    return {
      ...board, status: "Closed", statusLabel: "Closed",
      columns: board.columns.filter(column => column._tag === "Today"), cells: board.cells.filter(cell => cell.column === "today"),
      ask: closed, answer: closed, discard: { ...board.discard, availability: closed, ideas: 0, files: 0 },
      bar: { ...board.bar, mode: "Closed", prompt: "", placeholder: "This workspace is closed", edit: closed, idea: null, go: { label: "Closed", availability: closed } },
    }
  })
  if (next.workspace._tag !== "Open" || next.workspace.status !== "Closed") return next
  const parts = next.navigation.parts.map(part => ({ ...part, states: part.states.map(state => ({ ...state, pin: { _tag: "None" as const } })) }))
  const items = next.navigation.workspaces.items.map(item => item.selected ? { ...item, meta: `Closed · ${next.workspace._tag === "Open" ? next.workspace.discard.answered : 0} answers` } : item)
  return { ...next, navigation: { ...next.navigation, parts, workspaces: { ...next.navigation.workspaces, items } } }
}
