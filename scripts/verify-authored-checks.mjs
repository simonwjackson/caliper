#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
// Real browser contract gates: input, fresh state, takes, deadlines and source identity.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"
import { checkJobs } from "../src/render/checks.js"
import { createTakeStore } from "../src/takes/store.js"
import { withViewport } from "../src/render/plan.js"
import { STANDARD_DEVICES } from "../src/client/device-frame.js"

/** @template {import("../src/render/plan.js").DeviceJob} J @param {J} job */
const onDevice = job => withViewport({ devices: STANDARD_DEVICES }, job)

const { values } = parseArgs({
  options: { modules: { type: "string" }, out: { type: "string", default: "/tmp/caliper-authored-verification" } },
})
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const root = mkdtempSync("/tmp/caliper-authored-consumer-")
const out = resolve(values.out)
mkdirSync(join(root, "src"))
mkdirSync(out, { recursive: true })
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")
writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", exports: { ".": "./src/index.ts" } }))
writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
writeFileSync(join(root, "src/index.ts"), 'import "./fixture.css"')
writeFileSync(
  join(root, "src/fixture.css"),
  "body{margin:0}.slot{position:relative;width:fit-content}.cover{position:absolute;inset:0;background:white;z-index:1}",
)
writeFileSync(join(root, "src/heading.ts"), 'export const expectedHeading = "Library"')
const part = "src/Library.part.tsx"
const source = `import {useRef,useState} from 'react'
import {createPortal} from 'react-dom'
const phase = await fetch('/fixture-phase').then(response=>response.json())
const language = document.documentElement.lang
function Scenario({covered=false,disabled=false,redirect=false}) {
 const [loaded,setLoaded]=useState(false), [query,setQuery]=useState(''), [submitted,setSubmitted]=useState(''), [key,setKey]=useState(0)
 const other=useRef(null)
 function retry(){ setTimeout(()=>{setLoaded(true);setKey(value=>value+1)},30) }
 return <main lang={language}><h1>{loaded?'Library':'Load failed'}</h1>
 <div className="slot"><button key={key} disabled={disabled} onClick={retry}>Try again</button>{covered&&<div className="cover">Blocked</div>}</div>
 <form onSubmit={event=>{event.preventDefault();setSubmitted(query)}}><label>Find game<input value={query} onChange={event=>{setQuery(event.target.value);if(redirect)other.current?.focus()}}/></label><button ref={other}>Find</button></form>
 <output aria-label="Search result">{submitted}</output>
 {createPortal(<button onClick={retry}>Portal retry</button>,document.body)}
 </main>
}
export default function Default(){return <Scenario/>}
export function Covered(){return <Scenario covered/>}
export function Disabled(){return <Scenario disabled/>}
export function Redirect(){return <Scenario redirect/>}
export function Hang(){return <Scenario/>}
export function Loop(){return <Scenario/>}
export function Wait(){return <Scenario/>}
export function Pending(){throw new Promise(()=>{})}
export function RepeatPending(){if(phase===2)throw new Promise(()=>{});return <Scenario/>}
export const checks={
 default:{
  'retry':async({canvas,input,expect,waitFor})=>{await input.click(canvas.getByRole('button',{name:'Try again'}));const {expectedHeading}=await import('./heading');await waitFor(()=>expect(canvas.getByRole('heading',{name:expectedHeading})).toBeVisible())},
  'keyboard':async({canvas,input,expect,waitFor})=>{const field=canvas.getByRole('textbox',{name:'Find game'});await input.type(field,'Metroid');expect(field).toHaveFocus();await input.press(field,'Enter');await waitFor(()=>expect(canvas.getByRole('status',{name:'Search result'})).toHaveTextContent('Metroid'))},
  'portal':async({within,input,expect,waitFor})=>{await input.click(within(document.body).getByRole('button',{name:'Portal retry'}));await waitFor(()=>expect(within(document.body).getByRole('heading',{name:'Library'})).toBeVisible())},
  'fresh storage first':({expect})=>{expect(localStorage.getItem('check-state')).toBe(null);localStorage.setItem('check-state','yes')},
  'fresh storage second':({expect})=>{expect(localStorage.getItem('check-state')).toBe(null)},
  'stale target':async({canvas,input,waitFor,expect})=>{const old=canvas.getByRole('button',{name:'Try again'});await input.click(old);await waitFor(()=>expect(old.isConnected).toBe(false));await input.click(old)},
  'foreign target':async({input})=>{const frame=document.createElement('iframe');document.body.append(frame);const button=frame.contentDocument.createElement('button');frame.contentDocument.body.append(button);await input.click(button)},
  'concurrent input':async({canvas,input})=>{const button=canvas.getByRole('button',{name:'Try again'});await Promise.all([input.click(button),input.click(button)])},
  'unawaited input':({canvas,input})=>{void input.click(canvas.getByRole('button',{name:'Try again'}))},
 },
 Covered:{'covered click':async({canvas,input})=>{await input.click(canvas.getByRole('button',{name:'Try again'}))}},
 Disabled:{'disabled click':async({canvas,input})=>{await input.click(canvas.getByRole('button',{name:'Try again'}))}},
 Redirect:{'redirected focus':async({canvas,input})=>{await input.type(canvas.getByRole('textbox',{name:'Find game'}),'Metroid')}},
 Hang:{'hanging check':async()=>{await fetch('/witness?name=Hang');setTimeout(()=>fetch('/late'),17000);await new Promise(()=>{})}},
 Loop:{'non-yielding check':async()=>{await fetch('/witness?name=Loop');while(true){}}},
 Wait:{'await source change':async()=>{await fetch('/witness?name=Wait');await new Promise(()=>{})},'never started':()=>{}},
}
`
writeFileSync(join(root, part), source)
writeFileSync(
  join(root, "src/Invalid.part.tsx"),
  "export default ()=> <button>Ready</button>; export const checks={Missing:{wrong:()=>{}}}",
)
writeFileSync(join(root, "src/Plain.part.tsx"), "export default ()=> <button>Ready</button>")
let phase = 0,
  late = 0
