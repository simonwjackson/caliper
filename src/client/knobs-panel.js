// @ts-check
import { h } from "./dom.js"
import {
  animatedProperties, applyLive, containersOf, declarationsOf, initialComputed, isRead, kindOf, knockout, literalWins, longhandsIn,
  observeSheets, plainProperties, projectSheets, readTargets, referenceBlocks, registrations, sample, summarize, tokenHomes, walk,
} from "./knob-cssom.js"
import {
  clampTo, controlFor, declarationsIn, formatNumber, labelFor, literalSentinels, literalType, mergeHints, namespaceOf, parseNumber,
  readersOf, referenceGraph, replaceThreshold, scrub, sentinelFor, suggestTokenName, syntaxOfValue, thresholdsOf,
} from "./knob-values.js"

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
 * @typedef {{ _tag: "Property", registration: Registration }
 *   | { _tag: "Plain" }
 *   | { _tag: "Threshold", index: number, condition: string }} Origin
 *   What a knob edits: a registered property's declaration, the declaration
 *   of a plain custom property the part reads, or one length in a
 *   `@container` condition, which is `condition` as the file writes it.
 * @typedef {{
 *   key: string, name: string, origin: Origin, site: Site, source: Located,
 *   control: Exclude<Control, { _tag: "Skip" }>, label: string, where: string, note: string,
 *   problems: string[], elements: Element[], document: Document,
 * }} Knob
 * @typedef {{ name: string, where: string, reason: string }} Skipped
 * @typedef {{ _tag: "Closed" }
 *   | { _tag: "Idle", message: string }
 *   | { _tag: "Finding" }
 *   | { _tag: "Ready", knobs: Knob[], skipped: Skipped[], problems: string[] }} View
 * @typedef {{ _tag: "Saving" } | { _tag: "Saved" } | { _tag: "Conflict", reason: string } | { _tag: "Failed", reason: string }} Status
 * @typedef {{ selector: string, anchor: string, source: Located }} Home
 *   A rule a new token can go in; the token goes after its `anchor` declaration.
 * @typedef {{ key: string, property: string, value: string, selector: string, source: Located, homes: Home[] }} Literal
 *   A standard declaration with one literal value that wins on the part.
 * @typedef {{ _tag: "Closed" }
 *   | { _tag: "Finding" }
 *   | { _tag: "Ready", literals: Literal[], refused: Skipped[], taken: Set<string> }
 *   | { _tag: "Failed", message: string }} LiteralView
 *   `taken` holds every custom property name the frames declare or register.
 * @typedef {{ key: string, name: string, home: number, status: { _tag: "Editing" } | { _tag: "Saving" } | { _tag: "Failed", reason: string } }} Draft
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
  /** Whether the literals section is open; Caliper looks for literals only then. */
  let literalsOpen = false
  /** @type {LiteralView} */
  let literalView = { _tag: "Closed" }
  let literalGeneration = 0
  /** The literal being made a token, and the form's state. @type {Draft | null} */
  let draft = null
  /** What the last promotion did, shown above the literals. */
  let literalNotice = ""

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

  /**
   * The text a knob's site shows for `value`. A threshold's site is its whole
   * condition, with every live threshold of that rule in it.
   *
   * @param {Knob} knob
   * @param {string} value
   */
  const siteText = (knob, value) => {
    if (knob.origin._tag !== "Threshold") return value
    let condition = knob.origin.condition
    const site = siteKey(knob.site)
    for (const { knob: other, value: shown } of live.values()) {
      if (other.key !== knob.key && other.origin._tag === "Threshold" && siteKey(other.site) === site) condition = replaceThreshold(condition, other.origin.index, shown)
    }
    return replaceThreshold(condition, knob.origin.index, value)
  }

  /** Show a knob's value in every frame of the variant. @param {Knob} knob @param {string} value */
  const showEverywhere = (knob, value) => {
    for (const { document } of variantFrames()) applyLive(document, knob.site, siteText(knob, value))
  }

  /** Put every live value back into a frame, after Vite replaced a stylesheet's text. @param {Document} document */
  const reapply = document => {
    for (const { knob, value } of live.values()) applyLive(document, knob.site, siteText(knob, value))
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
      if (literalsOpen) void findLiterals()
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
                ? "Caliper found no design inputs in this part's CSS. A custom property that the part reads is a knob:"
                : "No design input here is a knob. The list below says why."),
              skipped.length === 0 ? h("pre", {}, ".card {\n  --gap: 8px;\n  padding: var(--gap);\n}") : null)
            : h("ul", { class: "cal-knob-list" }, ...knobs.map(knobRow)),
          ...(skipped.length === 0 ? [] : [h("details", { class: "cal-knobs-skipped" },
            h("summary", {}, `${skipped.length} not ${skipped.length === 1 ? "a knob" : "knobs"}`),
            h("ul", {}, ...skipped.map(item => h("li", {},
              h("code", {}, item.name), item.where ? h("span", { class: "cal-knob-where" }, ` ${item.where}`) : null,
              h("span", {}, ` ${item.reason}`)))))]),
          literalSection(),
        )
      }
    }
  }

  /** Find the literals of the variant's frames, and show them. */
  const findLiterals = async () => {
    const target = variant()
    const id = ++literalGeneration
    const list = variantFrames()
    if (target === null || list.length === 0) return
    if (literalView._tag !== "Ready") {
      literalView = { _tag: "Finding" }
      render()
    }
    try {
      const found = await discoverLiterals(list, target.take)
      if (id !== literalGeneration) return
      literalView = found
      if (draft !== null && !found.literals.some(literal => literal.key === draft?.key)) draft = null
    } catch (error) {
      if (id !== literalGeneration) return
      literalView = { _tag: "Failed", message: `Caliper could not find the literals: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (dragging === null) render()
  }

  /**
   * Literals: values written straight into a rule that win on the part.
   * Making one a token moves it into a rule with tokens, so it gets a knob.
   */
  const literalSection = () => {
    const count = literalView._tag === "Ready" ? ` (${literalView.literals.length})` : ""
    const section = h("details", {
      class: "cal-knobs-literals",
      open: literalsOpen,
      onToggle: () => {
        const next = /** @type {HTMLDetailsElement} */ (section).open
        if (next === literalsOpen) return
        literalsOpen = next
        if (next) void findLiterals()
      },
    }, h("summary", {}, `Literals${count}`))
    if (!literalsOpen) return section
    switch (literalView._tag) {
      case "Closed":
      case "Finding":
        section.append(h("p", { class: "cal-knobs-note" }, "Finding the literals…"))
        return section
      case "Failed":
        section.append(h("p", { class: "cal-knobs-problem", role: "alert" }, literalView.message))
        return section
      case "Ready": {
        const { literals, refused } = literalView
        section.append(...[
          h("p", { class: "cal-knobs-note" }, literals.length === 0
            ? "No value written straight into a rule changes this part."
            : "Values written straight into a rule. Make one a token to get a knob for it."),
          literalNotice ? h("p", { class: "cal-literal-notice", role: "status" }, literalNotice) : null,
          literals.length === 0 ? null : h("ul", { class: "cal-knob-list" }, ...literals.map(literalRow)),
          refused.length === 0 ? null : h("details", { class: "cal-knobs-skipped" },
            h("summary", {}, `${refused.length} Caliper could not place`),
            h("ul", {}, ...refused.map(item => h("li", {},
              h("code", {}, item.name), h("span", { class: "cal-knob-where" }, ` ${item.where}`), h("span", {}, ` ${item.reason}`))))),
        ].filter(node => node !== null))
        return section
      }
    }
  }

  /** @param {Literal} literal */
  const literalRow = literal => {
    const editing = draft?.key === literal.key
    return h("li", { class: "cal-literal", "data-literal": literal.key },
      h("div", { class: "cal-knob-head" },
        h("code", { class: "cal-literal-value" }, `${literal.property}: ${literal.value}`),
        h("button", {
          type: "button",
          class: "cal-literal-make",
          "aria-expanded": String(editing),
          onClick: () => {
            literalNotice = ""
            draft = editing ? null : startDraft(literal)
            render()
            if (draft === null) return
            container.querySelector(".cal-literal-form")?.scrollIntoView({ block: "nearest" })
            const input = /** @type {HTMLInputElement | null} */ (container.querySelector("input.cal-literal-name"))
            input?.focus()
          },
        }, "Make a token")),
      h("p", { class: "cal-knob-site" }, `in ${literal.selector} · `, fileButton(literal.source)),
      editing && draft !== null ? literalForm(literal, draft) : null)
  }

  /** @param {Located} source */
  const fileButton = source => h("button", { type: "button", class: "cal-knob-file", title: "Open this file in the code pane", onClick: () => openFile(source.file) },
    `${source.file.split("/").pop()}:${source.line}`)

  /** @param {Literal} literal @returns {Draft} */
  const startDraft = literal => {
    const home = literal.homes[0]
    return {
      key: literal.key,
      name: suggestTokenName(literal.selector, literal.property, home === undefined ? "--" : namespaceOf(home.anchor)),
      home: 0,
      status: { _tag: "Editing" },
    }
  }

  /**
   * The form that confirms the token's name and the rule it goes in, and
   * says both edits before Caliper makes them (decision 26).
   *
   * @param {Literal} literal
   * @param {Draft} state
   */
  const literalForm = (literal, state) => {
    const { homes } = literal
    if (homes.length === 0) {
      return h("div", { class: "cal-literal-form" },
        h("p", { class: "cal-knobs-note" }, "No rule with tokens reaches this element, so a token has nowhere to go. Declare a custom property in a rule around it first."),
        h("div", { class: "cal-literal-actions" }, h("button", { type: "button", onClick: () => { draft = null; render() } }, "Cancel")))
    }
    const preview = h("p", { class: "cal-literal-preview" })
    const error = h("p", { class: "cal-knob-problem", role: "alert" })
    const update = () => {
      const home = homes[state.home] ?? homes[0]
      if (home === undefined) return
      preview.replaceChildren("Adds ", h("code", {}, `${state.name}: ${literal.value};`), ` to ${home.selector} (`, fileButton(home.source),
        "), and writes ", h("code", {}, `var(${state.name})`), " in its place (", fileButton(literal.source), ").")
      const problem = nameProblem(state.name, literal)
      error.textContent = state.status._tag === "Failed" ? state.status.reason : problem ?? ""
    }
    const name = /** @type {HTMLInputElement} */ (h("input", {
      class: "cal-literal-name cal-knob-text",
      type: "text",
      value: state.name,
      spellcheck: "false",
      "aria-label": "Token name",
      onInput: () => {
        state.name = name.value.trim()
        if (state.status._tag === "Failed") state.status = { _tag: "Editing" }
        update()
      },
    }))
    const select = /** @type {HTMLSelectElement} */ (h("select", {
      class: "cal-literal-home cal-knob-select",
      "aria-label": "Rule the token goes in",
      onChange: () => {
        state.home = Number(select.value)
        update()
      },
    }, ...homes.map((home, index) => h("option", { value: String(index), ...(index === state.home ? { selected: true } : {}) },
      `${home.selector} · ${home.source.file.split("/").pop()}:${home.source.line}`))))
    const saving = state.status._tag === "Saving"
    const form = h("form", {
      class: "cal-literal-form",
      onSubmit: event => {
        event.preventDefault()
        void promote(literal, state)
      },
    },
    h("label", { class: "cal-literal-field" }, h("span", {}, "Token name"), name),
    h("label", { class: "cal-literal-field" }, h("span", {}, "Put it in"), select),
    preview,
    error,
    h("div", { class: "cal-literal-actions" },
      h("button", { type: "button", onClick: () => { draft = null; render() } }, "Cancel"),
      h("button", { type: "submit", class: "cal-primary", disabled: saving }, saving ? "Creating…" : "Create token")))
    update()
    return form
  }

  /**
   * Why a name cannot be the new token's, or null.
   *
   * @param {string} name
   * @param {Literal} literal
   */
  const nameProblem = (name, literal) => {
    if (!/^--[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) return "A token name starts with -- and holds letters, digits, - and _."
    if (literalView._tag === "Ready" && literalView.taken.has(name)) return `${name} is already a custom property here. Pick another name.`
    if (literal.homes.length === 0) return "No rule with tokens reaches this element."
    return null
  }

  /**
   * Make the literal a token: both edits, once, after the user confirmed them.
   *
   * @param {Literal} literal
   * @param {Draft} state
   */
  const promote = async (literal, state) => {
    const problem = nameProblem(state.name, literal)
    const home = literal.homes[state.home]
    if (problem !== null || home === undefined) return render()
    state.status = { _tag: "Saving" }
    render()
    /** @param {Located} source */
    const span = source => ({ file: source.file, version: source.version, start: source.start, end: source.end, expected: source.value })
    try {
      const response = await fetch("knobs/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ take: variant()?.take ?? null, name: state.name, literal: span(literal.source), home: span(home.source) }),
      })
      const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
      if (response.ok) {
        draft = null
        literalNotice = `Made ${state.name} in ${home.selector}. Its knob is in the list above.`
      } else {
        state.status = { _tag: "Failed", reason: result._tag === "Conflict" ? result.reason : result.error ?? `HTTP ${response.status}` }
      }
    } catch (error) {
      state.status = { _tag: "Failed", reason: error instanceof Error ? error.message : String(error) }
    }
    render()
    schedule()
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
    showEverywhere(knob, value)
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
      showEverywhere(knob, value)
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
      showEverywhere(knob, knob.source.value)
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
      "data-origin": knob.origin._tag,
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
        const isColor = knob.origin._tag === "Property"
          ? /color/.test(knob.origin.registration.syntax)
          : CSS.supports("color", tokens.find(token => token.name === chosen)?.value ?? "")
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

  // Plain custom properties the part reads: a sentinel in the declaration
  // changes a longhand that names the property, on any element of the part.
  /** @type {Map<string, { site: Site, value: string, document: Document }>} */
  const plain = new Map()
  for (const { document, window } of list) {
    const graph = referenceGraph(referenceBlocks(document))
    const longhands = longhandsIn(document)
    const targets = readTargets(document)
    const host = document.getElementById("caliper-host")
    for (const name of plainProperties(document, registered)) {
      const readers = readersOf(graph, name, longhands)
      if (readers.length === 0) continue
      for (const candidate of declarationsOf(document, name)) {
        const site = { sheetId: candidate.sheetId, path: candidate.path, property: name, name, selector: candidate.selector }
        if (plain.has(siteKey(site))) continue
        // A reference names no type, so its type comes from the value the part sees.
        const text = /\bvar\(/.test(candidate.value) && host ? window.getComputedStyle(host).getPropertyValue(name).trim() : candidate.value
        const typed = sentinelFor(syntaxOfValue(text, CSS.supports("color", text)), text)
        const sentinels = [...(typed === null || typed === "caliper-knockout" ? [] : [typed]), "caliper-knockout"]
        if (isRead(window, targets, candidate, name, readers, sentinels)) plain.set(siteKey(site), { site, value: candidate.value, document })
      }
    }
  }

  // The @container rules whose thresholds reach the part.
  /** @type {Map<string, { site: Site, document: Document }>} */
  const containers = new Map()
  for (const { document } of list) {
    for (const { sheetId, path, rule } of containersOf(document)) {
      const site = { sheetId, path, property: "@container", name: "@container", selector: rule.conditionText }
      if (!containers.has(siteKey(site))) containers.set(siteKey(site), { site, document })
    }
  }

  // Locate every site, and each registered property's @property rule for its hints.
  /** @type {Map<string, { site: Site, document: Document }>} */
  const asks = new Map([...containers, ...plain])
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
      origin: { _tag: "Property", registration },
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
  for (const [key, { site, value, document }] of plain) {
    const where = site.selector
    const source = located.get(key)
    if (source === undefined || source._tag === "Refused") {
      skipped.push({ name: site.name, where, reason: source?.reason ?? "Caliper did not get an answer for it." })
      continue
    }
    const hints = mergeHints(configured[site.name], source.hints)
    const syntax = syntaxOfValue(source.value, !/\bvar\(/.test(source.value) && CSS.supports("color", source.value))
    const control = controlFor({ syntax, value: source.value, hints })
    if (control._tag === "Skip") {
      skipped.push({ name: site.name, where, reason: syntax === "*" && control.reason.startsWith("Caliper has no control") ? `Caliper has no control for a value like ${source.value}.` : control.reason })
      continue
    }
    if (source.value.replace(/\s+/g, " ") !== value.replace(/\s+/g, " ")) {
      skipped.push({ name: site.name, where, reason: "The frame's CSS and the file disagree. Caliper waits for the frame to reload." })
      continue
    }
    knobs.push({
      key,
      name: site.name,
      origin: { _tag: "Plain" },
      site,
      source,
      control,
      label: hints.label ?? labelFor(site.name),
      where: `in ${where}`,
      note: source.note,
      problems: [...source.problems],
      elements: [],
      document,
    })
  }
  for (const [key, { site, document }] of containers) {
    const source = located.get(key)
    if (source === undefined || source._tag === "Refused") {
      skipped.push({ name: "@container", where: site.selector, reason: source?.reason ?? "Caliper did not get an answer for it." })
      continue
    }
    const thresholds = thresholdsOf(source.value)
    if (thresholds.length === 0) {
      skipped.push({ name: "@container", where: source.value, reason: "Its condition has no size threshold to change." })
      continue
    }
    thresholds.forEach((threshold, index) => {
      // A threshold below zero never holds, so the range starts at 0 unless a hint says otherwise.
      const control = controlFor({ syntax: "<length>", value: threshold.text, hints: mergeHints({ min: 0 }, source.hints) })
      if (control._tag === "Skip") {
        skipped.push({ name: "@container", where: source.value, reason: control.reason })
        return
      }
      const label = source.hints.label === undefined ? threshold.label : thresholds.length === 1 ? source.hints.label : `${source.hints.label} · ${threshold.label}`
      knobs.push({
        key: `${key}#${index}`,
        name: "@container",
        origin: { _tag: "Threshold", index, condition: source.value },
        site,
        source: { ...source, start: source.start + threshold.start, end: source.start + threshold.end, value: threshold.text },
        control,
        label,
        where: source.value,
        note: source.note,
        problems: [...source.problems],
        elements: [],
        document,
      })
    })
  }
  knobs.sort((left, right) => left.source.file.localeCompare(right.source.file) || left.source.start - right.source.start)
  skipped.sort((left, right) => left.name.localeCompare(right.name))
  return { _tag: "Ready", knobs, skipped, problems }
}

