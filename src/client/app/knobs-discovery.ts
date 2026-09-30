import type { KnobHints, KnobSource } from "../../types"
import { Type } from "typebox"
import { Check } from "typebox/value"
import { KnobHintsSchema } from "../../knobs/contract.js"

const SourceSchema = Type.Union([
  Type.Object({ _tag: Type.Literal("Refused"), reason: Type.String() }),
  Type.Object({ _tag: Type.Literal("Located"), file: Type.String({ minLength: 1 }), version: Type.String({ pattern: "^[0-9a-f]{16}$" }),
    start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 0 }), line: Type.Integer({ minimum: 1 }),
    value: Type.String(), hints: KnobHintsSchema, note: Type.String(), problems: Type.Array(Type.String()) }),
])
import {
  animatedProperties, containersOf, declarationsOf, initialComputed, isRead, kindOf, knockout, literalWins, longhandsIn,
  plainProperties, projectSheets, readTargets, referenceBlocks, registrations, sample, summarize, tokenHomes, walk,
} from "../knob-cssom.js"
import type { Registration, Site } from "../knob-cssom.js"
import {
  controlFor, declarationsIn, labelFor, literalSentinels, literalType, mergeHints, readersOf, referenceGraph,
  sentinelFor, syntaxOfValue, thresholdsOf,
} from "../knob-values.js"
import type { Control } from "../knob-values.js"

export type Request = <T>(path: string, data?: object) => Promise<T>
export type Located = Extract<KnobSource, { _tag: "Located" }>
export type Variant = { take: string | null; label: string }
export type Frame = { iframe: HTMLIFrameElement; document: Document; window: Window }
export type Origin = { _tag: "Property"; registration: Registration } | { _tag: "Plain" } | { _tag: "Threshold"; index: number; condition: string }
export type Knob = {
  key: string; name: string; origin: Origin; site: Site; source: Located
  control: Exclude<Control, { _tag: "Skip" }>; label: string; where: string; note: string
  problems: string[]; elements: Element[]; document: Document
}
export type Skipped = { name: string; where: string; reason: string }
export type Home = { selector: string; anchor: string; source: Located }
export type Literal = { key: string; property: string; value: string; selector: string; source: Located; homes: Home[] }
export type Found = { knobs: Knob[]; skipped: Skipped[]; problems: string[] }
export type FoundLiterals = { literals: Literal[]; refused: Skipped[]; taken: Set<string> }

export function siteKey(site: Pick<Site, "sheetId" | "path" | "property">) {
  return `${site.sheetId}#${site.path.join(".")}#${site.property}`
}

