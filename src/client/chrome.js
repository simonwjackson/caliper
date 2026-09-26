// @ts-check
import { CARD, DEFAULT_PX_PER_MM, DEVICES, frameGeometry, gridGeometry } from "./device-frame.js"

/**
 * Caliper's chrome: the part list, one device frame and the calibration.
 *
 * Plain DOM on purpose. The chrome shares no React with the project, and it
 * loads no project code: parts run only inside the device frame's iframe.
 */

/**
 * @typedef {import("../types").Project} Project
 * @typedef {import("../types").Part} Part
 * @typedef {import("../types").SourceSite} SourceSite
 * @typedef {import("./device-frame.js").Device} Device
 * @typedef {{ kind: "error" | "warning", title: string, detail: string }} Problem
 * @typedef {{ _tag: "Connecting" } | { _tag: "Ready", project: Project } | { _tag: "Unreachable", project: Project | null }} Connection
 * @typedef {{ part: string, partState: string, state: "Loading" | "Rendered" | "Empty" | "Failed", problems: Problem[] }} FrameReport
 * @typedef {{ _tag: "One", export: string } | { _tag: "All" }} Shown
 *   `One` shows one state of the part. `All` shows every state side by side.
 */

const STORAGE_PX_PER_MM = "caliper:px-per-mm"
const STORAGE_DEVICE = "caliper:device"
/** Room the caption under the frame needs, in CSS px. */
const CAPTION_RESERVE = 44
/** Matches `.cal-stage` padding in chrome.css. */
const STAGE_PADDING = 24
/** Matches the outer ring of `.cal-screen` in chrome.css. */
const RING = 7
const DEFAULT_DEVICE = /** @type {Device} */ (DEVICES[0])
const DEFAULT_STATE = "default"
/** The `state` value in the URL that shows every state. No export can have this name. */
const ALL_STATES = "*"
/** Chrome CSS px between two frames in the grid, ring to ring. */
const GRID_GAP = 20
/** Room above each frame in the grid for its label. */
const GRID_LABEL = 36

const saved = new URLSearchParams(location.hash.slice(1))
const storedPxPerMm = Number(localStorage.getItem(STORAGE_PX_PER_MM))

const state = {
  /** @type {Connection} */
  connection: { _tag: "Connecting" },
  /** @type {string | null} */
  part: saved.get("part"),
  /** @type {Shown} */
  shown: shownFrom(saved.get("state")),
  device: deviceById(saved.get("device") ?? localStorage.getItem(STORAGE_DEVICE)),
  pxPerMm: storedPxPerMm > 0 ? storedPxPerMm : DEFAULT_PX_PER_MM,
  calibrated: storedPxPerMm > 0,
  calibrating: false,
  filter: "",
  /** What each frame last reported, by state. @type {Map<string, FrameReport>} */
  reports: new Map(),
}

// ---------------------------------------------------------------- DOM helpers

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string | boolean | ((event: Event) => void)>} [props]
 * @param {Array<Node | string | null | false>} children
 * @returns {HTMLElementTagNameMap[K]}
 */
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value)
    else if (value === true) element.setAttribute(key, "")
    else if (value !== false) element.setAttribute(key, value)
  }
  for (const child of children) if (child !== null && child !== false) element.append(child)
  return element
}

/** @param {string} selector */
function $(selector) {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLElement)) throw new Error(`Caliper chrome is missing ${selector}`)
  return element
}

// ------------------------------------------------------------------- skeleton

