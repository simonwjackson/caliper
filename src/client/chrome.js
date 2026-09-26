// @ts-check
import { CARD, DEFAULT_PX_PER_MM, DEVICES, frameGeometry } from "./device-frame.js"

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

const saved = new URLSearchParams(location.hash.slice(1))
const storedPxPerMm = Number(localStorage.getItem(STORAGE_PX_PER_MM))

const state = {
  /** @type {Connection} */
  connection: { _tag: "Connecting" },
  /** @type {string | null} */
  part: saved.get("part"),
  /** The export of the part to render. */
  partState: saved.get("state") ?? DEFAULT_STATE,
  device: deviceById(saved.get("device") ?? localStorage.getItem(STORAGE_DEVICE)),
  pxPerMm: storedPxPerMm > 0 ? storedPxPerMm : DEFAULT_PX_PER_MM,
  calibrated: storedPxPerMm > 0,
  calibrating: false,
  filter: "",
  /** @type {FrameReport | null} */
  frame: null,
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

function saveLocation() {
  const params = new URLSearchParams()
  if (state.part) params.set("part", state.part)
  if (state.partState !== DEFAULT_STATE) params.set("state", state.partState)
  params.set("device", state.device.id)
  history.replaceState(null, "", `#${params}`)
}

/** @param {string} file */
function selectPart(file) {
  if (state.part === file) return
  state.part = file
  state.partState = DEFAULT_STATE
  state.frame = null
  saveLocation()
  renderParts()
  renderBar()
  renderFrame()
  renderProblems()
}

/** @param {string} exportName */
function selectState(exportName) {
  if (state.partState === exportName) return
  state.partState = exportName
  state.frame = null
  saveLocation()
  renderParts()
  renderBar()
  renderFrame()
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
  return h("div", { class: "cal-states", role: "group", "aria-label": `${part.name} states` },
    ...part.states.map(partState => h("button", {
      type: "button",
      class: "cal-state",
      "aria-current": partState.export === state.partState ? "true" : false,
      title: partState.line ? `${part.file}:${partState.line}` : `${part.file}: default export`,
      "data-state": partState.export,
      onClick: () => selectState(partState.export),
    }, partState.label)))
}

function currentStateLabel() {
  const part = currentPart()
  return part?.states.find(partState => partState.export === state.partState)?.label ?? state.partState
}

function renderBar() {
  const part = currentPart()
  const shownState = part && part.states.length > 1 ? ` · ${currentStateLabel()}` : ""
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

function renderFrame() {
  const part = currentPart()
  const figure = $(".cal-device")
  const empty = $(".cal-empty")
  figure.hidden = part === null
  empty.hidden = part !== null
  if (part === null) {
    empty.textContent = currentProject()?.parts.length ? "Pick a part from the list." : ""
    frame.removeAttribute("src")
    return
  }
  const src = `frame?part=${encodeURIComponent(part.file)}&state=${encodeURIComponent(state.partState)}`
  if (frame.getAttribute("src") === src) return
  figure.dataset.frameState = "Loading"
  frame.setAttribute("src", src)
}

function renderStage() {
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

  const caption = $(".cal-caption")
  const size = `${device.name} · ${device.widthMm} mm wide · ${device.cssWidth} × ${device.cssHeight} CSS px`
  const fit = geometry.fit._tag === "TrueSize"
    ? h("span", { class: state.calibrated ? "cal-fit-true" : "cal-fit-warn" },
      state.calibrated ? "True size" : "True size only after calibration (now assumes 96 px per inch)")
    : h("span", { class: "cal-fit-warn" }, `Scaled to ${geometry.fit.percent}%: the window is too small for true size`)
  caption.replaceChildren(h("span", { title: device.viewportNote }, size), " · ", fit)
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
  const report = state.frame
  if (!report || report.part !== state.part || report.partState !== state.partState) return
  for (const problem of report.problems) {
    section.append(h("div", { class: `cal-problem cal-problem-${problem.kind}`, role: problem.kind === "error" ? "alert" : "status" },
      h("strong", {}, problem.title),
      problem.detail ? h("pre", {}, problem.detail) : null))
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
      state.partState = DEFAULT_STATE
      saveLocation()
    }
    // A save can remove the shown state. Fall back to the default export.
    if (!currentPart()?.states.some(partState => partState.export === state.partState)) {
      state.partState = DEFAULT_STATE
      saveLocation()
    }
    renderParts()
    renderSetup()
    renderBar()
    renderFrame()
    // The frame reloads itself when a part changes. A change to the global CSS
    // list or the wrapper changes the frame page, so reload it here.
    if (before && setupKey(before) !== setupKey(project)) frame.contentWindow?.location.reload()
  })
  events.addEventListener("error", () => {
    state.connection = { _tag: "Unreachable", project: currentProject() }
    renderParts()
  })
}

window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.data?.source !== "caliper-frame") return
  state.frame = { part: event.data.part, partState: event.data.partState, state: event.data.state, problems: event.data.problems }
  $(".cal-device").dataset.frameState = event.data.state
  renderProblems()
})

new ResizeObserver(() => renderStage()).observe(stage)
renderParts()
renderBar()
renderCalibration()
renderStage()
connect()
