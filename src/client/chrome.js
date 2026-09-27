// @ts-check
import { CARD, DEFAULT_PX_PER_MM, DEVICES, frameGeometry, gridGeometry } from "./device-frame.js"
import { createIntegrationPanel } from "./integration-review.js"

const integrationPanel = createIntegrationPanel()
/** @param {TakeView} take */
const takeName = take => take.name ?? take.direction?.title ?? `Take ${take.take}`

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
 * @typedef {{ part: string, partState: string, take: string | null, state: "Loading" | "Rendered" | "Empty" | "Failed", problems: Problem[] }} FrameReport
 * @typedef {{ _tag: "One", export: string } | { _tag: "All" } | { _tag: "Takes", export: string }} Shown
 *   `One` shows one state of the part. `All` shows every state side by side.
 *   `Takes` shows one state of the original next to each take of the part.
 * @typedef {import("../types").TakesSnapshot} TakesSnapshot
 * @typedef {import("../types").TakeView} TakeView
 * @typedef {import("../types").Direction} Direction
 * @typedef {{ part: string, state: string, device: string, prompt: string }} TakeAsk
 * @typedef {{ _tag: "None" }
 *   | { _tag: "Planning", ask: TakeAsk, count: number, id: number }
 *   | { _tag: "Review", ask: TakeAsk, directions: Array<{ title: string, brief: string }>, note?: string }} Plan
 *   The composer's plan. Several takes start from a plan: the planner proposes
 *   one direction per take, and you edit them before the takes start.
 * @typedef {{ key: string, label: string, title: string, src: string, select: () => void, status?: string }} Cell
 *   One labelled frame in the grid.
 */

const STORAGE_PX_PER_MM = "caliper:px-per-mm"
const STORAGE_DEVICE = "caliper:device"
const STORAGE_TAKES_OPEN = "caliper:takes-open"
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
/** The `state` prefix in the URL that compares takes, for example `takes:default`. */
const TAKES_PREFIX = "takes:"
/** The most takes one prompt starts at once. */
const MAX_PARALLEL = 4

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
  /** What each frame last reported, by `reportKey`. @type {Map<string, FrameReport>} */
  reports: new Map(),
  /** @type {TakesSnapshot | null} */
  takes: null,
  /** The take whose conversation the panel shows. @type {string | null} */
  take: saved.get("take"),
  /** How many takes the next prompt starts. */
  parallel: 1,
  /** A request to the takes API is on its way. */
  sending: false,
  /** The last takes API error, shown in the panel. @type {string | null} */
  takeError: null,
  /** @type {Plan} */
  plan: { _tag: "None" },
  /** Whether the Takes panel is open. null: not chosen yet, so it follows the agent. @type {boolean | null} */
  takesOpen: localStorage.getItem(STORAGE_TAKES_OPEN) === null ? null : localStorage.getItem(STORAGE_TAKES_OPEN) === "true",
}

/**
 * @param {string | null} take
 * @param {string} partState
 */
function reportKey(take, partState) {
  return `${take ?? ""}|${partState}`
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
        h("button", { class: "cal-calibrate", type: "button", onClick: () => setCalibrating(!state.calibrating) }, "Calibrate"),
        h("button", { class: "cal-takes-toggle", type: "button", "aria-controls": "cal-takes", onClick: () => setTakesOpen(!takesOpen()) }, "Takes")),
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
      h("section", { class: "cal-problems", "aria-live": "polite" })),
    h("aside", { class: "cal-takes", id: "cal-takes", "aria-label": "Takes" },
      h("header", { class: "cal-takes-head" },
        h("h2", {}, "Takes"),
        h("p", { class: "cal-agent" })),
      h("div", { class: "cal-take-list", role: "list" }),
      h("div", { class: "cal-log", "aria-live": "polite" }),
      h("form", {
        class: "cal-composer",
        onSubmit: event => {
          event.preventDefault()
          void startTakes()
        },
      },
        h("div", { class: "cal-plan", "aria-live": "polite" }),
        h("textarea", {
          class: "cal-prompt",
          rows: "3",
          placeholder: "Describe a change to this part",
          "aria-label": "Prompt",
          onKeydown: event => {
            const key = /** @type {KeyboardEvent} */ (event)
            if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) {
              key.preventDefault()
              void (key.shiftKey ? followTake() : startTakes())
            }
          },
          onInput: () => renderComposer(),
        }),
        h("p", { class: "cal-composer-note" }),
        h("div", { class: "cal-composer-actions" },
          h("label", { class: "cal-parallel" },
            h("span", {}, "Takes"),
            h("select", {
              "aria-label": "How many takes to start",
              onChange: event => {
                state.parallel = Number(/** @type {HTMLSelectElement} */ (event.target).value)
                renderComposer()
              },
            }, ...Array.from({ length: MAX_PARALLEL }, (_, index) => h("option", { value: String(index + 1) }, String(index + 1))))),
          h("button", { type: "button", class: "cal-follow", onClick: () => void followTake() }),
          h("button", { type: "button", class: "cal-plan-back", onClick: () => closePlan() }, "Back"),
          h("button", { type: "submit", class: "cal-primary cal-start" }, "New take"))))))

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
  if (value?.startsWith(TAKES_PREFIX)) return { _tag: "Takes", export: value.slice(TAKES_PREFIX.length) || DEFAULT_STATE }
  return { _tag: "One", export: value ?? DEFAULT_STATE }
}