const app = $("#caliper")
app.append(
  h("div", { class: "cal" },
    h("aside", { class: "cal-side" },
      h("header", { class: "cal-side-head" },
        h("h1", { class: "cal-project" }, "Caliper"),
        h("span", { class: "cal-count" })),
      h("input", {
        class: "cal-filter",
        type: "search",
        placeholder: "Filter parts",
        "aria-label": "Filter parts",
        onInput: event => {
          state.filter = /** @type {HTMLInputElement} */ (event.target).value
          renderParts()
        },
      }),
      h("nav", { class: "cal-parts", "aria-label": "Parts" }),
      h("details", { class: "cal-setup" },
        h("summary", {}, "Setup"),
        h("div", { class: "cal-setup-body" }))),
    h("main", { class: "cal-main" },
      h("header", { class: "cal-bar" },
        h("div", { class: "cal-title" },
          h("strong", { class: "cal-part-name" }),
          h("span", { class: "cal-part-file" })),
        h("div", { class: "cal-devices", role: "radiogroup", "aria-label": "Device" }),
        h("button", { class: "cal-calibrate", type: "button", onClick: () => setCalibrating(!state.calibrating) }, "Calibrate")),
      h("div", { class: "cal-stage" },
        h("figure", { class: "cal-device" },
          h("div", { class: "cal-screen" },
            h("iframe", { class: "cal-frame", title: "Device screen" })),
          h("figcaption", { class: "cal-caption" })),
        h("section", { class: "cal-grid", hidden: true, "aria-label": "All states" },
          h("p", { class: "cal-grid-caption" }),
          h("div", { class: "cal-grid-cells" })),
        h("p", { class: "cal-empty" }),
        h("div", { class: "cal-calibration", hidden: true },
          h("div", { class: "cal-card", "aria-hidden": "true" }, "Match a credit card"),
          h("div", { class: "cal-calibration-controls" },
            h("p", {}, "Set the browser zoom to 100%. Hold a credit card against the screen, and move the slider until the outline matches the card."),
            h("label", { class: "cal-scale" },
              h("span", {}, "Scale"),
              h("input", {
                class: "cal-scale-input",
                type: "range",
                min: "2",
                max: "12",
                step: "0.01",
                onInput: event => setPxPerMm(Number(/** @type {HTMLInputElement} */ (event.target).value)),
              }),
              h("output", { class: "cal-scale-value" })),
            h("div", { class: "cal-calibration-actions" },
              h("button", { type: "button", onClick: () => resetCalibration() }, "Reset"),
              h("button", { type: "button", class: "cal-primary", onClick: () => setCalibrating(false) }, "Done"))))),
      h("section", { class: "cal-problems", "aria-live": "polite" }))))

const frame = /** @type {HTMLIFrameElement} */ ($(".cal-frame"))
const stage = $(".cal-stage")

// -------------------------------------------------------------------- actions

/** @param {string | null} id */
function deviceById(id) {
  return DEVICES.find(device => device.id === id) ?? DEFAULT_DEVICE
}

/**
 * @param {string | null} value the URL's `state`
 * @returns {Shown}
 */
function shownFrom(value) {
  if (value === ALL_STATES) return { _tag: "All" }
  return { _tag: "One", export: value ?? DEFAULT_STATE }
}

/**
 * What the stage shows for the current part. A part with one state has
 * nothing to compare, so `All` shows it alone.
 *
 * @returns {Shown}
 */
function effectiveShown() {
  const part = currentPart()
  if (state.shown._tag === "All" && part && part.states.length === 1) return { _tag: "One", export: DEFAULT_STATE }
  return state.shown
}

function saveLocation() {
  const params = new URLSearchParams()
  if (state.part) params.set("part", state.part)
  if (state.shown._tag === "All") params.set("state", ALL_STATES)
  else if (state.shown.export !== DEFAULT_STATE) params.set("state", state.shown.export)
  params.set("device", state.device.id)
  history.replaceState(null, "", `#${params}`)
}

/** @param {string} file */
function selectPart(file) {
  if (state.part === file) return
  state.part = file
  // Keep comparing states when you move to another part.
  if (state.shown._tag === "One") state.shown = { _tag: "One", export: DEFAULT_STATE }
  showChanged()
}

/** @param {Shown} shown */
function selectShown(shown) {
  if (JSON.stringify(shown) === JSON.stringify(state.shown)) return
  state.shown = shown
  showChanged()
}

function showChanged() {
  state.reports = new Map()
  saveLocation()
  renderParts()
  renderBar()
  renderFrame()
  renderStage()
  renderProblems()
}

/** @param {Device} device */
function selectDevice(device) {
  state.device = device
  localStorage.setItem(STORAGE_DEVICE, device.id)
  saveLocation()
  renderBar()
  renderStage()
}

/** @param {number} pxPerMm */
function setPxPerMm(pxPerMm) {
  if (!(pxPerMm > 0)) return
  state.pxPerMm = pxPerMm
  state.calibrated = true
  localStorage.setItem(STORAGE_PX_PER_MM, String(pxPerMm))
  renderCalibration()
  renderStage()
}

