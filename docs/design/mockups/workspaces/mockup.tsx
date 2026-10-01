/**
 * Workspaces, slice 1: a high-fidelity mockup in the real Darkroom chrome.
 *
 * The rail, panels, buttons, caption and region layout are the chrome's own
 * components and stylesheets (src/client/ui). The workspace list, the pins,
 * the board, the questions panel and the workspace bar are new and live in
 * this folder. Nothing here is wired to a server.
 *
 *   ?state=new|frame|planning|running|board|answer|discard   (default: board)
 *   ?scheme=light|dark      force a scheme (default: the system's)
 *   ?side=closed            close the questions panel
 *   ?drawer=open            open the parts drawer where the parts panel cannot dock
 */
import { useLayoutEffect, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { ChromeActions, ChromeView } from "../../../../src/client/ui/contract"
import type { FrameGeometry } from "../../../../src/client/device-frame.js"
import { REM_PX, fitComposer, planLayout } from "../../../../src/client/ui/layout"
import type { ComposerFit } from "../../../../src/client/ui/layout"
import { useBox } from "../../../../src/client/ui/useBox"
import { takesView } from "../../../../src/client/ui/fixtures/views"
import { ToolNav } from "../../../../src/client/ui/tools/ToolNav"
import { Panel } from "../../../../src/client/ui/atoms/Panel"
import { Button } from "../../../../src/client/ui/atoms/Button"
import { Icon } from "../../../../src/client/ui/atoms/Icon"
import { Caption } from "../../../../src/client/ui/canvas/Caption"
import { SetupFooter } from "../../../../src/client/ui/nav/SetupFooter"
import "../../../../src/client/ui/tokens.css"
import "../../../../src/client/ui/atoms/atoms.css"
import "../../../../src/client/ui/darkroom.css"
import "../../../../src/client/ui/nav/nav.css"
import "../../../../src/client/ui/canvas/canvas.css"
import "../../../../src/client/ui/bar/bar.css"
import "../../../../src/client/ui/side/side.css"
import "./workspace.css"
import { COLUMN_HEAD, COMPACT_HEAD, FRAME_H, FRAME_W, GAP as CELL_GAP, PICKER_H, PICK_ITEM_H, ROW_HEAD, ROW_PICK_W, planBoard } from "../../../../src/client/ui/board/plan-board"
import { IDEAS, ROWS, SCENES, WORKSPACE, cellOf, sameAsToday } from "./fixture"
import type { ColumnId, IdeaId, Question, RowId, Scene, SceneName } from "./fixture"

const params = new URLSearchParams(location.search)
const sceneName = (params.get("state") ?? "board") as SceneName
const base: Scene = SCENES[sceneName] ?? SCENES.board
const scene: Scene = params.get("side") === "closed" ? { ...base, side: "Closed" } : base
const scheme = params.get("scheme") === "light" ? "light" : params.get("scheme") === "dark" ? "dark" : undefined
const NOOP = new Proxy({}, { get: () => () => undefined }) as ChromeActions
const ideaOf = (id: IdeaId) => IDEAS.find(idea => idea.id === id)!
const openQuestions = (questions: readonly Question[]) => questions.filter(question => question._tag === "Open").length

function Mockup() {
  const root = useRef<HTMLDivElement>(null)
  const box = useBox(root)
  const fixture = takesView()
  const view: ChromeView = { ...fixture, tools: { ...fixture.tools, active: "takes" } }
  const open = { nav: true, side: scene.side === "Questions", code: false, bar: true }
  const plan = planLayout(box.width / REM_PX || 100, box.height / REM_PX || 62.5, open)
  const canDock = plan.nav === "docked"
  const [drawer, setDrawer] = useState(params.get("drawer") === "open")
  const drawerOpen = drawer && !canDock
  const navShown = canDock || drawerOpen
  // On a phone the questions are a sheet. It is in front while you answer, and one tap away otherwise.
  const sideFront = plan.side !== "sheet" || scene.answering !== null
  return <div ref={root} className="dr-root ws-root" data-scheme={scheme} data-tools={plan.tools}
    data-nav={drawerOpen ? "drawer" : navShown ? "docked" : "hidden"} data-side={open.side ? plan.side : "closed"}
    data-code="closed" data-front={plan.side === "sheet" && sideFront ? "side" : "none"} data-bar="on" data-drawer={drawerOpen ? "open" : "closed"}>
    <ToolNav view={view} actions={NOOP} place={plan.tools} box={box} partsOpen={navShown} drawerOpen={drawerOpen} onParts={() => setDrawer(value => !value)} />
    <main className="dr-room">
      {drawerOpen && <div className="dr-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <div className="dr-parts-host" hidden={!navShown}>
        <WorkspaceParts view={view} drawer={drawerOpen} onClose={drawerOpen ? () => setDrawer(false) : undefined} />
      </div>
      <div className="dr-stage">
        <Board view={view} />
        <WorkspaceBar hidden={plan.side === "sheet" && sideFront && open.side} />
      </div>
      {open.side && <aside className="dr-side" data-place={plan.side} hidden={!sideFront}><Questions sheet={plan.side === "sheet"} /></aside>}
      {scene.dialog === "Discard" && <DiscardDialog />}
    </main>
  </div>
}

/* --- the parts panel, with the workspace list and the pins ------------------------------- */

type MockState = { readonly label: string; readonly row?: RowId }
type MockPart = { readonly name: string; readonly states: readonly MockState[]; readonly open?: boolean }
const PAGES: readonly MockPart[] = [
  { name: "Game Detail", states: [{ label: "Default" }, { label: "No art or history" }, { label: "Multiple locations" }, { label: "Choose location" }, { label: "Confirm removal" }] },
  { name: "Home", open: true, states: [{ label: "Default", row: "home" }] },
  { name: "Find", states: [{ label: "Default", row: "find" }, { label: "Search results" }, { label: "No results" }, { label: "Empty" }, { label: "Collection" }, { label: "Alphabetical" }, { label: "Most played" }, { label: "Recent" }] },
  { name: "Gameplay Overlay", states: [{ label: "Default" }, { label: "Confirm quit" }, { label: "Retryable problem" }, { label: "Problem" }, { label: "No plugin controls" }] },
  { name: "Runner Picker", states: Array.from({ length: 8 }, (_, index) => ({ label: `State ${index + 1}` })) },
  { name: "Settings", open: true, states: [{ label: "Default", row: "settings" }, { label: "Empty" }, { label: "Saving" }, { label: "Error" }, { label: "Confirm forget" }, { label: "Identity actions" }] },
  { name: "Settings Panel", states: [{ label: "Default" }, { label: "Busy" }, { label: "Error" }] },
]
const TEMPLATES: readonly MockPart[] = [
  { name: "Game Overlay", states: [{ label: "Default" }, { label: "Paused" }] },
  { name: "Panel Screen", states: [{ label: "Default" }, { label: "Long" }] },
  { name: "Screen Shell", states: [{ label: "Default" }] },
]

function WorkspaceParts({ view, drawer, onClose }: { readonly view: ChromeView; readonly drawer: boolean; readonly onClose?: () => void }) {
  const pinned = new Set(scene.rows)
  const ideas = scene.ideas.length
  const current = scene.rows.length === 0 && ideas === 0 ? "New workspace" : WORKSPACE.name
  const meta = ideas === 0 ? "Open · no ideas yet" : `Open · ${ideas} ideas`
  const part = (item: MockPart) => {
    const count = item.states.filter(state => state.row && pinned.has(state.row)).length
    return <li key={item.name} className="dr-part" data-open={item.open || undefined}>
      <div className="dr-part__row">
        <button type="button" className="dr-part__caret" aria-expanded={!!item.open} aria-label={`${item.open ? "Collapse" : "Expand"} ${item.name} states`}>
          <span aria-hidden="true">{item.open ? "▾" : "▸"}</span>
        </button>
        <button type="button" className="dr-part__name">
          <span className="dr-part__label">{item.name}</span>
          {count > 0 && <span className="ws-pinned" title={`${count} pinned to the board`}><Icon name="pin" />{count}</span>}
          <span className="dr-part__count">{item.states.length}</span>
        </button>
      </div>
      {item.open && <ul className="dr-states" aria-label={`${item.name} states`}>
        {item.states.map(state => {
          const on = !!state.row && pinned.has(state.row)
          return <li key={state.label} className="dr-states__group ws-pin-row">
            <button type="button" className="dr-states__item">{state.label}</button>
            <button type="button" className="ws-pin" aria-pressed={on} aria-label={`${on ? "Unpin" : "Pin"} ${item.name}, ${state.label}`}
              title={on ? "On the board. Press to unpin." : "Pin to the board"}><Icon name="pin" /></button>
          </li>
        })}
      </ul>}
    </li>
  }
  return <div className="dr-parts" data-place={drawer ? "drawer" : "docked"} role={drawer ? "dialog" : undefined} aria-label={drawer ? "Parts" : undefined}>
    <Panel label="Parts" title={view.navigation.project} sub={view.navigation.countLabel} onClose={onClose} closeLabel="Close parts">
      <div className="dr-parts__body">
        <div className="dr-parts__head">
          <input className="dr-parts__filter" type="search" placeholder="Filter parts" aria-label="Filter parts" readOnly value="" />
        </div>
        <div />
        <div className="dr-parts__tree">
          <section className="dr-layer ws-spaces" aria-label="Workspaces">
            <h3 className="dr-layer__name ws-spaces__head"><span>Workspaces</span>
              <button type="button" className="ws-spaces__new"><Icon name="plus" />New</button></h3>
            <ul className="ws-spaces__list">
              <li><button type="button" className="ws-space" aria-current="true">
                <span className="ws-space__name">{current}</span><span className="ws-space__meta">{meta}</span>
              </button></li>
              <li><button type="button" className="ws-space">
                <span className="ws-space__name">Cart art at small sizes</span><span className="ws-space__meta">Closed · 2 answers</span>
              </button></li>
            </ul>
            {scene.pinning && <p className="ws-spaces__hint">Pin a state to make it a row on the board.</p>}
          </section>
          <section className="dr-layer" aria-label="Pages">
            <h3 className="dr-layer__name">Pages</h3>
            <ul className="dr-layer__parts">{PAGES.map(part)}</ul>
          </section>
          <section className="dr-layer" aria-label="Templates">
            <h3 className="dr-layer__name">Templates</h3>
            <ul className="dr-layer__parts">{TEMPLATES.map(part)}</ul>
          </section>
        </div>
        <SetupFooter rows={view.navigation.setup} problems={view.navigation.setupProblems} />
      </div>
    </Panel>
  </div>
}

/* --- the board ----------------------------------------------------------------------- */

function Board({ view }: { readonly view: ChromeView }) {
  const body = useRef<HTMLDivElement>(null)
  const box = useBox(body)
  const columns: ColumnId[] = ["today", ...scene.ideas.map(idea => idea.id)]
  const rows = scene.rows
  // Before the first measure the box is zero; after it, a zero height is a real (tiny) board.
  const measured = box.width > 0 || box.height > 0
  const plan = planBoard(measured ? box.width : 900, measured ? box.height : 600, { columns: columns.length, rows: Math.max(1, rows.length) })
  const [pair, setPair] = useState<IdeaId>(scene.focused ?? "1")
  const [one, setOne] = useState<ColumnId>(scene.focused ?? "today")
  const [row, setRow] = useState<RowId>(rows[0] ?? "home")
  const shown: ColumnId[] = plan.columns._tag === "All" ? columns : plan.columns._tag === "Pair" ? ["today", pair] : [one]
  const picked = plan.rows._tag === "Pick"
  const shownRows = picked ? rows.filter(item => item === row) : rows
  const geometry = plan.scale < 0.995 ? { fit: { _tag: "Scaled", percent: Math.round(plan.scale * 100) } } as unknown as FrameGeometry : null
  const ideas = columns.filter((id): id is IdeaId => id !== "today")
  const label = (id: ColumnId) => id === "today" ? "Today" : `${id} · ${ideaOf(id).name}`
  const rowPicker = <Picker label="Row" vertical={plan.rows._tag === "Pick" && plan.rows.place === "Side"}
    options={rows.map(id => ({ id, label: ROWS.find(item => item.id === id)!.part }))} value={row} onPick={setRow} />
  // The board's heights are planBoard's constants, so what is drawn is what the rule counted.
  const style = {
    "--ws-cell-w": `${FRAME_W * plan.scale}px`, "--ws-cell-h": `${FRAME_H * plan.scale}px`, "--ws-cols": shown.length,
    "--ws-gap": `${CELL_GAP}px`, "--ws-head": `${picked ? COMPACT_HEAD : COLUMN_HEAD}px`, "--ws-picker-h": `${PICKER_H}px`,
    "--ws-row-head": `${ROW_HEAD}px`, "--ws-row-pick-w": `${ROW_PICK_W}px`, "--ws-pick-item-h": `${PICK_ITEM_H}px`,
  } as CSSProperties
  const open = openQuestions(scene.questions)
  return <section className="dr-canvas ws-board" aria-label="Workspace board" data-columns={plan.columns._tag}
    data-rows={plan.rows._tag === "Pick" ? `Pick${plan.rows.place}` : "Stack"} style={style}>
    <header className="ws-board__head">
      <div className="ws-board__title">
        <h1>{scene.title}</h1>
        <span className="ws-board__status">{rows.length === 0 && scene.ideas.length === 0 ? "No question yet" : "Open"}</span>
        {scene.bar._tag !== "Ask" && <span className="ws-board__question">“{WORKSPACE.short}”</span>}
      </div>
      {scene.questions.length > 0 && <Button small tone="quiet" pressed={scene.side === "Questions"} onClick={() => undefined}>
        Questions{open > 0 && <span className="ws-count">{open} open</span>}
      </Button>}
    </header>
    <div ref={body} className="ws-board__body">
      {rows.length === 0
        ? <div className="ws-empty">
          <p className="ws-empty__lead">Pin the states this question is about.</p>
          <p>Press the pin beside a state in the parts list. Each pinned state becomes a row. The real files fill the first column, and every idea renders every row.</p>
        </div>
        : <div className="ws-grid">
          <div className="ws-top">
            {plan.columns._tag !== "All" && <div className="ws-colpick">
              {plan.columns._tag === "Pair" && <span className="ws-colpick__today">Compare with</span>}
              {plan.columns._tag === "Pair"
                ? <Picker label="Idea" options={ideas.map(idea => ({ id: idea, label: idea, title: label(idea) }))} value={pair} onPick={setPair} />
                : <Picker label="Column" options={columns.map(column => ({ id: column, label: column === "today" ? "Today" : column, title: label(column) }))} value={one} onPick={setOne} />}
            </div>}
            <div className="ws-heads" role="row">{shown.map(id => <div key={id} className="ws-head" role="columnheader" data-focus={id === scene.focused || undefined}><ColumnName id={id} /></div>)}</div>
          </div>
          {picked && <div className="ws-rowpick">{rowPicker}</div>}
          <div className="ws-rows">{shownRows.map(id => <BoardRow key={id} row={id} shown={shown} picked={picked} />)}</div>
        </div>}
    </div>
    <Caption view={view} actions={NOOP} geometry={geometry} />
  </section>
}

function ColumnName({ id }: { readonly id: ColumnId }) {
  if (id === "today") return <div className="ws-head__name"><b>Today</b><span className="ws-head__meta">Real files</span></div>
  const run = scene.ideas.find(idea => idea.id === id)?.run ?? "Ready"
  const idea = ideaOf(id)
  if (run === "Planning") return <div className="ws-head__name"><b>{id}</b><span className="dr-slot__pending ws-head__pending" aria-label="Being planned" /></div>
  return <div className="ws-head__name">
    <button type="button" className="ws-head__idea" aria-current={id === scene.focused || undefined} title={idea.brief}>
      {run === "Running" && <i className="dr-dot dr-dot--running ws-head__run" aria-label="Working" />}<b>{id}</b><span>{idea.name}</span>
    </button>
    <span className="ws-head__meta">
      {run === "Running" ? "Working" : `${idea.files.length} files`}
      {idea.strange && <span className="ws-strange">strange</span>}
    </span>
  </div>
}

function BoardRow({ row, shown, picked }: { readonly row: RowId; readonly shown: readonly ColumnId[]; readonly picked: boolean }) {
  const info = ROWS.find(item => item.id === row)!
  return <section className="ws-row" aria-label={`${info.part}, ${info.state}`}>
    {!picked && <h2 className="ws-row__head" title={info.file}><b>{info.part}</b><span>{info.state}</span></h2>}
    <div className="ws-row__cells">{shown.map(column => <Cell key={column} column={column} row={row} picked={picked} />)}</div>
  </section>
}

function Cell({ column, row, picked }: { readonly column: ColumnId; readonly row: RowId; readonly picked: boolean }) {
  const run = column === "today" ? "Ready" : scene.ideas.find(idea => idea.id === column)?.run ?? "Ready"
  const same = run === "Ready" && sameAsToday(column, row)
  const focus = column === scene.focused
  return <figure className="ws-cell" data-same={same || undefined} data-focus={focus || undefined} data-run={run}>
    <div className="ws-cell__screen">
      {run === "Ready"
        ? <img src={cellOf(column, row)} alt={`${ROWS.find(item => item.id === row)!.part} in ${column === "today" ? "the real files" : `idea ${column}`}`} />
        : <div className="dr-working" aria-hidden="true" />}
    </div>
    {same && <figcaption className="ws-cell__note">Same as Today</figcaption>}
    {picked && <span className="dr-sr">{column === "today" ? "Today" : `Idea ${column}`}</span>}
  </figure>
}

function Picker<T extends string>({ label, options, value, onPick, vertical = false }: {
  readonly label: string; readonly options: readonly { readonly id: T; readonly label: string; readonly title?: string }[]
  readonly value: T; readonly onPick: (id: T) => void; readonly vertical?: boolean
}) {
  return <div className="ws-picker" data-vertical={vertical || undefined} role="group" aria-label={label}>
    {options.map(option => <button key={option.id} type="button" className="ws-picker__item" aria-pressed={option.id === value}
      title={option.title ?? option.label} onClick={() => onPick(option.id)}>{option.label}</button>)}
  </div>
}

/* --- the questions panel ------------------------------------------------------------- */

function Questions({ sheet }: { readonly sheet: boolean }) {
  const open = scene.questions.filter(question => question._tag === "Open")
  const answered = scene.questions.filter(question => question._tag === "Answered")
  return <Panel label="Questions" title="Questions" sub={`${answered.length} answered · ${open.length} open`} onClose={() => undefined} closeLabel="Close questions" className={sheet ? "ws-q--sheet" : undefined}>
    <div className="dr-record__body ws-q">
      <section className="ws-q__ask" aria-label="The question">
        <p className="ws-q__text">{WORKSPACE.question}</p>
        <p className="ws-q__meta">You asked this on 1 Oct. Three ideas answer it.</p>
      </section>
      <section aria-label="Open questions">
        <h3 className="ws-q__head">Open</h3>
        <ul className="ws-q__list">{open.map(question => <OpenQuestion key={question.id} question={question} />)}</ul>
      </section>
      <section aria-label="Answered questions">
        <h3 className="ws-q__head">Answered</h3>
        <ul className="ws-q__list">{answered.map(question => question._tag === "Answered" && <li key={question.id} className="ws-q__item" data-answered="">
          <p className="ws-q__asked">{question.text}</p>
          <p className="ws-q__answer">{question.answer}</p>
          <p className="ws-q__reason"><span>Because</span> {question.reason}</p>
          <p className="ws-q__by">{question.by} · 1 Oct</p>
        </li>)}</ul>
      </section>
      <label className="ws-q__add"><span className="dr-sr">Add a question</span><input type="text" placeholder="Add a question" readOnly value="" /></label>
      <footer className="ws-q__foot">
        <Button tone="danger" small onClick={() => undefined}>Discard ideas</Button>
        <span>The questions and answers stay.</span>
      </footer>
    </div>
  </Panel>
}

function OpenQuestion({ question }: { readonly question: Question }) {
  const answering = scene.answering === question.id
  const item = useRef<HTMLLIElement>(null)
  // The question you answer is in view, as focus would bring it. Only its own scroller moves.
  useLayoutEffect(() => {
    const node = item.current
    if (!answering || !node) return
    let scroller = node.parentElement
    while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement
    if (scroller) scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8
  }, [answering])
  return <li ref={item} className="ws-q__item" data-answering={answering || undefined}>
    <p className="ws-q__asked">{question.text}</p>
    <p className="ws-q__by">{question.by}</p>
    {answering
      ? <div className="ws-answer">
        <label className="ws-answer__field">Answer<textarea rows={2} readOnly value="Yes, on Home only. The bar names MENU for the layout and OPTIONS for Find." /></label>
        <label className="ws-answer__field">Reason<textarea rows={3} readOnly value="A hint names a button that already works. Home is the one screen where both buttons do something, so the other screens keep A and B." /></label>
        <div className="ws-answer__actions"><Button tone="primary" small onClick={() => undefined}>Save answer</Button><Button small onClick={() => undefined}>Cancel</Button></div>
      </div>
      : <div className="ws-q__actions"><Button small onClick={() => undefined}>Answer</Button></div>}
  </li>
}

/* --- the bar ------------------------------------------------------------------------- */

const FIELD_W = 300
const GAP = 10

function WorkspaceBar({ hidden }: { readonly hidden: boolean }) {
  const form = useRef<HTMLFormElement>(null)
  const lead = useRef<HTMLDivElement>(null)
  const go = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<ComposerFit>("Inline")
  useLayoutEffect(() => {
    const node = form.current
    if (!node) return
    const measure = () => {
      const style = getComputedStyle(node)
      const width = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      setFit(fitComposer(width, { field: FIELD_W, gap: GAP, take: lead.current?.offsetWidth ?? 0, go: go.current?.offsetWidth ?? 0 }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const bar = scene.bar
  const placeholder = bar._tag === "Ask" ? "Ask the question this workspace answers"
    : bar._tag === "Idea" ? `Tell idea ${bar.idea} what to change` : "Describe another idea for this question"
  const prompt = bar._tag === "Ask" ? bar.prompt : bar._tag === "Planning" ? WORKSPACE.question : ""
  const split = (label: string, enabled: boolean, why?: string): ReactNode => <span className="dr-split">
    <button type="button" className="dr-btn dr-btn--primary dr-split__main" disabled={!enabled} title={why}>{label}</button>
    <button type="button" className="dr-btn dr-btn--primary dr-split__more" aria-label="More ways to start"><Icon name="chevron-down" /></button>
  </span>
  return <form ref={form} className="dr-bar" data-fit={fit} data-plan={bar._tag === "Planning" ? "Planning" : "None"} hidden={hidden} aria-label="Workspace composer"
    onSubmit={event => event.preventDefault()}>
    <div className="dr-bar__layout">
      {bar._tag === "Idea" && <div ref={lead} className="dr-bar__take">
        <div className="dr-take-actions" role="group" aria-label={`Idea ${bar.idea}`}>
          <span className="dr-take-actions__name"><b>Idea {bar.idea}</b></span>
          <Button onClick={() => undefined}>Discard</Button>
        </div>
      </div>}
      <div className="dr-well" data-disabled={bar._tag === "Planning" || undefined}>
        <textarea className="dr-well__text" aria-label="Prompt" rows={1} placeholder={placeholder} value={prompt} readOnly />
        {bar._tag !== "Planning" && <button type="button" className="dr-well__clip" aria-label="Add image" title="Add an image"><Icon name="clip" /></button>}
        <div ref={go} className="dr-well__go">
          {bar._tag === "Ask" && split("Plan 3 ideas", bar.ready, bar.ready ? "Ctrl+Enter" : "Pin a state and write the question first")}
          {bar._tag === "Planning" && <>
            <span className="dr-bar__planning" role="status"><i className="dr-dot dr-dot--running" aria-hidden="true" />Planning 3 ideas…</span>
            <Button onClick={() => undefined}>Cancel</Button>
          </>}
          {bar._tag === "More" && split("New idea", false, "Write a direction first")}
          {bar._tag === "Idea" && split(`Send to idea ${bar.idea}`, false, "Write what to change first")}
        </div>
      </div>
    </div>
  </form>
}

/* --- the discard dialog ---------------------------------------------------------------- */

function DiscardDialog() {
  const files = IDEAS.reduce((sum, idea) => sum + idea.files.length, 0)
  const open = openQuestions(scene.questions)
  return <>
    <div className="dr-scrim ws-dialog__scrim" aria-hidden="true" />
    <section className="ws-dialog" role="dialog" aria-modal="true" aria-labelledby="ws-discard-title">
      <h2 id="ws-discard-title">Discard the ideas in this workspace?</h2>
      <p>Caliper deletes {IDEAS.length} ideas and the {files} files they edited. Your project's files do not change.</p>
      <p>The question, 1 answer and {open} open questions stay. The workspace moves to Closed.</p>
      <div className="ws-dialog__actions">
        <Button onClick={() => undefined}>Cancel</Button>
        <Button tone="danger" onClick={() => undefined}>Discard {IDEAS.length} ideas</Button>
      </div>
    </section>
  </>
}

const host = document.getElementById("root")
if (!host) throw new Error("Missing mockup host")
createRoot(host).render(<Mockup />)
