// @ts-check
import { statSync } from "node:fs"
import { join } from "node:path"

/**
 * Vite's file watcher (chokidar 3) drops a `change` for a file that comes
 * within 50 ms of the last `change` for the same file, and never sends it
 * later. The browser has usually fetched the module again after the first
 * save, so Vite keeps serving that version, even after a page reload. Two
 * quick saves are common: an agent's two edits to one file, or an editor's
 * save followed by format-on-save.
 *
 * Chokidar's `raw` events are not throttled. After a raw event close to a
 * `change`, this waits for the file to settle. If the file on disk is not the
 * version the last `change` saw, it sends the `change` that was dropped.
 */

/** Chokidar suppresses a repeated `change` for this long. */
const THROTTLE_MS = 50
/** A raw event this soon after a `change` may belong to a dropped save. */
const WINDOW_MS = THROTTLE_MS * 2
/** How long the file must be quiet before the check. Longer than the throttle. */
const SETTLE_MS = THROTTLE_MS + 20

/**
 * @param {string} file
 * @returns {string | null} the file's version on disk, or null when it is gone
 */
function versionOf(file) {
  try {
    const stats = statSync(file, { bigint: true })
    return stats.isFile() ? `${stats.mtimeNs}:${stats.size}` : null
  } catch {
    return null
  }
}

/**
 * Start sending the `change` events the watcher drops.
 *
 * @param {import("vite").FSWatcher} watcher
 * @returns {() => void} stop
 */
export function reportLateChanges(watcher) {
  /** @type {Map<string, { at: number, version: string | null }>} the last `change` per file */
  const seen = new Map()
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map()

  /** @param {string} file */
  const onChange = file => {
    seen.set(file, { at: Date.now(), version: versionOf(file) })
  }

  /** @param {string} file */
  const check = file => {
    timers.delete(file)
    const last = seen.get(file)
    const now = versionOf(file)
    if (last && now !== null && now !== last.version) watcher.emit("change", file)
  }

  /**
   * `fs.watch` names the file relative to the watched path, which is either
   * the file itself or its folder.
   *
   * @param {string} _event
   * @param {string} path
   * @param {{ watchedPath?: string }} details
   */
  const onRaw = (_event, path, details) => {
    const watched = details?.watchedPath
    if (!watched) return
    const file = seen.has(watched) ? watched : join(watched, path ?? "")
    const last = seen.get(file)
    if (!last || Date.now() - last.at > WINDOW_MS) return
    clearTimeout(timers.get(file))
    const timer = setTimeout(check, SETTLE_MS, file)
    timer.unref?.()
    timers.set(file, timer)
  }

  watcher.on("change", onChange)
  watcher.on("raw", onRaw)
  return () => {
    watcher.off("change", onChange)
    watcher.off("raw", onRaw)
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    seen.clear()
  }
}