/** Preserve the CSSOM knockout discovery; source locations stay private to core. */
export async function discover(list: Frame[], target: Variant, request: Request): Promise<Found> {
  const registered = new Map<string, Registration & { document: Document }>()
  const animated = new Map<string, string>()
  for (const { document } of list) {
    for (const [name, registration] of registrations(document)) if (!registered.has(name)) registered.set(name, { ...registration, document })
    for (const [name, keyframes] of animatedProperties(document)) animated.set(name, keyframes)
  }
  const skipped: Skipped[] = []
  const sites = new Map<string, { site: Site; value: string; elements: Element[]; document: Document; registration: Registration }>()
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
    const rest: Array<{ document: Document; window: Window; elements: Element[] }> = []
    for (const { document, window } of list) {
      const elements = sample(document, 60)
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
    if (won) continue
    const fromInitial = rest.every(({ document, window, elements }) => {
      const initial = initialComputed(document, name)
      return elements.every(element => window.getComputedStyle(element).getPropertyValue(name) === initial)
    })
    if (fromInitial) {
      sites.set(siteKey(propertySite), { site: propertySite, value: registration.initialValue, elements: rest.flatMap(entry => entry.elements), document: registration.document, registration })
    } else {
      skipped.push({ name, where: "", reason: "Caliper could not find the declaration that sets it here." })
    }
  }
  const plain = new Map<string, { site: Site; value: string; document: Document }>()
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
        const text = /\bvar\(/.test(candidate.value) && host ? window.getComputedStyle(host).getPropertyValue(name).trim() : candidate.value
        const typed = sentinelFor(syntaxOfValue(text, CSS.supports("color", text)), text)
        const sentinels = [...(typed === null || typed === "caliper-knockout" ? [] : [typed]), "caliper-knockout"]
        if (isRead(window, targets, candidate, name, readers, sentinels)) plain.set(siteKey(site), { site, value: candidate.value, document })
      }
    }
  }
  const containers = new Map<string, { site: Site; document: Document }>()
  for (const { document } of list) {
    for (const { sheetId, path, rule } of containersOf(document)) {
      const site = { sheetId, path, property: "@container", name: "@container", selector: rule.conditionText }
      if (!containers.has(siteKey(site))) containers.set(siteKey(site), { site, document })
    }
  }
  const asks = new Map<string, { site: Site; document: Document }>([...containers, ...plain])
  for (const { site, document } of sites.values()) {
    asks.set(siteKey(site), { site, document })
    const registration = registered.get(site.name)
    if (registration) {
      const propertySite = { sheetId: registration.sheetId, path: registration.path, property: "initial-value", name: site.name, selector: "@property" }
      if (!asks.has(siteKey(propertySite))) asks.set(siteKey(propertySite), { site: propertySite, document: registration.document })
    }
  }
  const { located, configured, problems } = await locateAll([...asks.values()], target.take, request)
  const knobs: Knob[] = []
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
    knobs.push({ key, name: site.name, origin: { _tag: "Property", registration }, site: { ...site, syntax: registration.syntax, inherits: registration.inherits },
      source, control, label: hints.label ?? labelFor(site.name), where: site.property === "initial-value" ? "@property" : `in ${where}`,
      note: fromProperty?.note ?? "", problems: [...new Set([...(fromProperty?.problems ?? []), ...(site.property === "initial-value" ? [] : source.problems)])], elements, document })
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
    knobs.push({ key, name: site.name, origin: { _tag: "Plain" }, site, source, control, label: hints.label ?? labelFor(site.name), where: `in ${where}`, note: source.note, problems: [...source.problems], elements: [], document })
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
      const control = controlFor({ syntax: "<length>", value: threshold.text, hints: mergeHints({ min: 0 }, source.hints) })
      if (control._tag === "Skip") {
        skipped.push({ name: "@container", where: source.value, reason: control.reason })
        return
      }
      const label = source.hints.label === undefined ? threshold.label : thresholds.length === 1 ? source.hints.label : `${source.hints.label} · ${threshold.label}`
      knobs.push({ key: `${key}#${index}`, name: "@container", origin: { _tag: "Threshold", index, condition: source.value }, site,
        source: { ...source, start: source.start + threshold.start, end: source.start + threshold.end, value: threshold.text }, control, label, where: source.value,
        note: source.note, problems: [...source.problems], elements: [], document })
    })
  }
  knobs.sort((left, right) => left.source.file.localeCompare(right.source.file) || left.source.start - right.source.start)
  skipped.sort((left, right) => left.name.localeCompare(right.name))
  return { knobs, skipped, problems }
}

