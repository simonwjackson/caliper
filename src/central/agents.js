// @ts-check
// The main thread's side of the agent workers: one worker per project, made
// when the project is first used and kept while the app runs, so takes
// survive a restart of the project's dev server.
import { homedir } from "node:os"
import { MessageChannel, Worker } from "node:worker_threads"
import { serveSyncCalls } from "./sync-call.js"

/**
 * @typedef {{ type: "takes" | "marks", data: unknown }} Broadcast
 * @typedef {{
 *   request: (input: { path: string, method: string, headers: Record<string, string>, body: Buffer }) => Promise<{ status: number, headers: Record<string, string>, body: Buffer }>,
 *   snapshot: () => Promise<{ takes: unknown, marks: unknown, problem: string | null }>,
 *   editable: (take: string) => Promise<string | null>,
 *   edit: (take: string, file: string) => void,
 *   subscribe: (listener: (event: Broadcast) => void) => () => void,
 *   reconfigure: (agent: import("../types").AgentOptions | undefined) => void,
 *   close: () => Promise<void>,
 * }} AgentHost
 */

/**
 * @param {{
 *   stateDir: string,
 *   agent: () => import("../types").AgentOptions | undefined,
 *   env: Record<string, string | undefined>,
 *   hostCall: (id: string, target: string, method: string, args: unknown) => Promise<Omit<import("./sync-call.js").ReplyMessage, "id">>,
 * }} input
 *   `agent` is read when a project's worker starts. `hostCall` sends one call to the project's plugin;
 *   `app.server` answers with the project's checked dev server.
 */
export function createAgentHosts({ stateDir, agent, env, hostCall }) {
  /** @type {Map<string, AgentHost>} */
  const hosts = new Map()

  /**
   * @param {string} id
   * @param {string} root
   * @returns {AgentHost}
   */
  const start = (id, root) => {
    const channel = new MessageChannel()
    const flag = new SharedArrayBuffer(4)
    const option = agent()
    const worker = new Worker(new URL("./agent-host.js", import.meta.url), {
      workerData: { id, root, stateDir, home: homedir(), agent: option, env, port: channel.port2, flag },
      transferList: [channel.port2],
    })
    serveSyncCalls({ port: channel.port1, flag, answer: (target, method, args) => hostCall(id, target, method, args) })
    /** @type {Set<(event: Broadcast) => void>} */
    const listeners = new Set()
    /** @type {Map<number, (value: any) => void>} */
    const waiting = new Map()
    let seq = 0
    /** @type {string | null} */
    let failure = null
    worker.on("message", message => {
      if (message.type === "takes" || message.type === "marks") for (const listener of listeners) listener(message)
      else if (typeof message.seq === "number") { waiting.get(message.seq)?.(message); waiting.delete(message.seq) }
    })
    const fail = (/** @type {string} */ reason) => {
      failure = reason
      for (const resolve of waiting.values()) resolve({ type: "failed", reason })
      waiting.clear()
      hosts.delete(id)
      channel.port1.close()
    }
    worker.on("error", error => fail(`The agent host for this project stopped: ${error.message}`))
    worker.on("exit", code => fail(`The agent host for this project exited with code ${code}.`))
    /** @param {object} message @returns {Promise<any>} */
    const ask = message => new Promise(resolve => {
      if (failure !== null) return resolve({ type: "failed", reason: failure })
      const next = ++seq
      waiting.set(next, resolve)
      worker.postMessage({ ...message, seq: next })
    })
    return {
      request: async input => {
        const answer = await ask({ type: "request", ...input })
        if (answer.type === "failed") return { status: 503, headers: { "content-type": "application/json; charset=utf-8" }, body: Buffer.from(JSON.stringify({ error: answer.reason })) }
        return { status: answer.status, headers: answer.headers, body: Buffer.from(answer.body) }
      },
      snapshot: async () => {
        const answer = await ask({ type: "snapshot" })
        return answer.type === "failed" ? { takes: null, marks: null, problem: answer.reason } : answer
      },
      editable: async take => {
        const answer = await ask({ type: "editable", take })
        return answer.type === "failed" ? answer.reason : answer.error
      },
      edit: (take, file) => { if (failure === null) worker.postMessage({ type: "edit", take, file }) },
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
      reconfigure: next => { if (failure === null) worker.postMessage({ type: "agent", agent: next }) },
      close: async () => {
        if (failure !== null) return
        const exited = new Promise(resolve => worker.once("exit", resolve))
        worker.postMessage({ type: "close" })
        const timer = setTimeout(() => void worker.terminate(), 10_000)
        await exited
        clearTimeout(timer)
      },
    }
  }

  return {
    /** The project's agent host, started on first use. @param {string} id @param {string} root */
    get: (id, root) => {
      const found = hosts.get(id)
      if (found) return found
      const made = start(id, root)
      hosts.set(id, made)
      return made
    },
    /** Give every running project the agent settings as they are now. */
    reconfigure: () => {
      const option = agent()
      for (const host of hosts.values()) host.reconfigure(option)
    },
    close: async () => {
      const all = [...hosts.values()]
      hosts.clear()
      await Promise.all(all.map(host => host.close()))
    },
  }
}
