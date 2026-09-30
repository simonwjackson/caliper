// @ts-check
import { readFileSync } from "node:fs"
import { Check } from "typebox/value"
import { DEVICES } from "../client/device-frame.js"
import { contextsFor, sameState } from "../client/scenarios.js"
import { json, readJson, refuse } from "../http.js"
import { planSend } from "../takes/send-plan.js"
import { MarkChangeSchema, NewMarkSchema, RevisionSchema } from "../takes/marks-contract.js"
import { StaleDraft } from "../takes/marks.js"
import { markupMessage } from "./markup-message.js"

/**
 * The draft of marks and Send, on the dev server under `/__caliper/marks`.
 *
 * Every route that changes the draft is a POST with the revision it saw. A
 * stale revision gets 409 and the current draft. Send checks the whole pass
 * again on the server: the draft revision, each parent's identity, kind and
 * run, and each mark's element in a fresh render. One failure refuses the
 * whole pass; no take starts.
 *
 * @typedef {import("../takes/marks-contract.js").Draft} Draft
 * @typedef {import("../takes/marks-contract.js").Mark} Mark
 * @typedef {import("../takes/store.js").TakeRecord} TakeRecord
 * @typedef {import("../takes/store.js").TakeIdentity} TakeIdentity
 * @typedef {import("../render/plan.js").RenderJob} RenderJob
 * @typedef {import("../render/render.js").RenderResult} RenderResult
 */

/**
 * @param {{
 *   store: import("../takes/store.js").TakeStore,
 *   marks: import("../takes/marks.js").MarkStore,
 *   agents: Pick<ReturnType<typeof import("./take-agents.js").createTakeAgents>, "views" | "fork" | "startMarkup">,
 *   project: () => Promise<import("../types").Project>,
 *   validateTake: (parts: readonly import("../types").Part[], record: TakeRecord) => void,
 *   render: (jobs: RenderJob[]) => Promise<RenderResult[]>,
 *   onDraft: (draft: Draft) => void,
 *   agentProblem: () => string | null,
 * }} input
 *   `render` renders take jobs with annotations. `onDraft` tells every chrome about a new draft.
 *   `agentProblem` says why no agent can start, so Send never spends the draft on takes that cannot run.
 */
