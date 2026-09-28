// @ts-check
import { chromium } from "playwright-core"

/** @param {unknown} reason */
export function aborted(reason) {
  if (reason instanceof Error) return reason
  const error = new Error(typeof reason === "string" ? reason : "The check run was cancelled.")
  error.name = "AbortError"
  return error
}
/** Bound browser evaluation as well as navigation; a page loop cannot own the deadline.
 * @template T
 * @param {(signal:AbortSignal)=>Promise<T>} operation
 * @param {{signal?:AbortSignal,timeout?:number}} [options]
 * @returns {Promise<T>}
 */
export async function bounded(operation, { signal, timeout = 15000 } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort(aborted(signal?.reason))
  if (signal?.aborted) abort()
  else signal?.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(() => {
    const error = new Error(`The browser operation exceeded its ${timeout} ms deadline.`)
    error.name = "TimeoutError"
    controller.abort(error)
  }, timeout)
  /** @type {()=>void} */
  let cleanup = () => {}
  try {
    if (controller.signal.aborted) throw controller.signal.reason
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        const stop = () => reject(controller.signal.reason)
        controller.signal.addEventListener("abort", stop, { once: true })
        cleanup = () => controller.signal.removeEventListener("abort", stop)
      }),
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
    cleanup()
  }
}

/** Keep Playwright's pipe transport, which works in both Node and Bun. The public
 * Chromium SystemInfo protocol identifies our browser process for a last-resort
 * kill without private Playwright process fields or another listening server.
 * @param {string} executablePath @param {AbortSignal} [signal]
 */
export async function openBrowserSession(executablePath, signal) {
  if (signal?.aborted) throw aborted(signal.reason)
  // Launch has its own finite timeout. Wait for it before handling cancellation
  // so a late startup cannot leave an unowned browser behind.
  const browser = await chromium.launch({
    executablePath,
    timeout: 15000,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
  /** @type {number | undefined} */
  let pid
  /** @type {Promise<void> | undefined} */
  let closing
  const terminate = async () => {
    if (pid === undefined) throw new Error("Chromium cleanup failed before process ownership was established.")
    try {
      process.kill(pid, "SIGKILL")
    } catch (killError) {
      if (!(killError instanceof Error && "code" in killError && killError.code === "ESRCH")) throw killError
    }
    if (browser.isConnected())
      await bounded(() => new Promise(resolve => browser.once("disconnected", resolve)), { timeout: 2000 })
  }
  const close = () =>
    (closing ??= (async () => {
      try {
        await bounded(() => browser.close(), { timeout: 5000 })
      } catch {
        await terminate()
      }
    })())
  try {
    await bounded(
      async handshakeSignal => {
        handshakeSignal.throwIfAborted()
        const cdp = await browser.newBrowserCDPSession()
        handshakeSignal.throwIfAborted()
        const info = await cdp.send("SystemInfo.getProcessInfo")
        const candidate = info.processInfo.find(entry => entry.type === "browser")?.id
        if (!Number.isSafeInteger(candidate) || candidate === process.pid || !candidate || candidate < 1)
          throw new Error("Chromium did not identify its owned process.")
        pid = candidate
        handshakeSignal.throwIfAborted()
        await cdp.detach()
      },
      { signal, timeout: 5000 },
    )
    if (signal?.aborted) throw aborted(signal.reason)
    return {
      browser,
      close,
      /** @param {import('playwright-core').BrowserContext} context */
      closeContext: async context => {
        try {
          await bounded(() => context.close(), { timeout: 5000 })
        } catch (error) {
          // The context already spent the cleanup budget. Do not start another
          // five-second graceful-close budget before terminating the process.
          closing ??= terminate()
          await closing
          throw new Error(`Browser context cleanup required process termination: ${String(error)}`)
        }
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