function resetCalibration() {
  state.pxPerMm = DEFAULT_PX_PER_MM
  state.calibrated = false
  localStorage.removeItem(STORAGE_PX_PER_MM)
  renderCalibration()
  renderStage()
}

/** @param {boolean} on */
function setCalibrating(on) {
  state.calibrating = on
  renderBar()
  renderCalibration()
}

// ------------------------------------------------------------------ rendering

function currentProject() {
  return state.connection._tag === "Connecting" ? null : state.connection.project
}

function currentPart() {
  return currentProject()?.parts.find(part => part.file === state.part) ?? null
}

function renderParts() {
  const project = currentProject()
  $(".cal-project").textContent = project?.name ?? "Caliper"
  const count = $(".cal-count")
  const list = $(".cal-parts")
  list.replaceChildren()
  if (!project) {
    count.textContent = ""
    list.append(h("p", { class: "cal-note" }, state.connection._tag === "Connecting" ? "Connecting to Vite…" : "Vite is not reachable."))
    return
  }
  const needle = state.filter.trim().toLowerCase()
  const shown = project.parts.filter(part => !needle || part.name.toLowerCase().includes(needle) || part.file.toLowerCase().includes(needle))
  count.textContent = state.connection._tag === "Unreachable"
    ? "Vite is not reachable"
    : needle ? `${shown.length} of ${project.parts.length}` : `${project.parts.length} parts`
  if (project.parts.length === 0) {
    list.append(h("p", { class: "cal-note" }, "No *.part.tsx files found. A part file default-exports a component that renders with no props."))
    return
  }
  if (shown.length === 0) {
    list.append(h("p", { class: "cal-note" }, `No part matches “${state.filter}”.`))
    return
  }
  /** @type {Map<string, Part[]>} */
  const groups = new Map()
  for (const part of shown) {
    const folder = part.file.includes("/") ? part.file.slice(0, part.file.lastIndexOf("/")) : "."
    groups.set(folder, [...(groups.get(folder) ?? []), part])
  }
  for (const [folder, parts] of groups) {
    list.append(h("h2", { class: "cal-group" }, folder))
    for (const part of parts) {
      list.append(h("button", {
        type: "button",
        class: "cal-part",
        "aria-current": part.file === state.part ? "true" : false,
        title: part.file,
        onClick: () => selectPart(part.file),
      }, h("span", { class: "cal-part-label" }, part.name)))
      if (part.file === state.part && part.states.length > 1) list.append(stateList(part))
    }
  }
}

/**
 * The selected part's states, under its row in the list.
 *
 * @param {Part} part
 */
function stateList(part) {
  const shown = effectiveShown()
  return h("div", { class: "cal-states", role: "group", "aria-label": `${part.name} states` },
    h("button", {
      type: "button",
      class: "cal-state cal-state-all",
      "aria-current": shown._tag === "All" ? "true" : false,
      title: "Every state side by side",
      "data-state": ALL_STATES,
      onClick: () => selectShown({ _tag: "All" }),
    }, `All ${part.states.length} states`),
    ...part.states.map(partState => h("button", {
      type: "button",
      class: "cal-state",
      "aria-current": shown._tag === "One" && partState.export === shown.export ? "true" : false,
      title: stateSite(part, partState),
      "data-state": partState.export,
      onClick: () => selectShown({ _tag: "One", export: partState.export }),
    }, partState.label)))
}

/**
 * @param {Part} part
 * @param {import("../types").PartState} partState
 */
function stateSite(part, partState) {
  return partState.line ? `${part.file}:${partState.line}` : `${part.file}: default export`
}

/** @param {string} exportName */
function stateLabel(exportName) {
  return currentPart()?.states.find(partState => partState.export === exportName)?.label ?? exportName
}