/**
 * Find the literals that win on the part, where each lives in source, and
 * the rules a token for it can go in (decision 26; spike/knob-reads, part 2).
 * Every element of the part is tested, not a sample. A literal that
 * knockout cannot see change anything, such as `border: 0` with no border
 * style, is not offered.
 *
 * @param {Frame[]} list
 * @param {string | null} take
 * @returns {Promise<Extract<LiteralView, { _tag: "Ready" }>>}
 */
async function discoverLiterals(list, take) {
  /** @type {Map<string, { site: Site, value: string, elements: Element[], document: Document }>} */
  const found = new Map()
  /** @type {Set<string>} */
  const taken = new Set()
  for (const { document, window } of list) {
    for (const name of plainProperties(document, new Set())) taken.add(name)
    for (const name of registrations(document).keys()) taken.add(name)
    const host = document.getElementById("caliper-host")
    if (host === null) continue
    const elements = [host, ...host.querySelectorAll("*")]
    const longhands = longhandsIn(document)
    for (const { id, sheet } of projectSheets(document)) {
      for (const { rule, path } of walk(sheet.cssRules)) {
        if (kindOf(rule) !== "style") continue
        const style = /** @type {CSSStyleRule} */ (rule)
        for (const [property, value] of declarationsIn(style.style.cssText)) {
          if (property.startsWith("--")) continue
          let type = literalType(value, CSS.supports("color", value))
          // A zero is a length when the property takes one.
          if (type === "number" && Number(value) === 0 && CSS.supports(property, "1px")) type = "length"
          if (type === null) continue
          const site = { sheetId: id, path, property, name: property, selector: style.selectorText }
          const key = siteKey(site)
          const known = found.get(key)
          const candidate = { sheetId: id, path, selector: style.selectorText, value, priority: "", rule: style }
          const wins = literalWins(window, elements, candidate, property, longhands(property), literalSentinels(type))
          if (wins.length === 0) continue
          if (known === undefined) found.set(key, { site, value, elements: wins, document })
        }
      }
    }
  }
  // Each literal's homes, in its first frame; each home by its anchor declaration.
  /** @type {Map<string, { site: Site, document: Document }>} */
  const asks = new Map()
  /** @type {Map<string, Array<{ key: string, selector: string, anchor: string }>>} */
  const homesOf = new Map()
  for (const [key, { site, elements, document }] of found) {
    asks.set(key, { site, document })
    homesOf.set(key, tokenHomes(document, elements).map(home => {
      const anchor = { sheetId: home.sheetId, path: home.path, property: home.anchor, name: home.anchor, selector: home.selector }
      if (!asks.has(siteKey(anchor))) asks.set(siteKey(anchor), { site: anchor, document })
      return { key: siteKey(anchor), selector: home.selector, anchor: home.anchor }
    }))
  }
  const { located } = await locateAll([...asks.values()], take)
  /** @type {Literal[]} */
  const literals = []
  /** @type {Skipped[]} */
  const refused = []
  // The browser writes a value its own way (0 as 0px), so the source's text
  // is the literal; locating already checked it against the served CSS.
  for (const [key, { site, value }] of found) {
    const source = located.get(key)
    if (source === undefined || source._tag === "Refused") {
      refused.push({ name: `${site.property}: ${value}`, where: site.selector, reason: source?.reason ?? "Caliper did not get an answer for it." })
      continue
    }
    /** @type {Home[]} */
    const homes = (homesOf.get(key) ?? []).flatMap(home => {
      const anchor = located.get(home.key)
      return anchor?._tag === "Located" ? [{ selector: home.selector, anchor: home.anchor, source: anchor }] : []
    })
    literals.push({ key, property: site.property, value: source.value, selector: site.selector, source, homes })
  }
  literals.sort((left, right) => left.source.file.localeCompare(right.source.file) || left.source.start - right.source.start)
  return { _tag: "Ready", literals, refused, taken }
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
