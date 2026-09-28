// @ts-check
import { h } from "./dom.js"
import {
  animatedProperties, applyLive, declarationsOf, initialComputed, knockout, observeSheets, projectSheets,
  registrations, sample, summarize,
} from "./knob-cssom.js"
import { clampTo, controlFor, formatNumber, labelFor, mergeHints, parseNumber, scrub, sentinelFor } from "./knob-values.js"

/**
 * The Knobs panel: the design inputs of the part on the stage, found in its
 * CSS (decision 26) and edited as decision 23 says. While you drag, each
 * frame of the variant shows the value in its live CSSOM. When you release,
 * Caliper writes the declaration's file once, and Vite's reload confirms it.
 *
 * The variant is the code pane's: the selected take in the takes view, else
 * the real files. A take's knob writes the take's copy.
 *
 * @typedef {import("./knob-cssom.js").Site} Site
 * @typedef {import("./knob-cssom.js").Registration} Registration
 * @typedef {import("./knob-values.js").Control} Control
 * @typedef {import("../types").KnobHints} KnobHints
 * @typedef {import("../types").KnobSource} KnobSource
 * @typedef {Extract<KnobSource, { _tag: "Located" }>} Located
 * @typedef {{ take: string | null, label: string }} Variant
 * @typedef {{ iframe: HTMLIFrameElement, document: Document, window: Window }} Frame
 * @typedef {{
 *   key: string, name: string, registration: Registration, site: Site, source: Located,
 *   control: Exclude<Control, { _tag: "Skip" }>, label: string, where: string, note: string,
 *   problems: string[], elements: Element[], document: Document,
 * }} Knob
 * @typedef {{ name: string, where: string, reason: string }} Skipped
 * @typedef {{ _tag: "Closed" }
 *   | { _tag: "Idle", message: string }
 *   | { _tag: "Finding" }
 *   | { _tag: "Ready", knobs: Knob[], skipped: Skipped[], problems: string[] }} View
 * @typedef {{ _tag: "Saving" } | { _tag: "Saved" } | { _tag: "Conflict", reason: string } | { _tag: "Failed", reason: string }} Status
 */

/** Elements sampled per frame for knockout. */
const SAMPLE = 60
/** Wait this long after the last stylesheet change before finding the knobs again. */
const SETTLE_MS = 150
/** A saved value stays live at most this long while the frames reload the file. */
const COMMIT_MS = 3000
/** "Saved" shows this long. */
const SAVED_MS = 1500

/**
 * @param {HTMLElement} container
 * @param {{
 *   frames: () => HTMLIFrameElement[],
 *   variant: () => Variant | null,
 *   openFile: (file: string) => void,
 * }} options
 */