function renderBar() {
  const part = currentPart()
  const shown = effectiveShown()
  const shownState = !part || part.states.length === 1 ? ""
    : shown._tag === "All" ? ` · All ${part.states.length} states`
    : ` · ${stateLabel(shown.export)}`
  $(".cal-part-name").textContent = part ? `${part.name}${shownState}` : "No part selected"
  $(".cal-part-file").textContent = part ? (part.note ?? part.file) : ""
  const devices = $(".cal-devices")
  devices.replaceChildren(...DEVICES.map(device =>
    h("button", {
      type: "button",
      role: "radio",
      "aria-checked": device.id === state.device.id ? "true" : "false",
      onClick: () => selectDevice(device),
    }, device.name)))
  $(".cal-calibrate").setAttribute("aria-pressed", String(state.calibrating))
  $(".cal-calibrate").classList.toggle("cal-attention", !state.calibrated)
}

/**
 * @param {Part} part
 * @param {string} exportName
 */
function frameSrc(part, exportName) {
  return `frame?part=${encodeURIComponent(part.file)}&state=${encodeURIComponent(exportName)}`
}

function renderFrame() {
  const part = currentPart()
  const shown = effectiveShown()
  const figure = $(".cal-device")
  const grid = $(".cal-grid")
  const empty = $(".cal-empty")
  figure.hidden = part === null || shown._tag === "All"
  grid.hidden = part === null || shown._tag === "One"
  empty.hidden = part !== null
  if (part === null) {
    empty.textContent = currentProject()?.parts.length ? "Pick a part from the list." : ""
    frame.removeAttribute("src")
    $(".cal-grid-cells").replaceChildren()
    return
  }
  if (shown._tag === "All") {
    frame.removeAttribute("src")
    return renderGridCells(part)
  }
  $(".cal-grid-cells").replaceChildren()
  const src = frameSrc(part, shown.export)
  if (frame.getAttribute("src") === src) return
  figure.dataset.frameState = "Loading"
  frame.setAttribute("src", src)
}

/**
 * One labelled frame for each state of the part. Frames that already show the
 * right state stay, so a new state does not reload the others.
 *
 * @param {Part} part
 */
function renderGridCells(part) {
  const cells = $(".cal-grid-cells")
  /** @type {Map<string, HTMLElement>} */
  const existing = new Map()
  for (const cell of cells.querySelectorAll("figure")) {
    const src = cell.querySelector("iframe")?.getAttribute("src")
    if (src) existing.set(src, /** @type {HTMLElement} */ (cell))
  }
  cells.replaceChildren(...part.states.map(partState => {
    const src = frameSrc(part, partState.export)
    const kept = existing.get(src)
    const label = h("button", {
      type: "button",
      class: "cal-cell-label",
      title: `Show ${partState.label} alone · ${stateSite(part, partState)}`,
      onClick: () => selectShown({ _tag: "One", export: partState.export }),
    }, partState.label)
    if (kept) {
      kept.querySelector(".cal-cell-label")?.replaceWith(label)
      return kept
    }
    return h("figure", { class: "cal-cell", "data-state": partState.export, "data-frame-state": "Loading" },
      h("figcaption", {}, label),
      h("div", { class: "cal-screen" },
        h("iframe", { class: "cal-frame", title: `${part.name}: ${partState.label}`, src })))
  }))
  sizeGrid()
}

/** Size the grid's frames and columns to the stage. */
function sizeGrid() {
  const device = state.device
  const cells = [.../** @type {NodeListOf<HTMLElement>} */ ($(".cal-grid-cells").querySelectorAll(".cal-cell"))]
  const grid = gridGeometry(device, state.pxPerMm, {
    width: stage.clientWidth - (STAGE_PADDING + RING) * 2,
    height: stage.clientHeight - (STAGE_PADDING + RING) * 2 - CAPTION_RESERVE,
  }, Math.max(cells.length, 1), { gap: GRID_GAP + RING * 2, caption: GRID_LABEL })
  const { frame: geometry } = grid
  $(".cal-grid-cells").style.gridTemplateColumns = `repeat(${grid.columns}, ${geometry.width}px)`
  $(".cal-grid-cells").style.gap = `${GRID_GAP + RING * 2}px`
  for (const cell of cells) {
    const screen = /** @type {HTMLElement} */ (cell.querySelector(".cal-screen"))
    const iframe = /** @type {HTMLElement} */ (cell.querySelector("iframe"))
    screen.style.width = `${geometry.width}px`
    screen.style.height = `${geometry.height}px`
    iframe.style.width = `${device.cssWidth}px`
    iframe.style.height = `${device.cssHeight}px`
    iframe.style.transform = `scale(${geometry.scale})`
  }
  $(".cal-grid-caption").replaceChildren(...captionFor(device, geometry.fit, `${cells.length} states side by side, each`))
}

