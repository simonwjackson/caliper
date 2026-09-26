// @ts-check
import { DEVICES } from "../client/device-frame.js"

/**
 * @typedef {import("../types").Project} Project
 * @typedef {{ part: string, state?: string, devices?: readonly string[] }} RenderRequest
 *   `state` is an export name or "*" for every state. `devices` holds device
 *   ids, or "*" for every device.
 * @typedef {{ part: string, state: string, device: string }} RenderJob
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
  const devices = deviceIds.includes(EVERY) ? DEVICES.map(device => device.id) : deviceIds
  const unknown = devices.find(id => !DEVICES.some(device => device.id === id))
  if (unknown !== undefined) {
    const names = DEVICES.map(device => device.id).join(", ")
    return { _tag: "Invalid", reason: `Caliper has no device "${unknown}". Its devices are: ${names}.` }
  }

  return {
    _tag: "Planned",
    jobs: states.flatMap(state => devices.map(device => ({ part: part.file, state, device }))),
  }
}