export async function discoverLiterals(list: Frame[], take: string | null, request: Request): Promise<FoundLiterals> {
  const found = new Map<string, { site: Site; value: string; elements: Element[]; document: Document }>()
  const taken = new Set<string>()
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
        const style = rule as CSSStyleRule
        for (const [property, value] of declarationsIn(style.style.cssText)) {
          if (property.startsWith("--")) continue
          let type = literalType(value, CSS.supports("color", value))
          if (type === "number" && Number(value) === 0 && CSS.supports(property, "1px")) type = "length"
          if (type === null) continue
          const site = { sheetId: id, path, property, name: property, selector: style.selectorText }
          const key = siteKey(site)
          const candidate = { sheetId: id, path, selector: style.selectorText, value, priority: "", rule: style }
          const wins = literalWins(window, elements, candidate, property, longhands(property), literalSentinels(type))
          if (wins.length > 0 && !found.has(key)) found.set(key, { site, value, elements: wins, document })
        }
      }
    }
  }
  const asks = new Map<string, { site: Site; document: Document }>()
  const homesOf = new Map<string, Array<{ key: string; selector: string; anchor: string }>>()
  for (const [key, { site, elements, document }] of found) {
    asks.set(key, { site, document })
    homesOf.set(key, tokenHomes(document, elements).map(home => {
      const anchor = { sheetId: home.sheetId, path: home.path, property: home.anchor, name: home.anchor, selector: home.selector }
      if (!asks.has(siteKey(anchor))) asks.set(siteKey(anchor), { site: anchor, document })
      return { key: siteKey(anchor), selector: home.selector, anchor: home.anchor }
    }))
  }
  const { located } = await locateAll([...asks.values()], take, request)
  const literals: Literal[] = []
  const refused: Skipped[] = []
  for (const [key, { site, value }] of found) {
    const source = located.get(key)
    if (source === undefined || source._tag === "Refused") {
      refused.push({ name: `${site.property}: ${value}`, where: site.selector, reason: source?.reason ?? "Caliper did not get an answer for it." })
      continue
    }
    const homes: Home[] = (homesOf.get(key) ?? []).flatMap(home => {
      const anchor = located.get(home.key)
      return anchor?._tag === "Located" ? [{ selector: home.selector, anchor: home.anchor, source: anchor }] : []
    })
    literals.push({ key, property: site.property, value: source.value, selector: site.selector, source, homes })
  }
  literals.sort((left, right) => left.source.file.localeCompare(right.source.file) || left.source.start - right.source.start)
  return { literals, refused, taken }
}

async function locateAll(asks: Array<{ site: Site; document: Document }>, take: string | null, request: Request) {
  const bySheet = new Map<string, typeof asks>()
  for (const ask of asks) bySheet.set(ask.site.sheetId, [...(bySheet.get(ask.site.sheetId) ?? []), ask])
  const located = new Map<string, KnobSource>()
  const configured: Record<string, KnobHints> = {}
  const problems = new Set<string>()
  await Promise.all([...bySheet].map(async ([sheetId, list]) => {
    const entry = projectSheets(list[0]!.document).find(candidate => candidate.id === sheetId)
    if (entry === undefined) {
      for (const { site } of list) located.set(siteKey(site), { _tag: "Refused", reason: "The frame no longer holds this stylesheet." })
      return
    }
    try {
      const answer = await request<{ results: KnobSource[]; configured: Record<string, KnobHints>; problems: string[] }>("knobs/locate", {
        sheet: sheetId, take, css: entry.node.textContent ?? "", rules: summarize(entry.sheet),
        targets: list.map(({ site }) => ({ path: site.path, property: site.property })),
      })
      if (!Array.isArray(answer.results) || answer.results.length !== list.length) throw new Error("The locate answer does not match its declarations.")
      list.forEach(({ site }, index) => {
        const source = answer.results[index]!
        if (!Check(SourceSchema, source) || (source._tag === "Located" && source.end < source.start)) throw new Error("The locate answer is not a source location.")
        located.set(siteKey(site), source)
      })
      if (!answer.configured || typeof answer.configured !== "object" || !Object.values(answer.configured).every(hints => Check(KnobHintsSchema, hints))) throw new Error("The locate answer has invalid hints.")
      if (!Array.isArray(answer.problems) || !answer.problems.every(problem => typeof problem === "string")) throw new Error("The locate answer has invalid problems.")
      Object.assign(configured, answer.configured)
      for (const problem of answer.problems) problems.add(problem)
    } catch (error) {
      const reason = errorReason(error)
      for (const { site } of list) located.set(siteKey(site), { _tag: "Refused", reason })
    }
  }))
  return { located, configured, problems: [...problems] }
}

export function errorReason(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object") {
    if ("reason" in error && typeof error.reason === "string") return error.reason
    if ("error" in error && typeof error.error === "string") return error.error
  }
  return String(error)
}

export function tokensOf(knob: Knob, token: string, namespace: string) {
  const element = knob.elements[0] ?? knob.document.documentElement
  const view = knob.document.defaultView
  const found = new Map<string, string>()
  for (const candidate of declarationsOf(knob.document, token)) {
    for (const name of candidate.rule.style) {
      if (!name.startsWith(namespace) || found.has(name)) continue
      found.set(name, (view?.getComputedStyle(element).getPropertyValue(name) ?? "").trim() || candidate.rule.style.getPropertyValue(name).trim())
    }
  }
  return [...found].map(([name, value]) => ({ name, value }))
}