/**
 * The size line under a frame: the device, and whether the frame is true size.
 *
 * @param {Device} device
 * @param {import("./device-frame.js").Fit} fit
 * @param {string} [lead]
 */
function captionFor(device, fit, lead) {
  const size = `${lead ? `${lead} ` : ""}${device.name} · ${device.widthMm} mm wide · ${device.cssWidth} × ${device.cssHeight} CSS px`
  const note = fit._tag === "TrueSize"
    ? h("span", { class: state.calibrated ? "cal-fit-true" : "cal-fit-warn" },
      state.calibrated ? "True size" : "True size only after calibration (now assumes 96 px per inch)")
    : h("span", { class: "cal-fit-warn" }, `Scaled to ${fit.percent}%: the window is too small for true size`)
  return [h("span", { title: device.viewportNote }, size), " · ", note]
}

function renderStage() {
  if (effectiveShown()._tag === "All") return sizeGrid()
  const device = state.device
  const room = {
    width: stage.clientWidth - (STAGE_PADDING + RING) * 2,
    height: stage.clientHeight - (STAGE_PADDING + RING) * 2 - CAPTION_RESERVE,
  }
  const geometry = frameGeometry(device, state.pxPerMm, room)
  const screen = $(".cal-screen")
  screen.style.width = `${geometry.width}px`
  screen.style.height = `${geometry.height}px`
  frame.style.width = `${device.cssWidth}px`
  frame.style.height = `${device.cssHeight}px`
  frame.style.transform = `scale(${geometry.scale})`

  $(".cal-device .cal-caption").replaceChildren(...captionFor(device, geometry.fit))
}

function renderCalibration() {
  const panel = $(".cal-calibration")
  panel.hidden = !state.calibrating
  const card = $(".cal-card")
  card.style.width = `${CARD.widthMm * state.pxPerMm}px`
  card.style.height = `${CARD.heightMm * state.pxPerMm}px`
  const input = /** @type {HTMLInputElement} */ ($(".cal-scale-input"))
  input.value = String(state.pxPerMm)
  $(".cal-scale-value").textContent = `${state.pxPerMm.toFixed(2)} px/mm · ${Math.round(state.pxPerMm * 25.4)} px/in`
}

function renderProblems() {
  const section = $(".cal-problems")
  section.replaceChildren()
  const shown = effectiveShown()
  const part = currentPart()
  const exports = shown._tag === "One" ? [shown.export] : part?.states.map(partState => partState.export) ?? []
  for (const exportName of exports) {
    const report = state.reports.get(exportName)
    if (!report || report.part !== state.part) continue
    // In the grid, say which state each problem belongs to.
    const prefix = shown._tag === "All" ? `${stateLabel(exportName)}: ` : ""
    for (const problem of report.problems) {
      section.append(h("div", { class: `cal-problem cal-problem-${problem.kind}`, role: problem.kind === "error" ? "alert" : "status" },
        h("strong", {}, `${prefix}${problem.title}`),
        problem.detail ? h("pre", {}, problem.detail) : null))
    }
  }
}