export function createMarkupApi({ store, marks, agents, project, validateTake, render, onDraft, agentProblem }) {
  let sending = false

  /**
   * The take a mark goes on must exist at that creation time and be an
   * experiment. The preview is its subject or a declared scenario of it.
   *
   * @param {Mark["source"]} source @param {Mark["preview"]} preview @param {string} device
   */
  const markable = async (source, preview, device) => {
    const record = store.record(source.take)
    if (record === null || record.created !== source.created) throw new Error(`Take ${source.take} is no longer the take you marked. Reload the takes.`)
    if (record.integration) throw new Error(`Take ${source.take} is an alternate. Alternates have their own review and cannot be marked.`)
    const { parts } = await project()
    if (!sameState(preview, record) && !contextsFor(parts, record).some(context => sameState(context, preview))) throw new Error(`Take ${source.take} does not show ${preview.part} · ${preview.state}.`)
    if (!DEVICES.some(candidate => candidate.id === device)) throw new Error(`Caliper has no device "${device}".`)
  }

  /** @param {Draft} draft */
  const changed = draft => {
    onDraft(draft)
    return draft
  }

  /**
   * @param {string} path below `/__caliper`
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @returns {Promise<boolean>} false when the path is not a marks route
   */
  const handle = async (path, request, response) => {
    if (path === "/marks.json") {
      try { json(response, 200, marks.read()) }
      catch (error) { json(response, 500, { error: message(error) }) }
      return true
    }
    if (path !== "/marks" && !path.startsWith("/marks/")) return false
    const refusal = refuse(request)
    if (refusal !== null) {
      json(response, 403, { error: refusal })
      return true
    }
    try {
      const body = await readJson(request)
      const [, , id = "", action = ""] = path.split("/")
      if (path === "/marks") {
        if (!Check(NewMarkSchema, body)) throw new Error("A new mark needs the draft revision, its take, preview, device and anchor.")
        await markable(body.source, body.preview, body.device)
        const added = marks.add(body.revision, { source: body.source, preview: body.preview, device: body.device, anchor: body.anchor })
        changed(added.draft)
        json(response, 201, added)
      } else if (path === "/marks/send") {
        if (!Check(RevisionSchema, body)) throw new Error("Send needs the draft revision it shows.")
        json(response, 201, await send(body.revision))
      } else if (action === "remove") {
        if (!Check(RevisionSchema, body)) throw new Error("Removing a mark needs the draft revision.")
        json(response, 200, { draft: changed(marks.remove(body.revision, id)) })
      } else if (action === "") {
        if (!Check(MarkChangeSchema, body)) throw new Error("A mark change needs the draft revision and a note or an anchor.")
        json(response, 200, { draft: changed(marks.change(body.revision, id, { ...(body.note === undefined ? {} : { note: body.note }), ...(body.anchor === undefined ? {} : { anchor: body.anchor }) })) })
      } else {
        json(response, 404, { error: `Marks have no action "${action}".` })
      }
    } catch (error) {
      if (error instanceof StaleDraft) json(response, 409, { error: error.message, draft: error.draft })
      else json(response, 400, { error: message(error) })
    }
    return true
  }

  /**
   * Make one new take from each marked take, and start their agents together.
   *
   * @param {number} revision the draft the user sent
   * @returns {Promise<{ takes: string[], draft: Draft }>}
   */
  const send = async revision => {
    if (sending) throw new Error("A Send is already running. Wait for it to finish.")
    const problem = agentProblem()
    if (problem !== null) throw new Error(problem)
    sending = true
    try {
      const draft = marks.current(revision)
      const plan = check(draft)
      const { parts } = await project()
      const groups = plan.groups.map(group => {
        const record = /** @type {TakeRecord} */ (store.record(group.source.take))
        validateTake(parts, record)
        return { source: group.source, record, marks: group.marks.map(id => /** @type {Mark} */ (draft.marks.find(mark => mark.id === id))) }
      })
      // One picture per take, preview and device its marks were placed on.
      const pictures = groups.map(group => {
        /** @type {Map<string, Mark[]>} */
        const on = new Map()
        for (const mark of group.marks) {
          const key = JSON.stringify([mark.preview.part, mark.preview.state, mark.device])
          on.set(key, [...on.get(key) ?? [], mark])
        }
        return [...on.values()]
      })
      const jobs = groups.flatMap((group, index) => (pictures[index] ?? []).map(on => {
        const first = /** @type {Mark} */ (on[0])
        return { part: first.preview.part, state: first.preview.state, device: first.device, take: group.source.take, annotations: on.map(mark => ({ letter: mark.letter, anchor: mark.anchor })) }
      }))
      const results = await render(jobs)
      /** @type {string[]} */
      const lost = []
      let next = 0
      const rendered = groups.map((group, index) => (pictures[index] ?? []).map(on => {
        const result = results[next++]
        if (result?.annotated === undefined) throw new Error(`Caliper could not draw the marks on take ${group.source.take}.`)
        for (const [position, mark] of on.entries()) {
          if (!result.annotated.marks[position]?.found && !mark.anchor.afterInput) lost.push(`${group.source.take}${mark.letter}: its element is not in a fresh render of take ${group.source.take}. Re-place or remove the mark.`)
        }
        return { on, result, annotated: result.annotated }
      }))
      if (lost.length) throw new Error(lost.join("\n"))

      // Rendering took time. From here to the end nothing awaits, so no other
      // write can land between this check and the draft's release.
      check(marks.current(revision))
      const labels = labelsOf(parts)
      /** @type {string[]} */
      const created = []
      /** @type {Array<{ take: string, brief: string, images: import("./images.js").AttachedImage[] }>} */
      const launches = []
      try {
        for (const [index, group] of groups.entries()) {
          const record = childRecord(group.source, group.record, group.marks)
          const take = agents.fork(group.source.take, record)
          created.push(take)
          const shots = rendered[index] ?? []
          const sources = [...new Set([record.part, record.context?.part].filter(file => file !== undefined))].map(path => ({ path, content: store.read(take, path) }))
          const brief = markupMessage({
            take, record, sources,
            pictures: shots.map(({ on, result, annotated }) => ({
              preview: { part: result.part, state: result.state }, previewLabel: labels(result.part, result.state),
              deviceLabel: DEVICES.find(device => device.id === result.device)?.name ?? result.device,
              width: result.viewport.width, height: result.viewport.height,
              drawn: on.map(mark => mark.letter),
              missing: on.filter((_, position) => !annotated.marks[position]?.found).map(mark => mark.letter),
              outside: on.filter((_, position) => annotated.marks[position]?.found && !annotated.marks[position]?.visible).map(mark => mark.letter),
            })),
          })
          const images = shots.map(({ result, annotated }) => ({ name: `take-${group.source.take}-${result.device}-marks.png`, mimeType: /** @type {const} */ ("image/png"), bytes: readFileSync(annotated.png) }))
          launches.push({ take, brief, images })
        }
      } catch (error) {
        for (const take of created) store.discard(take)
        throw error
      }
      const released = marks.release(revision, new Set(groups.flatMap(group => group.marks.map(mark => mark.id))))
      for (const launch of launches) agents.startMarkup(launch.take, launch.brief, launch.images)
      changed(released)
      return { takes: launches.map(launch => launch.take), draft: released }
    } finally {
      sending = false
    }
  }

  /**
   * The same Send policy the chrome shows. The chrome has already checked
   * each mark's location in its own frames; the server rechecks it in a fresh
   * render before any take starts.
   *
   * @param {Draft} draft
   */
  const check = draft => {
    const takes = agents.views().map(view => ({ take: view.take, created: view.created, kind: /** @type {"Alternate" | "Experiment"} */ (view.integration ? "Alternate" : "Experiment"), run: view.run }))
    const plan = planSend(draft.marks.map(mark => ({ id: mark.id, name: `${mark.source.take}${mark.letter}`, source: mark.source, location: { _tag: "Located" } })), takes)
    if (plan._tag === "Empty") throw new Error("The draft has no marks to send.")
    if (plan._tag === "Blocked") throw new Error(plan.reasons.join("\n"))
    return plan
  }

  return { handle, draft: () => marks.read() }
}

