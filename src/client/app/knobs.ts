import type { Availability, KnobControl, KnobsView, KnobWrite, LiteralsView } from "../ui/contract"
import { applyLive, observeSheets } from "../knob-cssom.js"
import { clampTo, controlFor, formatNumber, namespaceOf, parseNumber, replaceThreshold, suggestTokenName } from "../knob-values.js"
import {
  discover, discoverLiterals, errorReason, siteKey, tokensOf,
  type Found, type FoundLiterals, type Frame, type Knob, type Literal, type Located, type Request, type Variant,
} from "./knobs-discovery"

const SETTLE_MS = 150
const COMMIT_MS = 3000
const SAVED_MS = 1500
const enabled: Availability = { _tag: "Enabled" }
const disabled = (reason: string): Availability => ({ _tag: "Disabled", reason })
type Model = { _tag: "Closed" } | { _tag: "Idle"; message: string } | { _tag: "Finding" } | ({ _tag: "Ready" } & Found)
type LiteralModel = { _tag: "Closed" } | { _tag: "Finding" } | { _tag: "Failed"; reason: string } | ({ _tag: "Ready" } & FoundLiterals)
type Draft = { id: string; name: string; home: string; status: "Editing" | "Saving" | "Failed"; reason: string }
type Result = { _tag: "Written" | "Promoted" } | { _tag: "Conflict"; reason: string } | { error: string }

