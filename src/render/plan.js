// @ts-check
import { DEVICES } from "../client/device-frame.js"

/**
 * @typedef {import("../types").Project} Project
 * @typedef {{ part: string, state?: string, devices?: readonly string[], take?: string }} RenderRequest
 *   `state` is an export name or "*" for every state. `devices` holds device
 *   ids, or "*" for every device. `take` renders the part as that take changes it.
 * @typedef {{ letter: string, anchor: import("../takes/marks-contract.js").MarkAnchor }} Annotation
 *   A mark to find and draw on the render, for the picture a take made from marks gets.
 * @typedef {{ part: string, state: string, device: string, take?: string, annotations?: Annotation[] }} RenderJob
 *   With `annotations`, the render also saves a second picture with the marks drawn in.
 * @typedef {{ _tag: "Planned", jobs: RenderJob[] } | { _tag: "Invalid", reason: string }} RenderPlan
 */

export const EVERY = "*"

/**
 * Turn a render request into one job for each state and device, or a reason
 * that names the valid choices. Pure: the project comes from the dev server.
 *
 * @param {Project} project
 * @param {RenderRequest} request
 * @returns {RenderPlan}
 */
export function planRenders(project, request) {
  if (request.part === EVERY) {
    if (!project.parts.length) return { _tag: "Invalid", reason: "No parts discovered. There are no states to render." }
    /** @type {RenderJob[]} */
    const jobs = []
    for (const part of project.parts) {
      const plan = planRenders(project, { ...request, part: part.file })
      if (plan._tag === "Invalid") return plan
      jobs.push(...plan.jobs)
    }
    return { _tag: "Planned", jobs }
  }
  const part = project.parts.find(candidate => candidate.file === request.part)
  if (part === undefined) {
    const needle = request.part.toLowerCase()
    const matches = project.parts.filter(candidate => candidate.file.toLowerCase().includes(needle)).map(candidate => candidate.file)
    const hint = matches.length ? `Parts that match: ${matches.slice(0, 10).join(", ")}` : "Run with --list to see every part."
    return { _tag: "Invalid", reason: `"${request.part}" is not a part of ${project.name}. ${hint}` }
  }

  const stateName = request.state ?? "default"
  const states = stateName === EVERY ? part.states.map(state => state.export) : [stateName]
  if (!part.states.some(state => state.export === states[0])) {
    const names = part.states.map(state => state.export).join(", ")
    return { _tag: "Invalid", reason: `${part.file} has no state "${stateName}". Its states are: ${names}.` }
  }

  const deviceIds = request.devices ?? [DEVICES[0]?.id ?? ""]
  const devices = deviceIds.includes(EVERY) ? DEVICES.map(device => device.id) : [...new Set(deviceIds)]
  const unknown = devices.find(id => !DEVICES.some(device => device.id === id))
  if (unknown !== undefined) {
    const names = DEVICES.map(device => device.id).join(", ")
    return { _tag: "Invalid", reason: `Caliper has no device "${unknown}". Its devices are: ${names}.` }
  }

  if (request.take !== undefined && !/^[1-9]\d*$/.test(request.take)) {
    return { _tag: "Invalid", reason: `"${request.take}" is not a take number.` }
  }
  const take = request.take === undefined ? {} : { take: request.take }
  return {
    _tag: "Planned",
    jobs: states.flatMap(state => devices.map(device => ({ part: part.file, state, device, ...take }))),
  }
}
