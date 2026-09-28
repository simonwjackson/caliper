// @ts-check

/** @typedef {import("./types").FrameConfig} FrameConfig */

/** How long a frame may take to start before it says so. */
export const FRAME_WATCHDOG_MS = 10_000

/**
 * Caliper's own page. It loads no project code and no Vite client, so a save
 * in the project reloads only the device frame, never this page.
 *
 * The import map names the browser packages the chrome loads from Caliper's
 * own node_modules, such as CodeMirror. It must come before any module script.
 *
 * @param {{ clientUrl: string, importMap: { imports: Record<string, string> } }} input
 */
export function chromePage({ clientUrl, importMap }) {
  const map = JSON.stringify(importMap).replaceAll("<", "\\u003c")
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Caliper</title>
    <link rel="icon" href="data:," />
    <link rel="stylesheet" href="${clientUrl}/chrome.css" />
    <script type="importmap">${map}</script>
    <script type="module" src="${clientUrl}/chrome.js"></script>
  </head>
  <body>
    <div id="caliper" class="cal-root"></div>
  </body>
</html>
`
}

/**
 * The page inside one device frame. It loads the project's global CSS, its
 * React and one part, then renders the part inside the app's outer shell.
 *
 * A small classic script watches the start. If the module script never runs,
 * for example because the project cannot compile it, the frame shows that
 * instead of staying blank.
 *
 * @param {{ clientUrl: string, config: FrameConfig, problem: string | null }} input
 *   `problem` renders an error in place of the part
 */
export function framePage({ clientUrl, config, problem }) {
  const json = JSON.stringify({ ...config, problem }).replaceAll("<", "\\u003c")
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(config.partFile)}</title>
    <link rel="icon" href="data:," />
    <link rel="stylesheet" href="${clientUrl}/frame.css" />
    <script type="application/json" id="caliper-frame-config">${json}</script>
    <script>
      setTimeout(function () {
        var state = document.documentElement.dataset.caliperState
        if (state && state !== "Loading") return
        var panel = document.createElement("div")
        panel.id = "caliper-problem"
        panel.setAttribute("role", "alert")
        panel.textContent = document.documentElement.dataset.caliperStarted
          ? "Caliper's frame did not finish its first render within ${FRAME_WATCHDOG_MS / 1000} seconds. Check for pending imports or suspended product content."
          : "Caliper's frame script did not start within ${FRAME_WATCHDOG_MS / 1000} seconds. Check the terminal that runs Vite."
        document.body.append(panel)
        document.documentElement.dataset.caliperState = "Failed"
        var config = JSON.parse(document.getElementById("caliper-frame-config").textContent)
        var report = {
          part: config.partFile, partState: config.state, take: config.take || null, state: "Failed",
          problems: (window.caliperReport ? window.caliperReport.problems : []).concat([{ kind: "error", title: panel.textContent, detail: "" }])
        }
        window.caliperReport = report
        if (window.parent !== window) window.parent.postMessage(Object.assign({ source: "caliper-frame" }, report), location.origin)
      }, ${FRAME_WATCHDOG_MS})
    </script>
    <script type="module" src="${clientUrl}/frame.js"></script>
  </head>
  <body>
    <div id="caliper-host"></div>
  </body>
</html>
`
}

/** @param {string} text */
function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
