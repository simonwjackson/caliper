import { useCallback, useEffect, useRef } from "react"
import type { ReactNode } from "react"
import type {
  ChainView, Availability, ChromeActions, ChromeProps, ChromeView, FrameView, IntegrationView, KnobView, Notice, MarkPoint,
} from "./contract"
import { CAL } from "./hooks"
import type { CalHook } from "./hooks"
import { CARD, frameGeometry } from "../device-frame.js"
import { clampTo, formatNumber, parseNumber } from "../knob-values.js"

/** Unstyled executable contract. The plugin serves Darkroom, not this reference renderer. */
export default function Chrome({ view, actions }: ChromeProps) {
  return <div data-cal={CAL.root}>
    <p data-cal={CAL.connection} role="status">{view.connection._tag === "Unreachable" ? view.connection.reason : view.connection._tag}</p>
    <header>
      <button data-cal={CAL.navToggle} type="button" aria-expanded={view.tools.navOpen} onClick={() => actions.onNavOpen(!view.tools.navOpen)}>Parts</button>
      {(["preview", "takes", "knobs", "code", "checks", "calibrate"] as const).map(tool =>
        <button key={tool} data-cal={CAL.tool} data-tool={tool} type="button" aria-pressed={view.tools.active === tool} onClick={() => actions.onTool(tool)}>{tool}</button>)}
    </header>
    <Navigation view={view} actions={actions} />
    <main data-cal={CAL.canvas}>
      {view.canvas._tag === "Empty" ? <p>{view.canvas.message}</p> : <>
        <h1>{view.canvas.title}</h1>
        {view.canvas.frames.filter(frame => !view.canvas._tag || !chained(view, frame.key)).map(frame => <DeviceFrame key={frame.key} frame={frame} view={view} actions={actions} />)}
        {view.canvas.chains.map(chain => <Chain key={chain.id} chain={chain} view={view} actions={actions} />)}
      </>}
      <Plan view={view} actions={actions} />
      <p data-cal={CAL.caption}>
        {view.device.widthMm} mm wide. {view.device.cssWidth} × {view.device.cssHeight} CSS px. {view.device.viewportNote}
        {!view.calibrated && " True size requires calibration."}
      </p>
      <div role="group" aria-label="Device">{view.devices.map(device =>
        <button key={device.id} data-cal={CAL.device} data-device={device.id} type="button" aria-pressed={device.id === view.device.id} onClick={() => actions.onDevice(device.id)}>{device.name}</button>)}</div>
    </main>
    <MarkupReference view={view} actions={actions} />
    <Composer view={view} actions={actions} />
    {view.focusedTake && <TakeActions take={view.focusedTake} actions={actions} />}
    <Record view={view} actions={actions} />
    <Code view={view} actions={actions} />
    <Knobs view={view} actions={actions} />
    <Checks view={view} actions={actions} />
    <Calibration view={view} actions={actions} />
  </div>
}

