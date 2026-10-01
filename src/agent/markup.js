// @ts-check
import { readFileSync } from "node:fs"
import { Check } from "typebox/value"
import { unknownDevice } from "../render/plan.js"
import { contextsFor, sameState } from "../client/scenarios.js"
import { json, readJson, refuse } from "../http.js"
import { isOriginal, planSend } from "../takes/send-plan.js"
import { MarkChangeSchema, NewMarkSchema, ReleaseSchema, RevisionSchema } from "../takes/marks-contract.js"
import { StaleDraft } from "../takes/marks.js"
import { markupMessage, promptMarksText } from "./markup-message.js"

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
 * @typedef {import("../render/plan.js").DeviceJob} DeviceJob
 * @typedef {import("../render/render.js").RenderResult} RenderResult
 */

/**
 * @param {{
 *   store: import("../takes/store.js").TakeStore,
 *   marks: import("../takes/marks.js").MarkStore,
 *   agents: Pick<ReturnType<typeof import("./take-agents.js").createTakeAgents>, "views" | "fork" | "create" | "startMarkup">,
 *   project: () => Promise<import("../types").Project>,
 *   validateTake: (parts: readonly import("../types").Part[], record: TakeRecord) => void,
 *   render: (jobs: DeviceJob[]) => Promise<RenderResult[]>,
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
   * experiment, or be the original (phase 6). The preview is its subject or a
   * declared scenario of it.
   *
   * @param {Mark["source"]} source @param {Mark["preview"]} preview @param {string} device
   * @param {Mark["subject"]} [subject] required for a mark on the original
   */
  const markable = async (source, preview, device, subject) => {
    if (isOriginal(source)) {
      // Plan decision 8: the original frame shows the real files at a subject's state or a declared scenario of it.
      if (!subject) throw new Error("A mark on the original needs the subject it edits.")
      const viewed = await project()
      const { parts } = viewed
      if (!parts.some(part => part.file === subject.part && part.states.some(state => state.export === subject.state))) throw new Error(`${subject.part} · ${subject.state} does not exist.`)
      if (!sameState(preview, subject) && !contextsFor(parts, subject).some(context => sameState(context, preview))) throw new Error(`${preview.part} · ${preview.state} is not a declared scenario of ${subject.part} · ${subject.state}.`)
      if (!viewed.devices.some(candidate => candidate.id === device)) throw new Error(unknownDevice(viewed, device))
      return
    }
    const record = store.record(source.take)
    if (record === null || record.created !== source.created) throw new Error(`Take ${source.take} is no longer the take you marked. Reload the takes.`)
    if (record.integration) throw new Error(`Take ${source.take} is an alternate. Alternates have their own review and cannot be marked.`)
    const viewed = await project()
    if (!sameState(preview, record) && !contextsFor(viewed.parts, record).some(context => sameState(context, preview))) throw new Error(`Take ${source.take} does not show ${preview.part} · ${preview.state}.`)
    if (!viewed.devices.some(candidate => candidate.id === device)) throw new Error(unknownDevice(viewed, device))
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
        await markable(body.source, body.preview, body.device, body.subject)
        const added = marks.add(body.revision, { source: body.source, preview: body.preview, ...(isOriginal(body.source) && body.subject ? { subject: body.subject } : {}), device: body.device, anchor: body.anchor })
        changed(added.draft)
        json(response, 201, added)
      } else if (path === "/marks/release") {
        if (!Check(ReleaseSchema, body)) throw new Error("Releasing marks needs the draft revision and the marks.")
        const draft = marks.current(body.revision)
        const ids = new Set(body.ids)
        if (draft.marks.some(mark => ids.has(mark.id) && !isOriginal(mark.source))) throw new Error("Only marks on the original go with a prompt.")
        json(response, 200, { draft: changed(marks.release(body.revision, ids)) })
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
   * Make one new take from each marked take, or from the original, whose marks
   * are not all pointed to by notes on other takes (decisions 7 and 8), and
   * start their agents together.
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
      const { parts, devices } = await project()
      const byId = (/** @type {string} */ id) => /** @type {Mark} */ (draft.marks.find(mark => mark.id === id))
      const groups = plan.groups.map(group => {
        const own = group.marks.map(byId)
        const base = { source: group.source, marks: own, makes: group.outcome._tag === "NewTake", pointsTo: group.pointsTo.map(byId) }
        if (!isOriginal(group.source)) {
          const record = /** @type {TakeRecord} */ (store.record(group.source.take))
          validateTake(parts, record)
          return { ...base, record }
        }
        // Plan decision 8: one take from the real files, so every mark on the original in one pass edits one subject.
        const subjects = [...new Set(own.map(mark => JSON.stringify([mark.subject?.part ?? mark.preview.part, mark.subject?.state ?? mark.preview.state])))]
        if (subjects.length > 1) throw new Error("The marks on the original are on more than one part or state. Send them one subject at a time: remove the others first.")
        const first = /** @type {Mark} */ (own[0])
        const subject = first.subject ?? first.preview
        /** @type {Omit<TakeRecord, "created">} */
        const record = { part: subject.part, state: subject.state, device: first.device, ...(sameState(first.preview, subject) ? {} : { context: first.preview }) }
        validateTake(parts, /** @type {TakeRecord} */ ({ ...record, created: 0 }))
        return { ...base, record }
      })
      const referenced = new Set(groups.flatMap(group => group.pointsTo.map(mark => mark.id)))
      // One picture per source, preview and device its marks were placed on. Marks a note points to also get a crop.
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
        return {
          part: first.preview.part, state: first.preview.state, device: first.device, ...(isOriginal(group.source) ? {} : { take: group.source.take }),
          annotations: on.map(mark => ({ letter: mark.letter, anchor: mark.anchor, ...(referenced.has(mark.id) ? { crop: true } : {}) })),
        }
      }))
      const results = await render(jobs)
      /** @type {string[]} */
      const lost = []
      /** @type {Map<string, string>} */
      const crops = new Map()
      let next = 0
      const rendered = groups.map((group, index) => (pictures[index] ?? []).map(on => {
        const result = results[next++]
        const where = isOriginal(group.source) ? "the real files" : `take ${group.source.take}`
        if (result?.annotated === undefined) throw new Error(`Caliper could not draw the marks on ${where}.`)
        for (const [position, mark] of on.entries()) {
          const drawn = result.annotated.marks[position]
          if (!drawn?.found && !mark.anchor.afterInput) lost.push(`${group.source.take}${mark.letter}: its element is not in a fresh render of ${where}. Re-place or remove the mark.`)
          if (drawn?.crop) crops.set(mark.id, drawn.crop)
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
          if (!group.makes) continue
          /** @type {Map<string, { source: TakeIdentity, marks: Mark[] }>} */
          const bySource = new Map()
          for (const mark of group.pointsTo) {
            const key = `${mark.source.take}@${mark.source.created}`
            bySource.set(key, { source: mark.source, marks: [...bySource.get(key)?.marks ?? [], mark] })
          }
          const references = [...bySource.values()]
          const record = isOriginal(group.source)
            ? { ...group.record, history: { prompt: null, lineage: [], passes: [] }, marks: group.marks, ...(references.length ? { references } : {}) }
            : { ...childRecord(group.source, /** @type {TakeRecord} */ (group.record), group.marks), ...(references.length ? { references } : {}) }
          const take = isOriginal(group.source) ? agents.create(record) : agents.fork(group.source.take, record)
          created.push(take)
          const shots = rendered[index] ?? []
          const sources = [...new Set([record.part, record.context?.part].filter(file => file !== undefined))].map(path => ({ path, content: store.read(take, path) }))
          const brief = markupMessage({
            take, record, sources,
            references: group.pointsTo.map(mark => ({ source: mark.source, mark, crop: crops.has(mark.id) })),
            pictures: shots.map(({ on, result, annotated }) => ({
              preview: { part: result.part, state: result.state }, previewLabel: labels(result.part, result.state),
              deviceLabel: devices.find(device => device.id === result.device)?.name ?? result.device,
              width: result.viewport.width, height: result.viewport.height,
              drawn: on.map(mark => mark.letter),
              missing: on.filter((_, position) => !annotated.marks[position]?.found).map(mark => mark.letter),
              outside: on.filter((_, position) => annotated.marks[position]?.found && !annotated.marks[position]?.visible).map(mark => mark.letter),
            })),
          })
          const pictureName = (/** @type {TakeIdentity} */ source) => isOriginal(source) ? "original" : `take-${source.take}`
          const images = [
            ...shots.map(({ result, annotated }) => ({ name: `${pictureName(group.source)}-${result.device}-marks.png`, mimeType: /** @type {const} */ ("image/png"), bytes: readFileSync(annotated.png) })),
            ...group.pointsTo.flatMap(mark => {
              const crop = crops.get(mark.id)
              return crop ? [{ name: `${pictureName(mark.source)}-${mark.letter}-crop.png`, mimeType: /** @type {const} */ ("image/png"), bytes: readFileSync(crop) }] : []
            }),
          ]
          launches.push({ take, brief, images })
        }
      } catch (error) {
        for (const take of created) store.discard(take)
        throw error
      }
      // Every mark leaves the draft: its own take's, or, when a note pointed to it, as reference material.
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
    const plan = planSend(draft.marks.map(mark => ({ id: mark.id, name: `${mark.source.take}${mark.letter}`, note: mark.note, source: mark.source, location: { _tag: "Located" } })), takes)
    if (plan._tag === "Empty") throw new Error("The draft has no marks to send.")
    if (plan._tag === "Blocked") throw new Error(plan.reasons.join("\n"))
    return plan
  }

  /**
   * Planner choice 14 (A): marks on the original go with a typed prompt. Their
   * text is appended to the prompt and a picture of the real files with them
   * drawn in is attached. The chrome releases them from the draft once the
   * takes started, so this reads the draft and does not change it.
   *
   * @param {unknown} ids from the request body
   * @param {{ part: string, state: string, device: string, context?: import("../types").StateRef }} ask
   * @returns {Promise<{ text: string, images: import("./images.js").AttachedImage[] }>}
   */
  const promptMarks = async (ids, ask) => {
    if (ids === undefined) return { text: "", images: [] }
    if (!Array.isArray(ids) || !ids.length || ids.length > 26 || !ids.every(id => typeof id === "string")) throw new Error("marks must be a list of marks on the original.")
    const draft = marks.read()
    const preview = ask.context ?? ask
    const chosen = ids.map(id => {
      const mark = draft.marks.find(item => item.id === id)
      if (!mark || !isOriginal(mark.source)) throw new Error("A mark that goes with the prompt is no longer on the original in the draft. Check the draft and start again.")
      const subject = mark.subject ?? mark.preview
      if (!sameState(mark.preview, preview) || !sameState(subject, ask) || mark.device !== ask.device) throw new Error(`0${mark.letter} is on another preview, subject or device than this prompt.`)
      return mark
    })
    const [result] = await render([{ part: preview.part, state: preview.state, device: ask.device, annotations: chosen.map(mark => ({ letter: mark.letter, anchor: mark.anchor })) }])
    if (result?.annotated === undefined) throw new Error("Caliper could not draw the marks on the real files.")
    return { text: promptMarksText(chosen), images: [{ name: `original-${ask.device}-marks.png`, mimeType: "image/png", bytes: readFileSync(result.annotated.png) }] }
  }

  return { handle, draft: () => marks.read(), promptMarks }
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
