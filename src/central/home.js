// @ts-check
// The Caliper app's first page: the running projects, each a link to its
// chrome. It uses the chrome's own stylesheet for the Darkroom tokens and
// font (decision 34), and follows the registry live.
import { chromeDelivery } from "../build/chrome.js"

/**
 * What the page knows. `Connecting` is before the first project list.
 * `Lost` keeps the last list, which may be out of date, while the page
 * tries again.
 *
 * @typedef {import("./server.js").ProjectView} ProjectView
 * @typedef {{ _tag: "Connecting" } | { _tag: "Live", projects: ProjectView[] } | { _tag: "Lost", projects: ProjectView[] }} HomeState
 * @typedef {{ tone: "running" | "good" | "warn" | "bad", status: string, slot: { title: string, note: string } | null, steps: boolean, stale: boolean }} HomeView
 */

/**
 * The one decision about what the page shows. The page script runs this same
 * function, so the server's first paint and every later state agree.
 * It must stay self-contained: the page gets its source text.
 *
 * @param {HomeState} state
 * @returns {HomeView}
 */
export function homeView(state) {
  const projects = state._tag === "Connecting" ? [] : state.projects
  const count = (/** @type {number} */ n) => n === 1 ? "1 project" : `${n} projects`
  if (state._tag === "Connecting") {
    return { tone: "running", status: "Connecting to the Caliper app", slot: { title: "Loading projects", note: "The list shows when the app answers." }, steps: false, stale: false }
  }
  if (state._tag === "Lost") {
    return {
      tone: "bad", status: "Lost the Caliper app. Trying again.",
      slot: projects.length === 0 ? { title: "No project list", note: "The list comes back when the app answers." } : null,
      steps: false, stale: projects.length > 0,
    }
  }
  if (projects.length === 0) {
    return { tone: "running", status: "Watching for dev servers", slot: { title: "No project is running", note: "A dev server with the Caliper plugin shows here by itself." }, steps: true, stale: false }
  }
  const blocked = projects.filter(project => project.status !== "Ready").length
  return {
    tone: blocked > 0 ? "warn" : "good",
    status: blocked > 0 ? `${count(projects.length)} running, ${blocked} cannot open` : `${count(projects.length)} running`,
    slot: null, steps: false, stale: false,
  }
}

/** @param {string} text */
const escape = text => text.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`)

/**
 * @param {{ themeColor: string }} input
 */
export function homePage({ themeColor }) {
  /** @type {string[]} */
  let css = []
  try { css = chromeDelivery().css.map(file => `/__caliper/assets/${file}`) } catch { /* the page still lists projects in system fonts */ }
  const first = homeView({ _tag: "Connecting" })
  return `<!doctype html>
<html lang="en" class="dr-scope cal-home">
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
  <body>
    <main data-cal="home" data-state="Connecting">
      <header class="cal-home__head">
        <div>
          <h1>Caliper</h1>
          <p class="cal-home__lead">Projects whose dev server runs with the Caliper plugin.</p>
        </div>
        <p class="cal-home__live" role="status"><span class="cal-home__dot" data-tone="${first.tone}"></span><span data-cal="home-status">${escape(first.status)}</span></p>
      </header>
      <ul class="cal-home__list" data-cal="projects"></ul>
      <div class="cal-home__slot" data-cal="home-slot"${first.slot ? "" : " hidden"}><b>${escape(first.slot?.title ?? "")}</b><span>${escape(first.slot?.note ?? "")}</span></div>
      <section class="cal-home__steps" data-cal="home-steps" aria-labelledby="cal-home-steps"${first.steps ? "" : " hidden"}>
        <h2 id="cal-home-steps">Add a project</h2>
        <ol>
          <li><p>In the project, install the plugin:</p><pre><code>npm install --save-dev @simonwjackson/caliper</code></pre></li>
          <li><p>Add it to <code>vite.config</code>:</p><pre><code>import { caliper } from "@simonwjackson/caliper"

