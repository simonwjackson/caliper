// @ts-check
import { expect, test } from "bun:test"
import { MessageChannel } from "node:worker_threads"
import { asyncCaller, serveHostCalls } from "../src/central/host-call.js"

/** @param {number} ms */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test("concurrent host calls match out-of-order replies to their request", async () => {
  const { port1, port2 } = new MessageChannel()
  const call = asyncCaller({ port: port2 })
  serveHostCalls({ port: port1, answer: async (_target, method) => {
    await delay(method === "slow" ? 50 : 1)
    return { value: method }
  } })
  try {
    const slow = call("store", "slow", [])
    const fast = call("store", "fast", [])
    expect((await fast).value).toBe("fast")
    expect((await slow).value).toBe("slow")
  } finally { port1.close(); port2.close() }
})

test("a timeout keeps its error text, cancels its answer, and does not poison the next call", async () => {
  const { port1, port2 } = new MessageChannel()
  const call = asyncCaller({ port: port2, timeout: 30 })
  const cancelled = Promise.withResolvers()
  serveHostCalls({ port: port1, answer: async (_target, method, _args, signal) => {
    if (method === "slow") {
      signal.addEventListener("abort", () => cancelled.resolve(undefined), { once: true })
      await delay(80)
    }
    return { value: method }
  } })
  try {
    expect((await call("store", "slow", [])).error).toBe("The project's dev server did not answer store.slow within 0.03 seconds.")
    await cancelled.promise
    expect((await call("store", "next", [])).value).toBe("next")
    await delay(90)
    expect((await call("store", "last", [])).value).toBe("last")
  } finally { port1.close(); port2.close() }
})

test("abort and channel close settle waiting callers without waiting for the answer", async () => {
  const { port1, port2 } = new MessageChannel()
  const call = asyncCaller({ port: port2, timeout: 100 })
  const controller = new AbortController()
  const waiting = call("store", "read", [], controller.signal)
  controller.abort(new Error("The take was stopped."))
  await expect(waiting).rejects.toThrow("The take was stopped.")
  const closed = call("store", "read", [])
  call.close()
  await expect(closed).rejects.toThrow("host call channel closed")
  port1.close()
})