function disabled(value: Availability) { return value._tag === "Disabled" }
function reason(value: Availability) { return value._tag === "Disabled" ? value.reason : undefined }
function Action({ hook, availability, action, children, take }: {
  hook: CalHook; availability: Availability; action: () => void; children: ReactNode; take?: string
}) {
  return <button type="button" data-cal={hook} data-take={take} disabled={disabled(availability)} title={reason(availability)} onClick={action}>{children}</button>
}
function Notices({ notices }: { notices: readonly Notice[] }) {
  return <>{notices.map((notice, index) => <p key={index} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>)}</>
}
function Source({ source, actions }: { source: { readonly file: string; readonly line: number }; actions: ChromeActions }) {
  return <button type="button" data-cal={CAL.sourceFile} data-file={source.file} onClick={() => actions.onOpenFile(source.file)}>{source.file}:{source.line}</button>
}
function Navigation({ view, actions }: ChromeProps) {
  const nav = view.navigation
  return <aside data-cal={CAL.nav} aria-label="Parts">
    <h2>{nav.project}</h2><p>{nav.countLabel}</p>
    {nav.projects._tag === "Choices" && <select data-cal={CAL.project} aria-label="Project" value={nav.projects.choices.find(choice => choice.current)?.id ?? ""} onChange={event => actions.onProject(event.currentTarget.value)}>
      {nav.projects.choices.map(choice => <option key={choice.id} value={choice.id} disabled={choice.problem !== ""}>{choice.problem ? `${choice.name}: ${choice.problem}` : choice.name}</option>)}
    </select>}
    <input data-cal={CAL.filter} type="search" aria-label="Filter parts" value={nav.filter} onChange={event => actions.onFilter(event.currentTarget.value)} />
    {nav.scenario._tag === "Selected" && <section aria-label="Scenario context">
      <p>{nav.scenario.editingLabel}</p>
      <select data-cal={CAL.context} aria-label="Preview scenario" value={nav.scenario.chosen} onChange={event => actions.onContext(event.currentTarget.value)}>
        {nav.scenario.choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
      </select><p role="status">{nav.scenario.note}</p>
      {nav.scenario.whole && <button type="button" data-cal={CAL.whole} onClick={actions.onWholeScenario}>Edit whole scenario: {nav.scenario.whole.label}</button>}
      {nav.scenario.children.map(child => <button key={`${child.ref.part}#${child.ref.state}`} type="button" data-cal={CAL.subject} data-part={child.ref.part} data-state={child.ref.state} aria-current={child.selected} onClick={() => actions.onSubject(child.ref)}>{child.label}</button>)}
    </section>}
    <p>{nav.emptyMessage}</p>
    {nav.parts.map(part => <section key={part.file} data-part={part.file}>
      <button type="button" data-cal={CAL.partExpand} data-part={part.file} aria-expanded={part.expanded} onClick={() => actions.onPartExpanded(part.file, !part.expanded)}>{part.expanded ? "Collapse" : "Expand"} states</button>
      <button type="button" data-cal={CAL.part} data-part={part.file} aria-current={part.selected} title={`${part.file}\n${part.note}\n${part.layerSite}`} onClick={() => actions.onPart(part.file)}>{part.name}</button>
      {part.expanded && part.states.map(state => <div key={state.ref.state}>
        <button type="button" data-cal={CAL.state} data-part={state.ref.part} data-state={state.ref.state} aria-current={state.selected} title={state.site} onClick={() => actions.onState(state.ref)}>{state.label} {state.badge?.label}</button>
        {state.takes.length > 0 && <button type="button" data-cal={CAL.compare} data-part={state.ref.part} data-state={state.ref.state} aria-current={state.comparing} onClick={() => actions.onCompare(state.ref)}>Compare {state.takes.length} takes</button>}
        {state.takes.map(take => <button key={take.id} type="button" data-cal={CAL.navTake} data-take={take.id} aria-current={take.selected} title={take.badge?.detail} onClick={() => actions.onTake(take.id)}>{take.label} {take.badge?.label}</button>)}
      </div>)}
    </section>)}
    {nav.unavailable.length > 0 && <section data-cal={CAL.unavailable} aria-label="Unavailable states"><h3>Unavailable states</h3>
      {nav.unavailable.map(group => <div key={`${group.subject.part}#${group.subject.state}`}><p>{group.label}</p>{group.takes.map(take =>
        <button key={take.id} type="button" data-cal={CAL.navTake} data-take={take.id} onClick={() => actions.onTake(take.id)}>{take.label}</button>)}</div>)}
    </section>}
    <details data-cal={CAL.setup}><summary>Setup</summary>
      <Notices notices={nav.setupProblems.map(text => ({ kind: "error", text }))} />
      {nav.setup.map(row => <section key={row.label}><h3>{row.label} · {row.status}</h3>{row.values.map((value, index) => <pre key={index}>{value}</pre>)}<p>{row.provenance}</p><Notices notices={row.problems.map(text => ({ kind: "warning", text }))} /></section>)}
    </details>
  </aside>
}

function DeviceFrame({ frame, view, actions }: { frame: FrameView; view: ChromeView; actions: ChromeActions }) {
  const screen = useRef<HTMLDivElement>(null)
  const mount = useCallback((node: HTMLIFrameElement | null) => actions.onFrameMount(frame.key, node), [actions.onFrameMount, frame.key])
  useEffect(() => {
    const box = screen.current
    if (!box) return
    const resize = () => {
      // Dynamic physical geometry, not a design token. The reference uses the containing block's width.
      const geometry = frameGeometry(view.device, view.pxPerMm, { width: box.parentElement?.clientWidth ?? 0, height: Number.MAX_SAFE_INTEGER })
      box.style.width = `${geometry.width}px`; box.style.height = `${geometry.height}px`
      const iframe = box.querySelector("iframe")
      if (iframe) { iframe.style.transform = `scale(${geometry.scale})`; iframe.style.transformOrigin = "top left" }
      const caption = box.parentElement?.querySelector("[data-fit]")
      if (caption) caption.textContent = geometry.fit._tag === "Scaled" ? `Scaled to ${geometry.fit.percent}%` : view.calibrated ? "True size" : "True size only after calibration"
      actions.onFrameGeometry(frame.key, geometry)
    }
    const observer = new ResizeObserver(resize)
    if (box.parentElement) observer.observe(box.parentElement)
    resize()
    return () => observer.disconnect()
  }, [actions.onFrameGeometry, frame.key, view.device, view.pxPerMm, view.calibrated])
  const marking = view.markup._tag === "Ready" && view.markup.mode._tag !== "Off" && frame.markable._tag === "Enabled"
  return <figure data-frame-key={frame.key}>
    <figcaption><button type="button" data-cal={CAL.frameSelect} data-frame-key={frame.key} data-take={frame.take ?? undefined} aria-current={frame.selected} title={frame.title} onClick={() => frame.take ? actions.onTake(frame.take) : actions.onState(frame.subject)}>{frame.label}</button>
      {frame.run?._tag} · {frame.verdict._tag}<span data-fit="" /></figcaption>
    <div ref={screen} style={{ position: "relative" }}><iframe ref={mount} data-cal={CAL.frame} data-frame-key={frame.key} data-part={frame.preview.part} data-state={frame.preview.state} data-take={frame.take ?? undefined} title={frame.label} src={frame.src} width={view.device.cssWidth} height={view.device.cssHeight} />
      {marking && <MarkSurface frame={frame} width={view.device.cssWidth} height={view.device.cssHeight} actions={actions} />}
    </div>
    {marking && <MarkCoordinates frame={frame} width={view.device.cssWidth} height={view.device.cssHeight} actions={actions} />}
    {frame.marks.map(mark => <button key={mark.id} type="button" data-cal={CAL.markPin} data-mark-id={mark.id} data-frame-key={frame.key} onClick={() => actions.onMarkEdit(mark.id)}>{mark.letter} · {mark.location._tag}</button>)}
    {frame.problems.map((problem, index) => <div key={index} data-cal={CAL.frameProblem} role={problem.kind === "error" ? "alert" : "status"}><strong>{problem.title}</strong><pre>{problem.detail}</pre></div>)}
  </figure>
}
function Plan({ view, actions }: ChromeProps) {
  const plan = view.plan
  if (plan._tag === "None") return null
  return <section data-cal={CAL.plan} aria-label="Take plan">
    <p role="status">{plan.message}</p>
    <button type="button" data-cal={CAL.planCancel} onClick={actions.onPlanCancel}>Cancel</button>
  </section>
}
function Composer({ view, actions }: ChromeProps) {
  const composer = view.composer
  const picker = useRef<HTMLInputElement>(null)
  return <form data-cal={CAL.composer} onSubmit={event => { event.preventDefault(); if (!disabled(composer.start) && view.plan._tag === "None") actions.onStart() }}
    onDragOver={event => { if (!disabled(composer.attach) && event.dataTransfer.types.includes("Files")) event.preventDefault() }}
    onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); if (!disabled(composer.attach)) actions.onAttach([...event.dataTransfer.files]) } }}>
    <textarea data-cal={CAL.prompt} aria-label="Prompt" placeholder={composer.placeholder} disabled={disabled(composer.edit)} value={composer.prompt} onChange={event => actions.onPrompt(event.currentTarget.value)}
      onPaste={event => { if (event.clipboardData.files.length && !disabled(composer.attach)) { event.preventDefault(); actions.onAttach([...event.clipboardData.files]) } }}
      onKeyDown={event => {
        if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return
        event.preventDefault()
        if (event.shiftKey) { if (composer.follow && !disabled(composer.follow.availability)) actions.onFollow(composer.follow.take) }
        else if (view.plan._tag === "None" && !disabled(composer.start)) actions.onStart()
      }} />
    {composer.marks._tag === "WithPrompt" && <p data-cal={CAL.promptMarks}>{composer.marks.label}</p>}
    <ul data-cal={CAL.attachments}>{composer.attachments.map(image => <li key={image.id}><img src={image.url} alt={image.name} /><Action hook={CAL.attachmentRemove} availability={image.remove} action={() => actions.onRemoveAttachment(image.id)}>Remove {image.name}</Action></li>)}</ul>
    <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event => { actions.onAttach([...event.currentTarget.files ?? []]); event.currentTarget.value = "" }} />
    <Action hook={CAL.attach} availability={composer.attach} action={() => picker.current?.click()}>Add image</Action>
    {view.plan._tag === "None" && <details><summary>New take options</summary>
      <select data-cal={CAL.count} aria-label="How many takes to start" value={composer.count} onChange={event => { const count = Number(event.currentTarget.value); if (count === 1 || count === 2 || count === 3 || count === 4) actions.onCount(count) }}>{[1, 2, 3, 4].map(count => <option key={count}>{count}</option>)}</select>
      {composer.follow && <Action hook={CAL.follow} take={composer.follow.take} availability={composer.follow.availability} action={() => composer.follow && actions.onFollow(composer.follow.take)}>{composer.follow.label}</Action>}
      <div data-cal={CAL.agent}>
        {composer.agent._tag === "Ready" ? <p title={`${composer.agent.baseUrl} (${composer.agent.api}) from ${composer.agent.baseUrlFrom}. Key from ${composer.agent.keyFrom}.`}>{composer.agent.model} · reasoning {composer.agent.reasoning}</p>
          : composer.agent._tag === "Connecting" ? <p>Connecting…</p> : composer.agent._tag === "Off" ? <p>{composer.agent.hint}</p> : null}
      </div>
      <details data-cal={CAL.skills}><summary>{composer.skills.skills.length} skills</summary><Notices notices={composer.skills.problems.map(text => ({ kind: "warning", text }))} />
        {composer.skills.skills.map(skill => <p key={skill.name} title={skill.description}>{skill.name} · {skill.scope} · {skill.location}</p>)}
      </details>
    </details>}
    {composer.agent._tag === "Failed" && <p data-cal={CAL.agent} role="alert">{composer.agent.reason} {composer.agent.hint}</p>}
    {view.plan._tag === "None" && <Action hook={CAL.start} availability={composer.start} action={actions.onStart}>{composer.startLabel}</Action>}
    <Notices notices={composer.notices} />
  </form>
}
const chained = (view: ChromeView, key: string) => view.canvas._tag === "Frames" && view.canvas.chains.some(chain => chain.shown === key || chain.parent === key)
/** Phase 5 reference: one chain as its heading, history and pair. Not the production layout. */
function Chain({ chain, view, actions }: { chain: ChainView } & ChromeProps) {
  const frames = view.canvas._tag === "Frames" ? view.canvas.frames : []
  const pair = [chain.parent, chain.shown].flatMap(key => frames.filter(frame => frame.key === key))
  return <section data-cal={CAL.chain} data-chain={chain.id} aria-label={`Chain of take ${chain.take}`}>
    <h2>{chain.label}</h2>
    {chain.flag._tag === "Before" && <p data-cal={CAL.chainFlag} title={chain.flag.detail}>{chain.flag.label}</p>}
    {chain.history._tag !== "None" && <button type="button" data-cal={CAL.chainHistory} data-chain={chain.id} aria-expanded={chain.history._tag === "Open"}
      onClick={() => actions.onChainHistory(chain.id, chain.history._tag !== "Open")}>{chain.history.label}</button>}
    {chain.history._tag === "Open" && <ol>{chain.history.steps.map(step => <li key={`${step.take}-${step._tag}`}>{step._tag === "Present"
      ? <button type="button" data-cal={CAL.chainStep} data-take={step.take} aria-current={step.selected} onClick={() => actions.onTake(step.take)}>{step.label}</button>
      : <span data-cal={CAL.chainStep} data-take={step.take} aria-disabled="true">{step.label}</span>}</li>)}</ol>}
    {chain.parent && <button type="button" data-cal={CAL.chainSolo} data-chain={chain.id} data-solo={chain.solo}
      onClick={() => actions.onChainSolo(chain.id, chain.solo === "Shown" ? "Parent" : "Shown")}>{chain.solo === "Shown" ? "Show the parent when the pair does not fit" : "Show the newest take when the pair does not fit"}</button>}
    {pair.map(frame => <DeviceFrame key={frame.key} frame={frame} view={view} actions={actions} />)}
  </section>
}
function TakeActions({ take, actions }: { take: NonNullable<ChromeView["focusedTake"]>; actions: ChromeActions }) {
  return <div data-take={take.id}>
    {take.kind === "Experiment" && <Action hook={CAL.accept} take={take.id} availability={take.accept} action={() => actions.onAccept(take.id)}>Accept</Action>}
    <Action hook={CAL.discard} take={take.id} availability={take.discard} action={() => actions.onDiscard(take.id)}>Discard</Action>
  </div>
}
function Record({ view, actions }: ChromeProps) {
  if (view.record._tag === "Closed") return null
  const { take, log, integration, emptyLogMessage } = view.record
  return <section data-cal={CAL.record} data-take={take.id} aria-label="Take record">
    <h2>{take.name} · Take {take.id}</h2><p>{take.subjectLabel} · {take.deviceLabel}</p><p>{take.createdLabel}</p>
    {take.lineage && <p>{take.lineage}</p>}{take.flag._tag === "Before" && <p title={take.flag.detail}>{take.flag.label}</p>}
    <button type="button" data-cal={CAL.recordClose} onClick={actions.onRecordClose}>Close record</button>
    {take.run._tag === "Running" && <Action hook={CAL.stop} take={take.id} availability={take.stop} action={() => actions.onStop(take.id)}>Stop</Action>}
    {take.run._tag === "Failed" && <p role="alert">{take.run.reason}</p>}
    <p role="status">{take.unavailableReason}</p><p>{take.nameIssue}</p>
    {take.direction && <section><h3>{take.direction.title}</h3><p>{take.direction.brief}</p>{take.direction.strange && <p>Strange direction</p>}</section>}
    <ul>{take.files.map(file => <li key={file}><button type="button" data-cal={CAL.file} data-file={file} onClick={() => actions.onOpenFile(file)}>{file}</button></li>)}</ul>
    <div data-cal={CAL.log} aria-live="polite">{log.length === 0 && <p>{emptyLogMessage}</p>}{log.map((entry, index) => <div key={index}>
      {entry._tag === "User" ? <><p>{entry.text}</p>{entry.images.map(image => <a key={image.url} href={image.url} target="_blank" rel="noopener"><img src={image.url} alt={image.name} /></a>)}</>
        : entry._tag === "Assistant" ? <p>{entry.text}</p> : entry._tag === "Edit" ? <p>You edited {entry.file}</p> : <p title={entry.detail}>{entry.name} {entry.subject} · {entry.outcome} {entry.detail}</p>}
    </div>)}</div>
    {take.kind === "Experiment" && <Action hook={CAL.alternate} take={take.id} availability={take.prepareAlternate} action={() => actions.onPrepareAlternate(take.id)}>Add an alternate</Action>}
    <Integration take={take.id} view={integration} actions={actions} />
  </section>
}
function ReviewDiff({ take, revision, file, actions }: { take: string; revision: string; file: string; actions: ChromeActions }) {
  const mount = useCallback((host: HTMLDivElement | null) => actions.onReviewDiffMount(take, revision, file, host), [actions.onReviewDiffMount, take, revision, file])
  return <div data-cal={CAL.reviewDiff} data-file={file} ref={mount} />
}
function Integration({ take, view, actions }: { take: string; view: IntegrationView; actions: ChromeActions }) {
  if (view._tag === "None") return null
  return <section data-cal={CAL.integration} data-take={take} aria-label="Alternate integration review">
    <p>Source experiment {view.sourceTake} stays separate.</p>
    {view._tag === "Preparing" ? <p>{view.message}</p> : <>
      <Action hook={CAL.review} take={take} availability={view._tag === "Review" ? view.refresh : view.load} action={() => actions.onReview(take)}>Review changes</Action>
      <Notices notices={view.notices} />
      {view._tag === "Review" && <>
        <h3>{view.review.proposal.strategy}</h3><p>{view.review.proposal.summary}</p><p>{view.review.proposal.shared}</p><p>{view.review.proposal.preserved}</p><pre>{view.review.proposal.usage}</pre><p>Preview: {view.review.proposal.preview.part} · {view.review.proposal.preview.state}</p>
        {view.review.files.map(file => <details key={`${view.review.revision}:${file.path}`} open><summary>{file.path}</summary>
          <button type="button" data-cal={CAL.file} data-file={file.path} onClick={() => actions.onOpenFile(file.path)}>Open in Code</button>
          <ReviewDiff take={take} revision={view.review.revision} file={file.path} actions={actions} />
        </details>)}
        <p role="status">{view.review.checks._tag === "Passed" ? view.review.checks.summary : view.review.checks._tag === "Failed" ? view.review.checks.reason : "Render checks have not passed for this revision."}</p>
        <Action hook={CAL.integrationCheck} take={take} availability={view.check} action={() => actions.onIntegrationCheck(take, view.review.revision)}>Check original and alternate</Action>
        <label><input type="checkbox" data-cal={CAL.behaviorReviewed} data-take={take} checked={view.behaviorReviewed} disabled={view.review.checks._tag !== "Passed" || disabled(view.check)} onChange={event => actions.onBehaviorReviewed(take, view.review.revision, event.currentTarget.checked)} />I verified product types, interactions, and callers. Screenshots alone do not prove these.</label>
        <Action hook={CAL.applyAlternate} take={take} availability={view.apply} action={() => actions.onApplyAlternate(take, view.review.revision)}>Apply reviewed alternate</Action>
      </>}
    </>}
  </section>
}
function Code({ view, actions }: ChromeProps) {
  const code = view.code
  if (code._tag === "Closed") return null
  return <section data-cal={CAL.code} aria-label="Code">
    {code._tag === "Failed" ? <><p role="alert">{code.reason}</p><Action hook={CAL.codeRetry} availability={code.retry} action={actions.onCodeRetry}>Retry editor</Action></>
      : code._tag !== "Ready" ? <p>{code.message}</p> : <>
        <nav aria-label="Open files">{code.files.filter(file => code.tabs.includes(file.file)).map(file => <button key={file.file} type="button" data-cal={CAL.file} data-file={file.file} aria-current={file.file === code.selectedFile} onClick={() => actions.onOpenFile(file.file)}>{file.label} {file.changed && `+${file.added ?? 0} −${file.removed ?? 0}`}</button>)}</nav>
        <details data-cal={CAL.fileMenu}><summary>Files · {code.files.length}</summary>
          <input type="search" data-cal={CAL.fileFilter} aria-label="Filter files" value={code.filter} onChange={event => actions.onFileFilter(event.currentTarget.value)} />
          {code.files.filter(file => file.file.toLowerCase().includes(code.filter.toLowerCase())).map(file => <button key={file.file} type="button" data-cal={CAL.file} data-file={file.file} title={file.depth === null ? "Changed, not imported by this part" : `Import depth ${file.depth}`} onClick={() => actions.onOpenFile(file.file)}>{file.file}</button>)}
        </details>
        <p>{code.selectedFile} · {code.mode._tag}</p><p role="status">{code.notice}</p>
        <p data-cal={CAL.codeStatus} role="status">{code.save._tag === "Failed" ? code.save.reason : code.save._tag === "Saved" ? code.save.label : code.save._tag}</p>
        {code.mode._tag === "Watching" && code.take && <Action hook={CAL.stop} take={code.take} availability={code.stop} action={() => code.take && actions.onStop(code.take)}>Stop</Action>}
        {code.changes > 0 && <><button type="button" data-cal={CAL.previousChange} onClick={actions.onPreviousChange}>Previous change</button><span>{code.changes} changes</span><button type="button" data-cal={CAL.nextChange} onClick={actions.onNextChange}>Next change</button></>}
        <div data-cal={CAL.editor} data-document-key={code.documentKey} ref={actions.onEditorMount} />
        <button type="button" data-cal={CAL.codeSave} disabled={code.mode._tag === "Watching"} onClick={actions.onCodeSave}>Save</button>
        <label>Code share<input type="range" data-cal={CAL.codeShare} min="0.2" max="0.8" step="0.05" value={view.tools.codeShare} onInput={event => actions.onCodeShare(Number(event.currentTarget.value), false)} onPointerUp={event => actions.onCodeShare(Number(event.currentTarget.value), true)} onKeyUp={event => actions.onCodeShare(Number(event.currentTarget.value), true)} onDoubleClick={() => actions.onCodeShare(0.45, true)} /></label>
      </>}
  </section>
}
function Knob({ knob, actions }: { knob: KnobView; actions: ChromeActions }) {
  const control = knob.control
  const numeric = parseNumber(knob.value)?.number ?? (control._tag === "Number" ? control.number : 0)
  const numberValue = (value: number) => control._tag === "Number" ? formatNumber(clampTo(control, value), control.unit, control.step) : knob.value
  return <li data-cal={CAL.knob} data-knob={knob.id}>
    <p>{knob.label} · {knob.name} · {knob.origin}</p>
    {control._tag === "Number" ? <>
      <input type="number" data-cal={CAL.knobValue} data-knob={knob.id} aria-label={knob.label} disabled={disabled(knob.edit)} value={numeric} min={control.min} max={control.max} step={control.step}
        onInput={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) actions.onKnobInput(knob.id, numberValue(event.currentTarget.valueAsNumber)) }}
        onBlur={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) actions.onKnobCommit(knob.id, numberValue(event.currentTarget.valueAsNumber)) }} />{control.unit}
      {control.min !== undefined && control.max !== undefined && <input type="range" data-cal={CAL.knobSlider} data-knob={knob.id} aria-label={`${knob.label} slider`} disabled={disabled(knob.edit)} value={numeric} min={control.min} max={control.max} step={control.step}
        onInput={event => actions.onKnobInput(knob.id, numberValue(Number(event.currentTarget.value)))} onPointerUp={event => actions.onKnobCommit(knob.id, numberValue(Number(event.currentTarget.value)))} onKeyUp={event => actions.onKnobCommit(knob.id, numberValue(Number(event.currentTarget.value)))} onPointerCancel={() => actions.onKnobCancel(knob.id)} />}
    </> : control._tag === "Color" ? <>
      <input type="text" data-cal={CAL.knobValue} data-knob={knob.id} aria-label={knob.label} disabled={disabled(knob.edit)} value={knob.value} onChange={event => actions.onKnobInput(knob.id, event.currentTarget.value)} onBlur={event => actions.onKnobCommit(knob.id, event.currentTarget.value)} />
      {control.hex && <input type="color" data-cal={CAL.knobColor} data-knob={knob.id} aria-label={`${knob.label} colour`} disabled={disabled(knob.edit)} value={control.hex} onInput={event => actions.onKnobInput(knob.id, event.currentTarget.value)} onBlur={event => actions.onKnobCommit(knob.id, event.currentTarget.value)} />}
    </> : control._tag === "Choice" ? <select data-cal={CAL.knobChoice} data-knob={knob.id} aria-label={knob.label} disabled={disabled(knob.edit)} value={knob.value} onChange={event => actions.onKnobCommit(knob.id, event.currentTarget.value)}>{control.options.map(option => <option key={option}>{option}</option>)}</select>
      : <div role="group" aria-label={knob.label}>{control.options.map(option => <button key={option.name} type="button" data-cal={CAL.knobToken} data-knob={knob.id} data-token={option.name} disabled={disabled(knob.edit)} aria-pressed={option.name === control.chosen} title={option.value} onClick={() => actions.onKnobCommit(knob.id, `var(${option.name})`)}>{option.name}</button>)}</div>}
    <p>{knob.where}</p><Source source={knob.source} actions={actions} /><p>{knob.note}</p><Notices notices={knob.problems.map(text => ({ kind: "warning", text }))} />
    <p data-cal={CAL.knobStatus} role="status">{knob.write._tag === "Failed" || knob.write._tag === "Conflict" ? knob.write.reason : knob.write._tag}</p>
  </li>
}
function Knobs({ view, actions }: ChromeProps) {
  const knobs = view.knobs
  if (knobs._tag === "Closed") return null
  return <section data-cal={CAL.knobs} aria-label="Knobs">
    {knobs._tag === "Idle" ? <p>{knobs.message}</p> : knobs._tag === "Finding" ? <p>Finding knobs for {knobs.target}…</p> : <>
      <h2>{knobs.target}</h2><Notices notices={knobs.problems.map(text => ({ kind: "warning", text }))} />
      <ul>{knobs.knobs.map(knob => <Knob key={knob.id} knob={knob} actions={actions} />)}</ul>
      {knobs.knobs.length === 0 && <p>No design input here is a knob.</p>}
      <details><summary>{knobs.skipped.length} not knobs</summary>{knobs.skipped.map((item, index) => <p key={index}>{item.name} {item.where} {item.reason}</p>)}</details>
      <details data-cal={CAL.literals} open={knobs.literals._tag !== "Closed"} onToggle={event => { const open = event.currentTarget.open; if (open !== (knobs.literals._tag !== "Closed")) actions.onLiteralsOpen(open) }}><summary>Literals</summary>
        {knobs.literals._tag === "Finding" ? <p>Finding literals…</p> : knobs.literals._tag === "Failed" ? <p role="alert">{knobs.literals.reason}</p> : knobs.literals._tag === "Ready" ? <>
          <p role="status">{knobs.literals.notice}</p>
          {knobs.literals.literals.map(literal => <section key={literal.id} data-cal={CAL.literal} data-literal={literal.id}><p>{literal.property}: {literal.value} in {literal.selector}</p><Source source={literal.source} actions={actions} />
            <button type="button" data-cal={CAL.literalOpen} data-literal={literal.id} aria-expanded={literal.draft._tag !== "Closed"} onClick={() => actions.onLiteralDraft(literal.id, literal.draft._tag === "Closed")}>Make a token</button>
            {literal.draft._tag !== "Closed" && <form onSubmit={event => { event.preventDefault(); if (literal.draft._tag !== "Closed" && !disabled(literal.draft.create)) actions.onPromote(literal.id) }}>
              <input data-cal={CAL.literalName} data-literal={literal.id} aria-label="Token name" value={literal.draft.name} disabled={literal.draft._tag === "Saving"} onChange={event => actions.onLiteralName(literal.id, event.currentTarget.value)} />
              <select data-cal={CAL.literalHome} data-literal={literal.id} aria-label="Rule the token goes in" value={literal.draft.home} disabled={literal.draft._tag === "Saving"} onChange={event => actions.onLiteralHome(literal.id, event.currentTarget.value)}>{literal.homes.map(home => <option key={home.id} value={home.id}>{home.label}</option>)}</select>
              <p>{literal.draft.preview}</p><p role="alert">{literal.draft.problem}</p>
              <button type="button" data-cal={CAL.literalCancel} data-literal={literal.id} disabled={literal.draft._tag === "Saving"} onClick={() => actions.onLiteralDraft(literal.id, false)}>Cancel</button>
              <Action hook={CAL.promote} availability={literal.draft.create} action={() => actions.onPromote(literal.id)}>Create token</Action>
            </form>}
          </section>)}
          <details><summary>{knobs.literals.refused.length} could not be placed</summary>{knobs.literals.refused.map((item, index) => <p key={index}>{item.name} {item.where} {item.reason}</p>)}</details>
        </> : null}
      </details>
    </>}
  </section>
}
function Checks({ view, actions }: ChromeProps) {
  const checks = view.checks
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element || checks._tag === "Closed") return
    if (!element.open) element.showModal()
    return () => { if (element.open) element.close() }
  }, [checks._tag])
  if (checks._tag === "Closed") return null
  const run = checks.run
  return <dialog ref={dialog} data-cal={CAL.checks} aria-label="Checks" onCancel={event => { event.preventDefault(); actions.onChecksClose() }}>
    <h2>Checks</h2><button type="button" data-cal={CAL.checksClose} onClick={actions.onChecksClose}>Close</button>
    <p>{checks.targetLabel}</p><Action hook={CAL.checkRun} availability={checks.runSelected} action={() => actions.onCheckRun("selected")}>Check selected preview</Action>
    <Action hook={CAL.checkRun} availability={checks.runAll} action={() => actions.onCheckRun("all")}>Check all states</Action>
    <Notices notices={checks.notices} />
    {run._tag === "Idle" ? <p>No checks run yet.</p> : run._tag === "Loading" ? <p>Loading checks…</p> : run._tag === "Running" ? <><p role="status">{run.progress}</p><Action hook={CAL.checkStop} availability={run.stop} action={() => actions.onCheckStop(run.id)}>Stop checks</Action></>
      : run._tag !== "Ready" ? <p role="alert">{run.reason}</p> : <>
        <h3>{run.badge.label}</h3><p>{run.badge.detail}</p><p>{run.summary}</p>{run.stale && <p role="status">Results are out of date.</p>}
        <details><summary>Coverage and limits</summary><p>{run.coverage}</p><pre>{run.runDetail}</pre></details><a data-cal={CAL.report} href={run.reportUrl} download="caliper-checks.json">Download report</a>
        {run.rows.map(row => <details key={row.index} data-cal={CAL.checkRow} data-index={row.index}><summary>{row.part} · {row.state} · {row.device} · {row.take ? `Take ${row.take}` : "Real files"} · {row.badge.label}</summary>
          <p>{row.badge.detail}</p>
          {[...row.findings, ...row.authored].map(finding => <details key={finding.id} data-cal={CAL.finding}><summary>{finding.label} · {finding.status}</summary><pre>{finding.detail}</pre>
            {finding.image && <a href={finding.image.url} target="_blank" rel="noopener"><img data-cal={CAL.evidence} src={finding.image.url} alt={finding.image.label} onLoad={() => finding.image && actions.onImageLoaded(run.id, row.index, finding.image.key)} onError={() => finding.image && actions.onImageFailed(run.id, row.index, finding.image.key)} /></a>}
          </details>)}
          <p>{row.authoredSummary}</p><pre>{row.provenance}</pre>
          {row.images.map(image => <figure key={image.key}><a href={image.url} target="_blank" rel="noopener"><img data-cal={CAL.evidence} src={image.url} alt={image.label} onLoad={() => actions.onImageLoaded(run.id, row.index, image.key)} onError={() => actions.onImageFailed(run.id, row.index, image.key)} /></a><figcaption>{image.caption}</figcaption></figure>)}
          <p>{row.approvalNote}</p>
          <label><input type="checkbox" data-cal={CAL.imageReviewed} data-index={row.index} checked={row.reviewed} disabled={row.approved || disabled(row.approval)} onChange={event => actions.onImageReviewed(run.id, row.index, event.currentTarget.checked)} />I reviewed both renders.</label>
          <Action hook={CAL.approveImage} availability={row.reviewed && !row.approved ? row.approval : { _tag: "Disabled", reason: row.approved ? "Already approved" : "Review both images first" }} action={() => actions.onApproveImage(run.id, row.index)}>{row.approved ? "Baseline approved" : "Approve this image"}</Action>
        </details>)}
      </>}
  </dialog>
}
function Calibration({ view, actions }: ChromeProps) {
  const calibration = view.calibration
  if (calibration._tag === "Closed") return null
  return <section data-cal={CAL.calibration} aria-label="Calibrate">
    <p>Set browser zoom to 100%. Match a credit card to the outline.</p>
    <div style={{ width: CARD.widthMm * calibration.pxPerMm, height: CARD.heightMm * calibration.pxPerMm, border: "1px solid currentColor" }}>Credit card</div>
    <input data-cal={CAL.calibrationScale} type="range" aria-label="Scale" min="2" max="12" step="0.01" value={calibration.pxPerMm} onChange={event => actions.onPxPerMm(Number(event.currentTarget.value))} />
    <output>{calibration.pxPerMm.toFixed(2)} px/mm · {Math.round(calibration.pxPerMm * 25.4)} px/in · {calibration.calibrated ? "Calibrated" : "Assumed"}</output>
    <button type="button" data-cal={CAL.calibrationReset} onClick={actions.onResetCalibration}>Reset</button><button type="button" data-cal={CAL.calibrationClose} onClick={actions.onCalibrationClose}>Done</button>
  </section>
}

