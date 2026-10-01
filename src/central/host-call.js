// @ts-check
// Correlated, asynchronous host calls. Waiting leaves the agent worker's
// event loop free to receive Stop, edits and requests from other tabs.
export const CALL_TIMEOUT_MS = 60_000

/** @typedef {{ id: number, target: string, method: string, args: unknown }} CallMessage */
/** @typedef {{ id: number, value?: unknown, error?: string, name?: string, draft?: unknown }} ReplyMessage */

/**
 * @param {{ port: import("node:worker_threads").MessagePort, timeout?: number }} input
 */
export function asyncCaller({ port, timeout = CALL_TIMEOUT_MS }) {
  let next = 0
  /** @type {Map<number, { finish: (reply: ReplyMessage) => void, fail: (error: Error) => void }>} */
  const pending = new Map()
  let closed = false
  port.on("message", (/** @type {ReplyMessage} */ reply) => pending.get(reply.id)?.finish(reply))
  const close = () => {
    closed = true
    for (const call of pending.values()) call.fail(new Error("The project's host call channel closed."))
    port.close()
  }
  port.on("close", close)
  /** @param {string} target @param {string} method @param {unknown} args @param {AbortSignal} [signal] @returns {Promise<ReplyMessage>} */
  const call = (target, method, args, signal) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error("The project's host call channel closed."))
    if (signal?.aborted) return reject(signal.reason)
    const id = ++next
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      pending.delete(id)
    }
    const abort = () => {
      cleanup()
      port.postMessage({ cancel: id })
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      cleanup()
      port.postMessage({ cancel: id })
      resolve({ id, error: `The project's dev server did not answer ${target}.${method} within ${timeout / 1000} seconds.` })
    }, timeout)
    pending.set(id, {
      finish: reply => { cleanup(); resolve(reply) },
      fail: error => { cleanup(); reject(error) },
    })
    signal?.addEventListener("abort", abort, { once: true })
    port.postMessage(/** @type {CallMessage} */ ({ id, target, method, args }))
  })
  return Object.assign(call, { close })
}

/**
 * @param {{ port: import("node:worker_threads").MessagePort, answer: (target: string, method: string, args: unknown, signal: AbortSignal) => Promise<Omit<ReplyMessage, "id">> }} input
 */
export function serveHostCalls({ port, answer }) {
  /** @type {Map<number, AbortController>} */
  const pending = new Map()
  let closed = false
  port.on("close", () => {
    closed = true
    for (const controller of pending.values()) controller.abort()
    pending.clear()
  })
  port.on("message", async (/** @type {CallMessage & { cancel?: number }} */ call) => {
    if (call.cancel !== undefined) {
      pending.get(call.cancel)?.abort()
      pending.delete(call.cancel)
      return
    }
    const controller = new AbortController()
    pending.set(call.id, controller)
    /** @type {Omit<ReplyMessage, "id">} */
    let reply
    try { reply = await answer(call.target, call.method, call.args, controller.signal) }
    catch (error) { reply = { error: error instanceof Error ? error.message : String(error) } }
    pending.delete(call.id)
    if (!closed && !controller.signal.aborted) port.postMessage({ ...reply, id: call.id })
  })
}