/** No DOM rendering. Located spans, live CSSOM edits and write preconditions belong to core. */
export function createKnobsController({ request, changed, frames, variant }: {
  request: Request; changed: () => void; frames: () => HTMLIFrameElement[]; variant: () => Variant | null
}) {
  let model: Model = { _tag: "Closed" }
  let literalModel: LiteralModel = { _tag: "Closed" }
  let target: Variant | null = null
  let open = false
  let dead = false
  let generation = 0
  let literalGeneration = 0
  let epoch = 0
  let settle: ReturnType<typeof setTimeout> | undefined
  let literalsShown = false
  let draft: Draft | null = null
  let notice = ""
  const live = new Map<string, { knob: Knob; value: string; until: number }>()
  const textDrafts = new Map<string, string>()
  const writes = new Map<string, KnobWrite>()
  const controls = new Map<string, KnobControl>()
  const observed = new Map<Document, () => void>()
  let literalDocuments = new Set<Document>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const notify = () => { if (!dead) changed() }
  const later = (callback: () => void, ms: number) => {
    const timer = setTimeout(() => { timers.delete(timer); if (!dead) callback() }, ms)
    timers.add(timer)
  }
  const identity = (key: string) => JSON.stringify([target?.take ?? null, key])
  const current = () => !dead && open && target !== null && variant()?.take === target.take
  const variantFrames = (): Frame[] => {
    const next = variant()
    if (next === null) return []
    return frames().flatMap(iframe => {
      const src = iframe.getAttribute("src")
      const document = iframe.contentDocument
      const window = iframe.contentWindow
      if (!src || !document || !window || new URL(src, globalThis.location?.href ?? "http://localhost/").searchParams.get("take") !== next.take) return []
      // A keyed iframe can retain its old document while its new src loads.
      // Do not let that old scenario authorize a current action.
      if (document.location) {
        const wanted = new URL(src, globalThis.location?.href ?? "http://localhost/").searchParams
        const loaded = new URLSearchParams(document.location.search)
        if (["part", "state", "take"].some(key => wanted.get(key) !== loaded.get(key))) return []
      }
      const state = document.documentElement.dataset.caliperState
      return state === "Rendered" || state === "Empty" ? [{ iframe, document, window }] : []
    })
  }
  const siteText = (knob: Knob, value: string) => {
    if (knob.origin._tag !== "Threshold") return value
    let condition = knob.origin.condition
    for (const { knob: other, value: shown } of live.values()) {
      if (other.key !== knob.key && other.origin._tag === "Threshold" && siteKey(other.site) === siteKey(knob.site)) condition = replaceThreshold(condition, other.origin.index, shown)
    }
    return replaceThreshold(condition, knob.origin.index, value)
  }
  const showEverywhere = (knob: Knob, value: string) => {
    for (const { document } of variantFrames()) applyLive(document, knob.site, siteText(knob, value))
  }
  const restore = () => {
    // Closing or changing variants cancels uncommitted input, not a save
    // already sent to the server. Restoring that save's old located value
    // after HMR would leave the frame behind the file with no observer.
    const entries = [...live.values()].filter(entry => entry.until === Infinity && writes.get(entry.knob.key)?._tag !== "Saving")
    live.clear()
    textDrafts.clear()
    for (const document of observed.keys()) for (const { knob } of entries) applyLive(document, knob.site, siteText(knob, knob.source.value))
  }
  const stopWatching = () => { for (const stop of observed.values()) stop(); observed.clear() }
  const adopt = () => {
    const next = variant()
    if (target?.take === next?.take && (target === null) === (next === null)) {
      target = next === null ? null : { ...next }
      return false
    }
    restore()
    stopWatching()
    target = next === null ? null : { ...next }
    epoch++
    generation++
    literalGeneration++
    writes.clear()
    controls.clear()
    draft = null
    notice = ""
    literalModel = { _tag: "Closed" }
    literalDocuments.clear()
    model = open ? { _tag: "Finding" } : { _tag: "Closed" }
    return true
  }
  const watch = (list: Frame[]) => {
    const documents = new Set(list.map(frame => frame.document))
    for (const [document, stop] of observed) if (!documents.has(document)) { stop(); observed.delete(document) }
    for (const { document } of list) {
      if (observed.has(document)) continue
      observed.set(document, observeSheets(document, () => {
        if (!current()) return
        for (const { knob, value } of live.values()) applyLive(document, knob.site, siteText(knob, value))
        schedule()
      }))
      for (const { knob, value } of live.values()) applyLive(document, knob.site, siteText(knob, value))
    }
  }
  const editing = () => textDrafts.size > 0 || [...live.values()].some(entry => entry.until === Infinity) || [...writes.values()].some(write => write._tag === "Saving")
  const schedule = () => {
    if (!open || dead) return
    clearTimeout(settle)
    settle = setTimeout(() => { if (editing()) schedule(); else void find() }, SETTLE_MS)
  }
  const controlView = (knob: Knob): KnobControl => {
    const control = knob.control
    if (control._tag !== "Token") return control._tag === "Choice" ? { _tag: "Choice", options: [...control.options] } : { ...control }
    const options = tokensOf(knob, control.token, control.namespace)
    return { _tag: "Token", chosen: control.token, options, color: knob.origin._tag === "Property"
      ? /color/.test(knob.origin.registration.syntax) : CSS.supports("color", options.find(token => token.name === control.token)?.value ?? "") }
  }
  const find = async () => {
    if (!open || dead) return
    adopt()
    const id = ++generation
    const ownEpoch = epoch
    const list = variantFrames()
    if (target === null) { model = { _tag: "Idle", message: "Pick a part to see its knobs." }; notify(); return }
    if (list.length === 0) { model = { _tag: "Idle", message: "The knobs appear when a frame of these files has rendered." }; notify(); return }
    watch(list)
    if (editing()) { schedule(); return }
    if (model._tag !== "Ready") { model = { _tag: "Finding" }; notify() }
    try {
      const found = await discover(list, target, request)
      if (!current() || ownEpoch !== epoch || id !== generation || editing()) return
      for (const [key, entry] of live) {
        const knob = found.knobs.find(candidate => candidate.key === key)
        if (knob === undefined || knob.source.value === entry.value || Date.now() > entry.until) {
          live.delete(key)
          // A timeout must restore the CSSOM as well as the displayed value.
          if (knob && knob.source.value !== entry.value) showEverywhere(knob, knob.source.value)
        }
      }
      controls.clear()
      for (const knob of found.knobs) controls.set(knob.key, controlView(knob))
      model = { _tag: "Ready", ...found }
      notify()
      if (literalsShown) void findLiterals()
    } catch (error) {
      if (!current() || ownEpoch !== epoch || id !== generation) return
      model = { _tag: "Idle", message: `Caliper could not find the knobs: ${errorReason(error)}` }
      notify()
    }
  }
  const findLiterals = async () => {
    const id = ++literalGeneration
    const ownEpoch = epoch
    const list = variantFrames()
    if (!current() || !literalsShown || target === null || list.length === 0 || draft?.status === "Saving") return
    if (literalModel._tag !== "Ready") { literalModel = { _tag: "Finding" }; notify() }
    try {
      const found = await discoverLiterals(list, target.take, request)
      if (!current() || !literalsShown || ownEpoch !== epoch || id !== literalGeneration) return
      literalModel = { _tag: "Ready", ...found }
      literalDocuments = new Set(list.map(frame => frame.document))
      if (draft && !found.literals.some(literal => identity(literal.key) === draft?.id)) draft = null
    } catch (error) {
      if (!current() || !literalsShown || ownEpoch !== epoch || id !== literalGeneration) return
      literalModel = { _tag: "Failed", reason: `Caliper could not find the literals: ${errorReason(error)}` }
    }
    notify()
  }
  const knobById = (id: string) => current() && model._tag === "Ready" ? model.knobs.find(knob => identity(knob.key) === id && variantFrames().some(frame => frame.document === knob.document)) : undefined
  const literalById = (id: string) => current() && literalsShown && literalModel._tag === "Ready" && variantFrames().some(frame => literalDocuments.has(frame.document))
    ? literalModel.literals.find(literal => identity(literal.key) === id) : undefined
  const valueFor = (knob: Knob) => live.get(knob.key)?.value ?? knob.source.value
  const normalize = (knob: Knob, value: string): string | null => {
    switch (knob.control._tag) {
      case "Number": {
        const parsed = parseNumber(value)
        if (!parsed || !Number.isFinite(parsed.number) || (parsed.unit !== "" && parsed.unit !== knob.control.unit)) return null
        return formatNumber(clampTo(knob.control, parsed.number), knob.control.unit, knob.control.step)
      }
      case "Color": return CSS.supports("color", value.trim()) ? value.trim() : null
      case "Choice": return knob.control.options.includes(value) ? value : null
      case "Token": {
        const name = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)?.[1]
        const control = controls.get(knob.key)
        return name && control?._tag === "Token" && control.options.some(option => option.name === name) ? `var(${name})` : null
      }
    }
  }
  const preview = (knob: Knob, value: string) => {
    textDrafts.delete(knob.key)
    live.set(knob.key, { knob, value, until: Infinity })
    writes.delete(knob.key)
    showEverywhere(knob, value)
    notify()
  }
  const commit = async (id: string, value: string) => {
    const knob = knobById(id)
    if (!knob || writes.get(knob.key)?._tag === "Saving") return
    const next = normalize(knob, value)
    textDrafts.delete(knob.key)
    if (next === null) {
      live.delete(knob.key)
      showEverywhere(knob, knob.source.value)
      notify()
      schedule()
      return
    }
    if (next === knob.source.value) {
      live.delete(knob.key)
      showEverywhere(knob, next)
      notify()
      schedule()
      return
    }
    const ownEpoch = epoch
    const take = target!.take
    preview(knob, next)
    writes.set(knob.key, { _tag: "Saving" })
    notify()
    let status: KnobWrite
    try {
      const result = await request<Result>("knobs/write", { file: knob.source.file, take, version: knob.source.version,
        start: knob.source.start, end: knob.source.end, expected: knob.source.value, value: next })
      status = "error" in result ? { _tag: "Failed", reason: result.error } : result._tag === "Conflict" ? result : result._tag === "Written" ? { _tag: "Saved" } : { _tag: "Failed", reason: "The server did not confirm the knob write." }
    } catch (error) {
      status = { _tag: isConflict(error) ? "Conflict" : "Failed", reason: errorReason(error) }
    }
    if (dead || ownEpoch !== epoch || variant()?.take !== take) return
    if (status._tag === "Saved") {
      const entry = live.get(knob.key)
      if (entry) entry.until = Date.now() + COMMIT_MS
      later(() => { if (ownEpoch === epoch && writes.get(knob.key)?._tag === "Saved") { writes.delete(knob.key); notify() } }, SAVED_MS)
      later(schedule, COMMIT_MS)
    } else {
      live.delete(knob.key)
      showEverywhere(knob, knob.source.value)
    }
    writes.set(knob.key, status)
    notify()
    schedule()
  }
  const nameProblem = (name: string, literal: Literal) => {
    if (!/^--[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) return "A token name starts with -- and holds letters, digits, - and _."
    if (literalModel._tag === "Ready" && literalModel.taken.has(name)) return `${name} is already a custom property here. Pick another name.`
    if (literal.homes.length === 0) return "No rule with tokens reaches this element."
    return ""
  }
  const homeId = (literal: Literal, index: number) => {
    const home = literal.homes[index]!
    return JSON.stringify([identity(literal.key), home.source.file, home.source.start, home.anchor])
  }
  const promote = async (id: string) => {
    const literal = literalById(id)
    const state = draft
    if (!literal || !state || state.id !== id || state.status === "Saving" || nameProblem(state.name, literal)) return
    const home = literal.homes.find((_, index) => homeId(literal, index) === state.home)
    if (!home) return
    const ownEpoch = epoch
    const take = target!.take
    const span = (source: Located) => ({ file: source.file, version: source.version, start: source.start, end: source.end, expected: source.value })
    state.status = "Saving"
    notify()
    try {
      const result = await request<Result>("knobs/promote", { take, name: state.name, literal: span(literal.source), home: span(home.source) })
      if (dead || ownEpoch !== epoch || variant()?.take !== take || draft !== state) return
      if (!("error" in result) && result._tag === "Promoted") {
        draft = null
        notice = `Made ${state.name} in ${home.selector}. Its knob is in the list above.`
      } else {
        state.status = "Failed"
        state.reason = "error" in result ? result.error : result._tag === "Conflict" ? result.reason : "The server did not confirm the token promotion."
      }
    } catch (error) {
      if (dead || ownEpoch !== epoch || variant()?.take !== take || draft !== state) return
      state.status = "Failed"
      state.reason = errorReason(error)
    }
    notify()
    schedule()
  }
  const literalsView = (): LiteralsView => {
    if (!literalsShown) return { _tag: "Closed" }
    if (literalModel._tag === "Closed") return { _tag: "Finding" }
    if (literalModel._tag !== "Ready") return { ...literalModel }
    return { _tag: "Ready", notice, refused: literalModel.refused.map(item => ({ ...item })), literals: literalModel.literals.map(literal => {
      const state = draft?.id === identity(literal.key) ? draft : null
      const home = state ? literal.homes.find((_, index) => homeId(literal, index) === state.home) : undefined
      const problem = state ? (state.status === "Failed" ? state.reason : nameProblem(state.name, literal)) : ""
      const fileLine = (source: Located) => `${source.file.split("/").pop()}:${source.line}`
      return { id: identity(literal.key), property: literal.property, value: literal.value, selector: literal.selector,
        source: { file: literal.source.file, line: literal.source.line },
        homes: literal.homes.map((home, index) => ({ id: homeId(literal, index), label: `${home.selector} · ${fileLine(home.source)}` })),
        draft: state === null ? { _tag: "Closed" } : { _tag: state.status, name: state.name, home: state.home, problem,
          preview: home ? `Adds ${state.name}: ${literal.value}; to ${home.selector} (${fileLine(home.source)}), and writes var(${state.name}) in its place (${fileLine(literal.source)}).` : "No rule with tokens reaches this element, so a token has nowhere to go. Declare a custom property in a rule around it first.",
          create: state.status === "Saving" ? disabled("Creating token…") : problem || !home ? disabled(problem || "Pick a rule for the token.") : { ...enabled } },
      }
    }) }
  }
  const getView = (): KnobsView => {
    if (model._tag === "Finding") return { _tag: "Finding", target: target?.label ?? "" }
    if (model._tag !== "Ready") return { ...model }
    return { _tag: "Ready", target: target?.label ?? "", skipped: model.skipped.map(item => ({ ...item })), problems: [...model.problems], literals: literalsView(),
      knobs: model.knobs.map(knob => {
        const value = valueFor(knob)
        const base = controls.get(knob.key)!
        const control: KnobControl = base._tag === "Number" ? { ...base, ...(parseNumber(value) ?? {}) }
          : base._tag === "Token" ? { ...base, chosen: /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)?.[1] ?? base.chosen, options: base.options.map(option => ({ ...option })) }
          : base._tag === "Choice" ? { ...base, options: [...base.options] } : (() => {
            const color = controlFor({ syntax: "<color>", value, hints: {} })
            return { _tag: "Color" as const, hex: color._tag === "Color" ? color.hex : base.hex }
          })()
        const write = writes.get(knob.key) ?? { _tag: "Idle" }
        return { id: identity(knob.key), name: knob.name, label: knob.label, value: textDrafts.get(knob.key) ?? value, origin: knob.origin._tag, where: knob.where,
          source: { file: knob.source.file, line: knob.source.line }, note: knob.note, problems: [...knob.problems], control, write: { ...write },
          edit: write._tag === "Saving" ? disabled("Saving…") : { ...enabled } }
      }) }
  }
  return {
    sync(next: boolean) {
      if (dead) return
      const moved = adopt()
      if (open === next && !moved) return
      open = next
      if (open) void find()
      else {
        generation++
        literalGeneration++
        clearTimeout(settle)
        restore()
        stopWatching()
        model = { _tag: "Closed" }
        notify()
      }
    },
    refresh() {
      if (dead) return
      if (adopt()) { if (open) void find(); return }
      if (open) { watch(variantFrames()); schedule() }
    },
    getView,
    input(id: string, value: string) {
      const knob = knobById(id)
      if (!knob || writes.get(knob.key)?._tag === "Saving") return
      const next = normalize(knob, value)
      if (next !== null) { generation++; preview(knob, next) }
      else if (knob.control._tag === "Color") { generation++; textDrafts.set(knob.key, value); notify() }
    },
    commit(id: string, value: string) { void commit(id, value) },
    cancel(id: string) {
      const knob = knobById(id)
      if (!knob || writes.get(knob.key)?._tag === "Saving") return
      live.delete(knob.key)
      textDrafts.delete(knob.key)
      writes.delete(knob.key)
      showEverywhere(knob, knob.source.value)
      notify()
      schedule()
    },
    literalsOpen(next: boolean) {
      if (!current() || next === literalsShown) return
      literalsShown = next
      literalGeneration++
      if (next) void findLiterals()
      notify()
    },
    literalDraft(id: string, next: boolean) {
      const literal = literalById(id)
      if (!literal || draft?.status === "Saving") return
      notice = ""
      draft = next ? { id, name: suggestTokenName(literal.selector, literal.property, literal.homes[0] ? namespaceOf(literal.homes[0].anchor) : "--"),
        home: literal.homes.length ? homeId(literal, 0) : "", status: "Editing", reason: "" } : null
      notify()
    },
    literalName(id: string, name: string) {
      if (!literalById(id) || draft?.id !== id || draft.status === "Saving") return
      draft.name = name.trim()
      draft.status = "Editing"
      draft.reason = ""
      notify()
    },
    literalHome(id: string, home: string) {
      const literal = literalById(id)
      if (!literal || draft?.id !== id || draft.status === "Saving" || !literal.homes.some((_, index) => homeId(literal, index) === home)) return
      draft.home = home
      notify()
    },
    promote(id: string) { void promote(id) },
    destroy() {
      if (dead) return
      restore()
      stopWatching()
      dead = true
      open = false
      generation++
      literalGeneration++
      clearTimeout(settle)
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      model = { _tag: "Closed" }
    },
  }
}

function isConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if ("_tag" in error && error._tag === "Conflict") return true
  if ("status" in error && error.status === 409) return true
  if ("cause" in error) return isConflict(error.cause)
  return false
}
