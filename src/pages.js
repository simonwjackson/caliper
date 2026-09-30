// @ts-check

/** @typedef {import("./types").FrameConfig} FrameConfig */

/** How long a frame may take to start before it says so. */
export const FRAME_WATCHDOG_MS = 10_000

/**
 * Caliper's own page. It loads no project code and no Vite client, so a save
 * in the project reloads only the device frame, never this page.
 *
 * All chrome dependencies are bundled by Caliper, outside the consumer's Vite.
 *
 * @param {{ entryUrl: string, cssUrls: string[], pwaUrl: string, themeColor: string, serviceWorker?: string }} input
 *   `serviceWorker` is the URL of the Caliper app's routing worker. The page
 *   registers it and waits until it controls the page before the chrome
 *   starts, because the frames' requests only reach their project through it.
 */
export function chromePage({ entryUrl, cssUrls, pwaUrl, themeColor, serviceWorker }) {
  const start = serviceWorker === undefined
    ? `<script type="module" src="${escapeHtml(entryUrl)}"></script>`
    : `<script type="module">${routedStart(entryUrl, serviceWorker)}</script>`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Caliper</title>
    <link rel="manifest" href="${pwaUrl}/manifest.webmanifest" />
    <link rel="icon" type="image/svg+xml" href="${pwaUrl}/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="${pwaUrl}/favicon-32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="${pwaUrl}/favicon-16.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="${pwaUrl}/icon-192.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="${pwaUrl}/apple-touch-icon.png" />
    <meta name="theme-color" content="${escapeHtml(themeColor)}" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Caliper" />
    ${cssUrls.map(url => `<link rel="stylesheet" href="${escapeHtml(url)}" />`).join("\n    ")}
    ${start}
  </head>
  <body>
    <div id="caliper" class="cal-root"></div>
  </body>
</html>
`
}

/**
 * Start the chrome once the routing service worker controls the page. A hard
 * reload bypasses the worker for the page, so the page reloads once, normally.
 *
 * @param {string} entryUrl
 * @param {string} serviceWorker
 */
function routedStart(entryUrl, serviceWorker) {
  const entry = JSON.stringify(entryUrl).replaceAll("<", "\\u003c")
  const worker = JSON.stringify(serviceWorker).replaceAll("<", "\\u003c")
  return `
      const fail = text => { const panel = document.createElement("p"); panel.className = "cal-boot-problem"; panel.setAttribute("role", "alert"); panel.textContent = text; document.body.append(panel) }
      const start = async () => {
        const workers = navigator.serviceWorker
        if (!workers) return fail("This browser has no service workers. Caliper needs one to reach a project's dev server. Use a secure origin, such as localhost or HTTPS.")
        const existing = await workers.getRegistration("/")
        if (existing && existing.active && !workers.controller && !sessionStorage.getItem("caliper:reloaded")) {
          sessionStorage.setItem("caliper:reloaded", "1")
          return location.reload()
        }
        sessionStorage.removeItem("caliper:reloaded")
        await workers.register(${worker}, { scope: "/" })
        await workers.ready
        if (!workers.controller) await new Promise(done => { workers.addEventListener("controllerchange", done, { once: true }); setTimeout(done, 5000) })
        if (!workers.controller) return fail("Caliper's service worker does not control this page. Reload the page.")
        document.documentElement.dataset.calRouted = "true"
        await import(${entry})
      }
      start().catch(error => fail(\`Caliper could not start: \${error instanceof Error ? error.message : String(error)}\`))
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
