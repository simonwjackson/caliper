// @ts-check
// The Caliper app's first page: the running projects, each a link to its
// chrome. It uses the chrome's own stylesheet for the Darkroom tokens and
// font (decision 34), and follows the registry live.
//
// The page shows its state, it does not describe it. A row-shaped slot with a
// moving light is the list looking for a dev server. The recipe under it is the
// file and the commands, with only the part to add lit. A lost app dims the
// rows, and a line fills for exactly the time until the page tries again.
import { chromeDelivery } from "../build/chrome.js"

/** How long the page waits before it connects again, in ms. The retry line fills in this time. */
export const RETRY_MS = 3000

/**
 * What the page knows. `Connecting` is before the first project list.
 * `Lost` keeps the last list, which may be out of date, until the page
 * connects again.
 *
 * @typedef {import("./server.js").ProjectView} ProjectView
 * @typedef {{ _tag: "Connecting" } | { _tag: "Live", projects: ProjectView[] } | { _tag: "Lost", projects: ProjectView[] }} HomeState
 * @typedef {{ slot: "Looking" | "Still" | "None", recipe: boolean, retry: boolean, stale: boolean, said: string }} HomeView
 */

/**
 * The one decision about what the page draws. `said` is for screen readers
 * only. The page script runs this same function, so the server's first paint
 * and every later state agree. It must stay self-contained: the page gets its
 * source text.
 *
 * @param {HomeState} state
 * @returns {HomeView}
 */
export function homeView(state) {
  if (state._tag === "Connecting") return { slot: "Looking", recipe: false, retry: false, stale: false, said: "Connecting to the Caliper app." }
  const { projects } = state
  const count = projects.length === 1 ? "1 project" : `${projects.length} projects`
  if (state._tag === "Lost") {
    return { slot: projects.length === 0 ? "Still" : "None", recipe: false, retry: true, stale: projects.length > 0, said: "Lost the Caliper app. Reconnecting." }
  }
  if (projects.length === 0) return { slot: "Looking", recipe: true, retry: false, stale: false, said: "No project is running. Waiting for a dev server." }
  const blocked = projects.filter(project => project.status !== "Ready").length
  return { slot: "None", recipe: false, retry: false, stale: false, said: blocked > 0 ? `${count}, ${blocked} cannot open.` : `${count}.` }
}

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
    <main data-cal="home" data-state="Connecting" data-slot="${first.slot}" style="--cal-retry: ${RETRY_MS}ms">
      <h1>Caliper</h1>
      <p class="cal-home__said" role="status" data-cal="home-said">${first.said}</p>
      <div class="cal-home__retry" data-cal="home-retry" aria-hidden="true" hidden><span>Reconnecting</span></div>
      <ul class="cal-home__list" data-cal="projects"></ul>
      <div class="cal-home__slot" aria-hidden="true"><i></i><i></i></div>
      <div class="cal-home__recipe" data-cal="home-recipe" hidden>
        <figure class="cal-home__file">
          <figcaption>vite.config.ts</figcaption>
          <pre><code><mark>import { caliper } from "@simonwjackson/caliper"</mark>
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [<mark>caliper()</mark>],
})</code></pre>
        </figure>
        <pre class="cal-home__term"><code><span aria-hidden="true">$ </span>npm i -D @simonwjackson/caliper
<span aria-hidden="true">$ </span>npx vite</code></pre>
      </div>
    </main>
    <script type="module">${SCRIPT}</script>
  </body>