function renderSetup() {
  const project = currentProject()
  const body = $(".cal-setup-body")
  body.replaceChildren()
  if (!project) return
  const derivations = [project.entry, project.css, project.wrapper]
  const failures = derivations.filter(derivation => derivation._tag === "Failed").length
  const details = /** @type {HTMLDetailsElement} */ ($(".cal-setup"))
  $(".cal-setup summary").textContent = failures
    ? `Setup · ${failures} not found`
    : "Setup · entry, CSS and wrapper found"
  details.classList.toggle("cal-setup-failed", failures > 0)
  if (failures > 0) details.open = true

  body.append(
    setupRow("Entry", project.entry, entry => [h("code", {}, entry.file)]),
    setupRow("Global CSS", project.css, css => [
      css.stylesheets.length === 0
        ? h("span", {}, "No stylesheet is imported for its side effect.")
        : h("ol", {}, ...css.stylesheets.map(sheet =>
          h("li", {}, h("code", {}, sheet.file), h("span", { class: "cal-site" }, ` from ${site(sheet.importedAt)}`)))),
      css.unresolved.length === 0
        ? null
        : h("details", { class: "cal-unresolved" },
          h("summary", {}, `${css.unresolved.length} imports did not resolve`),
          h("ul", {}, ...css.unresolved.map(miss => h("li", {}, h("code", {}, miss.specifier), ` at ${site(miss.at)}`)))),
    ]),
    setupRow("Wrapper", project.wrapper, wrapper => [
      wrapper.elements.length === 0
        ? h("span", {}, "None: parts render straight into the page.")
        : h("code", {}, wrapper.elements.map(element => `<${element.tag}${element.className ? ` class="${element.className}"` : ""}>`).join("")),
      wrapper.renderedAt ? h("span", { class: "cal-site" }, `App rendered at ${site(wrapper.renderedAt)}`) : null,
    ]),
  )
}

/**
 * @template A
 * @param {string} label
 * @param {import("../types").Derivation<A>} derivation
 * @param {(value: A) => Array<Node | null>} show
 */
function setupRow(label, derivation, show) {
  const row = h("section", { class: `cal-derivation cal-derivation-${derivation._tag.toLowerCase()}` }, h("h3", {}, label))
  switch (derivation._tag) {
    case "Derived":
      row.append(...show(derivation.value).filter(node => node !== null),
        h("p", { class: "cal-site" }, `Found at ${site(derivation.source)}: ${derivation.via}`))
      break
    case "Overridden":
      row.append(...show(derivation.value).filter(node => node !== null),
        h("p", { class: "cal-site" }, `Set by caliper({ ${derivation.option} }) in vite.config`))
      break
    case "Failed":
      row.append(h("p", {}, derivation.reason), h("p", { class: "cal-site" }, derivation.hint))
      break
  }
  return row
}

/** @param {SourceSite} source */
function site(source) {
  return `${source.file}:${source.line}`
}

// --------------------------------------------------------------------- inputs

/** @param {Project} project */
function setupKey(project) {
  return JSON.stringify([project.css, project.wrapper])
}

function connect() {
  const events = new EventSource("events")
  events.addEventListener("project", message => {
    /** @type {Project} */
    const project = JSON.parse(/** @type {MessageEvent<string>} */ (message).data)
    const before = currentProject()
    state.connection = { _tag: "Ready", project }
    if (state.part === null || !project.parts.some(part => part.file === state.part)) {
      state.part = project.parts[0]?.file ?? null
      if (state.shown._tag === "One") state.shown = { _tag: "One", export: DEFAULT_STATE }
      saveLocation()
    }
    // A save can remove the shown state. Fall back to the default export.
    const shown = state.shown
    if (shown._tag === "One" && !currentPart()?.states.some(partState => partState.export === shown.export)) {
      state.shown = { _tag: "One", export: DEFAULT_STATE }
      saveLocation()
    }
    renderParts()
    renderSetup()
    renderBar()
    renderFrame()
    renderStage()
    // The frame reloads itself when a part changes. A change to the global CSS
    // list or the wrapper changes the frame page, so reload it here.
    if (before && setupKey(before) !== setupKey(project)) {
      for (const iframe of stage.querySelectorAll("iframe[src]")) /** @type {HTMLIFrameElement} */ (iframe).contentWindow?.location.reload()
    }
  })
  events.addEventListener("error", () => {
    state.connection = { _tag: "Unreachable", project: currentProject() }
    renderParts()
  })
}

window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.data?.source !== "caliper-frame") return
  const sender = [...stage.querySelectorAll("iframe")].find(iframe => iframe.contentWindow === event.source)
  const figure = sender?.closest("figure")
  if (figure instanceof HTMLElement) figure.dataset.frameState = event.data.state
  state.reports.set(event.data.partState, { part: event.data.part, partState: event.data.partState, state: event.data.state, problems: event.data.problems })
  renderProblems()
})

new ResizeObserver(() => renderStage()).observe(stage)
renderParts()
renderBar()
renderCalibration()
renderStage()
connect()