export function createKnobsPanel(container, { frames, variant, openFile }) {
  container.classList.add("cal-knobs")
  const head = h("header", { class: "cal-knobs-head" }, h("h2", {}, "Knobs"), h("p", { class: "cal-knobs-target" }))
  const body = h("div", { class: "cal-knobs-body" })
  container.replaceChildren(head, body)

  /** @type {View} */
  let view = { _tag: "Closed" }
  let open = false
  /** Bumped by each search, so a slow one does not overwrite a newer one. */
  let generation = 0
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let settle
  /** The knob you are dragging, whose row must not be rebuilt. @type {string | null} */
  let dragging = null
  /** The variant the live edits belong to. @type {string | null | undefined} */
  let liveVariant
  /** Values shown in the CSSOM but not yet in the served CSS. @type {Map<string, { knob: Knob, value: string, until: number }>} */
  const live = new Map()
  /** @type {Map<string, Status>} */
  const statuses = new Map()
  /** Row updaters, to change a row's value without rebuilding it. @type {Map<string, (value: string) => void>} */
  const rows = new Map()
  /** @type {WeakMap<Document, () => void>} */
  const observed = new WeakMap()
  /** Which knobs show their palette. @type {Set<string>} */
  const palettes = new Set()

  /** @returns {Frame[]} the rendered frames of the variant */
  const variantFrames = () => {
    const target = variant()
    if (target === null) return []
    return frames().flatMap(iframe => {
      const src = iframe.getAttribute("src")
      if (!src) return []
      const take = new URL(src, location.href).searchParams.get("take")
      const document = iframe.contentDocument
      const window = iframe.contentWindow
      if (take !== target.take || document === null || window === null) return []
      const state = document.documentElement.dataset.caliperState
      return state === "Rendered" || state === "Empty" ? [{ iframe, document, window }] : []
    })
  }

  /** Put every live value back into a frame, after Vite replaced a stylesheet's text. @param {Document} document */
  const reapply = document => {
    for (const { knob, value } of live.values()) applyLive(document, knob.site, value)
  }

  /** @param {Frame[]} list */
  const watch = list => {
    for (const { document } of list) {
      if (observed.has(document)) continue
      observed.set(document, observeSheets(document, () => {
        reapply(document)
        schedule()
      }))
    }
  }

  const schedule = () => {
    if (!open) return
    clearTimeout(settle)
    settle = setTimeout(() => {
      if (dragging === null) void find()
      else schedule()
    }, SETTLE_MS)
  }

  /** Find the knobs of the variant's frames. */
  const find = async () => {
    const target = variant()
    const id = ++generation
    head.querySelector(".cal-knobs-target")?.replaceChildren(target === null ? "" : target.label)
    if (liveVariant !== undefined && target?.take !== liveVariant) live.clear()
    liveVariant = target?.take ?? null
    if (target === null) return show({ _tag: "Idle", message: "Pick a part to see its knobs." })
    const list = variantFrames()
    if (list.length === 0) return show({ _tag: "Idle", message: "The knobs appear when a frame of these files has rendered." })
    watch(list)
    if (view._tag !== "Ready") show({ _tag: "Finding" })
    try {
      const found = await discover(list, target)
      if (id !== generation) return
      for (const [key, entry] of live) {
        const knob = found.knobs.find(candidate => candidate.key === key)
        if (knob === undefined || knob.source.value === entry.value || Date.now() > entry.until) live.delete(key)
      }
      show(found)
    } catch (error) {
      if (id !== generation) return
      show({ _tag: "Idle", message: `Caliper could not find the knobs: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  /** @param {View} next */
  const show = next => {
    view = next
    render()
  }

  const render = () => {
    rows.clear()
    container.dataset.view = view._tag
    switch (view._tag) {
      case "Closed":
        return body.replaceChildren()
      case "Idle":
        return body.replaceChildren(h("p", { class: "cal-knobs-note" }, view.message))
      case "Finding":
        return body.replaceChildren(h("p", { class: "cal-knobs-note" }, "Finding the knobs…"))
      case "Ready": {
        const { knobs, skipped, problems } = view
        body.replaceChildren(
          ...problems.map(problem => h("p", { class: "cal-knobs-problem", role: "alert" }, problem)),
          knobs.length === 0
            ? h("div", { class: "cal-knobs-note" },
              h("p", {}, skipped.length === 0
                ? "This part's CSS registers no design inputs. Register one with @property to get a knob:"
                : "No registered property here is a knob. The list below says why."),
              skipped.length === 0 ? h("pre", {}, '@property --gap {\n  syntax: "<length>";\n  inherits: true;\n  initial-value: 8px;\n}') : null)
            : h("ul", { class: "cal-knob-list" }, ...knobs.map(knobRow)),
          ...(skipped.length === 0 ? [] : [h("details", { class: "cal-knobs-skipped" },
            h("summary", {}, `${skipped.length} not ${skipped.length === 1 ? "a knob" : "knobs"}`),
            h("ul", {}, ...skipped.map(item => h("li", {},
              h("code", {}, item.name), item.where ? h("span", { class: "cal-knob-where" }, ` ${item.where}`) : null,
              h("span", {}, ` ${item.reason}`)))))]),
        )
      }
    }
  }

  /** @param {Knob} knob */
  const currentValue = knob => live.get(knob.key)?.value ?? knob.source.value

  /**
   * Show a value in every frame of the variant.
   *
   * @param {Knob} knob
   * @param {string} value
   */
  const preview = (knob, value) => {
    live.set(knob.key, { knob, value, until: Infinity })
    statuses.delete(knob.key)
    for (const { document } of variantFrames()) applyLive(document, knob.site, value)
    rows.get(knob.key)?.(value)
  }

  /**
   * Write the value to the declaration's file, once.
   *
   * @param {Knob} knob
   * @param {string} value
   */
  const commit = async (knob, value) => {
    dragging = null
    if (value === knob.source.value) {
      live.delete(knob.key)
      for (const { document } of variantFrames()) applyLive(document, knob.site, value)
      return
    }
    preview(knob, value)
    setStatus(knob, { _tag: "Saving" })
    /** @type {Status} */
    let status
    try {
      const response = await fetch("knobs/write", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file: knob.source.file, take: variant()?.take ?? null, version: knob.source.version,
          start: knob.source.start, end: knob.source.end, expected: knob.source.value, value,
        }),
      })
      const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
      status = response.ok ? { _tag: "Saved" } : result._tag === "Conflict" ? { _tag: "Conflict", reason: result.reason } : { _tag: "Failed", reason: result.error ?? `HTTP ${response.status}` }
    } catch (error) {
      status = { _tag: "Failed", reason: error instanceof Error ? error.message : String(error) }
    }
    if (status._tag === "Saved") {
      // Keep the value live until the reloaded stylesheet holds it.
      const entry = live.get(knob.key)
      if (entry) entry.until = Date.now() + COMMIT_MS
      setTimeout(() => {
        if (statuses.get(knob.key)?._tag === "Saved") setStatus(knob, null)
      }, SAVED_MS)
      setTimeout(schedule, COMMIT_MS)
    } else {
      live.delete(knob.key)
      for (const { document } of variantFrames()) applyLive(document, knob.site, knob.source.value)
      rows.get(knob.key)?.(knob.source.value)
    }
    setStatus(knob, status)
    schedule()
  }

  /** @param {Knob} knob @param {Status | null} status */
  const setStatus = (knob, status) => {
    if (status === null) statuses.delete(knob.key)
    else statuses.set(knob.key, status)
    const row = container.querySelector(`[data-knob="${CSS.escape(knob.key)}"]`)
    if (!(row instanceof HTMLElement)) return
    row.dataset.status = status?._tag ?? "Idle"
    const line = row.querySelector(".cal-knob-status")
    if (line) line.textContent = statusText(status)
  }

  /** @param {Knob} knob */
  const knobRow = knob => {
    const status = statuses.get(knob.key) ?? null
    const control = controlElement(knob)
    const row = h("li", {
      class: "cal-knob",
      "data-knob": knob.key,
      "data-status": status?._tag ?? "Idle",
      "data-control": knob.control._tag,
    },
    h("div", { class: "cal-knob-head" }, control.label, control.field),
    control.extra,
    h("p", { class: "cal-knob-site" },
      h("code", {}, knob.name),
      ` ${knob.where} · `,
      h("button", { type: "button", class: "cal-knob-file", title: "Open this file in the code pane", onClick: () => openFile(knob.source.file) },
        `${knob.source.file.split("/").pop()}:${knob.source.line}`)),
    knob.note ? h("p", { class: "cal-knob-note" }, knob.note) : null,
    ...knob.problems.map(problem => h("p", { class: "cal-knob-problem" }, problem)),
    h("p", { class: "cal-knob-status", "aria-live": "polite" }, statusText(status)))
    return row
  }

  /**
   * The label and the field for a knob's control, and the row updater.
   *
   * @param {Knob} knob
   * @returns {{ label: HTMLElement, field: HTMLElement, extra: HTMLElement | null }}
   */
  const controlElement = knob => {
    const { control } = knob
    const id = `cal-knob-${knob.key.replace(/[^a-z0-9]/gi, "-")}`
    const value = currentValue(knob)
    switch (control._tag) {
      case "Number": {
        const scale = { ...control, ...(parseNumber(value) ?? {}) }
        const input = /** @type {HTMLInputElement} */ (h("input", {
          id,
          class: "cal-knob-number",
          type: "number",
          step: String(control.step),
          ...(control.min === undefined ? {} : { min: String(control.min) }),
          ...(control.max === undefined ? {} : { max: String(control.max) }),
          value: String(scale.number),
          onInput: () => {
            if (input.value === "" || !Number.isFinite(input.valueAsNumber)) return
            preview(knob, formatNumber(clampTo(control, input.valueAsNumber), control.unit, control.step))
          },
          onChange: () => {
            if (input.value === "" || !Number.isFinite(input.valueAsNumber)) return void (input.value = String(parseNumber(currentValue(knob))?.number ?? ""))
            void commit(knob, formatNumber(clampTo(control, input.valueAsNumber), control.unit, control.step))
          },
        }))
        const range = control.min !== undefined && control.max !== undefined
          ? /** @type {HTMLInputElement} */ (h("input", {
            class: "cal-knob-range",
            type: "range",
            min: String(control.min),
            max: String(control.max),
            step: String(control.step),
            value: String(scale.number),
            "aria-label": knob.label,
            onPointerdown: () => { dragging = knob.key },
            onInput: event => preview(knob, formatNumber(Number(/** @type {HTMLInputElement} */ (event.target).value), control.unit, control.step)),
            onChange: event => void commit(knob, formatNumber(Number(/** @type {HTMLInputElement} */ (event.target).value), control.unit, control.step)),
          }))
          : null
        const label = h("label", { class: "cal-knob-label cal-knob-scrub", for: id, title: "Drag sideways to change. Shift moves ten steps." }, knob.label)
        scrubbing(label, knob, control)
        rows.set(knob.key, next => {
          const number = parseNumber(next)?.number
          if (number === undefined) return
          if (document.activeElement !== input) input.value = String(number)
          if (range) range.value = String(number)
        })
        return {
          label,
          // The unit keeps its room when empty, so number fields line up.
          field: h("span", { class: "cal-knob-field" }, input, h("span", { class: "cal-knob-unit" }, control.unit)),
          extra: range,
        }
      }
      case "Color": {
        const text = /** @type {HTMLInputElement} */ (h("input", {
          id,
          class: "cal-knob-text",
          type: "text",
          value,
          spellcheck: "false",
          onKeydown: event => {
            if (/** @type {KeyboardEvent} */ (event).key !== "Enter") return
            const next = text.value.trim()
            if (CSS.supports("color", next)) void commit(knob, next)
          },
          onChange: () => {
            const next = text.value.trim()
            if (CSS.supports("color", next)) void commit(knob, next)
            else text.value = currentValue(knob)
          },
        }))
        const swatch = control.hex === null
          ? h("span", { class: "cal-knob-swatch", style: `background: ${value}` })
          : /** @type {HTMLInputElement} */ (h("input", {
            class: "cal-knob-color",
            type: "color",
            value: control.hex,
            "aria-label": `${knob.label} colour`,
            onInput: event => preview(knob, /** @type {HTMLInputElement} */ (event.target).value),
            onChange: event => void commit(knob, /** @type {HTMLInputElement} */ (event.target).value),
          }))
        rows.set(knob.key, next => {
          if (document.activeElement !== text) text.value = next
          if (swatch instanceof HTMLInputElement && /^#[0-9a-f]{6}$/i.test(next)) swatch.value = next
        })
        return { label: h("label", { class: "cal-knob-label", for: id }, knob.label), field: h("span", { class: "cal-knob-field" }, swatch, text), extra: null }
      }
      case "Choice": {
        const select = /** @type {HTMLSelectElement} */ (h("select", {
          id,
          class: "cal-knob-select",
          onChange: () => void commit(knob, select.value),
        }, ...control.options.map(option => h("option", { value: option, ...(option === value ? { selected: true } : {}) }, option))))
        rows.set(knob.key, next => { select.value = next })
        return { label: h("label", { class: "cal-knob-label", for: id }, knob.label), field: select, extra: null }
      }
      case "Token": {
        const tokens = tokensOf(knob, control.token, control.namespace)
        const chosen = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)?.[1] ?? control.token
        const isColor = /color/.test(knob.registration.syntax)
        const expanded = palettes.has(knob.key)
        const toggle = h("button", {
          id,
          type: "button",
          class: "cal-knob-token",
          "aria-expanded": String(expanded),
          onClick: () => {
            if (palettes.has(knob.key)) palettes.delete(knob.key)
            else palettes.add(knob.key)
            render()
          },
        },
        isColor ? h("span", { class: "cal-knob-swatch", style: `background: ${tokens.find(token => token.name === chosen)?.value ?? ""}` }) : null,
        h("code", {}, chosen.replace(/^--/, "")))
        const palette = !expanded ? null : h("div", { class: `cal-knob-palette${isColor ? " cal-knob-palette-colors" : ""}`, role: "radiogroup", "aria-label": `${knob.label}: ${control.namespace}* tokens` },
          ...tokens.map(token => h("button", {
            type: "button",
            role: "radio",
            class: "cal-knob-choice",
            "aria-checked": String(token.name === chosen),
            title: `${token.name}: ${token.value}`,
            onClick: () => void commit(knob, `var(${token.name})`),
          },
          isColor ? h("span", { class: "cal-knob-swatch", style: `background: ${token.value}` }) : null,
          h("span", { class: isColor ? "cal-knob-choice-name" : "" }, token.name.slice(control.namespace.length)))))
        return { label: h("label", { class: "cal-knob-label", for: id }, knob.label), field: toggle, extra: palette }
      }
    }
  }

  /**
   * A drag across the label scrubs the value; pointer capture keeps it going
   * over the device frames.
   *
   * @param {HTMLElement} label
   * @param {Knob} knob
   * @param {Extract<Control, { _tag: "Number" }>} control
   */
  const scrubbing = (label, knob, control) => {
    /** @type {{ x: number, number: number, moved: boolean } | null} */
    let start = null
    label.addEventListener("pointerdown", event => {
      if (event.button !== 0) return
      event.preventDefault()
      label.setPointerCapture(event.pointerId)
      start = { x: event.clientX, number: parseNumber(currentValue(knob))?.number ?? control.number, moved: false }
      dragging = knob.key
    })
    label.addEventListener("pointermove", event => {
      if (start === null || !label.hasPointerCapture(event.pointerId)) return
      const dx = (event.clientX - start.x) * (event.shiftKey ? 10 : 1)
      if (Math.abs(dx) < 1 && !start.moved) return
      start.moved = true
      preview(knob, formatNumber(scrub({ ...control, number: start.number }, dx), control.unit, control.step))
    })
    const end = (/** @type {PointerEvent} */ event) => {
      if (start === null) return
      const moved = start.moved
      start = null
      if (label.hasPointerCapture(event.pointerId)) label.releasePointerCapture(event.pointerId)
      if (moved) void commit(knob, currentValue(knob))
      else {
        dragging = null
        document.getElementById(label.getAttribute("for") ?? "")?.focus()
      }
    }
    label.addEventListener("pointerup", end)
    label.addEventListener("pointercancel", end)
  }

  /**
   * The sibling tokens a reference picks among: the `namespace` properties
   * declared in the rules that declare `token`, with their values.
   *
   * @param {Knob} knob
   * @param {string} token
   * @param {string} namespace
   */
  const tokensOf = (knob, token, namespace) => {
    const element = knob.elements[0] ?? knob.document.documentElement
    const view = knob.document.defaultView
    /** @type {Map<string, string>} */
    const found = new Map()
    for (const candidate of declarationsOf(knob.document, token)) {
      for (const name of candidate.rule.style) {
        if (!name.startsWith(namespace) || found.has(name)) continue
        found.set(name, (view?.getComputedStyle(element).getPropertyValue(name) ?? "").trim() || candidate.rule.style.getPropertyValue(name).trim())
      }
    }
    return [...found].map(([name, value]) => ({ name, value }))
  }

  return {
    /** @param {boolean} next */
    setOpen(next) {
      if (open === next) return
      open = next
      if (open) void find()
      else {
        clearTimeout(settle)
        show({ _tag: "Closed" })
      }
    },
    /** The stage or the variant changed. */
    refresh() {
      if (open) schedule()
    },
    /** A frame reported its state: it may be new, or reloaded. */
    frameChanged() {
      if (open) schedule()
    },
  }
}

/** @param {Status | null} status */
function statusText(status) {
  if (status === null) return ""
  switch (status._tag) {
    case "Saving": return "Saving…"
    case "Saved": return "Saved"
    case "Conflict": return `${status.reason} The knob shows the file's value.`
    case "Failed": return `Not saved: ${status.reason}`
  }
}

/**
 * Find the knobs in a set of frames: registered properties, the declarations
 * that set them on the rendered part, and where those live in source.
 *
 * @param {Frame[]} list
 * @param {Variant} target
 * @returns {Promise<Extract<View, { _tag: "Ready" }>>}
 */
async function discover(list, target) {
  /** @type {Map<string, Registration & { document: Document }>} */
  const registered = new Map()
  /** @type {Map<string, string>} */
  const animated = new Map()
  for (const { document } of list) {
    for (const [name, registration] of registrations(document)) if (!registered.has(name)) registered.set(name, { ...registration, document })
    for (const [name, keyframes] of animatedProperties(document)) animated.set(name, keyframes)
  }
  /** @type {Skipped[]} */
  const skipped = []
  /** @type {Map<string, { site: Site, value: string, elements: Element[], document: Document, registration: Registration }>} */
  const sites = new Map()
  for (const [name, registration] of registered) {
    const keyframes = animated.get(name)
    if (keyframes !== undefined) {
      skipped.push({ name, where: "", reason: `@keyframes ${keyframes} animates it, so it is an output.` })
      continue
    }
    const propertySite = {
      sheetId: registration.sheetId, path: registration.path, property: "initial-value", name, selector: "@property",
      syntax: registration.syntax, inherits: registration.inherits,
    }
    let won = false
    /** @type {Array<{ document: Document, window: Window, elements: Element[] }>} */
    const rest = []
    for (const { document, window } of list) {
      const elements = sample(document, SAMPLE)
      const candidates = declarationsOf(document, name)
      const sentinel = sentinelFor(registration.syntax, candidates[0]?.value ?? registration.initialValue)
      const { winners, unexplained } = candidates.length > 0 && elements.length > 0 && sentinel !== null
        ? knockout(window, elements, name, candidates, sentinel)
        : { winners: [], unexplained: elements }
      for (const { candidate, elements: reached } of winners) {
        won = true
        const site = { sheetId: candidate.sheetId, path: candidate.path, property: name, name, selector: candidate.selector }
        const key = siteKey(site)
        const known = sites.get(key)
        if (known) known.elements.push(...reached)
        else sites.set(key, { site, value: candidate.value, elements: [...reached], document, registration })
      }
      rest.push({ document, window, elements: unexplained })
    }
    // The initial value is a knob when no style rule sets the property on
    // the part: then @property is the only declaration of it. Elements that
    // keep the initial value beside a rule that wins are outside its scope.
    if (won) continue
    const fromInitial = rest.every(({ document, window, elements }) => {
      const initial = initialComputed(document, name)
      return elements.every(element => window.getComputedStyle(element).getPropertyValue(name) === initial)
    })
    if (fromInitial) {
      sites.set(siteKey(propertySite), { site: propertySite, value: registration.initialValue, elements: rest.flatMap(entry => entry.elements), document: registration.document, registration })
    } else {
      // A registered value that no declaration Caliper found explains: refuse, never guess (decision 23).
      skipped.push({ name, where: "", reason: "Caliper could not find the declaration that sets it here." })
    }
  }

  // Locate every site, and each registered property's @property rule for its hints.
  /** @type {Map<string, { site: Site, document: Document }>} */
  const asks = new Map()
  for (const { site, document } of sites.values()) {
    asks.set(siteKey(site), { site, document })
    const registration = registered.get(site.name)
    if (registration) {
      const propertySite = { sheetId: registration.sheetId, path: registration.path, property: "initial-value", name: site.name, selector: "@property" }
      if (!asks.has(siteKey(propertySite))) asks.set(siteKey(propertySite), { site: propertySite, document: registration.document })
    }
  }
  const { located, configured, problems } = await locateAll([...asks.values()], target.take)

  /** @type {Knob[]} */
  const knobs = []
  for (const [key, { site, value, elements, document, registration }] of sites) {
    const where = site.property === "initial-value" ? "@property" : site.selector
    const source = located.get(key)
    const property = located.get(siteKey({ sheetId: registration.sheetId, path: registration.path, property: "initial-value" }))
    if (source === undefined || source._tag === "Refused") {
      skipped.push({ name: site.name, where, reason: source?.reason ?? "Caliper did not get an answer for it." })
      continue
    }
    const fromProperty = property?._tag === "Located" ? property : null
    const hints = mergeHints(configured[site.name], fromProperty?.hints, site.property === "initial-value" ? undefined : source.hints)
    const control = controlFor({ syntax: registration.syntax, value: source.value, hints })
    if (control._tag === "Skip") {
      skipped.push({ name: site.name, where, reason: control.reason })
      continue
    }
    if (source.value.replace(/\s+/g, " ") !== value.replace(/\s+/g, " ") && site.property !== "initial-value") {
      skipped.push({ name: site.name, where, reason: "The frame's CSS and the file disagree. Caliper waits for the frame to reload." })
      continue
    }
    knobs.push({
      key,
      name: site.name,
      registration,
      site: { ...site, syntax: registration.syntax, inherits: registration.inherits },
      source,
      control,
      label: hints.label ?? labelFor(site.name),
      where: site.property === "initial-value" ? "@property" : `in ${where}`,
      note: fromProperty?.note ?? "",
      problems: [...new Set([...(fromProperty?.problems ?? []), ...(site.property === "initial-value" ? [] : source.problems)])],
      elements,
      document,
    })
  }
  knobs.sort((left, right) => left.source.file.localeCompare(right.source.file) || left.source.start - right.source.start)
  skipped.sort((left, right) => left.name.localeCompare(right.name))
  return { _tag: "Ready", knobs, skipped, problems }
}

/** @param {Pick<Site, "sheetId" | "path" | "property">} site */
function siteKey(site) {
  return `${site.sheetId}#${site.path.join(".")}#${site.property}`
}

/**
 * Ask the knobs API where each site lives, one request per stylesheet.
 *
 * @param {Array<{ site: Site, document: Document }>} asks
 * @param {string | null} take
 */
async function locateAll(asks, take) {
  /** @type {Map<string, Array<{ site: Site, document: Document }>>} */
  const bySheet = new Map()
  for (const ask of asks) bySheet.set(ask.site.sheetId, [...(bySheet.get(ask.site.sheetId) ?? []), ask])
  /** @type {Map<string, KnobSource>} */
  const located = new Map()
  /** @type {Record<string, KnobHints>} */
  const configured = {}
  /** @type {Set<string>} */
  const problems = new Set()
  await Promise.all([...bySheet].map(async ([sheetId, list]) => {
    const document = /** @type {Document} */ (list[0]?.document)
    const entry = projectSheets(document).find(candidate => candidate.id === sheetId)
    if (entry === undefined) {
      for (const { site } of list) located.set(siteKey(site), { _tag: "Refused", reason: "The frame no longer holds this stylesheet." })
      return
    }
    const response = await fetch("knobs/locate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sheet: sheetId,
        take,
        css: entry.node.textContent ?? "",
        rules: summarize(entry.sheet),
        targets: list.map(({ site }) => ({ path: site.path, property: site.property })),
      }),
    })
    const answer = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
    if (!response.ok) {
      for (const { site } of list) located.set(siteKey(site), { _tag: "Refused", reason: answer.error ?? `HTTP ${response.status}` })
      return
    }
    list.forEach(({ site }, index) => located.set(siteKey(site), answer.results[index]))
    Object.assign(configured, answer.configured)
    for (const problem of answer.problems ?? []) problems.add(problem)
  }))
  return { located, configured, problems: [...problems] }
}
