// @ts-check
import { setTimeout as delay } from "node:timers/promises"
import { Type } from "typebox"
import { Check } from "typebox/value"
import { CheckSourceSchema } from "./contract.js"

const StampSchema = Type.Object({ epoch: Type.String(), generation: Type.Integer({ minimum: 0 }) })
/** @param {string} url @param {string} path @param {string} [take] */
function endpoint(url, path, take) {
  const address = new URL(`/__caliper/${path}`, url)
  if (take) address.searchParams.set("take", take)
  return address
}
/** @param {string} url @param {string} [take] @param {AbortSignal} [signal] */
export async function readCheckSource(url, take, signal) {
  const response = await fetch(endpoint(url, "check-source", take), {
    signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
  })
  if (!response.ok) throw new Error(`Cannot read check source: HTTP ${response.status}.`)
  const value = await response.json()
  if (!Check(CheckSourceSchema, value))
    throw new Error("The server did not provide a valid authored-check source snapshot. Update its Caliper plugin.")
  return value
}
/** @param {import('./contract.js').SourceRevision} left @param {import('./contract.js').SourceRevision} right */
export const sameRevision = (left, right) =>
  left.epoch === right.epoch && left.generation === right.generation && left.fingerprint === right.fingerprint

/** Drain late watcher events from writes that preceded the run. This is a quiet
 * starting point, not a source freeze; changes after it still invalidate work.
 * @param {string} url @param {string|undefined} take @param {AbortSignal} [signal]
 */
export async function settledCheckSource(url, take, signal) {
  let previous = await readCheckSource(url, take, signal)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    await delay(200, undefined, { signal })
    const next = await readCheckSource(url, take, signal)
    if (sameRevision(previous.revision, next.revision)) return next
    previous = next
  }
  throw new Error("Sources did not settle before the check run. Finish editing and try again.")
}
/** Observe edits during browser work without rescanning the whole project on every tick.
 * @param {string} url @param {string|undefined} take @param {import('./contract.js').SourceRevision} revision
 */
export function watchCheckSource(url, take, revision) {
  const controller = new AbortController()
  const requests = new AbortController()
  let closed = false
  let running = false
  const tick = async () => {
    if (closed || running || controller.signal.aborted) return
    running = true
    try {
      const response = await fetch(endpoint(url, "check-revision", take), {
        signal: AbortSignal.any([requests.signal, AbortSignal.timeout(3000)]),
      })
      if (!response.ok) throw new Error(`Source revision is unavailable: HTTP ${response.status}.`)
      const stamp = await response.json()
      if (!Check(StampSchema, stamp)) throw new Error("Invalid source revision response.")
      if (stamp.epoch !== revision.epoch || stamp.generation !== revision.generation) {
        const error = new Error("Product or take sources changed during the check run.")
        error.name = "SourceChanged"
        controller.abort(error)
      }
    } catch (error) {
      if (!closed) {
        const failure = new Error(`The source server became unavailable: ${String(error)}`)
        failure.name = "InfrastructureError"
        controller.abort(failure)
      }
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => {
    void tick()
  }, 200)
  return {
    signal: controller.signal,
    invalidate() {
      const error = new Error("Product or take sources changed during the check run.")
      error.name = "SourceChanged"
      controller.abort(error)
    },
    /** @param {unknown} cause */
    unavailable(cause) {
      const error = new Error(`Source identity could not be verified: ${String(cause)}`)
      error.name = "InfrastructureError"
      controller.abort(error)
    },
    close() {
      closed = true
      clearInterval(timer)
      requests.abort()
    },
  }
}
