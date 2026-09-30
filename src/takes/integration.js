// @ts-check
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { Value } from "typebox/value"
import { fenceProjectPath, isTakeId, TAKES_DIR } from "./store.js"
import { integrationProposalSchema } from "./integration-contract.js"
// Preserve the existing public schema import while moving validation out of Node-only code.
export { integrationProposalSchema } from "./integration-contract.js"

/**
 * @typedef {import('typebox').Static<typeof integrationProposalSchema>} IntegrationProposal
 * @typedef {{ _tag: 'NotRun' } | { _tag: 'Passed', summary: string } | { _tag: 'Failed', reason: string }} Checks
 * @typedef {{ originals: Record<string, string>, sourceRevision: string }} Base
 * @typedef {{ _tag: 'Preparing', sourceTake: string, base: Base } | {
 *   _tag: 'Review', sourceTake: string, base: Base, proposal: IntegrationProposal,
 *   revision: string, checks: Checks, checkedRevision?: string
 * }} Integration
 * @typedef {{ path: string, before: string | null, after: string }} Change
 * @typedef {{ revision: string, proposal: IntegrationProposal, files: Change[], checks: Checks }} Review
 */

/** @param {unknown} value */
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex")
/** @param {unknown} error */
const reason = error => error instanceof Error ? error.message : String(error)

/**
 * A review is bound to the submitted bytes, not the take number. Its successful
 * check survives restart, but cannot authorize changed bytes or changed sources.
 * @param {import('./store.js').TakeStore} store
 */
