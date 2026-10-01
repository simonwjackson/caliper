// @ts-check
// The Caliper app's first page: the running projects, each a link to its
// chrome. It uses the chrome's own stylesheet for the Darkroom tokens and
// font (decision 34), and follows the registry live.
import { chromeDelivery } from "../build/chrome.js"

/**
 * @param {{ themeColor: string }} input
 */
export function homePage({ themeColor }) {
  /** @type {string[]} */
  let css = []
  try { css = chromeDelivery().css.map(file => `/__caliper/assets/${file}`) } catch { /* the page still lists projects in system fonts */ }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Caliper</title>
    <link rel="manifest" href="/__caliper/manifest.webmanifest" />
    <link rel="icon" type="image/svg+xml" href="/__caliper/favicon.svg" />
    <link rel="apple-touch-icon" sizes="180x180" href="/__caliper/apple-touch-icon.png" />
    <meta name="theme-color" content="${themeColor.replace(/[^#\w]/g, "")}" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    ${css.map(url => `<link rel="stylesheet" href="${url}" />`).join("\n    ")}
    <style>${STYLE}</style>
  </head>
  <body class="dr-scope cal-home">
    <main>
      <h1>Caliper</h1>
      <p class="cal-home__lead">Projects whose dev server runs with the Caliper plugin.</p>
      <ul class="cal-home__list" data-cal="projects" aria-live="polite"></ul>
      <p class="cal-home__empty" hidden>No project is running. In a project with <code>caliper()</code> in its <code>vite.config</code>, start <code>vite</code>. It appears here by itself.</p>
    </main>
    <script type="module">${SCRIPT}</script>
  </body>
</html>
`
}

const STYLE = `
html, body.cal-home { margin: 0; min-height: 100%; background: var(--dr-room, #121316); color: var(--dr-ink, #ECECEE); font-family: var(--dr-sans, system-ui, sans-serif); font-size: var(--dr-fs-2, 13px); }
.cal-home main { box-sizing: border-box; max-width: 44rem; margin: 0 auto; padding: max(var(--dr-gutter, 1rem), env(safe-area-inset-top)) max(var(--dr-gutter, 1rem), env(safe-area-inset-right)) max(var(--dr-gutter, 1rem), env(safe-area-inset-bottom)) max(var(--dr-gutter, 1rem), env(safe-area-inset-left)); }
.cal-home h1 { font-size: var(--dr-fs-3, 15px); font-weight: 600; margin: 1.5rem 0 .25rem; }
.cal-home__lead { color: var(--dr-ink-2, #A3A6AE); margin: 0 0 1.25rem; }
.cal-home__list { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
.cal-home__row { background: var(--dr-card, #1C1D21); box-shadow: var(--dr-lift); border-radius: var(--dr-radius, 8px); }
.cal-home__row a, .cal-home__row > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .125rem .75rem; padding: .75rem .875rem; min-height: var(--dr-control-h, 2.25rem); color: inherit; text-decoration: none; border-radius: inherit; }
.cal-home__row a:hover { background: var(--dr-card-2, #24262B); }
.cal-home__row a:focus-visible { outline: 2px solid var(--dr-ink, #ECECEE); outline-offset: 2px; }
.cal-home__name { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.cal-home__where { grid-column: 1 / -1; color: var(--dr-ink-3, #6E717A); font-size: var(--dr-fs-1, 12px); overflow-wrap: anywhere; }
.cal-home__status { color: var(--dr-ink-2, #A3A6AE); font-size: var(--dr-fs-1, 12px); justify-self: end; }
.cal-home__row[data-status="Protocol"] .cal-home__status, .cal-home__row[data-status="Duplicate"] .cal-home__status, .cal-home__row[data-status="Silent"] .cal-home__status { color: var(--dr-warn, #E9B565); }
.cal-home__row[data-status="Protocol"], .cal-home__row[data-status="Duplicate"], .cal-home__row[data-status="Silent"] { background: transparent; box-shadow: 0 0 0 1px var(--dr-edge, #303237); }
.cal-home__empty { color: var(--dr-ink-2, #A3A6AE); line-height: 1.5; max-width: 34rem; }
.cal-home code { font-family: var(--dr-mono, monospace); font-size: .95em; }
`

const SCRIPT = `
const list = document.querySelector(".cal-home__list")
const empty = document.querySelector(".cal-home__empty")
const where = project => project.root.replace(/^\\/home\\/[^/]+/, "~") + " · " + new URL(project.url).host
const row = project => {
  const item = document.createElement("li")
  item.className = "cal-home__row"
  item.dataset.status = project.status
  item.dataset.project = project.id
  const body = document.createElement(project.status === "Ready" ? "a" : "div")
  if (project.status === "Ready") body.href = project.chrome
  const name = Object.assign(document.createElement("span"), { className: "cal-home__name", textContent: project.name })
  const status = Object.assign(document.createElement("span"), { className: "cal-home__status", textContent: project.status === "Ready" ? "Open" : "Cannot open: " + project.problem })
  const place = Object.assign(document.createElement("span"), { className: "cal-home__where", textContent: where(project) })
  body.append(name, status, place)
  item.append(body)
  return item
}
const show = value => {
  list.replaceChildren(...value.projects.map(row))
  empty.hidden = value.projects.length > 0
}
new EventSource("/__caliper/api/projects/events").addEventListener("projects", event => show(JSON.parse(event.data)))
// Install the routing worker now, so the first project opens with it in control.
navigator.serviceWorker?.register("/__caliper/sw.js", { scope: "/" }).catch(() => {})
`