const events = new EventEmitter()
const server = await createServer({
  root,
  configFile: false,
  cacheDir: join(root, ".vite"),
  logLevel: "silent",
  plugins: [
    caliper({ wrap: false }),
    {
      name: "authored-fixture-behavior",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const address = new URL(request.url || "/", "http://fixture")
          if (address.pathname === "/fixture-phase") {
            const current = ++phase
            response.setHeader("content-type", "application/json")
            response.end(JSON.stringify(current))
            events.emit(`phase:${current}`)
            return
          }
          if (address.pathname === "/witness") {
            response.end("started")
            events.emit(address.searchParams.get("name") ?? "unknown")
            return
          }
          if (address.pathname === "/late") {
            late++
            response.end("late")
            return
          }
          next()
        })
      },
    },
  ],
  server: { host: "127.0.0.1", port: 0 },
})
try {
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  assert(url)
  const executablePath = process.env.CHROMIUM
  /** @param {string} state @param {Partial<Parameters<typeof checkJobs>[0]>} [extra] */
  const run = async (state, extra = {}) => {
    const result = await checkJobs({
      url,
      project: "authored-gate",
      jobs: [onDevice({ part, state, device: "iphone-16" })],
      out,
      executablePath,
      ...extra,
    })
    assert(result.report.version === 2)
    return { ...result, report: result.report, results: result.report.results }
  }
  for (const device of ["iphone-16", "pixel-7"]) {
    const result = await run("default", { jobs: [onDevice({ part, state: "default", device })] })
    assert.deepEqual(
      result.results[0].authored.checks.map(check => check.status),
      ["Passed", "Passed", "Passed", "Passed", "Passed", "Failed", "Failed", "Failed", "Failed"],
    )
    assert.equal(result.report.run.termination, "Completed")
    assert.equal(result.report.results[0].checks.find(check => check.name === "determinism")?.status, "Passed")
    console.log(
      `${device}: retry, keyboard, portal, fresh storage and rejected stale/foreign/concurrent/unawaited input`,
    )
  }
  for (const state of ["Covered", "Disabled", "Redirect"]) {
    const result = await run(state)
    assert.equal(result.results[0].authored.status, "Failed", state)
    assert.equal(result.results[0].authored.checks[0].reason, "InputError")
    if (state === "Redirect") assert.match(result.results[0].authored.checks[0].detail, /Focus/)
  }
  await assert.rejects(run("default", { out: join(root, "screenshots") }), /must be under .caliper\/checks/)
  const store = createTakeStore(root)
  const broken = store.create({ part, state: "default", device: "iphone-16" })
  store.write(broken, part, source.replace("setLoaded(true)", "setLoaded(false)"))
  const changed = store.create({ part, state: "default", device: "iphone-16" })
  store.write(changed, part, source.replace("loaded?'Library'", "loaded?'Take library'"))
  store.write(changed, "src/heading.ts", 'export const expectedHeading = "Take library"')
  for (const [take, expected] of [
    [broken, "Failed"],
    [changed, "Passed"],
  ]) {
    const result = await run("default", { jobs: [onDevice({ part, state: "default", device: "iphone-16", take })] })
    assert.equal(result.results[0].authored.checks[0].status, expected)
    assert.equal(result.results[0].authored.provenance.kind, "Take")
    assert(result.results[0].authored.provenance.files.includes(part))
  }
  for (const [file, expected] of [
    ["src/Invalid.part.tsx", "Failed"],
    ["src/Plain.part.tsx", "NotRun"],
  ]) {
    const result = await run("default", { jobs: [onDevice({ part: file, state: "default", device: "iphone-16" })] })
    assert.equal(result.results[0].authored.status, expected)
  }
  for (const state of ["Hang", "Loop"]) {
    const started = once(events, state, { signal: AbortSignal.timeout(30000) })
    const began = Date.now()
    const running = run(state)
    await started
    const ownedBrowsers = execFileSync("ps", ["-eo", "pid,ppid,args"], { encoding: "utf8" }).split("\n").flatMap(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
      return match && Number(match[2]) === process.pid && match[3].includes("--remote-debugging-pipe") ? [Number(match[1])] : []
    })
    assert(ownedBrowsers.length > 0, "the lifecycle probe must identify its actual Chromium process")
    const result = await running
    for (const pid of ownedBrowsers) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "Chromium must exit after the run")
    assert.equal(result.results[0].authored.checks[0].reason, "Timeout", JSON.stringify(result.results[0].authored))
    assert(Date.now() - began < 26000, `${state} must reach a bounded terminal result`)
    if (state === "Hang") {
      await new Promise(resolve => setTimeout(resolve, 2500))
      assert.equal(late, 0, "closed context must not send delayed effects")
    }
    console.log(`${state}: deadline reached and context closed`)
  }
  const lostStarted = once(events, "Wait", { signal: AbortSignal.timeout(30000) })
  const lostRun = run("Wait")
  await lostStarted
  const processes = execFileSync("ps", ["-eo", "pid,ppid,args"], { encoding: "utf8" }).split("\n")
  const owner = processes.map(line => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).find(match => match && Number(match[2]) === process.pid && match[3].includes("--remote-debugging-pipe"))
  assert(owner, "must identify the browser owned by this verification process")
  process.kill(Number(owner[1]), "SIGKILL")
  const lost = await lostRun
  assert.equal(lost.report.run.termination, "Infrastructure")
  assert.deepEqual(lost.results[0].authored.checks.map(check => check.status), ["Inconclusive", "NotRun"])
  // The same source observation contract is consumed by UI, CLI and the agent.
  const started = once(events, "Wait", { signal: AbortSignal.timeout(30000) })
  const pending = run("Wait")
  await started
  writeFileSync(join(root, "src/changed.ts"), "export const changed=true")
  const invalidated = await pending
  assert.equal(invalidated.report.run.termination, "SourceChanged")
  assert.equal(invalidated.report.run.stale, true)
  assert.deepEqual(
    invalidated.results[0].authored.checks.map(check => check.status),
    ["Inconclusive", "NotRun"],
  )
  for (const [state, number] of /** @type {const} */ ([
    ["Pending", 1],
    ["RepeatPending", 2],
  ])) {
    phase = 0
    const entered = once(events, `phase:${number}`, { signal: AbortSignal.timeout(30000) })
    const controller = new AbortController()
    const output = join(out, `cancel-${state}`)
    const pending = run(state, { signal: controller.signal, out: output })
    // Attach rejection handling before sending cancellation.
    const ended = pending.then(
      () => null,
      error => error,
    )
    await entered
    const at = Date.now()
    controller.abort(new DOMException("verification stop", "AbortError"))
    const error = await ended
    assert.equal(error?.name, "AbortError")
    assert(Date.now() - at < 10000, `${state} cancellation exceeded cleanup budget`)
    const directory = readdirSync(output).find(name => name.startsWith("check-"))
    assert(directory)
    const partial = JSON.parse(readFileSync(join(output, directory, "interrupted.json"), "utf8"))
    assert.equal(partial.completedRenders.length, number === 1 ? 0 : 1)
  }
  console.log(
    `PASS: input, both viewports, take helpers, declarations, timeouts, non-yielding code, source invalidation and both render-pass cancellation. Evidence: ${out}`,
  )
} finally {
  if (server.httpServer && "closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections()
  await server.close()
  rmSync(root, { recursive: true, force: true })
}
