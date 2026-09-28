// @ts-check
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Check } from "typebox/value"
import { WorkerReplySchema, WorkerRequestSchema } from "./worker-contract.js"

/** Keep Playwright's driver in Node when its caller is Bun. Only a validated
 * job crosses IPC; the child never loads product code into Node.
 * @param {Exclude<import('./worker-contract.js').WorkerRequest,{type:'cancel'}>} request
 * @param {{signal?:AbortSignal,onProgress?:(progress:{phase:string,completed:number,total:number})=>void}} [options]
 * @returns {Promise<Exclude<import('./worker-contract.js').WorkerReply,{type:'progress'}|{type:'error'}>>}
 */
export function runNodeWorker(request, { signal, onProgress } = {}) {
  signal?.throwIfAborted()
  if (!Check(WorkerRequestSchema, request)) throw new Error("Invalid browser worker request.")
  const child = fork(fileURLToPath(new URL("./worker.js", import.meta.url)), [], {
    execPath: "node",
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  })
  /** @type {Exclude<import('./worker-contract.js').WorkerReply,{type:'progress'}|{type:'error'}>|undefined} */
  let result
  /** @type {Error|undefined} */
  let failure
  let diagnostic = ""
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let force
  child.stderr?.on("data", bytes => {
    diagnostic = (diagnostic + String(bytes)).slice(-4000)
  })
  const cancel = () => {
    if (child.connected)
      child.send({
        type: "cancel",
        reason: signal?.reason instanceof Error ? signal.reason.message : "The browser run was cancelled.",
      })
    // Browser startup has 15 seconds, followed by bounded teardown. The Node
    // worker handles its own Chromium; this is only a dead-worker watchdog.
    timer ??= setTimeout(() => {
      child.kill("SIGTERM")
      force = setTimeout(() => child.kill("SIGKILL"), 5000)
    }, 25000)
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      clearTimeout(force)
      signal?.removeEventListener("abort", cancel)
    }
    child.once("error", error => {
      cleanup()
      reject(new Error(`Cannot start Node browser worker. Make node available on PATH. ${error.message}`))
    })
    child.on("message", value => {
      if (!Check(WorkerReplySchema, value)) {
        failure = new Error("Invalid browser worker response.")
        child.kill("SIGTERM")
        return
      }
      if (value.type === "progress") {
        try {
          onProgress?.(value.progress)
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error))
          cancel()
        }
      } else if (value.type === "error") {
        failure = new Error(value.message)
        failure.name = value.name
      } else result = value
    })
    child.once("exit", (code, killed) => {
      cleanup()
      if (failure) reject(failure)
      else if (result && code === 0 && !killed) resolve(result)
      else reject(new Error(`Browser worker exited without a completed result: ${code ?? killed}. ${diagnostic}`))
    })
    child.send(request)
    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted) cancel()
  })
}