/**
 * The record of a take made from `parent`'s marks. It carries its own copy of
 * the chain's history, so it never depends on its parent being kept.
 *
 * @param {TakeIdentity} source
 * @param {TakeRecord} parent
 * @param {Mark[]} sent
 * @returns {Omit<TakeRecord, "created"> & { parent: TakeIdentity, history: import("../takes/store.js").TakeHistory, marks: Mark[] }}
 */
export function childRecord(source, parent, sent) {
  const identity = { take: source.take, created: source.created }
  const direction = parent.history?.direction ?? parent.direction
  return {
    part: parent.part, state: parent.state, device: parent.device,
    ...(parent.context === undefined ? {} : { context: parent.context }),
    parent: identity,
    chain: parent.chain ?? identity,
    history: {
      prompt: parent.history?.prompt ?? parent.prompt ?? null,
      ...(direction === undefined ? {} : { direction }),
      lineage: [...(parent.history?.lineage ?? []), identity],
      passes: [...(parent.history?.passes ?? []), ...(parent.parent && parent.marks ? [{ source: parent.parent, marks: parent.marks }] : [])],
    },
    marks: sent,
  }
}

/** @param {readonly import("../types").Part[]} parts */
function labelsOf(parts) {
  return (/** @type {string} */ part, /** @type {string} */ state) => {
    const found = parts.find(candidate => candidate.file === part)
    return `${found?.name ?? part} · ${found?.states.find(candidate => candidate.export === state)?.label ?? state}`
  }
}

/** @param {unknown} error */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
