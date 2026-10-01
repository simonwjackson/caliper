// @ts-check

const ATTEMPTS = 3
/** @param {unknown} error */
const lostContext = error => error instanceof Error && /Execution context was destroyed|Cannot find context with specified id|Screenshot failed because page is navigating/.test(error.message)
/** @param {unknown} error */
const unavailableScreenshot = error => error instanceof Error && /Page\.captureScreenshot.*Unable to capture screenshot/.test(error.message)

/** @param {Promise<unknown>} commit @param {AbortSignal} signal */
async function waitForCommit(commit, signal) {
  let cleanup = () => {}
  try {
    await Promise.race([
      commit,
      new Promise((_, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener("abort", abort, { once: true })
        cleanup = () => signal.removeEventListener("abort", abort)
        if (signal.aborted) abort()
      }),
    ])
  } finally { cleanup() }
}

/** Retry complete read-only visual observations after reloads or compositor capture races.
 * The caller owns the deadline. This must not wrap authored actions: replaying
 * input after navigation can repeat side effects.
 * @template T
 * @param {{ page: import('playwright-core').Page, url: string, signal: AbortSignal, observe: () => Promise<T> }} input
 * @returns {Promise<T>}
 */
export async function observeFrame({ page, url, signal, observe }) {
  let generation = 0
  let leftFrame = false
  /** @param {string} address */
  const matchesFrame = address => address.split("#")[0] === url.split("#")[0]
  let committed = () => {}
  const nextCommit = () => new Promise(resolve => { committed = () => resolve(undefined) })
  let navigation = nextCommit()
  /** @param {import('playwright-core').Frame} frame */
  const navigated = frame => {
    if (frame !== page.mainFrame()) return
    generation++
    leftFrame ||= !matchesFrame(frame.url())
    committed()
    navigation = nextCommit()
  }
  const requestedFrame = () => {
    // Fragment navigation does not change the requested part/state/take.
    if (leftFrame || !matchesFrame(page.url()))
      throw new Error("The preview navigated away from the requested frame.")
  }
  page.on("framenavigated", navigated)
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      signal.throwIfAborted()
      requestedFrame()
      const before = generation
      const commit = navigation
      let needsCommit = true
      /** @type {unknown} */
      let failure
      try {
        const result = await observe()
        signal.throwIfAborted()
        requestedFrame()
        if (generation === before) return result
        // A screenshot or audit can finish after a reload without throwing.
        // Never combine observations from different documents into one sample.
      } catch (error) {
        signal.throwIfAborted()
        // A coincident reload must not hide filesystem or other unrelated errors.
        if (page.isClosed() || (!lostContext(error) && !unavailableScreenshot(error))) throw error
        failure = error
        needsCommit = !unavailableScreenshot(error) || generation !== before
      }
      if (needsCommit) {
        // Context destruction can precede the navigation event. The existing
        // render deadline also bounds this wait; no new timeout starts here.
        await waitForCommit(commit, signal)
      } else {
        // Chromium can reject a capture before the new compositor is ready,
        // even without another navigation. Wait for a paint, not a fixed delay.
        try { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))) }
        catch (error) {
          signal.throwIfAborted()
          if (page.isClosed() || !lostContext(error)) throw error
          await waitForCommit(commit, signal)
        }
      }
      signal.throwIfAborted()
      requestedFrame()
      if (attempt === ATTEMPTS)
        throw new Error(`The preview did not settle after ${ATTEMPTS} rendering attempts.`, { cause: failure })
      await page.waitForLoadState("domcontentloaded")
    }
    throw new Error("The preview could not be observed.")
  } finally {
    page.off("framenavigated", navigated)
  }
}
