#!/usr/bin/env node
// @ts-check
import { parseArgs } from "node:util"
import { DEVICES } from "../src/client/device-frame.js"
import { planRenders } from "../src/render/plan.js"
import { renderJobs } from "../src/render/render.js"
import { approveBaselines, checkJobs } from "../src/render/checks.js"

const HELP = `caliper-render: render a part of a running project and report what it shows.

Usage:
  caliper-render --url <dev server> --part <file> [--state <export>] [--device <id>] [--take <n>] [--out <dir>]
  caliper-render --url <dev server> --list
  caliper-render --url <dev server> --part '*' --state '*' --device '*' --check [--baselines <dir>]
  caliper-render --approve <saved report.json> --baselines <dir>

The project's Vite dev server must run with the caliper() plugin. The command
reads the server; it starts nothing. Only --approve writes accepted baselines,
and only in the explicitly supplied directory.

Options:
  --url      Origin of the project's Vite dev server, for example http://localhost:5173
  --part     A part file, relative to the Vite root, as --list prints it; '*' selects all parts
  --state    An exported state of the part. Default: "default". "*": every state
  --device   A device id. Repeat it, or pass "*" for every device. Default: ${DEVICES[0]?.id}
             Devices: ${DEVICES.map(device => `${device.id} (${device.name}, ${device.cssWidth}x${device.cssHeight} CSS px)`).join(", ")}
  --take     Render the part as take <n> changes it: the files in .caliper/takes/<n>/
             replace the real files. Default: the real files
  --out      Folder for the PNG files. Default: /tmp/caliper-render
  --chromium Chromium executable. Default: the CHROMIUM environment variable
  --list     Print every part with states, composition, expectations and problems, and devices, as JSON
  --check    Report render, browser, spill, axe, repeat-render and baseline checks.
             Uses two fresh renders; writes report.json and both sets of images under --out.
  --baselines Directory of accepted images for this project. Without it, baseline checks are NotRun.
  --approve  Approve images from this saved check report after inspecting them. Requires --baselines.
             Does not rerender. Rejects changed images, unstable/broken renders and takes.

Output: one JSON object on stdout.
  { "results": [ { part, state, device, take?, viewport, frame, png, problems, console, spill } ] }
  frame     "Rendered", "Empty" (the component rendered nothing) or "Failed"
  png       Screenshot of the device's CSS viewport, 1 image px per CSS px
  problems  What the frame shows: load errors, render errors with stacks, warnings
  console   Browser errors the frame did not catch
  spill     null when the part fits the viewport. Else the box that holds the part,
            in CSS px, and up to 5 elements that reach past the edge. With --check,
            every spilling element is measured. The device clips or scrolls that content.

An animation that ends, such as an entry animation, is jumped to its end before
the spill is measured and the PNG is taken. A looping animation keeps running.

Exit status: 0 when every frame is Rendered, 1 when a frame is Empty or Failed,
2 when the request is invalid or the dev server or browser is not reachable.
With --check, exit 0 means the report was written, NOT that checks passed.
Check statuses: Passed, Accepted, Failed, Review, Inconclusive, NotRun.
Product-owned expectations can pass intended empty states and accept narrowly scoped
spill or axe findings, with evidence, reasons and counts retained. Accepted is not a
clean pass. Undeclared emptiness, spill and changed/missing baselines need Review.
Invalid expectations fail; unused exceptions need Review. None blocks Replace.
Approval records visual intent only. It does not hide accessibility or other findings.
Checks cover listed states only, not interactions or every possible consumer.`

/** @param {unknown} value */
function print(value) {
  return new Promise(resolve => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`, () => resolve(undefined)))
}

/**
 * @param {string} reason
 * @returns {never}
 */
function stop(reason) {
  print({ error: reason })
  process.exit(2)
}

const { values: args } = (() => {
  try {
    return parseArgs({
      options: {
        url: { type: "string" },
        part: { type: "string" },
        state: { type: "string" },
        device: { type: "string", multiple: true },
        take: { type: "string" },
        out: { type: "string", default: "/tmp/caliper-render" },
        chromium: { type: "string" },
        list: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
        check: { type: "boolean", default: false },
        baselines: { type: "string" },
        approve: { type: "string" },
      },
    })
  } catch (error) {
    return stop(`${error instanceof Error ? error.message : String(error)}. Run with --help.`)
  }
})()

if (args.help) {
  process.stdout.write(`${HELP}\n`)
  process.exit(0)
}
if (args.approve) {
  if (!args.baselines || args.url || args.part || args.state || args.device || args.take || args.check || args.list) stop("Use --approve <report.json> with --baselines <dir>, without a render request.")
  try { await print(approveBaselines(args.approve, args.baselines)) }
  catch (error) { stop(error instanceof Error ? error.message : String(error)) }
  process.exit(0)
}
if (args.baselines && !args.check) stop("--baselines needs --check or --approve.")
if (args.list && args.check) stop("Use --list or --check, not both.")
if (!args.url) stop("Pass --url, the origin of the project's Vite dev server. Run with --help.")
const url = /** @type {string} */ (args.url)

/** @type {import("../src/types").Project} */
const project = await fetch(new URL("/__caliper/project.json", url))
  .then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
  .catch(error => stop(`No Caliper at ${url} (${error.message ?? error}). Start the project's Vite dev server with the caliper() plugin.`))

if (args.list) {
  await print({
    project: project.name,
    parts: project.parts.map(part => ({
      file: part.file, name: part.name, states: part.states.map(state => state.export),
      ...(part.composition === undefined ? {} : { composition: part.composition }),
      ...(part.compositionProblems === undefined ? {} : { compositionProblems: part.compositionProblems }),
      ...(part.expectations === undefined ? {} : { expectations: part.expectations }),
      ...(part.expectationProblems === undefined ? {} : { expectationProblems: part.expectationProblems }),
    })),
    devices: DEVICES.map(device => ({ id: device.id, name: device.name, cssWidth: device.cssWidth, cssHeight: device.cssHeight, widthMm: device.widthMm })),
  })
  process.exit(0)
}
if (!args.part) stop("Pass --part, or --list to see the parts. Run with --help.")

const plan = planRenders(project, {
  part: /** @type {string} */ (args.part),
  state: args.state,
  devices: args.device?.flatMap(value => value.split(",")),
  ...(args.take === undefined ? {} : { take: args.take }),
})
if (plan._tag === "Invalid") stop(plan.reason)

const executablePath = args.chromium ?? process.env.CHROMIUM
if (!executablePath) stop("Set CHROMIUM, or pass --chromium, to a Chromium executable. `nix develop` in the Caliper checkout sets it.")

if (args.check) {
  try {
    const checked = await checkJobs({ url, project: project.name, jobs: plan.jobs, out: args.out, executablePath, ...(args.baselines === undefined ? {} : { baselines: args.baselines }) })
    await print(checked)
  } catch (error) { stop(`Checks could not finish: ${error instanceof Error ? error.message : String(error)}`) }
  process.exit(0)
}

const results = await renderJobs({
  url,
  jobs: plan._tag === "Planned" ? plan.jobs : [],
  out: /** @type {string} */ (args.out),
  executablePath: /** @type {string} */ (executablePath),
}).catch(error => stop(`The browser failed: ${error instanceof Error ? error.message : String(error)}`))

await print({ results })
process.exit(results.every(result => result.frame === "Rendered") ? 0 : 1)