/** Executable unstyled contract, not the production Darkroom markup design. */
function MarkupReference({ view, actions }: ChromeProps) {
  const markup = view.markup
  const note = useRef<HTMLInputElement>(null)
  const editorId = markup._tag === "Ready" && markup.editor._tag === "Open" ? markup.editor.id : null
  useEffect(() => { if (editorId) note.current?.focus() }, [editorId])
  if (markup._tag === "Unavailable") return null
  const send = markup.send
  const unavailable = send._tag === "Sending" || send.availability._tag === "Disabled"
  const reason = send._tag === "Sending" ? "Sending the draft" : send.availability._tag === "Disabled" ? send.availability.reason : undefined
  return <section data-cal={CAL.markup} aria-label="Take markup">
    <button type="button" data-cal={CAL.markMode} aria-pressed={markup.mode._tag !== "Off"} onClick={() => actions.onMarkMode(markup.mode._tag === "Off")}>Mark mode</button>
    {markup.mode._tag !== "Off" && <p role="status">Click or drag to mark. Turn Mark mode off to use the part.</p>}
    <button type="button" data-cal={CAL.draftOpen} aria-expanded={markup.draftOpen} onClick={() => actions.onDraftOpen(!markup.draftOpen)}>Draft</button>
    {markup.draftOpen && <div data-cal={CAL.draft}>
      {markup.groups.length === 0 && <p>No draft marks.</p>}
      {markup.groups.map(group => <section key={`${group.source.take}@${group.source.created}`} data-take={group.source.take} data-created={group.source.created}>
        <h2>{group.label}</h2>
        <p data-cal={CAL.draftOutcome} data-outcome={group.outcome._tag}>{group.outcome.label}</p>
        {group.decision._tag === "Blocked" && <p>{group.decision.reasons.join(" ")}</p>}
        <ul>{group.marks.map(mark => <li key={mark.id} data-mark-id={mark.id}>
          <button type="button" data-cal={CAL.markEdit} data-mark-id={mark.id} disabled={mark.edit._tag === "Disabled"} onClick={() => actions.onMarkEdit(mark.id)}>{mark.name}</button>
          <p>{mark.note} · {mark.previewLabel} · {mark.deviceLabel}</p>
          {mark.references.length > 0 && <p>Points to {mark.references.join(", ")}</p>}
          {mark.location._tag !== "Located" && <p role="status">{mark.location.reason}</p>}
          <button type="button" data-cal={CAL.markReplace} data-mark-id={mark.id} disabled={mark.replace._tag === "Disabled"} onClick={() => actions.onMarkReplace(mark.id)}>Re-place {mark.name}</button>
          <button type="button" data-cal={CAL.markRemove} data-mark-id={mark.id} disabled={mark.remove._tag === "Disabled"} onClick={() => actions.onMarkRemove(mark.id)}>Remove {mark.name}</button>
        </li>)}</ul>
      </section>)}
    </div>}
    {markup.editor._tag === "Open" && <label>Note for {markup.editor.name}
      <input ref={note} data-cal={CAL.markNote} data-mark-id={markup.editor.id} aria-label={`Note for ${markup.editor.name}`} value={markup.editor.note} disabled={markup.editor.edit._tag === "Disabled"}
        onChange={event => { if (markup.editor._tag === "Open") actions.onMarkNote(markup.editor.id, event.currentTarget.value) }}
        onKeyDown={event => { if (event.key === "Escape" || event.key === "Enter") { event.preventDefault(); actions.onMarkEdit(null) } }} />
      <button type="button" data-cal={CAL.markEditorClose} onClick={() => actions.onMarkEdit(null)}>Close note</button>
      <ul aria-label="Marks this note can point to">{markup.editor.references.map(option => <li key={option.id}>
        <button type="button" data-cal={CAL.markReference} data-mark-id={option.id} disabled={markup.editor._tag !== "Open" || markup.editor.edit._tag === "Disabled"}
          onClick={() => { if (markup.editor._tag === "Open") actions.onMarkNote(markup.editor.id, `${markup.editor.note}${markup.editor.note && !markup.editor.note.endsWith(" ") ? " " : ""}${option.name}`) }}>
          {option.name} · {option.label}{option.note ? ` · ${option.note}` : ""}{option.crop ? "" : " · no picture"}</button>
      </li>)}</ul>
    </label>}
    <button type="button" data-cal={CAL.send} disabled={unavailable} title={reason} onClick={() => actions.onSend(markup.revision)}>{send.label}</button>
    {unavailable && <p role="status">{reason}</p>}
    {send._tag === "Failed" && <p role="alert">{send.reason}</p>}
  </section>
}