export default defineConfig({ plugins: [caliper()] })</code></pre></li>
          <li><p>Start the dev server:</p><pre><code>npx vite</code></pre></li>
        </ol>
      </section>
    </main>
    <script type="module">${SCRIPT}</script>
  </body>
</html>
`
}

const STYLE = `
html.cal-home, .cal-home body { margin: 0; min-height: 100%; background: var(--dr-room, #121316); color: var(--dr-ink, #ECECEE); font-family: var(--dr-sans, system-ui, sans-serif); font-size: var(--dr-fs-2, 13px); }
.cal-home main { box-sizing: border-box; max-width: 44rem; margin: 0 auto; padding: max(var(--dr-gutter, 1rem), env(safe-area-inset-top)) max(var(--dr-gutter, 1rem), env(safe-area-inset-right)) max(var(--dr-gutter, 1rem), env(safe-area-inset-bottom)) max(var(--dr-gutter, 1rem), env(safe-area-inset-left)); }
.cal-home__head { display: grid; gap: .5rem; margin: 1.5rem 0 1.25rem; }
.cal-home h1 { font-size: var(--dr-fs-3, 15px); font-weight: 600; margin: 0 0 .25rem; }
.cal-home__lead { color: var(--dr-ink-2, #A3A6AE); margin: 0; }
.cal-home__live { display: inline-flex; align-items: center; gap: .5rem; margin: 0; color: var(--dr-ink-2, #A3A6AE); font-size: var(--dr-fs-1, 12px); }
.cal-home__dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--dr-ink-2, #A3A6AE); }
.cal-home__dot[data-tone="running"] { animation: cal-home-pulse 1.2s ease-in-out infinite; }
.cal-home__dot[data-tone="good"] { background: var(--dr-good, #7FD39A); }
.cal-home__dot[data-tone="warn"] { background: var(--dr-warn, #E9B565); }
.cal-home__dot[data-tone="bad"] { background: var(--dr-bad, #FF7B72); }
@keyframes cal-home-pulse { 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .cal-home__dot[data-tone="running"] { animation: none; } }
.cal-home__list { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; transition: opacity .2s; }
.cal-home__list:empty { display: none; }
.cal-home main[data-stale] .cal-home__list { opacity: .45; }
.cal-home__row { background: var(--dr-card, #1C1D21); box-shadow: var(--dr-lift); border-radius: var(--dr-radius, 8px); }
.cal-home__row a, .cal-home__row > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .125rem .75rem; padding: .75rem .875rem; min-height: var(--dr-control-h, 2.25rem); color: inherit; text-decoration: none; border-radius: inherit; }
.cal-home__row a:hover { background: var(--dr-card-2, #24262B); }
.cal-home__row a:focus-visible { outline: 2px solid var(--dr-ink, #ECECEE); outline-offset: 2px; }
.cal-home__name { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.cal-home__where { grid-column: 1 / -1; color: var(--dr-ink-3, #6E717A); font-size: var(--dr-fs-1, 12px); overflow-wrap: anywhere; }
.cal-home__status { color: var(--dr-ink-2, #A3A6AE); font-size: var(--dr-fs-1, 12px); justify-self: end; }
/* A problem is a sentence, not a word: it takes its own line, so it never squeezes the name. */
.cal-home__row:not([data-status="Ready"]) .cal-home__status { grid-column: 1 / -1; justify-self: start; }
.cal-home__row[data-status="Protocol"] .cal-home__status, .cal-home__row[data-status="Duplicate"] .cal-home__status, .cal-home__row[data-status="Silent"] .cal-home__status { color: var(--dr-warn, #E9B565); }
.cal-home__row[data-status="Protocol"], .cal-home__row[data-status="Duplicate"], .cal-home__row[data-status="Silent"] { background: transparent; box-shadow: 0 0 0 1px var(--dr-edge, #303237); }
/* The empty slot: drawn where the first project row will be, the same size, with no card. */
.cal-home__slot { display: grid; gap: .125rem; padding: .75rem .875rem; border: 1px dashed var(--dr-edge-2, #3E4148); border-radius: var(--dr-radius, 8px); }
.cal-home__slot[hidden] { display: none; }
.cal-home__slot b { font-weight: 600; color: var(--dr-ink-2, #A3A6AE); }
.cal-home__slot span { color: var(--dr-ink-3, #6E717A); font-size: var(--dr-fs-1, 12px); }
.cal-home__steps { margin-top: 2rem; }
.cal-home__steps h2 { font-size: var(--dr-fs-2, 13px); font-weight: 600; margin: 0 0 .75rem; }
.cal-home__steps ol { margin: 0; padding: 0 0 0 1.25rem; display: grid; gap: 1rem; }
.cal-home__steps li { min-width: 0; color: var(--dr-ink-2, #A3A6AE); padding-left: .25rem; }
.cal-home__steps li::marker { color: var(--dr-ink-3, #6E717A); font-variant-numeric: tabular-nums; }
.cal-home__steps p { margin: 0 0 .4rem; }
.cal-home__steps pre { margin: 0; padding: .625rem .75rem; background: var(--dr-card, #1C1D21); border-radius: 6px; color: var(--dr-ink, #ECECEE); font-size: var(--dr-fs-1, 12px); line-height: 1.5; overflow-x: auto; }
.cal-home code { font-family: var(--dr-mono, monospace); font-size: .95em; }
.cal-home pre code { font-size: inherit; }
`

const SCRIPT = `
${homeView}
const main = document.querySelector("main")
const list = document.querySelector(".cal-home__list")
const dot = document.querySelector(".cal-home__dot")
const status = document.querySelector('[data-cal="home-status"]')
const slot = document.querySelector(".cal-home__slot")
const steps = document.querySelector(".cal-home__steps")
const where = project => project.root.replace(/^\\/home\\/[^/]+/, "~") + " · " + new URL(project.url).host
const row = project => {
  const item = document.createElement("li")
  item.className = "cal-home__row"
  item.dataset.status = project.status
  item.dataset.project = project.id
  const body = document.createElement(project.status === "Ready" ? "a" : "div")
  if (project.status === "Ready") body.href = project.chrome
  const name = Object.assign(document.createElement("span"), { className: "cal-home__name", textContent: project.name })
  const state = Object.assign(document.createElement("span"), { className: "cal-home__status", textContent: project.status === "Ready" ? "Open" : "Cannot open: " + project.problem })
  const place = Object.assign(document.createElement("span"), { className: "cal-home__where", textContent: where(project) })
  body.append(name, state, place)
  item.append(body)
  return item
}
let state = { _tag: "Connecting" }
const show = next => {
  state = next
  const view = homeView(state)
  main.dataset.state = state._tag
  main.toggleAttribute("data-stale", view.stale)
  dot.dataset.tone = view.tone
  status.textContent = view.status
  if (state._tag !== "Connecting") list.replaceChildren(...state.projects.map(row))
  // A stale row's link goes to an app that does not answer.
  list.inert = view.stale
  slot.hidden = view.slot === null
  if (view.slot) slot.replaceChildren(Object.assign(document.createElement("b"), { textContent: view.slot.title }), Object.assign(document.createElement("span"), { textContent: view.slot.note }))
  steps.hidden = !view.steps
}
const connect = () => {
  const source = new EventSource("/__caliper/api/projects/events")
  source.addEventListener("projects", event => show({ _tag: "Live", projects: JSON.parse(event.data).projects }))
  source.addEventListener("error", () => {
    show({ _tag: "Lost", projects: state._tag === "Connecting" ? [] : state.projects })
    // EventSource retries a dropped stream by itself, but not an HTTP error, such as a proxy's 502.
    if (source.readyState === EventSource.CLOSED) setTimeout(connect, 3000)
  })
}
connect()
// Install the routing worker now, so the first project opens with it in control.
navigator.serviceWorker?.register("/__caliper/sw.js", { scope: "/" }).catch(() => {})
`