</html>
`
}

const STYLE = `
html.cal-home, .cal-home body { margin: 0; min-height: 100%; background: var(--dr-room, #121316); color: var(--dr-ink, #ECECEE); font-family: var(--dr-sans, system-ui, sans-serif); font-size: var(--dr-fs-2, 13px); }
.cal-home main { box-sizing: border-box; max-width: 44rem; margin: 0 auto; display: grid; gap: .5rem; padding: max(var(--dr-gutter, 1rem), env(safe-area-inset-top)) max(var(--dr-gutter, 1rem), env(safe-area-inset-right)) max(var(--dr-gutter, 1rem), env(safe-area-inset-bottom)) max(var(--dr-gutter, 1rem), env(safe-area-inset-left)); }
.cal-home h1 { font-size: var(--dr-fs-3, 15px); font-weight: 600; margin: 1.5rem 0 .75rem; }
.cal-home__said { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; margin: 0; }
.cal-home [hidden] { display: none !important; }

/* Rows. */
.cal-home__list { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; transition: opacity .2s; }
.cal-home__list:empty { display: none; }
.cal-home__row { background: var(--dr-card, #1C1D21); box-shadow: var(--dr-lift); border-radius: var(--dr-radius, 8px); }
.cal-home__row a, .cal-home__row > div { display: grid; gap: .25rem; padding: .75rem .875rem; color: inherit; text-decoration: none; border-radius: inherit; }
.cal-home__row a:hover { background: var(--dr-card-2, #24262B); }
.cal-home__row a:focus-visible { outline: 2px solid var(--dr-ink, #ECECEE); outline-offset: 2px; }
.cal-home__name { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.cal-home__where { display: flex; flex-wrap: wrap; gap: 0 1rem; color: var(--dr-ink-3, #6E717A); font-size: var(--dr-fs-1, 12px); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.cal-home__problem { color: var(--dr-warn, #E9B565); font-size: var(--dr-fs-1, 12px); }
.cal-home__row:not([data-status="Ready"]) { background: transparent; box-shadow: 0 0 0 1px var(--dr-edge, #303237); }
.cal-home main[data-stale] .cal-home__list { opacity: .4; }

/* The slot: the shape of the row that will land, with a light moving across it while the list looks. */
.cal-home__slot { position: relative; overflow: hidden; display: grid; gap: .5rem; padding: .875rem; border: 1px dashed var(--dr-edge-2, #3E4148); border-radius: var(--dr-radius, 8px); }
.cal-home__slot i { display: block; height: .5rem; border-radius: 2px; background: var(--dr-edge, #303237); }
.cal-home__slot i:first-child { width: min(9rem, 40%); height: .625rem; }
.cal-home__slot i:last-child { width: min(17rem, 75%); }
.cal-home__slot::after { content: ""; position: absolute; inset: 0; width: 40%; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--dr-ink, #ECECEE) 7%, transparent), transparent); transform: translateX(-100%); }
.cal-home main[data-slot="Looking"] .cal-home__slot::after { animation: cal-home-look 2.4s cubic-bezier(.4, 0, .2, 1) infinite; }
.cal-home main[data-slot="Still"] .cal-home__slot { opacity: .5; }
.cal-home main[data-slot="None"] .cal-home__slot { display: none; }
/* With the recipe, the slot comes last: the row lands under the command that starts it. */
.cal-home main:has(.cal-home__recipe:not([hidden])) .cal-home__slot { order: 1; }
@keyframes cal-home-look { to { transform: translateX(250%); } }

/* Lost: a line that fills for exactly the wait before the next try. */
.cal-home__retry { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .75rem; color: var(--dr-bad, #FF7B72); font-size: var(--dr-fs-1, 12px); }
.cal-home__retry::before { content: ""; height: 2px; border-radius: 1px; background: linear-gradient(var(--dr-bad, #FF7B72), var(--dr-bad, #FF7B72)) no-repeat 0 0 / 0% 100%, var(--dr-edge, #303237); animation: cal-home-retry var(--cal-retry) linear forwards; }
@keyframes cal-home-retry { to { background-size: 100% 100%, auto; } }

/* The recipe: the file and the commands. Only what you add is lit. */
.cal-home__recipe { display: grid; gap: .5rem; }
.cal-home__file { margin: 0; background: var(--dr-card, #1C1D21); border-radius: var(--dr-radius, 8px); overflow: hidden; }
.cal-home__file figcaption { padding: .5rem .875rem; color: var(--dr-ink-3, #6E717A); font-size: var(--dr-fs-1, 12px); border-bottom: 1px solid var(--dr-edge, #303237); }
.cal-home pre { margin: 0; padding: .75rem .875rem; font-family: var(--dr-mono, monospace); font-size: var(--dr-fs-1, 12px); line-height: 1.6; color: var(--dr-ink-3, #6E717A); overflow-x: auto; }
.cal-home mark { color: var(--dr-ink, #ECECEE); background: color-mix(in srgb, var(--dr-ink, #ECECEE) 9%, transparent); border-radius: 3px; padding: .1em .2em; margin: 0 -.2em; }
.cal-home__term { background: var(--dr-card, #1C1D21); border-radius: var(--dr-radius, 8px); }
.cal-home__term code { color: var(--dr-ink, #ECECEE); }
.cal-home__term span { color: var(--dr-ink-3, #6E717A); user-select: none; }

@media (prefers-reduced-motion: reduce) {
  .cal-home main[data-slot="Looking"] .cal-home__slot::after { animation: none; }
  .cal-home__list { transition: none; }
}
`

const SCRIPT = `
${homeView}
const RETRY_MS = ${RETRY_MS}
const main = document.querySelector("main")
const list = document.querySelector(".cal-home__list")
const said = document.querySelector(".cal-home__said")
const retry = document.querySelector(".cal-home__retry")
const recipe = document.querySelector(".cal-home__recipe")
const span = (className, textContent) => Object.assign(document.createElement("span"), { className, textContent })
const row = project => {
  const item = document.createElement("li")
  item.className = "cal-home__row"
  item.dataset.status = project.status
  item.dataset.project = project.id
  const ready = project.status === "Ready"
  const body = document.createElement(ready ? "a" : "div")
  if (ready) body.href = project.chrome
  const where = Object.assign(document.createElement("span"), { className: "cal-home__where" })
  where.append(span("", project.root.replace(/^\\/home\\/[^/]+/, "~")), span("", new URL(project.url).host))
  body.append(span("cal-home__name", project.name))
  if (!ready) body.append(span("cal-home__problem", "Cannot open: " + project.problem))
  body.append(where)
  item.append(body)
  return item
}
let state = { _tag: "Connecting" }
const show = next => {
  state = next
  const view = homeView(state)
  main.dataset.state = state._tag
  main.dataset.slot = view.slot
  main.toggleAttribute("data-stale", view.stale)
  if (said.textContent !== view.said) said.textContent = view.said
  if (state._tag !== "Connecting") list.replaceChildren(...state.projects.map(row))
  // A stale row's link goes to an app that does not answer.
  list.inert = view.stale
  recipe.hidden = !view.recipe
  // Each try starts the line again from empty.
  retry.hidden = true
  if (view.retry) { void retry.offsetWidth; retry.hidden = false }
}
// The page owns the retry, so the line shows the real wait.
const connect = () => {
  const source = new EventSource("/__caliper/api/projects/events")
  source.addEventListener("projects", event => show({ _tag: "Live", projects: JSON.parse(event.data).projects }))
  source.addEventListener("error", () => {
    source.close()
    show({ _tag: "Lost", projects: state._tag === "Connecting" ? [] : state.projects })
    setTimeout(connect, RETRY_MS)
  })
}
connect()
// Install the routing worker now, so the first project opens with it in control.
navigator.serviceWorker?.register("/__caliper/sw.js", { scope: "/" }).catch(() => {})
`
