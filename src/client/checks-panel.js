// @ts-check
import { h } from "./dom.js"
import { canApproveImage, checkDetail, planChecks, reconcileChecks, summarizeChecks } from "./checks-view.js"

/** @typedef {import('../checks/contract.js').ChecksView} ChecksView */
/** @typedef {{part: string, state: string, take?: string, label: string}} Target */
const NAMES = { render: "Rendering", browser: "Browser errors", spill: "Content outside the screen", accessibility: "Accessibility", determinism: "Repeat render", baseline: "Accepted image" }

/**
 * Owns run/review interactions, not source editing or take acceptance.
 * A native dialog provides focus containment, Escape and return focus.
 * @param {{ container: HTMLElement, target: () => Target | null, changed: () => void }} input
 */
export function createChecksPanel({ container, target, changed }) {
  /** @type {ChecksView} */
  let view = { _tag: "Idle" }
  let busy = false
  let connecting = false
  let error = ""
  let notice = ""
  let epoch = 0
  /** @type {Target | null} */
  let selection = null
  /** @type {Set<number>} */
  const expanded = new Set()
  const dialog = h("dialog", { class: "cal-checks-dialog", "aria-labelledby": "cal-checks-title" })
  const body = h("div", { class: "cal-checks-body" })
  dialog.append(
    h("header", { class: "cal-checks-head" }, h("h2", { id: "cal-checks-title" }, "Checks"),
      h("button", { type: "button", "aria-label": "Close checks", onClick: () => dialog.close() }, "Close")), body,
  )
  document.body.append(dialog)
  dialog.addEventListener("close", () => {
    const opener = container.querySelector('.cal-checks-toggle:not([data-overflow])') ?? container.querySelector('.cal-more')
    if (opener instanceof HTMLElement) opener.focus({ preventScroll: true })
  })
  const layout = () => {
    const box = container.getBoundingClientRect()
    const rem = parseFloat(getComputedStyle(dialog).fontSize) || 16
    // Transient UI escapes clipping, but follows the actual Caliper box.
    dialog.style.setProperty("--checks-left", `${box.left}px`)
    dialog.style.setProperty("--checks-top", `${box.top}px`)
    dialog.style.setProperty("--checks-width", `${box.width}px`)
    dialog.style.setProperty("--checks-height", `${box.height}px`)
    const plan = planChecks(Math.max(0, box.width - rem * 2) / rem, Math.max(0, box.height - rem * 2) / rem)
    dialog.style.setProperty("--checks-columns", String(plan.columns))
    dialog.dataset.compact = String(plan.compact)
  }
  new ResizeObserver(layout).observe(container)

  /** @param {ChecksView} next */
  const receive = next => {
    next = reconcileChecks(view, next)
    if (JSON.stringify(next) === JSON.stringify(view)) return
    if (!("id" in view) || !("id" in next) || view.id !== next.id) { expanded.clear(); notice = "" }
    view = next
    epoch++
    render()
    changed()
  }
  const refresh = async () => {
    const started = epoch
    connecting = true
    render()
    try {
      const response = await fetch("checks")
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
      if (epoch === started) receive(result)
    } catch (problem) { error = message(problem) }
    finally { connecting = false; render() }
  }
  /** @param {string} action @param {object} data */
  const post = async (action, data) => {
    if (busy) return
    busy = true
    const started = epoch
    error = ""
    notice = ""
    render()
    try {
      const response = await fetch(`checks/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
      // SSE can complete this run, or start a newer one from another window,
      // before the HTTP acknowledgement arrives. Never rewind those updates.
      if (epoch === started) receive(result)
      if (action === "approve") notice = "Baseline approved from these saved images. Other findings remain. Run checks again to compare with it."
    } catch (problem) { error = message(problem); void refresh() }
    finally { busy = false; render() }
  }
  /** @param {string} label @param {() => void} action @param {boolean} [disabled] */
  const button = (label, action, disabled = false) => h("button", { type: "button", disabled: disabled || busy || connecting, onClick: action }, label)

  /** @param {Extract<ChecksView, {_tag: 'Ready'}>} ready @param {number} index */
  const resultRow = (ready, index) => {
    const result = ready.report.results[index]
    if (!result) return h("div")
    const summary = summarizeChecks(result.checks)
    const row = h("details", { class: "cal-check-result", "data-index": String(index) },
      h("summary", {},
        h("span", { class: "cal-check-result-name" }, h("strong", {}, result.part), h("span", {}, `${result.state} · ${result.device}${result.take ? ` · Take ${result.take}` : " · Real files"}`)),
        h("span", { class: "cal-check-badge", "data-status": ready.stale ? "Stale" : summary.status }, ready.stale ? "Out of date" : summary.label)))
    let mounted = false
    const mount = () => {
      if (mounted) return
      mounted = true
      const list = h("div", { class: "cal-check-list" })
      for (const check of result.checks) {
        const detail = h("details", { class: "cal-check-finding" },
          h("summary", {}, NAMES[check.name], h("span", { class: "cal-check-badge", "data-status": check.status }, check.status === "NotRun" ? "Not run" : check.status)),
          h("pre", { tabindex: "0", "aria-label": `${NAMES[check.name]} details` }, checkDetail(check)))
        detail.open = check.status === "Failed" || check.status === "Inconclusive"
        list.append(detail)
      }
      const images = h("div", { class: "cal-check-images" })
      const reviewed = h("input", { type: "checkbox", disabled: true })
      const approved = ready.approved.includes(index)
      const eligible = !ready.stale && canApproveImage(result) && !approved
      const approve = button(approved ? "Baseline approved" : "Approve this image", () => {
        if (reviewed.checked) void post("approve", { id: ready.id, index, reviewed: true })
      }, true)
      const loaded = new Set()
      const updateApproval = () => {
        reviewed.disabled = !eligible || loaded.size < 2 || busy
        approve.disabled = reviewed.disabled || !reviewed.checked
      }
      reviewed.addEventListener("change", updateApproval)
      /** @type {Array<['first' | 'repeat' | 'baseline', string]>} */
      const shots = [["first", "First render"], ["repeat", "Repeat render"]]
      if (result.checks.some(check => check.name === "baseline" && check.image)) shots.push(["baseline", "Baseline at check time"])
      for (const [kind, label] of shots) {
        const src = `checks/image?id=${encodeURIComponent(ready.id)}&index=${index}&kind=${kind}`
        const image = h("img", { src, alt: `${label}: ${result.part}, ${result.state}, ${result.device}` })
        const caption = h("figcaption", {}, label, h("span", {}, `${result.viewport.width} × ${result.viewport.height}. Open full size.`))
        image.addEventListener("load", () => { if (kind !== "baseline") loaded.add(kind); updateApproval() })
        image.addEventListener("error", () => { caption.append(h("span", { role: "alert" }, "Image unavailable. Run checks again.")); updateApproval() })
        images.append(h("figure", {}, h("a", { href: src, target: "_blank", rel: "noopener", "aria-label": `Open ${label.toLowerCase()} at full size` }, image), caption))
      }
      row.append(list, images)
      if (result.take !== undefined) row.append(h("p", { class: "cal-note" }, "Take images cannot become product baselines. Accept the take, then check and review the real files."))
      else if (!canApproveImage(result)) row.append(h("p", { class: "cal-note" }, "Fix render or browser errors and get two matching renders before approving an image."))
      else row.append(h("div", { class: "cal-check-approval" },
        h("label", {}, reviewed, " I reviewed both renders and this is the intended image."), approve,
        h("p", { class: "cal-note" }, "Approves visual intent only. Accessibility and other findings remain. Does not accept a take.")))
    }
    row.open = expanded.has(index)
    if (row.open) mount()
    row.addEventListener("toggle", () => {
      if (row.open) { expanded.add(index); mount() } else expanded.delete(index)
    })
    return row
  }

  const render = () => {
    if (!dialog.open) return
    const oldScroll = body.scrollTop
    const lostFocus = body.contains(document.activeElement)
    const running = view._tag === "Running"
    const current = selection
    const runSelected = () => { if (current) void post("run", { part: current.part, state: current.state, ...(current.take ? { take: current.take } : {}) }) }
    const runAll = () => void post("run", { part: "*", state: "*", ...(current?.take ? { take: current.take } : {}) })
    body.replaceChildren(
      h("section", { class: "cal-check-controls", "aria-label": "Run checks" },
        h("p", {}, current ? current.label : "No preview selected."),
        h("div", { class: "cal-check-actions" }, button("Check selected preview", runSelected, running || !current), button(current?.take ? "Check all states with this take" : "Check all states", runAll, running || !current)),
        h("p", { class: "cal-note" }, "Both device sizes. Reports problems without blocking Replace. Checks render twice and do not prove interactions.")),
    )
    if (error) body.append(h("p", { class: "cal-check-error", role: "alert" }, error))
    if (notice) body.append(h("p", { class: "cal-check-notice", role: "status" }, notice))
    if (connecting) body.append(h("p", { role: "status" }, "Loading checks…"))
    if (view._tag === "Idle") body.append(h("div", { class: "cal-check-empty" }, h("h3", {}, "No checks run yet"), h("p", {}, "Run checks to see rendering, browser errors, overflow, accessibility, repeat renders and accepted-image comparisons.")))
    else if (view._tag === "Running") body.append(h("p", { role: "status", class: "cal-check-progress" }, `Checking ${view.total} state/device renders twice… You can close this window while checks run.`))
    else if (view._tag === "Failed") body.append(h("div", { class: "cal-check-error", role: "alert" }, h("h3", {}, "Checks could not finish"), h("p", {}, view.reason), h("p", {}, "Fix the reported setup problem, then run checks again. No passing report was produced.")))
    else {
      const ready = view
      const summary = summarizeChecks(ready.report.results.flatMap(result => result.checks))
      body.append(h("section", { class: "cal-check-summary", "aria-label": "Check results" },
        h("h3", { role: "status" }, ready.stale ? "Results are out of date" : summary.label),
        h("p", {}, summary.detail),
        h("p", { class: "cal-note" }, `${ready.report.results.length} state/device results · ${ready.request.take ? `Take ${ready.request.take}` : "Real files"} · ${new Date(ready.report.createdAt).toLocaleString()}`),
        ready.stale ? h("p", { class: "cal-check-warning", role: "status" }, "Source files changed during or after this run. These are historical observations. Run checks again before approving images.") : null,
        h("details", {}, h("summary", {}, "Coverage and limits"), h("p", {}, ready.report.coverage), h("p", {}, "Only the latest UI run is kept during this server session. Closing this window or reloading the page keeps it; restarting Vite clears it. Accepted baselines stay on disk.")),
        h("a", { href: `checks/report?id=${encodeURIComponent(ready.id)}`, download: "caliper-checks.json" }, "Download report")),
      ...ready.report.results.map((_result, index) => resultRow(ready, index)))
    }
    body.scrollTop = oldScroll
    if (lostFocus) dialog.querySelector('button')?.focus({ preventScroll: true })
  }

  const open = () => {
    selection = target()
    error = ""
    if (!dialog.open) dialog.showModal()
    layout()
    render()
    void refresh()
  }
  /** Status text for a state row; absent does not mean passed. @param {string} part @param {string} state @param {string} [take] */
  const badge = (part, state, take) => {
    if (view._tag !== "Ready") return null
    const results = view.report.results.filter(result => result.part === part && result.state === state && result.take === take)
    if (!results.length) return null
    const summary = summarizeChecks(results.flatMap(result => result.checks))
    return h("span", { class: "cal-check-badge", "data-status": view.stale ? "Stale" : summary.status, title: summary.detail }, view.stale ? "Out of date" : summary.label)
  }
  const status = () => view._tag === "Ready" ? view.stale ? "Out of date" : summarizeChecks(view.report.results.flatMap(result => result.checks)).label : view._tag === "Running" ? "Running" : view._tag === "Failed" ? "Could not finish" : "Not checked"
  return { open, receive, badge, status }
}

/** @param {unknown} problem */
function message(problem) { return problem instanceof Error ? problem.message : String(problem) }