/** The takes of the selected part, oldest first. @returns {TakeView[]} */
function partTakes() {
  return state.takes?.takes.filter(take => take.part === state.part) ?? []
}

/** The take whose conversation the panel shows, when it belongs to the selected part. */
function currentTake() {
  return partTakes().find(take => take.take === state.take) ?? null
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
  if (state.shown._tag === "Takes" && partTakes().length === 0) return { _tag: "One", export: state.shown.export }
  return state.shown
}

function saveLocation() {
  const params = new URLSearchParams()
  if (state.part) params.set("part", state.part)
  if (state.shown._tag === "All") params.set("state", ALL_STATES)
  else if (state.shown._tag === "Takes") params.set("state", `${TAKES_PREFIX}${state.shown.export}`)
  else if (state.shown.export !== DEFAULT_STATE) params.set("state", state.shown.export)
  params.set("device", state.device.id)
  if (state.take) params.set("take", state.take)
  history.replaceState(null, "", `#${params}`)
}

/** @param {string} file */
function selectPart(file) {
  if (state.part === file) return
  state.part = file
  state.take = null
  // Keep comparing states, or takes, when you move to another part.
  if (state.shown._tag !== "All") state.shown = { _tag: state.shown._tag, export: DEFAULT_STATE }
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
  renderTakes()
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
      const takes = part.file === state.part ? partTakes().length : 0
      if (part.file === state.part && (part.states.length > 1 || takes > 0)) list.append(stateList(part))
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
  const takes = partTakes().length
  const current = shown._tag === "All" ? null : shown.export
  return h("div", { class: "cal-states", role: "group", "aria-label": `${part.name} states` },
    takes > 0
      ? h("button", {
        type: "button",
        class: "cal-state cal-state-all",
        "aria-current": shown._tag === "Takes" ? "true" : false,
        title: "The original next to each take",
        "data-state": TAKES_PREFIX,
        onClick: () => selectShown({ _tag: "Takes", export: current ?? DEFAULT_STATE }),
      }, `Compare ${takes} ${takes === 1 ? "take" : "takes"}`)
      : null,
    part.states.length > 1
      ? h("button", {
        type: "button",
        class: "cal-state cal-state-all",
        "aria-current": shown._tag === "All" ? "true" : false,
        title: "Every state side by side",
        "data-state": ALL_STATES,
        onClick: () => selectShown({ _tag: "All" }),
      }, `All ${part.states.length} states`)
      : null,
    ...(part.states.length > 1 ? part.states : []).map(partState => h("button", {
      type: "button",
      class: "cal-state",
      "aria-current": shown._tag !== "All" && partState.export === shown.export ? "true" : false,
      title: stateSite(part, partState),
      "data-state": partState.export,
      // In the takes view, a state picks what every frame shows.
      onClick: () => selectShown({ _tag: shown._tag === "Takes" ? "Takes" : "One", export: partState.export }),
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
  const takes = partTakes().length
  const shownState = !part ? ""
    : shown._tag === "All" ? ` · All ${part.states.length} states`
    : shown._tag === "Takes" ? `${part.states.length > 1 ? ` · ${stateLabel(shown.export)}` : ""} · original and ${takes} ${takes === 1 ? "take" : "takes"}`
    : part.states.length === 1 ? ""
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
 * @param {Pick<Part, 'file'>} part
 * @param {string} exportName
 * @param {string | null} [take]
 */
function frameSrc(part, exportName, take = null) {
  return `frame?part=${encodeURIComponent(part.file)}&state=${encodeURIComponent(exportName)}${take ? `&take=${take}` : ""}`
}

function renderFrame() {
  const part = currentPart()
  const shown = effectiveShown()
  const figure = $(".cal-device")
  const grid = $(".cal-grid")
  const empty = $(".cal-empty")
  figure.hidden = part === null || shown._tag !== "One"
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
    return renderGridCells(part.states.map(partState => ({
      key: partState.export,
      label: partState.label,
      title: `Show ${partState.label} alone · ${stateSite(part, partState)}`,
      src: frameSrc(part, partState.export),
      select: () => selectShown({ _tag: "One", export: partState.export }),
    })), `${part.states.length} states side by side, each`)
  }
  if (shown._tag === "Takes") {
    frame.removeAttribute("src")
    return renderGridCells([
      {
        key: "original",
        label: "Original",
        title: "The real files · show alone",
        src: frameSrc(part, shown.export),
        select: () => selectShown({ _tag: "One", export: shown.export }),
      },
      ...partTakes().map(take => ({
        key: `take-${take.take}`,
        label: `${takeName(take)}${take.run._tag === "Running" ? " · working" : take.run._tag === "Failed" ? " · failed" : ""}`,
        title: take.files.length ? `Changes ${take.files.join(", ")}` : "No changes yet",
        src: take.integration?._tag === "Review"
          ? frameSrc({ file: take.integration.proposal.preview.part }, take.integration.proposal.preview.state, take.take)
          : frameSrc(part, shown.export, take.take),
        status: take.run._tag,
        select: () => selectTake(take.take),
      })),
    ], `The original and ${partTakes().length} ${partTakes().length === 1 ? "take" : "takes"}, each`)
  }
  $(".cal-grid-cells").replaceChildren()
  const src = frameSrc(part, shown.export)
  if (frame.getAttribute("src") === src) return
  figure.dataset.frameState = "Loading"
  frame.setAttribute("src", src)
}

/**
 * One labelled frame for each cell. Frames that already show the right page
 * stay, so a new cell does not reload the others.
 *
 * @param {Cell[]} wanted
 * @param {string} lead the caption's first words
 */
function renderGridCells(wanted, lead) {
  const cells = $(".cal-grid-cells")
  cells.dataset.lead = lead
  /** @type {Map<string, HTMLElement>} */
  const existing = new Map()
  for (const cell of cells.querySelectorAll("figure")) {
    const src = cell.querySelector("iframe")?.getAttribute("src")
    if (src) existing.set(src, /** @type {HTMLElement} */ (cell))
  }
  cells.replaceChildren(...wanted.map(want => {
    const kept = existing.get(want.src)
    const label = h("button", {
      type: "button",
      class: "cal-cell-label",
      title: want.title,
      "aria-current": want.key === `take-${state.take}` ? "true" : false,
      onClick: () => want.select(),
    }, want.label)
    const cell = kept ?? h("figure", { class: "cal-cell", "data-frame-state": "Loading" },
      h("figcaption", {}, label),
      h("div", { class: "cal-screen" },
        h("iframe", { class: "cal-frame", title: want.label, src: want.src })))
    if (kept) kept.querySelector(".cal-cell-label")?.replaceWith(label)
    cell.dataset.key = want.key
    if (want.status) cell.dataset.run = want.status
    else delete cell.dataset.run
    return cell
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
  $(".cal-grid-caption").replaceChildren(...captionFor(device, geometry.fit, $(".cal-grid-cells").dataset.lead))
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
  if (effectiveShown()._tag !== "One") return sizeGrid()
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
  /** @type {Array<{ key: string, prefix: string }>} */
  const sources = shown._tag === "One"
    ? [{ key: reportKey(null, shown.export), prefix: "" }]
    : shown._tag === "Takes"
      ? [{ key: reportKey(null, shown.export), prefix: "Original: " }, ...partTakes().map(take => ({ key: reportKey(take.take, shown.export), prefix: `Take ${take.take}: ` }))]
      // In the grid, say which state each problem belongs to.
      : part?.states.map(partState => ({ key: reportKey(null, partState.export), prefix: `${partState.label}: ` })) ?? []
  for (const { key, prefix } of sources) {
    const report = state.reports.get(key)
    if (!report || report.part !== state.part) continue
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
        ? h("span", {}, "No global stylesheets injected. Components load their own CSS.")
        : h("ol", {}, ...css.stylesheets.map(sheet =>
          h("li", {}, h("code", {}, sheet.file), h("span", { class: "cal-site" }, sheet.importedAt ? ` from ${site(sheet.importedAt)}` : " from caliper({ css })")))),
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

// ------------------------------------------------------------------- takes

/** What each take looked like last time, to know when its frames must reload. @type {Map<string, string>} */
const takeSignatures = new Map()

/** @param {TakesSnapshot} snapshot */
function takesArrived(snapshot) {
  const before = state.takes
  state.takes = snapshot
  // A take frame keeps the files it loaded. Reload it when the take's files
  // change, and when its agent finishes, so it shows the take as it ends.
  for (const take of snapshot.takes) {
    const signature = `${take.files.join(",")}|${take.run._tag}`
    const previous = takeSignatures.get(take.take)
    takeSignatures.set(take.take, signature)
    if (previous === undefined) continue
    const [files, run] = previous.split("|")
    if (files !== take.files.join(",") || (run === "Running" && take.run._tag !== "Running")) reloadTakeFrames(take.take)
  }
  const countBefore = before?.takes.filter(take => take.part === state.part).length ?? 0
  const shapeChanged = countBefore !== partTakes().length
    || JSON.stringify(before?.takes.map(take => [take.take, take.run._tag])) !== JSON.stringify(snapshot.takes.map(take => [take.take, take.run._tag]))
  if (state.take !== null && !snapshot.takes.some(take => take.take === state.take)) {
    state.take = null
    saveLocation()
  }
  if (shapeChanged) {
    renderParts()
    renderBar()
    renderFrame()
    renderStage()
  }
  renderTakes()
}

/** @param {string} take */
function reloadTakeFrames(take) {
  for (const iframe of stage.querySelectorAll("iframe[src]")) {
    const src = iframe.getAttribute("src") ?? ""
    if (new URLSearchParams(src.slice(src.indexOf("?"))).get("take") === take) {
      /** @type {HTMLIFrameElement} */ (iframe).contentWindow?.location.reload()
    }
  }
}

/** @param {string} take */
function selectTake(take) {
  state.take = take
  const shown = effectiveShown()
  if (shown._tag !== "Takes") state.shown = { _tag: "Takes", export: shown._tag === "One" ? shown.export : DEFAULT_STATE }
  showChanged()
}

/**
 * @param {string} path below /__caliper
 * @param {object} body
 * @returns {Promise<any>}
 */
async function postTakes(path, body = {}) {
  state.sending = true
  state.takeError = null
  renderComposer()
  try {
    const response = await fetch(path.replace(/^\//, ""), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
    return result
  } catch (error) {
    state.takeError = error instanceof Error ? error.message : String(error)
    return null
  } finally {
    state.sending = false
    renderTakes()
  }
}

function promptBox() {
  return /** @type {HTMLTextAreaElement} */ ($(".cal-prompt"))
}

/** Start as many takes as the composer asks for, all with the same prompt. */
async function startTakes() {
  if (state.sending) return
  if (state.plan._tag === "Review") return startPlan(state.plan)
  if (state.plan._tag === "Planning") return
  const part = currentPart()
  const prompt = promptBox().value.trim()
  if (!part || !prompt) return
  const shown = effectiveShown()
  const ask = { part: part.file, state: shown._tag === "All" ? DEFAULT_STATE : shown.export, device: state.device.id, prompt }
  if (state.parallel === 1) return launch(ask, [undefined])
  // Several takes: ask the planner for one different direction per take first.
  const id = Date.now()
  state.plan = { _tag: "Planning", ask, count: state.parallel, id }
  renderComposer()
  const plan = await postTakes("/takes/plan", { ...ask, count: state.parallel })
  // Cancelled, or replaced by a newer plan, while the planner worked.
  if (state.plan._tag !== "Planning" || state.plan.id !== id) return
  state.plan = plan === null
    ? { _tag: "None" }
    : { _tag: "Review", ask, directions: plan.directions.map((/** @type {Direction} */ direction) => ({ ...direction })), ...(plan.note ? { note: plan.note } : {}) }
  renderComposer()
}

/** @param {Extract<Plan, { _tag: "Review" }>} plan */
async function startPlan(plan) {
  const directions = plan.directions.filter(direction => direction.title.trim() !== "" && direction.brief.trim() !== "")
  if (directions.length === 0) return
  await launch(plan.ask, directions)
}

/**
 * Start one take for each direction, or one take with none.
 *
 * @param {TakeAsk} ask
 * @param {Array<Direction | undefined>} directions
 */
async function launch(ask, directions) {
  const titles = directions.flatMap(direction => (direction ? [direction.title.trim()] : []))
  const results = await Promise.all(directions.map(direction => postTakes("/takes", direction === undefined
    ? ask
    : { ...ask, direction, others: titles.filter(title => title !== direction.title.trim()) })))
  const started = results.filter(Boolean).map(result => /** @type {string} */ (result.take))
  if (started.length === 0) return
  promptBox().value = ""
  state.plan = { _tag: "None" }
  state.take = started[0] ?? null
  state.shown = { _tag: "Takes", export: ask.state }
  showChanged()
}

/** Leave the plan. The prompt stays, so you can change it and plan again. */
function closePlan() {
  state.plan = { _tag: "None" }
  renderComposer()
}

/** Send the prompt to the selected take's agent. */
async function followTake() {
  const take = currentTake()
  const prompt = promptBox().value.trim()
  if (!take || !prompt || state.sending) return
  if (await postTakes(`/takes/${take.take}/prompt`, { prompt })) {
    promptBox().value = ""
    renderComposer()
  }
}

/** @param {TakeView} take */
async function acceptTake(take) {
  const files = take.files.join("\n")
  if (!confirm(`Replace the real files with ${takeName(take)} (take ${take.take})?\n\n${files}`)) return
  await postTakes(`/takes/${take.take}/accept`)
}

/** @param {TakeView} take */
async function prepareAlternate(take) {
  if (state.sending) return
  const result = await postTakes(`/takes/${take.take}/alternate`)
  if (result) selectTake(result.take)
}

/** @param {TakeView} take */
async function discardTake(take) {
  if (take.files.length > 0 && !confirm(`Throw away take ${take.take} and its changes to ${take.files.length} ${take.files.length === 1 ? "file" : "files"}?`)) return
  await postTakes(`/takes/${take.take}/discard`)
}

/**
 * The panel is open when you opened it. Until you choose, it is open when an
 * agent is set up or a take exists, so a viewer-only project keeps the room.
 */
function takesOpen() {
  return state.takesOpen ?? (state.takes?.agent._tag !== "Off" || (state.takes?.takes.length ?? 0) > 0)
}

/** @param {boolean} open */
function setTakesOpen(open) {
  state.takesOpen = open
  localStorage.setItem(STORAGE_TAKES_OPEN, String(open))
  renderTakes()
  renderStage()
}

function renderTakes() {
  const open = takesOpen()
  $(".cal").classList.toggle("cal-takes-closed", !open)
  $(".cal-takes").hidden = !open
  const toggle = $(".cal-takes-toggle")
  toggle.setAttribute("aria-expanded", String(open))
  const running = state.takes?.takes.filter(take => take.run._tag === "Running").length ?? 0
  toggle.textContent = running > 0 ? `Takes · ${running} working` : "Takes"
  renderAgent()
  renderTakeList()
  renderLog()
  renderComposer()
}

function renderAgent() {
  const line = $(".cal-agent")
  const agent = state.takes?.agent
  line.className = "cal-agent"
  if (!agent) {
    line.textContent = "Connecting…"
    return
  }
  if (agent._tag === "Ready") {
    line.textContent = `${agent.model} · reasoning ${agent.reasoning}`
    line.title = `${agent.baseUrl} (${agent.api}) from ${agent.baseUrlFrom}. Key from ${agent.keyFrom}.`
    return
  }
  line.classList.add(agent._tag === "Failed" ? "cal-agent-failed" : "cal-agent-off")
  line.textContent = agent._tag === "Failed" ? `${agent.reason} ${agent.hint}` : agent.hint
  line.title = ""
}

function renderTakeList() {
  const list = $(".cal-take-list")
  const takes = partTakes()
  if (takes.length === 0) {
    list.replaceChildren(h("p", { class: "cal-note" }, currentPart() ? `No takes of ${currentPart()?.name} yet.` : ""))
    return
  }
  list.replaceChildren(...takes.map(take => {
    const running = take.run._tag === "Running"
    const status = running ? "Working" : take.run._tag === "Failed" ? "Failed" : take.files.length ? `${take.files.length} ${take.files.length === 1 ? "file" : "files"}` : "No changes"
    return h("div", { class: "cal-take", role: "listitem", "data-run": take.run._tag, "aria-current": take.take === state.take ? "true" : false },
      h("button", {
        type: "button",
        class: "cal-take-name",
        title: [takeName(take), take.direction?.brief, take.files.join("\n") || "No changes yet"].filter(Boolean).join("\n\n"),
        onClick: () => selectTake(take.take),
      },
        h("strong", {}, takeName(take)), " ", h("span", { class: "cal-take-status" }, status),
        h("span", { class: "cal-take-direction" }, `Take ${take.take}${take.integration ? " · alternate proposal" : ""}`)),
      ...(take.nameIssue ? [h("p", { class: "cal-note" }, take.nameIssue)] : []),
      h("div", { class: "cal-take-actions" },
        running
          ? h("button", { type: "button", onClick: () => void postTakes(`/takes/${take.take}/stop`) }, "Stop")
          : take.integration
            ? h("button", { type: "button", onClick: () => selectTake(take.take) }, "Review alternate")
            : h("button", { type: "button", class: "cal-accept", disabled: take.files.length === 0 || state.sending, onClick: () => void acceptTake(take) }, "Replace"),
        ...(!running && !take.integration ? [h("button", { type: "button", disabled: take.files.length === 0 || state.sending || state.takes?.agent._tag !== "Ready", onClick: () => void prepareAlternate(take) }, "Add an alternate")] : []),
        h("button", { type: "button", onClick: () => void discardTake(take) }, "Discard")))
  }))
}

function renderLog() {
  const log = $(".cal-log")
  const take = currentTake()
  const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 24
  if (!take) {
    log.replaceChildren()
    return
  }
  // A streaming reply starts empty; it shows once it has words.
  const entries = take.log.filter(entry => entry._tag !== "Assistant" || entry.text !== "")
  log.replaceChildren(
    h("p", { class: "cal-log-title" }, `${takeName(take)} · Take ${take.take} · asked on ${take.device}, state ${take.state}`),
    ...(take.integration ? [integrationPanel(take)] : []),
    ...(take.direction ? [h("div", { class: "cal-log-direction" }, h("strong", {}, take.direction.title), " ", take.direction.brief)] : []),
    ...entries.map(entry => {
      if (entry._tag === "User") return h("div", { class: "cal-log-user" }, entry.text)
      if (entry._tag === "Assistant") return h("div", { class: "cal-log-assistant" }, entry.text)
      return h("div", { class: "cal-log-tool", "data-outcome": entry.outcome, title: entry.detail },
        h("span", { class: "cal-log-tool-name" }, entry.name), " ", h("code", {}, entry.subject),
        entry.detail && entry.outcome !== "Running" ? h("span", { class: "cal-log-tool-detail" }, entry.detail) : null)
    }),
    ...(take.run._tag === "Failed" ? [h("div", { class: "cal-problem cal-problem-error", role: "alert" }, take.run.reason)] : []),
    ...(take.log.length === 0 ? [h("p", { class: "cal-note" }, "This take has no conversation since Vite started. Send a prompt to go on.")] : []),
  )
  if (pinned) log.scrollTop = log.scrollHeight
}

function renderComposer() {
  const agent = state.takes?.agent
  const ready = agent?._tag === "Ready"
  const part = currentPart()
  const take = currentTake()
  const text = promptBox().value.trim()
  const start = /** @type {HTMLButtonElement} */ ($(".cal-start"))
  const follow = /** @type {HTMLButtonElement} */ ($(".cal-follow"))
  const back = /** @type {HTMLButtonElement} */ ($(".cal-plan-back"))
  const plan = state.plan
  const planning = plan._tag !== "None"
  const reviewed = plan._tag === "Review" ? plan.directions.filter(direction => direction.title.trim() && direction.brief.trim()).length : 0
  promptBox().disabled = !ready || planning
  $(".cal-parallel").hidden = planning
  back.hidden = !planning
  back.textContent = plan._tag === "Planning" ? "Cancel" : "Back"
  start.disabled = plan._tag === "Planning" || state.sending || (plan._tag === "Review" ? reviewed === 0 : !ready || !part || !text)
  start.textContent = plan._tag === "Planning" ? "Planning…"
    : plan._tag === "Review" ? `Start ${reviewed} ${reviewed === 1 ? "take" : "takes"}`
    : state.parallel === 1 ? "New take" : `Plan ${state.parallel} takes`
  follow.hidden = take === null || planning
  follow.disabled = !ready || !text || state.sending || take?.run._tag === "Running"
  follow.textContent = take ? `Send to take ${take.take}` : ""
  const note = $(".cal-composer-note")
  note.className = state.takeError ? "cal-composer-note cal-agent-failed" : "cal-composer-note"
  note.textContent = state.takeError
    ?? (plan._tag === "Planning" ? `Asking ${state.takes?.agent._tag === "Ready" ? state.takes.agent.model : "the model"} for ${plan.count} different directions…`
      : plan._tag === "Review" ? "Edit or remove directions. Each take follows one, and knows what the others try."
      : ready && part ? `${part.name} on ${state.device.name}. ${state.parallel === 1 ? "Ctrl+Enter starts a take" : "Ctrl+Enter plans the takes"}${take ? `; Ctrl+Shift+Enter sends to take ${take.take}` : ""}.`
      : "")
  renderPlan()
}

/**
 * The plan's directions, as editable rows. Rebuilt only when the plan
 * changes shape, so typing in a row keeps its focus.
 */
function renderPlan() {
  const box = $(".cal-plan")
  const plan = state.plan
  const shape = plan._tag === "Review" ? `Review:${plan.directions.length}:${plan.note ?? ""}` : plan._tag
  if (box.dataset.shape === shape) return
  box.dataset.shape = shape
  if (plan._tag !== "Review") {
    box.replaceChildren()
    return
  }
  box.replaceChildren(
    h("p", { class: "cal-plan-prompt" }, plan.ask.prompt),
    ...(plan.note ? [h("p", { class: "cal-plan-note" }, plan.note)] : []),
    ...plan.directions.map((direction, index) => h("div", { class: "cal-direction" },
      h("input", {
        class: "cal-direction-title",
        value: direction.title,
        "aria-label": `Direction ${index + 1} title`,
        onInput: event => {
          direction.title = /** @type {HTMLInputElement} */ (event.target).value
          renderComposer()
        },
      }),
      h("button", {
        type: "button",
        class: "cal-direction-remove",
        title: "Remove this direction",
        "aria-label": `Remove direction ${index + 1}`,
        onClick: () => {
          plan.directions.splice(index, 1)
          if (plan.directions.length === 0) state.plan = { _tag: "None" }
          renderComposer()
        },
      }, "×"),
      textareaWith(direction.brief, `Direction ${index + 1} brief`, value => {
        direction.brief = value
        renderComposer()
      }))),
  )
}

/**
 * @param {string} value
 * @param {string} label
 * @param {(value: string) => void} onChange
 */
function textareaWith(value, label, onChange) {
  const area = h("textarea", {
    class: "cal-direction-brief",
    rows: "2",
    "aria-label": label,
    onInput: event => onChange(/** @type {HTMLTextAreaElement} */ (event.target).value),
  })
  area.value = value
  return area
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
  events.addEventListener("takes", message => {
    /** @type {TakesSnapshot} */
    const snapshot = JSON.parse(/** @type {MessageEvent<string>} */ (message).data)
    takesArrived(snapshot)
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
  const take = event.data.take ?? null
  state.reports.set(reportKey(take, event.data.partState), { part: event.data.part, partState: event.data.partState, take, state: event.data.state, problems: event.data.problems })
  renderProblems()
})

new ResizeObserver(() => renderStage()).observe(stage)
renderParts()
renderBar()
renderCalibration()
renderStage()
renderTakes()
connect()