export function createIntegrationReview(store) {
  const checking = new Set()

  // Reject links even when they currently resolve inside the project: otherwise
  // two reviewed paths could alias one target. Check ancestors, including the
  // take metadata directories, before asking the store to read or write.
  /** @param {string} path */
  const safe = path => {
    const parts = relative(store.root, path).split(sep)
    let cursor = store.root
    for (const [index, part] of parts.entries()) {
      cursor = join(cursor, part)
      let stat
      try { stat = lstatSync(cursor) } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") break
        throw error
      }
      if (stat.isSymbolicLink()) throw new Error(`Unsafe symbolic link: ${cursor}. Remove the link before reviewing.`)
      if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`Not a directory: ${cursor}.`)
      if (index === parts.length - 1 && !stat.isFile() && !stat.isDirectory()) throw new Error(`Not a regular file: ${cursor}.`)
    }
    return path
  }
  /** @param {string} file */
  const project = file => {
    if (typeof file !== "string" || file.includes("\\") || file.includes("\0") || file.split("/").includes("..")) {
      throw new Error("Invalid project path: path traversal is not allowed.")
    }
    const fenced = fenceProjectPath(store.root, file)
    if (fenced._tag === "Outside") throw new Error(fenced.reason)
    if (fenced.file !== file) throw new Error(`Use the canonical project path: ${fenced.file}.`)
    return safe(join(store.root, fenced.file))
  }
  /** @param {string} take */
  const record = take => {
    if (!isTakeId(take)) throw new Error(`Invalid take number: ${take}.`)
    safe(join(store.root, TAKES_DIR, `${take}.json`))
    const folder = safe(join(store.root, TAKES_DIR, take))
    const result = store.record(take)
    if (result === null || !existsSync(folder)) throw new Error(`Take ${take} is missing. Prepare a new integration from an existing source take.`)
    return result
  }
  /** @param {string} take @returns {Array<{path: string, after: string}>} */
  const copies = take => {
    record(take)
    const folder = join(store.root, TAKES_DIR, take)
    /** @type {Array<{path: string, after: string}>} */
    const result = []
    /** @param {string} directory */
    const walk = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = safe(join(directory, entry.name))
        if (entry.isDirectory()) walk(absolute)
        else {
          const path = relative(folder, absolute).split(sep).join("/")
          project(path)
          result.push({ path, after: readFileSync(absolute, "utf8") })
        }
      }
    }
    walk(folder)
    return result.sort((a, b) => a.path.localeCompare(b.path, "en"))
  }
  /** @param {string} path @returns {string | null} */
  const original = path => {
    project(path)
    return store.original(path)
  }
  /** @param {string} take */
  const state = take => {
    const integration = record(take).integration
    if (!integration || (integration._tag !== "Preparing" && integration._tag !== "Review")) {
      throw new Error(`Take ${take} is not an integration proposal.`)
    }
    if (integration.sourceTake === take) throw new Error("An integration must have a separate source take.")
    record(integration.sourceTake)
    return integration
  }
  /** @param {string} take */
  const idle = take => {
    if (checking.has(take)) throw new Error(`Take ${take} has a check in progress. Wait for it to finish.`)
  }
  /** @param {Integration} integration @param {string[]} paths */
  const baseline = (integration, paths) => {
    const known = new Set(Object.keys(integration.base.originals))
    for (const path of store.listFiles(integration.sourceTake, "")) {
      if (!known.has(path) && original(path) !== null) {
        throw new Error(`Project source "${path}" was added after preparation. Prepare a new integration so its callers are checked.`)
      }
    }
    if (hash({ record: record(integration.sourceTake), copies: copies(integration.sourceTake) }) !== integration.base.sourceRevision) {
      throw new Error("The source take changed after preparation. Prepare a new integration.")
    }
    for (const path of new Set([...Object.keys(integration.base.originals), ...paths])) {
      const content = original(path)
      const expected = Object.hasOwn(integration.base.originals, path) ? integration.base.originals[path] : hash(null)
      if (hash(content) !== expected) throw new Error(`Project source "${path}" changed after preparation. Prepare a new integration; do not overwrite the newer source.`)
    }
  }
  /** @param {unknown} proposal @returns {IntegrationProposal} */
  const validate = proposal => {
    if (!Value.Check(integrationProposalSchema, proposal)) throw new Error("Invalid integration proposal. Supply variant/component, nonblank summary, shared, preserved, usage, and preview part/state within their length limits.")
    return structuredClone(proposal)
  }
  /** @param {string} take @param {IntegrationProposal} proposal */
  const preview = (take, proposal) => {
    const part = proposal.preview.part
    project(part)
    if (!part.endsWith(".part.tsx")) throw new Error("The preview must name a product-owned *.part.tsx file.")
    const copy = safe(join(store.root, TAKES_DIR, take, part))
    if (!existsSync(copy) && original(part) === null) throw new Error(`Preview "${part}" does not exist in the take or project.`)
    if (existsSync(copy) && !lstatSync(copy).isFile()) throw new Error(`Preview "${part}" is not a file.`)
  }
  /** @param {string} take @param {Integration} integration @param {IntegrationProposal} proposal */
  const snapshot = (take, integration, proposal) => {
    const edited = copies(take)
    baseline(integration, [...edited.map(file => file.path), proposal.preview.part])
    preview(take, proposal)
    const all = edited.map(file => ({ ...file, before: original(file.path) }))
    const files = all.filter(file => file.before !== file.after)
    if (files.length === 0) throw new Error("The integration has no changed files. Edit the proposal before submitting it.")
    return { revision: hash({ proposal, files: all, base: integration.base }), proposal, files }
  }

  /** @param {string} sourceTake @returns {string} */
  const begin = sourceTake => {
    const source = record(sourceTake)
    if (source.integration) throw new Error("Prepare an alternate from an experiment, not another integration proposal.")
    const edited = copies(sourceTake)
    /** @type {Record<string, string>} */
    const originals = Object.create(null)
    for (const path of store.listFiles(sourceTake, "")) {
      const content = original(path)
      if (content !== null) originals[path] = hash(content)
    }
    const base = { originals, sourceRevision: hash({ record: source, copies: edited }) }
    // Spread the ask so future product context survives without another copier.
    return store.fork(sourceTake, { ...source, name: `${source.name ?? `Take ${sourceTake}`} alternate`.slice(0, 80), integration: { _tag: "Preparing", sourceTake, base } })
  }
  /** @param {string} take @param {unknown} input @returns {Review} */
  const submit = (take, input) => {
    idle(take)
    const integration = state(take)
    const proposal = validate(input)
    const current = snapshot(take, integration, proposal)
    store.update(take, { integration: {
      _tag: "Review", sourceTake: integration.sourceTake, base: integration.base,
      proposal, revision: current.revision, checks: { _tag: "NotRun" },
    } })
    return { ...current, checks: { _tag: "NotRun" } }
  }
  /** @param {string} take @returns {Review} */
  const review = take => {
    const integration = state(take)
    if (integration._tag !== "Review") throw new Error("The integration is still preparing. Submit its proposal first.")
    const current = snapshot(take, integration, validate(integration.proposal))
    if (current.revision !== integration.revision) throw new Error("The proposal changed after submission. Resubmit it and run checks again.")
    const checks = integration.checks._tag === "Passed" && integration.checkedRevision !== current.revision
      ? /** @type {Checks} */ ({ _tag: "NotRun" }) : integration.checks
    return { ...current, checks }
  }
  /** @param {string} take @param {() => Promise<string>} verify @returns {Promise<Review>} */
  const check = async (take, verify) => {
    idle(take)
    const before = review(take)
    const initial = state(take)
    if (initial._tag !== "Review") throw new Error("The proposal is no longer in review.")
    store.update(take, { integration: { ...initial, checks: { _tag: "NotRun" }, checkedRevision: undefined } })
    checking.add(take)
    try {
      const summary = await verify()
      if (typeof summary !== "string" || summary.trim() === "") throw new Error("Verification returned no summary.")
      const after = review(take)
      if (before.revision !== after.revision) throw new Error("The proposal changed during verification. Resubmit and check again.")
      const integration = state(take)
      if (integration._tag !== "Review") throw new Error("The proposal is no longer in review.")
      store.update(take, { integration: { ...integration, checks: { _tag: "Passed", summary }, checkedRevision: after.revision } })
    } catch (error) {
      // Persist the failure even for races. A stale review still throws below;
      // it must never display an old success or permit applying after restart.
      const integration = record(take).integration
      if (integration?._tag === "Review") store.update(take, { integration: { ...integration, checks: { _tag: "Failed", reason: reason(error) }, checkedRevision: undefined } })
    } finally {
      checking.delete(take)
    }
    return review(take)
  }
  /** @param {string} take @param {string} revision @param {boolean} behaviorReviewed @returns {string[]} */
  const apply = (take, revision, behaviorReviewed) => {
    idle(take)
    const current = review(take)
    if (current.revision !== revision) throw new Error("The review revision does not match. Reload the review before applying.")
    if (current.checks._tag !== "Passed") throw new Error("Run successful checks for this review before applying.")
    if (behaviorReviewed !== true) throw new Error("Confirm that you reviewed product behavior and typecheck before applying.")
    // Read every target and validate every ancestor before the first write.
    const targets = current.files.map(file => {
      const target = project(file.path)
      return { ...file, target, bytes: existsSync(target) ? readFileSync(target) : null }
    })
    /** @type {typeof targets} */
    const attempted = []
    try {
      for (const target of targets) {
        project(target.path)
        attempted.push(target)
        mkdirSync(dirname(target.target), { recursive: true })
        writeFileSync(target.target, target.after)
      }
    } catch (error) {
      const failures = []
      for (const target of attempted.reverse()) {
        try {
          project(target.path)
          if (target.bytes === null) rmSync(target.target, { force: true })
          else if (!existsSync(target.target) || !readFileSync(target.target).equals(target.bytes)) writeFileSync(target.target, target.bytes)
        } catch (restoreError) { failures.push(`${target.path}: ${reason(restoreError)}`) }
      }
      throw new Error(`Apply failed; the proposal is saved for retry. ${reason(error)}${failures.length ? ` Restoration failed: ${failures.join("; ")}` : " Original target contents restored."}`)
    }
    store.discard(take)
    return current.files.map(file => file.path)
  }
  /** @param {string} take */
  const summary = take => {
    const integration = record(take).integration
    if (!integration) return undefined
    return integration._tag === "Preparing"
      ? { _tag: /** @type {const} */ ("Preparing"), sourceTake: integration.sourceTake }
      : { _tag: /** @type {const} */ ("Review"), sourceTake: integration.sourceTake, proposal: validate(integration.proposal) }
  }
  return { begin, submit, review, check, apply, summary }
}
