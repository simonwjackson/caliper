// @ts-check
// The take agent's code reads its take store synchronously. In the Caliper
// app that store lives in a project's plugin, behind HTTP. The agent runs in
// a worker thread; each store call posts to the main thread and blocks the
// worker, not the app, until the answer arrives. The main thread keeps
// serving the chrome, the proxy and every other project while a worker waits.
import { receiveMessageOnPort } from "node:worker_threads"

/** How long a worker waits for one host call before it gives up. */
export const CALL_TIMEOUT_MS = 60_000

/**
 * @typedef {{ id: number, target: string, method: string, args: unknown }} CallMessage
 * @typedef {{ id: number, value?: unknown, error?: string, name?: string, draft?: unknown }} ReplyMessage
 */

/**
 * The worker's side: a function that blocks until the main thread answers.
 *
 * @param {{ port: import("node:worker_threads").MessagePort, flag: SharedArrayBuffer, timeout?: number }} input
 * @returns {(target: string, method: string, args: unknown) => ReplyMessage}
 */
export function syncCaller({ port, flag, timeout = CALL_TIMEOUT_MS }) {
  const state = new Int32Array(flag)
  let next = 0
  return (target, method, args) => {
    const id = ++next
    Atomics.store(state, 0, 0)
    port.postMessage(/** @type {CallMessage} */ ({ id, target, method, args }))
    const end = Date.now() + timeout
    for (;;) {
      // A reply to a call that timed out earlier can still arrive; skip it.
      for (let message = receiveMessageOnPort(port); message !== undefined; message = receiveMessageOnPort(port)) {
        const reply = /** @type {ReplyMessage} */ (message.message)
        if (reply.id === id) return reply
      }
      const left = end - Date.now()
      if (left <= 0) return { id, error: `The project's dev server did not answer ${target}.${method} within ${timeout / 1000} seconds.` }
      // Wake at least every 20 ms, in case a notify comes before its message is readable.
      Atomics.wait(state, 0, 0, Math.min(left, 20))
      Atomics.store(state, 0, 0)
    }
  }
}

/**
 * The main thread's side: answer each call with `answer` and wake the worker.
 *
 * @param {{ port: import("node:worker_threads").MessagePort, flag: SharedArrayBuffer, answer: (target: string, method: string, args: unknown) => Promise<Omit<ReplyMessage, "id">> }} input
 */
export function serveSyncCalls({ port, flag, answer }) {
  const state = new Int32Array(flag)
  port.on("message", async (/** @type {CallMessage} */ call) => {
    /** @type {Omit<ReplyMessage, "id">} */
    let reply
    try { reply = await answer(call.target, call.method, call.args) }
    catch (error) { reply = { error: error instanceof Error ? error.message : String(error) } }
    port.postMessage({ ...reply, id: call.id })
    Atomics.store(state, 0, 1)
    Atomics.notify(state, 0)
  })
}
