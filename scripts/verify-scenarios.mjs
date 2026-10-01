#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
// @ts-check
/** Real composed scenarios, take isolation and chrome navigation. No model or backend service.
 * CHROMIUM=/path/to/chromium node scripts/verify-scenarios.mjs --modules /path/to/react-project/node_modules
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"
import { projectBase, startApp } from "./caliper-app.mjs"
import { createTakeStore } from "../src/takes/store.js"
import { createIntegrationReview } from "../src/takes/integration.js"
import { planRenders } from "../src/render/plan.js"
import { renderJobs } from "../src/render/render.js"
import { relatedStates } from "../src/client/scenarios.js"
import { cal, deferLayout, reveal, waitFrames } from "./verify-helpers.mjs"

const { values } = parseArgs({ options: { modules: { type: "string" }, out: { type: "string", default: "/tmp/caliper-scenarios" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const root = mkdtempSync(join(tmpdir(), "caliper-scenarios-"))
const out = values.out
mkdirSync(out, { recursive: true })
/** @param {string} file @param {string} source */
function write(file, source) {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), source)
}
const cart = "src/Cart.molecule.part.tsx"
const shelf = "src/Shelf.organism.part.tsx"
const home = "src/Home.page.part.tsx"
const files = {
  "package.json": JSON.stringify({ name: "scenario-consumer", type: "module", exports: { ".": "./src/index.ts" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
  "src/index.ts": 'import "./global.css"; export { Home } from "./Home"',
  "src/global.css": 'body { margin: 0; font: 16px system-ui; } .theme { color: #eee; background: #151515; height: 100%; } button { font: inherit; }',
  "src/Badge.atom.part.tsx": 'export default function Badge() { return <span>Badge</span> }',
  "src/fixtures.ts": 'export const ready = [{id:"a", title:"Alpha", art:true},{id:"b", title:"Beta", art:true}]; export const mixed = [ready[0], {...ready[1], art:false}];',
  "src/Cart.tsx": 'import "./Cart.css"; export function Cart({game,onRemove}) { return <article className="cart" data-id={game.id}><span>{game.title}</span><p>{game.art ? "Artwork" : "No artwork"}</p><button onClick={() => onRemove(game.id)}>Remove {game.title}</button></article> }',
  "src/Cart.css": '.cart { border: 1px solid #888; padding: 8px; letter-spacing: 0px; }',
  "src/Shelf.tsx": 'import { Cart } from "./Cart"; export function Shelf({games,onRemove}) { return <section aria-label="Shelf">{games.map(game => <Cart key={game.id} game={game} onRemove={onRemove} />)}</section> }',
  "src/Home.tsx": 'import {useState} from "react"; import {Shelf} from "./Shelf"; export function Home({initial}) { const [games,setGames]=useState(initial); return <main><h1>Library</h1><output>{games.length} games</output>{games.length ? <Shelf games={games} onRemove={id => setGames(games.filter(game => game.id !== id))} /> : <p>No games</p>}<button onClick={() => setGames(initial)}>Reset library</button></main> }',
  [cart]: 'import {Cart} from "./Cart"; import {ready,mixed} from "./fixtures"; export const name="Cart"; export default function Default() { return <Cart game={ready[0]} onRemove={() => {}} /> } export function MissingArt() { return <Cart game={mixed[1]} onRemove={() => {}} /> }',
  [shelf]: `import {Shelf} from "./Shelf"; import {ready,mixed} from "./fixtures"; export const name="Shelf"; export default function Default() { return <Shelf games={ready} onRemove={() => {}} /> } export function MissingArt() { return <Shelf games={mixed} onRemove={() => {}} /> } export const composition = { default: [{part:"${cart}",state:"default"}], MissingArt: [{part:"${cart}",state:"default"},{part:"${cart}",state:"MissingArt"}] };`,
  [home]: `import {Home} from "./Home"; import {ready,mixed} from "./fixtures"; export const name="Home"; export default function Default() { return <Home initial={ready} /> } export function MissingArt() { return <Home initial={mixed} /> } export function Empty() { return <Home initial={[]} /> } export const composition = { default: [{part:"${shelf}",state:"default"}], MissingArt: [{part:"${shelf}",state:"MissingArt"}] };`,
}
for (const [path, source] of Object.entries(files)) write(path, source)
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")
const store = createTakeStore(root)
const context = { part: home, state: "MissingArt" }
const take = store.create({ part: cart, state: "MissingArt", context, device: "iphone-16" })
store.write(take, "src/Cart.css", '.cart { border: 3px solid #f80; padding: 8px; letter-spacing: 3px; }')
const isolatedTake = store.create({ part: cart, state: "MissingArt", device: "iphone-16" })
store.write(isolatedTake, "src/Cart.css", '.cart { letter-spacing: 5px; }')
const otherStateTake = store.create({ part: cart, state: "default", device: "iphone-16" })
store.write(otherStateTake, "src/Cart.css", '.cart { letter-spacing: 7px; }')
const server = await createServer({ root, cacheDir: join(root, ".vite"), configFile: false, logLevel: "silent", plugins: [caliper({ wrap: "theme" })], server: { host: "127.0.0.1", port: 0 } })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** @type {string[]} */
const errors = []
/** @type {import("playwright-core").Page | undefined} */
let debugPage
/** @type {Awaited<ReturnType<typeof startApp>> | undefined} */
let app
try {
  await server.listen()
  app = await startApp()
  const origin = await projectBase(app, root)
  assert(origin)
  const base = `${origin}__caliper/`
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })
  debugPage = page
  page.on("pageerror", error => errors.push(error.message))
  page.on("request", request => assert.equal(new URL(request.url()).origin, new URL(base).origin, "fixture makes no remote requests"))
  await page.goto(`${base}#part=${home}&state=MissingArt`)
  await waitFrames(page, 1)
  const screen = page.frameLocator(cal.frame)
  assert.equal(await screen.locator("output").textContent(), "2 games")
  assert.equal(await screen.getByText("No artwork", { exact: true }).count(), 1)
  await screen.getByRole("button", { name: "Remove Beta" }).click()
  assert.equal(await screen.locator("output").textContent(), "1 games", "parent and child share working state")
  assert.equal(await screen.locator('[data-id="b"]').count(), 0)
  await screen.getByRole("button", { name: "Remove Alpha" }).click()
  await screen.getByText("No games", { exact: true }).waitFor()
  assert.equal(await screen.getByRole("region", { name: "Shelf" }).count(), 0)
  await screen.getByRole("button", { name: "Reset library" }).click()
  assert.equal(await screen.locator("output").textContent(), "2 games")

  await page.locator(`${cal.subject}[data-part="${cart}"][data-state="MissingArt"]`).click()
  assert.match(await page.getByRole("region", { name: "Scenario context" }).innerText(), /Editing Cart · Missing art/)
  assert.match(await page.getByLabel("Preview scenario").locator("option:checked").innerText(), /Home · Missing art/)
  assert.equal(await screen.locator("h1").innerText(), "Library", "drilling into a child keeps the whole scenario")
  await page.locator(`${cal.nav} ${cal.navTake}[data-take="${take}"]`).click()
  await waitFrames(page, 3)
  assert.equal(await page.locator(cal.frame).count(), 3, "only takes of the selected state are compared")
  assert.equal(await page.locator(`${cal.frame}[data-take="${otherStateTake}"]`).count(), 0, "another state's take is not compared")
  assert.equal(await page.locator(`${cal.nav} ${cal.navTake}[data-take="${otherStateTake}"]`).count(), 1, "another state's take remains navigable")
  const original = page.frameLocator(`${cal.frame}:not([data-take])`)
  const edited = page.frameLocator(`${cal.frame}[data-take="${take}"]`)
  assert.equal(await original.locator(".cart").first().evaluate(node => getComputedStyle(node).letterSpacing), "normal")
  assert.equal(await edited.locator(".cart").first().evaluate(node => getComputedStyle(node).letterSpacing), "3px")
  assert.equal(await edited.locator(".cart").count(), 2, "source edits affect repeated instances, not substituted fixtures")
  await edited.getByRole("button", { name: "Remove Beta" }).click()
  assert.equal(await edited.locator("output").textContent(), "1 games")
  assert.equal(await original.locator("output").textContent(), "2 games", "frame fixture state is isolated")
  await page.reload()
  await waitFrames(page, 3)
  assert.equal(await edited.locator("output").textContent(), "2 games", "reload resets fixture state")
  assert.match(await page.getByLabel("Preview scenario").locator("option:checked").innerText(), /Home/)
  assert.equal(await page.locator(`${cal.nav} ${cal.navTake}[data-take="${take}"]`).getAttribute("aria-current"), "true", "reload restores the selected take identity")
  await page.locator(`${cal.tool}[data-tool="takes"]`).click()
  assert.match(await page.locator(`${cal.record}[data-take="${take}"]`).innerText(), new RegExp(`Take ${take}`))

  store.write(take, "src/Cart.css", '.cart { letter-spacing: 4px; }')
  await edited.locator(".cart").first().evaluate(node => node.setAttribute("data-before-css", "same document"))
  await page.waitForFunction(selector => {
    const frame = /** @type {HTMLIFrameElement | null} */ (document.querySelector(selector))
    const node = frame?.contentDocument?.querySelector(".cart")
    return node && getComputedStyle(node).letterSpacing === "4px"
  }, `${cal.frame}[data-take="${take}"]`)
  assert.equal(await edited.locator(".cart").first().getAttribute("data-before-css"), "same document", "CSS HMR preserves fixture state")
  assert.equal(await original.locator(".cart").first().evaluate(node => getComputedStyle(node).letterSpacing), "normal")

  // Compare is owned by the state, even when a different state's take was selected.
  await page.locator(`${cal.nav} ${cal.compare}[data-part="${cart}"][data-state="default"]`).click()
  await waitFrames(page, 2)
  assert.equal(await page.locator(`${cal.frame}[data-take="${otherStateTake}"]`).count(), 1)
  assert.equal(await page.locator(`${cal.frame}[data-take="${take}"]`).count(), 0)
  assert.equal(await page.frameLocator(`${cal.frame}[data-take="${otherStateTake}"]`).locator(".cart").first().evaluate(node => getComputedStyle(node).letterSpacing), "7px")
  await page.locator(`${cal.nav} ${cal.navTake}[data-take="${take}"]`).click()
  await waitFrames(page, 3)

  // Available child states lead to whole authored scenarios, not prop overrides.
  await page.locator(`${cal.nav} ${cal.state}[data-part="${cart}"][data-state="default"]`).click()
  await page.getByLabel("Preview scenario").selectOption({ label: "Home · Default" })
  await waitFrames(page, 1)
  assert.equal(await screen.getByText("No artwork", { exact: true }).count(), 0)
  await page.locator(`${cal.nav} ${cal.state}[data-part="${cart}"][data-state="MissingArt"]`).click()
  assert.match(await page.getByRole("region", { name: "Scenario context" }).innerText(), /not declared/)
  assert.match(await page.getByLabel("Preview scenario").locator("option:checked").innerText(), /Isolated/)
  await page.getByLabel("Preview scenario").selectOption({ label: "Home · Missing art" })
  await waitFrames(page, 1)
  await page.locator(`${cal.nav} ${cal.navTake}[data-take="${take}"]`).click()
  await waitFrames(page, 3)

  /** @type {Array<[string,number,number]>} */
  const sizes = [["generous",1800,1000],["medium",1000,800],["narrow-tall",390,844],["wide-short",1280,300],["tiny",320,320]]
  for (const [name,width,height] of sizes) {
    await page.setViewportSize({ width,height })
    for (const selector of [cal.context, `${cal.nav} ${cal.navTake}`, cal.subject, `${cal.setup} summary`, cal.prompt, cal.start, `${cal.accept}[data-take="${take}"]`, `${cal.tool}[data-tool="calibrate"]`, `${cal.tool}[data-tool="takes"]`]) {
      const control = await reveal(page, page.locator(selector).first())
      assert(await control.isVisible(), `${selector} remains reachable at ${name}`)
    }
    // Exercise an action at each shape, not only the presence of its control.
    await (await reveal(page, page.locator(cal.context))).selectOption({ label: "Home · Missing art" })
    assert.match(await page.getByLabel("Preview scenario").locator("option:checked").innerText(), /Home · Missing art/)
    await page.screenshot({ path: join(out, `${name}.png`) })
  }
  deferLayout(["Scenario controls fully inside the viewport and hit-test unclipped/uncovered at all five shapes", "Zero document overflow at all five shapes; drawer/tab/overflow tap depth"])
  await page.setViewportSize({ width:1800,height:1000 })

  /** @type {import("../src/types").Project} */
  const project = await (await fetch(`${base}project.json`)).json()
  const refs = relatedStates(project.parts, { part:cart,state:"MissingArt" })
  const jobs = refs.flatMap(ref => {
    const plan = planRenders(project, { ...ref, devices:["iphone-16"], take })
    assert.equal(plan._tag,"Planned")
    return plan._tag === "Planned" ? plan.jobs : []
  })
  // Renders read the dev server itself (decision 14), not the app.
  const results = await renderJobs({ url: server.resolvedUrls?.local[0] ?? "",jobs,out:join(out,"renders"),executablePath:process.env.CHROMIUM })
  assert.equal(results.length, refs.length)
  assert(results.every(result => result.frame === "Rendered" && result.console.length === 0))

  // Removing the declared relation makes the stored context stale, visibly.
  write(home, files[home].replace(`MissingArt: [{part:"${shelf}",state:"MissingArt"}]`, "MissingArt: []"))
  await page.getByRole("region", { name: "Scenario context" }).getByRole("status").filter({ hasText:"not declared" }).waitFor()
  assert.match(await page.getByLabel("Preview scenario").locator("option:checked").innerText(), /Isolated/)
  const refused = await fetch(`${base}takes/${take}/accept`, { method:"POST",headers:{"content-type":"application/json"},body:"{}" })
  assert.equal(refused.status,400,"stale context blocks accept")
  assert.equal(store.record(take)?.context?.part,home,"stale take remains recoverable")
  write(home, files[home])
  await page.getByLabel("Preview scenario").locator("option").filter({hasText:"Home · Missing art"}).waitFor({state:"attached"})
  page.on("dialog",dialog => dialog.accept())
  await page.locator(`${cal.nav} ${cal.navTake}[data-take="${take}"]`).click()
  await (await reveal(page, page.locator(`${cal.accept}[data-take="${take}"]`))).click()
  await page.locator(`${cal.nav} ${cal.navTake}[data-take="${take}"]`).waitFor({ state: "detached" })
  assert.equal(store.record(take),null)
  assert.match(store.read(isolatedTake,"src/Cart.css"),/5px/,"accept does not overwrite another take")
  write(home, files[home].replace(`state:"MissingArt"}]`, 'state:"Gone"}]'))
  await page.locator(`${cal.setup} [role="alert"]`).filter({hasText:"Gone"}).waitFor({state:"attached"})
  await reveal(page, page.locator(`${cal.setup} [role="alert"]`).first())
  assert.match(await page.locator(cal.setup).innerText(), /Gone/)

  write(home, files[home])
  write(cart, files[cart].replace("function MissingArt()", "function RemovedArt()"))
  const unavailable = page.locator(`${cal.unavailable} ${cal.navTake}[data-take="${isolatedTake}"]`)
  await unavailable.waitFor()
  await unavailable.click()
  for (const accept of await page.locator(`${cal.accept}[data-take="${isolatedTake}"]`).all()) assert.equal(await accept.isDisabled(),true)
  await page.reload()
  await unavailable.click()
  await (await reveal(page, page.locator(`${cal.discard}[data-take="${isolatedTake}"]`))).click()
  await unavailable.waitFor({state:"detached"})
  assert.equal(store.record(isolatedTake),null,"removed-state takes remain discardable after reload")
  write(cart,files[cart])

  write(home,files[home].replace("export const composition = {", `export function Broken() { throw new Error("Scenario failure") } export const composition = { Broken: [{part:"${cart}",state:"MissingArt"}],`))
  await page.locator(`${cal.nav} ${cal.part}[data-part="${home}"]`).click()
  await page.locator(`${cal.nav} ${cal.state}[data-part="${home}"][data-state="Broken"]`).click()
  await waitFrames(page, 1, "Failed")
  assert.match(await page.locator(cal.frameProblem).innerText(),/Scenario failure/)
  const failedSrc = await page.locator(cal.frame).getAttribute("src")
  await page.locator(`${cal.subject}[data-part="${cart}"][data-state="MissingArt"]`).click()
  assert.equal(await page.locator(cal.frame).getAttribute("src"),failedSrc)
  assert.match(await page.locator(cal.frameProblem).innerText(),/Scenario failure/,"drilling into a child preserves the retained preview's error")
  await page.locator(`${cal.nav} ${cal.part}[data-part="${cart}"]`).click()
  await page.locator(`${cal.nav} ${cal.part}[data-part="src/Badge.atom.part.tsx"]`).click()
  await waitFrames(page, 1)
  assert.equal(await screen.getByText("Badge",{exact:true}).count(),1,"All states falls back to the only state of a single-state part")
  write(home,files[home])
  const experiment = store.create({part:cart,state:"MissingArt",context,device:"iphone-16",name:"Context experiment"})
  store.write(experiment,"src/proposal-note.ts","export const note = 'experiment'\n")
  const integration = createIntegrationReview(store)
  const proposal = integration.begin(experiment)
  store.write(proposal,home,`${files[home]}\nexport function Alternate() { return <Home initial={[{id:"alternate",title:"Alternate choice",art:false}]} /> }`)
  integration.submit(proposal,{strategy:"variant",summary:"An explicit alternate scenario",shared:"The real Home renderer",preserved:"Existing scenario exports",usage:"Choose the Alternate state",preview:{part:home,state:"Alternate"}})
  await page.reload()
  await page.locator(`${cal.nav} ${cal.part}[data-part="${cart}"]`).click()
  await page.locator(`${cal.nav} ${cal.navTake}[data-take="${proposal}"]`).click()
  await waitFrames(page, 3)
  const alternate = page.frameLocator(`${cal.frame}[data-take="${proposal}"]`)
  assert.equal(await alternate.getByText("Alternate choice",{exact:true}).count(),1,"an alternate's explicit preview is not replaced by the source take's context")
  assert.equal(await alternate.getByText("Beta",{exact:true}).count(),0)
  assert.deepEqual(errors,[])
  console.log(`PASS: working page state, transitive browsing, state-owned takes, context restore, repeated instances, frame isolation, CSS HMR, ${sizes.length} behavioral size samples (layout deferred), ${results.length} related renders, stale context, acceptance and visible declaration errors. Screenshots: ${out}`)
} catch (error) {
  if (debugPage) {
    await debugPage.screenshot({path:join(out,"failure.png")})
    console.error(await debugPage.locator("body").innerText())
    console.error(await debugPage.locator("iframe").evaluateAll(nodes => nodes.map(node => {
      const frame = /** @type {HTMLIFrameElement} */ (node)
      return {src:frame.getAttribute("src"),state:frame.contentDocument?.documentElement.dataset.caliperState,body:frame.contentDocument?.body.innerText}
    })))
  }
  console.error(errors)
  throw error
} finally {
  await browser.close()
  await app?.close(); await server.close()
  rmSync(root,{ recursive:true,force:true })
}