/** UI-only coordinate conversion. No anchor discovery, frame document access or persisted marks. */
function MarkSurface({ frame, width, height, actions }: {
  frame: FrameView; width: number; height: number; actions: ChromeActions
}) {
  const start = useRef<{ readonly pointer: number; readonly point: MarkPoint } | null>(null)
  return <>
    <div data-cal={CAL.markSurface} data-frame-key={frame.key} role="button" tabIndex={0} aria-label={`Place a mark on ${frame.label}`}
      // The reference overlay follows measured physical frame geometry, not a fixed design size.
      style={{ position: "absolute", inset: 0 }}
      onPointerDown={event => {
        if (start.current || event.button !== 0 || !event.isPrimary) return
        const box = event.currentTarget.getBoundingClientRect()
        start.current = { pointer: event.pointerId, point: { x: (event.clientX - box.left) * width / box.width, y: (event.clientY - box.top) * height / box.height } }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      }}
      onPointerUp={event => {
        if (start.current?.pointer !== event.pointerId) return
        const from = start.current.point
        start.current = null
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        const box = event.currentTarget.getBoundingClientRect()
        const to = { x: Math.max(0, Math.min(width, (event.clientX - box.left) * width / box.width)), y: Math.max(0, Math.min(height, (event.clientY - box.top) * height / box.height)) }
        // Reference-only jitter threshold in device CSS px. Production gestures remain UI-owned.
        if (Math.hypot(to.x - from.x, to.y - from.y) < 4) actions.onMarkPoint(frame.key, to)
        else actions.onMarkRegion(frame.key, { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) })
      }}
      onPointerCancel={event => { if (start.current?.pointer === event.pointerId) start.current = null }}
      onLostPointerCapture={event => { if (start.current?.pointer === event.pointerId) start.current = null }}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); actions.onMarkPoint(frame.key, { x: width / 2, y: height / 2 }) } }} />
  </>
}

/** Native alternatives exercise coordinate actions without prescribing production gestures. */
function MarkCoordinates({ frame, width, height, actions }: { frame: FrameView; width: number; height: number; actions: ChromeActions }) {
  return <>
    <button type="button" data-cal={CAL.markPoint} data-frame-key={frame.key} onClick={() => actions.onMarkPoint(frame.key, { x: width / 2, y: height / 2 })}>Mark centre point</button>
    <button type="button" data-cal={CAL.markRegion} data-frame-key={frame.key} onClick={() => actions.onMarkRegion(frame.key, { x: width / 4, y: height / 4, width: width / 2, height: height / 2 })}>Mark centre region</button>
  </>
}
