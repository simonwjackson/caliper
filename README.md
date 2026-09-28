# Caliper

Caliper is a dev-only Vite plugin. It shows a project's own UI parts at their
true physical size on a target device.

You add one line to the project's `vite.config`. Caliper then reads the
project's source to find the parts, the global CSS and the app's outer shell.
It does not run the app to do this.

## Use it

1. Register this checkout once per machine:

   ```sh
   cd /path/to/caliper && bun install && bun link
   ```

2. In the project, add the dev dependency and the plugin:

   ```sh
   bun add -d @simonwjackson/caliper@link:@simonwjackson/caliper
   ```

   ```ts
   // vite.config.ts
   import { caliper } from "@simonwjackson/caliper"
   import { defineConfig } from "vite"

   export default defineConfig({ plugins: [caliper()] })
   ```

3. Run `vite` in the project and open `/__caliper/` on the dev server.

4. Select **Calibrate** once for each monitor. Set the browser zoom to 100%,
   hold a credit card to the screen and move the slider until the outline
   matches the card.

`vite build` never includes Caliper. The plugin sets `apply: "serve"`.

Caliper fits the window it has, including a phone. In a wide window, the part
list, the stage, the code pane and the Takes panel sit side by side. In a
small window, **Parts** opens the part list over the stage, and **Preview**,
**Code** and **Takes** switch the one pane that fills the rest. Controls that
do not fit the bar, such as the devices and **Calibrate**, move into the **⋯**
menu. Nothing is removed at any size.

## What Caliper finds by itself

| Need | Where Caliper looks |
|---|---|
| Parts | Every `*.part.tsx` file. In a Git checkout, ignored files do not count. `node_modules` never counts. |
| App entry | The first `<script type="module" src>` in `index.html`, then `package.json` `exports["."]`, then `main`. |
| Global CSS | Stylesheets imported directly by the app entry for their side effect (`import "./app.css"`), in source order. Component styles load through the selected part's imports. |
| Wrapper | The `createRoot(...).render(<App />)` call reachable from the entry. Caliper reads the outermost DOM elements `App` returns, when their `className` is a literal. |

The **Setup** panel at the bottom of the part list shows each value and the
file and line it came from. When Caliper cannot find a value, the panel says why
and names the option that fixes it.

A part file default-exports a component that renders with no props:

```tsx
export const name = "Primary button"            // optional, shown in the list
export const note = "The main call to action"   // optional
export default function Part() {
  return <Button label="Go" />
}
```

A part file can also show other states of the same component. Each exported
component whose name starts with an upper-case letter is a state. The part list
shows the states under the selected part, and makes each label from the export
name:

```tsx
export const Busy = () => <Button label="Go" busy />       // "Busy"
export function NoResults() { return <Button label="Retry" /> } // "No results"
```

Click a part's name to show all its states side by side on the selected
device. The separate arrow expands or collapses its state list without changing
the preview. Click a child state to show it alone. Each state has its own frame,
so one that throws fails alone. All frames have the same size: true size when
one frame fits the window, or scaled down together when not. More states add rows that scroll. Click a frame's label
to show that state alone.

Navigation lists **Pages → Templates → Organisms → Molecules → Atoms**, then
**Unclassified**. A part declares its layer with a filename suffix such as
`Home.page.part.tsx`, or a literal `export const layer = "page"`. A valid
export overrides the suffix. The five accepted values are `page`, `template`,
`organism`, `molecule` and `atom`. Caliper does not execute computed layer
exports or infer layers from folders. Parts without a recognised declaration
remain unclassified. Within each layer, parts keep file-path order.

## Browse states in a composition

A **scenario** is an executable part state with product-owned fixture data and
action behavior. Caliper runs that state unchanged. It does not replace child
components with their standalone examples.

A parent part can declare the child states its scenarios contain:

```tsx
import { Home } from "./Home"
import { readyLibrary, libraryWithMissingArt } from "./fixtures"

export default function Ready() {
  return <Home initialLibrary={readyLibrary} />
}
export function MissingArtwork() {
  return <Home initialLibrary={libraryWithMissingArt} />
}

export const composition = {
  default: [{ part: "src/Cart.molecule.part.tsx", state: "default" }],
  MissingArtwork: [{ part: "src/Cart.molecule.part.tsx", state: "MissingArt" }],
}
```

The keys are this part's export names. `default` means the default export,
regardless of its function name. Child paths are relative to the Vite root.
Each child state must exist. Literal objects, arrays, strings, `as const` and
`satisfies` are supported. Calls, spreads and imported metadata are not evaluated.
Missing references, duplicates and cycles appear in Setup. Invalid declarations
supply no relationships.

In the part list, **States in this scenario** selects a child as the editing
subject while the frame keeps showing the whole scenario. **Preview** selects
the isolated subject or a declared parent scenario. Relationships can pass
through several levels, such as page → shelf → cart. Choosing another child
state does not alter the page's props: select a complete declared scenario
that contains that state. An unavailable context returns to isolation with a
visible explanation.

The declaration describes fixture intent, not runtime evidence. Repeated
instances can use the same child state; declare that reference once. Distinct
instance inputs and interactions belong in the parent fixture. Caliper cannot
infer which instance should change or verify that the declaration matches the
rendered tree. Product tests must check that relationship.

Use local, deterministic inputs and real action handlers that update fixture
state. A no-op callback does not become interactive because it appears inside
a page. Caliper does not prove that a scenario avoids network access, time,
randomness or shared storage. A render check proves rendering, not interaction
correctness or exhaustive state coverage.

## Options

Set an option when discovery fails or the project's global styles do not follow
the direct-entry convention.

```ts
caliper({
  entry: "src/main.tsx",             // the module the app starts from
  wrap: ["app-theme", "app-screen"], // outer element class names, outermost first
  css: ["src/tokens.css", "src/global.css"], // optional replacement global CSS list
})
```

`wrap: false` renders parts with no wrapper.

`css` replaces the derived global stylesheet list, in the order given. Paths
are relative to the Vite root. `css: []` injects no global styles, but components
still load their own CSS. Setup shows whether CSS came from entry imports or
this option. An invalid override appears in Setup and as a frame warning.

### CSS ownership

Caliper injects global styles before importing the selected part. Vite then
loads the CSS imported by that part and its components. Shared stylesheet
imports use the same module, so two buttons do not load shared motion twice.
Caliper still reads the app's imports to find its wrapper, but that traversal
no longer supplies CSS to every frame.

If a project imports global CSS in a nested bootstrap module or its App
component, move that import to the entry or name it in `css`. Caliper cannot
infer whether a nested stylesheet is global from its selectors or filename.
It does not restore the old behavior of injecting every reachable stylesheet.
A global file that imports every component stylesheet still affects every
preview; the project must move those imports to their components.

A component that forgets its CSS import is no longer styled by an unrelated
app import. Caliper cannot detect an absent import by appearance alone. A
broken import, however, fails the part visibly. Wrapper classes also need
styles in the global list, since Caliper recreates their DOM without rendering
the app component.

Import component CSS from JS or TS, including shared styles. A take rejects
CSS `@import` chains in component styles rather than silently removing
them. Existing plain global CSS import chains still use the take overlay's
flattening step. Sass, Less and generated CSS pipelines remain unverified.

## Make takes with an agent

A **take** is one version of a part that an AI agent proposes. The agent
writes edited copies of project files into `.caliper/takes/<n>/`, at the same
relative paths. The real files do not change until you accept the take.
Caliper shows the original next to each take, in one Vite server.

Turn the agent on in `vite.config`:

```ts
caliper({
  agent: {
    model: "claude-opus-5-5",
    baseUrl: "https://my-proxy.example/v1", // any endpoint that speaks the OpenAI API
    reasoning: "medium",                    // off, minimal, low, medium, high, xhigh, max
    api: "chat-completions",                // or "responses"
  },
})
```

The API key never goes in `vite.config`. Set `CALIPER_AGENT_API_KEY` in the
shell that starts Vite, or in the project's `.env.local`. `apiKeyEnv` names a
different variable. Without a `baseUrl`, Caliper uses the base URL and key in
`~/.pi/agent/cliproxyapi.json`, if that file exists; it sends that key to no
other endpoint. Caliper needs no `pi` binary.

The agent needs `CHROMIUM` to see its work. The Takes panel shows the model,
the reasoning level and where the base URL and key came from, or what is
missing.

In the Takes panel, describe a change and start one or more takes. Each take
has its own agent, and they run at the same time. An agent can read project
files, edit and write files in its own take, and render its take. It cannot
run commands or write anywhere else. The stage shows the original and the
takes of the selected state, and each frame reloads when its take changes. Send a
take another prompt, stop it, replace the real files with it, or discard it.
Each take gets a descriptive name from its agent. Planned takes start with their
direction title. Numeric IDs stay stable. Names survive a server restart. An old
or unnamed take keeps its numeric label and shows a naming hint.

When you ask for two or more takes, a planner first turns the prompt into one
different direction per take, for example "realistic data", "edge cases" and
"change the cart component". You can edit or remove directions before the
takes start. Each take's agent follows one direction and knows the titles of
the others. The planner returns fewer directions when the prompt has only one
sensible answer, and says why. It costs one model call of about 10 s.

A take belongs to the selected **editing state**. Its optional **context** is
the complete scenario used to preview it. The state list nests takes under their
editing state. Selecting a take restores its recorded context; changing Preview
compares experiments in another declared scenario. Alternate proposals show
their explicit new preview state, not the unchanged source context. Source edits
still affect all consumers when accepted. State ownership is not a state-local write fence.

The planner and agent receive both identities and both part sources. The first
screenshot and the default `render` use the context. The agent can pass `part`
to render its isolated subject or a related scenario, or `related: true` to
check every subject state and its declared parent scenarios. These checks do
not find undeclared consumers. Removed states or context declarations block
new prompts and acceptance until the declaration is restored or the take is
discarded. Takes whose subjects were removed remain under **Unavailable states**
for review and discard. Acceptance also validates the proposed part declarations
before copying files and rejects new declaration errors, not unrelated existing
ones. Existing takes without a context remain isolated.

`.caliper/` holds a `.gitignore` that ignores the whole folder. A take's
conversation lives only in the dev server: after a restart, the take's files
remain, and its next prompt starts a new conversation.

### Add an alternate without replacing existing callers

Choose **Add an alternate** on an experiment. Caliper copies it into a separate
proposal take and asks the agent to integrate an explicit new choice. The source
experiment stays available. The agent can use a named component variant or a
separate component that shares unchanged behavior. It must preserve existing
callers and add a product-owned preview state for the alternate.

The proposal explains the choice, shared behavior, preserved defaults, and caller
usage. **Review changes** shows each changed file as a diff against the real
file, in the code pane's editor, with the lines it adds and removes. Removed
lines show above the lines that replace them, and long unchanged runs fold away.
**Open in Code** opens that file of the proposal in the code pane. The comparison
frame shows the new alternate state, even before that state exists in production.

**Check original and alternate** renders every existing state on both devices
twice to establish a stable baseline. It compares the proposal's existing states
against that baseline, then checks the alternate for render errors and spill.
An unstable baseline or changed existing state blocks apply. Intentional empty
original states are valid; the alternate must render visible content.

Before **Apply reviewed alternate**, review the files and verify product types,
interactions, and existing callers. The checkbox records your confirmation; it
does not run product tests. Caliper cannot prove behavioral compatibility from
screenshots. Its agent cannot run a shell or test commands.

Checks and apply are bound to the reviewed file revision. Later proposal edits
require resubmission and fresh checks. Later project or source-experiment edits
require preparing a new proposal. A successful apply removes only the proposal
take. The alternate then works without Caliper. A failed file copy rolls back
writes, but this is not crash-safe filesystem transaction storage.

Costs: preparing an alternate adds an agent pass and review. Full render checks
can take minutes, and looping animation can make them inconclusive. Baselines
cover discovered project files, so even an unrelated source edit requires a new
proposal. Keep an experiment as a take when the product does not need another
supported choice.

## Edit code in Caliper

The **Code** button opens the code pane next to the stage. It sits beside the
stage when the main column is wide, and under it otherwise. Drag the divider to
resize it; double-click the divider to reset it. The pane needs no agent.

The pane shows the files of the part you edit. Tabs hold the part file, the
files it imports directly, and the files a take changes. **Files** lists every
local module and stylesheet the part reaches, nearest first. A take lists the
files it changes first, with the lines each one adds and removes. It also lists
files it changes that this part does not import, because they change other
parts.

Edit a real file as in any editor. The pane saves it to the project after a
short pause in typing, or at once with Ctrl+S, and Vite reloads the frames.
There is no review step: undo in the pane, or Git, takes a change back. The
pane saves only files that exist in the project, and never `node_modules`,
`.git`, `.caliper` or environment files. If another editor changes the file
while you type, the pane keeps your text and saves it over the file.

Select a take to edit its files instead. Those edits save to the take, and the
real files do not change until you choose Replace.

In a take, the pane shows the take's file against the real file. Removed
lines show above the lines that replace them, and long runs of unchanged lines
fold away. Alt+Up and Alt+Down move between changes. **Revert** on a change
puts the real lines back into the take.

While a take's agent works, the pane is read-only. It moves to each file the
agent starts to change, until you pick a file yourself. Text that arrives from
disk is marked for a moment. When you send the agent another prompt, Caliper
tells it which files you edited by hand, so it reads them again. Your edits also
show in the take's conversation.

In a part file, a line above each exported state names it. Click it to show
that state on the stage. The state on the stage says **On the stage**.

The pane uses CodeMirror 6. Caliper serves its packages from Caliper's own
`node_modules` through an import map, so the project's Vite never loads them.
The first open loads 355 KB with gzip; the browser then caches it. The
pane has no type checking or completion from the project's types yet.

## How a part renders

Each part renders in an `iframe` for one device. The `iframe` has the device's
CSS viewport size, for example 640 × 480 px for the RG353M. It is then scaled to
the device's physical width on the calibrated monitor. Media queries, `vw` and
`window.innerWidth` inside the frame therefore see the device, not the monitor.

Inside the frame, Caliper loads the global CSS, then the project's own React,
then the part and its stylesheet dependencies. It renders the part inside the
wrapper elements. A CSS save updates the frames that import it. Component code
changes reload the affected part frames. Caliper's own page loads no project code and no
React.

Every failure is visible. A part that fails to load, has no default export,
throws while rendering or renders nothing shows the reason in the frame and,
at a readable size, under the stage. When the window is too small for true
size, the frame is drawn smaller and the caption says by how much.

## Let an agent see a part

`caliper-render` renders a part of the running project in a headless Chromium,
at a device's CSS viewport, and prints what it found as JSON:

```sh
CHROMIUM=/path/to/chromium caliper-render --url http://localhost:5173 \
  --part src/ui/atoms/Button.atom.part.tsx --state '*' --device '*'
```

Each result gives the frame's verdict (`Rendered`, `Empty` or `Failed`), the
problems the frame shows, browser errors it did not catch, the elements that
reach past the device's screen, and the path of a PNG at one image pixel per
CSS pixel. `--take <n>` renders the part as take `n` changes it. `--list`
prints every part and its states. `--help` explains every field. The exit
status is 0 when every frame rendered.

`skills/caliper-render/SKILL.md` teaches an agent the loop: render, read the
verdict, look at the PNGs, change the code, render again. Copy or link it into
the agent's skills folder.

## Report automatic checks

Open **Checks** in Caliper's bar, or in **More controls** when the bar is narrow.
**Check selected preview** checks the scenario on the stage. **Check all states**
checks every declared state. Both commands use both built-in device sizes. When
a take is selected, the commands check its overlay and name the take explicitly.
They require no model connection.

The window shows progress, then a status row for each state and device. Expand
a row to read findings and compare its first render, repeat render, and accepted
image. Open any image at full size. State rows in the part list show results
from the latest run; no badge means that state was not in that report.

To accept a visual baseline, expand a real-file result, inspect both images,
select **I reviewed both renders**, then choose **Approve this image**. Approval
uses the saved images, not a new render. It does not hide other findings. Take
images cannot become baselines. Source changes mark a UI report **Out of date**
and block its baseline approval until checks run again. This does not block
**Replace**. The existing alternate acceptance rules also stay unchanged.

You can close the Checks window while it runs. Its latest report survives page
reloads during the same Vite session. Restarting Vite clears the displayed report;
accepted baselines remain in `<project>/.caliper/baselines`. UI evidence stays in
`<project>/.caliper/checks` until you remove it. **Download report** saves its JSON.
The UI does not freeze files while checks run or discover every affected consumer.

The same reporting engine is available through the CLI and the agent's render
tool. The [authored-check contract](#author-browser-input-checks) below is approved.
It runs through the same product frames; see the
[implementation and verification plan](docs/plans/authored-checks-v1.md).

```sh
CHROMIUM=/path/to/chromium caliper-render --url http://localhost:5173 \
  --part '*' --state '*' --device '*' --check \
  --baselines /path/to/project/.caliper/baselines --out /tmp/caliper-checks
```

Each run writes a unique folder with `report.json` and two sets of PNGs.
Use an output directory outside the product or under `<project>/.caliper/checks`.
Other project-local output directories are rejected before writing: their generated
files would invalidate the source revision being checked. The JSON
on stdout includes the report path, raw first-render results, and checks. Each
check reports one of these statuses:

| Status | Meaning |
|---|---|
| `Passed` | This check found no problem in these samples. |
| `Accepted` | Every observed finding for this check matches a scoped product exception. Reasons and evidence remain visible. This is not a clean pass. |
| `Failed` | A render problem, browser error, unmet empty expectation, invalid declaration, or unaccepted axe violation was observed. |
| `Review` | Human judgement is needed, such as empty content, spill, an incomplete axe check, or a changed or missing image baseline. |
| `Inconclusive` | The check cannot establish a result, such as differing repeat images, an unavailable audit, or an incompatible or damaged baseline. |
| `NotRun` | No baseline directory was supplied. |

With `--check`, exit 0 means the report was written, **not that it passed**.
SIGINT and SIGTERM cancel work, wait for browser cleanup, and exit 130 and 143.
Setup and browser failures without a report exit 2. Without `--check`, the existing render exit
policy stays unchanged. `--part '*'` selects every discovered part; `--state '*'`
selects every declared state of those parts. A selected state is not evidence
about unselected states or undeclared consumers.

The checks compare two fresh renders and scan the product host with axe's WCAG
A/AA rules through WCAG 2.2. Document title and language belong to Caliper's
frame and are excluded. Keyboard behavior, full-page semantics, and interactions
still need product tests and manual review. Scrollable content can cause spill.
Caliper reports it for review instead of guessing that scrolling is a defect.
Empty states also need review instead of an unconditional failure, unless the product declares that emptiness is expected.

### Declare product intent

A part can export literal `expectations`, keyed by its state exports. Caliper reads
this data without executing it. Only the named state receives these expectations;
composition links do not inherit exceptions. Takes use their own part source.

```tsx
export const expectations = {
  Empty: { empty: { reason: "The optional panel is absent when there are no results." } },
  Ready: {
    spill: [{
      target: "#caliper-host > section:nth-of-type(1) > div:nth-of-type(1)",
      edge: "bottom",
      maxPixels: 240,
      reason: "This content belongs to the vertical scroll area.",
    }],
    accessibility: [{
      rule: "color-contrast",
      target: [".caption"],
      reason: "Recorded palette exception. This caption still fails WCAG contrast.",
    }],
  },
} as const
```

Use real exported state names, including `default`. Copy targets from an actual
check report rather than guessing them. An accessibility target must exactly match
axe's target array. A spill target must exactly match the measured element path;
it is not a selector filter. Spill also requires one edge and a positive maximum
distance in CSS pixels. Each spilling element and edge needs coverage. Check runs
measure all spilling elements, rather than the five examples in an ordinary render.

An expected empty passes only when both samples are empty. Visible content fails
that expectation. Matched spill and accessibility exceptions become `Accepted`,
not `Passed`. The report retains raw observations, accepted reasons and counts,
including when another finding keeps the check failed. Browser errors, failed
renders, unavailable audits, and incomplete axe checks cannot be accepted.
Unused exceptions need review and removal, so a fixed finding does not leave a
silent waiver. Invalid declarations accept nothing and show a named error.

Declarations must be direct literal const exports. Calls, imports, export aliases,
spreads, computed keys, duplicate scopes, blank reasons, and unknown fields are
rejected. A change between the two samples is inconclusive and applies no exceptions.
The Checks window, CLI, and take agent share these rules. Replace and the reviewed
alternate gate remain unchanged. Baseline approval does not create exceptions.

Costs: exact targets need maintenance after markup changes. An exception can still
hide a real defect inside its scope; a reason is an explanation, not proof that the
design is accessible or that clipped content can be reached. Fix missing parent
context through product composition instead of broadly accepting its findings.

Frame verdicts now follow a React commit. Unresolved root suspension reaches the
watchdog instead of becoming Empty. Later DOM changes update the verdict and remove
stale empty warnings. A committed null Suspense fallback is still observed as empty;
Caliper does not infer when all product data has settled. Checks version 2 changes
the recorded environment, so older visual baselines need fresh review.

### Author browser-input checks

Add an optional lowercase literal `checks` export to the existing part file.
Outer keys are real state export names; `default` means the default export.
Inner keys are stable, nonblank check names. Product scenarios still own their
local data and real action behavior. Caliper does not make a no-op handler work.

```tsx
import type { StateChecks } from "@simonwjackson/caliper/checks"

// This part already exports an Error state with a working retry action.
export const checks = {
  Error: {
    "retry loads the library": async ({ canvas, input, expect, waitFor }) => {
      await input.click(canvas.getByRole("button", { name: "Try again" }))
      await waitFor(() => {
        expect(canvas.getByRole("heading", { name: "Library" })).toBeVisible()
      })
    },
  },
} satisfies StateChecks
```

No test config, manifest, or second dev server is required. The type import is
sufficient for a simple check; Caliper supplies runtime helpers lazily when a
check runs, not during an ordinary preview. Product callbacks execute in the
product browser document, never through a Node or SSR import.

| Helper | Use and limit |
|---|---|
| `canvas` | Testing Library queries scoped to `#caliper-host`, excluding Caliper diagnostics. Prefer role and accessible-name queries. |
| `within(root)` | Standard Testing Library queries scoped to a product root, including a portal outside the host. |
| `input.click(element)` | An awaited Playwright-backed click. Covered and disabled targets fail actionability checks. |
| `input.type(element, text)` | Focus and type into that element. An unintended focus change fails rather than typing elsewhere. |
| `input.press(element, key)` | Send one Playwright key expression to that element, for example `"Enter"`. |
| `expect(value)` | Synchronous typed Vitest assertions with jest-dom matchers. This is not the Vitest runner: no snapshots or `expect.poll`. |
| `waitFor(callback)` | Retry assertions within the overall check deadline. Re-query inside the callback. |

Input accepts DOM elements, not locators. A saved element can become detached
after a re-render. **Re-query immediately before each action.** Await each input
operation; concurrent input is rejected. Caliper does not replay partial or failed
actions. Product portals in the same frame body are valid targets. Another
document, a child iframe, detached nodes, and Caliper-owned diagnostic controls
are not. These guards are not a security sandbox. Unexpected navigation makes
the check inconclusive; v1 has no navigation-testing or product-command API.

Discovery reads source structure and file/line locations without executing code.
Use direct arrow functions, function expressions, or methods as check values.
`as const` and `satisfies` wrappers are supported. Computed keys, spreads, getters,
duplicate names, unknown states, imported maps, and nonfunction values produce
failed declaration results. Put reusable browser-safe behavior inside an inline
callback; its imports, including lazy imports, follow the selected take.
Value wildcard re-exports such as `export * from "./helpers"` are rejected because
static discovery cannot tell whether they hide an imported `checks` export. Use
explicit named exports instead. Type-only wildcard exports remain allowed.

Run checks from **Checks**, `caliper-render --check`, or the agent's
`render({ checks: true })`. `--list --take <id>` lists that take's states,
`authoredChecks`, and `authoredCheckProblems`. The Checks window
includes named results, reasons, progress, and **Stop**. Closing the window does
not cancel a run. Agent **Stop** and Vite shutdown also await render cleanup.

Each named check runs serially in a fresh Chromium context at the chosen device
viewport, with a scale factor of 1. It waits for the frame verdict before calling
the callback. Failed frames block checks; empty content can be a valid starting
point. Authored execution does not fast-forward animations. Input operations and
the full check have finite deadlines, including frame and helper loading.
Startup and each check allow 15 seconds; input allows up to 2 seconds. Evidence
capture is bounded separately. Cleanup gets 5 seconds before terminating the owned
Chromium process. Caliper obtains that process identity through Chromium's public
SystemInfo protocol, not private Playwright fields. Interrupted input skips image
capture so cleanup can start immediately. Browser execution uses Node. If Vite
runs under Bun, a trusted Node worker receives validated jobs and returns progress
and results; `node` must be on PATH. This avoids intermittent Playwright transport
stalls observed under Bun. The worker never imports product or take code.

| Authored status | Meaning |
|---|---|
| `Passed` | The callback returned without an observed error and the source identity is current. This does not prove it contained a useful assertion. |
| `Failed` | An assertion, input, callback, declaration, import, browser error, or timeout occurred. |
| `Inconclusive` | Cancellation, changed sources, unexpected navigation, or lost infrastructure prevented completion. |
| `NotRun` | No check was declared, or queued work never started. This is not an interaction pass. |

Product `expectations` cannot waive authored failures. `Accepted` describes only
automatic findings. **Neither authored checks nor their absence add a Replace
gate.** The reviewed alternate policy also stays unchanged.

Version 2 reports keep initial-state render evidence and authored results separate.
Each authored result names the check and source location, status, reason, elapsed
time, errors, and any interaction image. A failed evidence capture is explicit.
Interaction images cannot replace or approve initial-state baselines. The agent
keeps its four-image limit: initial-state images come first, then interaction
images if room remains. Results retain image paths and `checkReport` for omitted
evidence. `checkRun` exposes run termination and stale state in agent results.

Reports record source revision, selected take, edited files, and declaration
changes. Other edited modules can change helper behavior even when callback text
is unchanged. Passing take-defined checks does not prove the original contract
was preserved. Source changes stop remaining checks and retain completed
observations as stale history, not a current pass. This is invalidation, not a
frozen filesystem snapshot. Cancellation before a complete visual result does
not fabricate images or imply success. Old v1 reports remain visual evidence,
not authored-check coverage.

Costs: each check adds a render and browser work. Authors must maintain scenario
inputs, action behavior, and assertions. Coverage includes only the declared
states, devices, and checks; it does not prove hermeticity, network isolation,
every consumer, controller/native-device input, or all theoretical states.
Automated authored coverage starts with Chromium. Package delivery, lifecycle,
all public paths, and deployment still need the release gates named above.

### Approve reviewed images

Open both PNGs for every state in the saved report. If they show the intended
product states, record those exact images as baselines:

```sh
caliper-render --approve /tmp/caliper-checks/check-XXXXXX/report.json \
  --baselines /path/to/project/.caliper/baselines
```

Approval reads saved evidence; it does not rerender. It rejects unstable or
broken samples, changed image files, and take images. To establish a baseline
for an accepted take, run checks on the real files after acceptance and review
that new report. Approval records visual intent only. It does not hide other
findings, including accessibility problems and spill, or authorize acceptance.

Use a separate baseline directory for each project. Baselines identify the
project name, part, state and device, and record the browser/platform/check
version. An environment change is inconclusive until new images are reviewed.
Records update atomically one at a time, not as a crash-safe multi-state
transaction. Keep the directory in version control elsewhere if the team needs
shared baselines; `.caliper/` is ignored. No automatic pruning removes old images.

The take agent can request `render` with `checks: true`, optionally with
`related: true` and `device: "*"`. It receives findings and screenshots, and
compares against `<project>/.caliper/baselines`. It cannot approve baselines.
Normal renders remain single-pass for quick iteration.

Costs: checks render twice and run axe, so they take longer than normal renders.
Image comparisons are exact PNG-byte comparisons, not perceptual diffs. Fonts,
animation and changing data can prevent a match. Both snapshots stay available
for manual comparison; this phase does not produce a highlighted difference
image. The run does not freeze source files or prove hermeticity. Do not edit
the project during checks. A match proves only the observations listed in the
report, not that all behavior is safe.

## Limits

- Caliper shows size and viewport truthfully. It cannot show pixel density,
  panel colour or touch input.
- The wrapper must be DOM elements with literal class names. A provider
  component or a computed `className` needs the `wrap` option, and a provider
  that parts need cannot be recreated yet.
- The device list is built in: RG353M and ODIN 2 PORTAL. Their CSS viewports
  are inferred from each panel's resolution and Sway's default scale of 1. They
  are not yet measured on the devices.
- Only Vite projects can use Caliper.
- A take cannot show a change that goes through a conditional CSS `@import`
  (`layer`, `media`, `supports`), Sass, Less or Tailwind's source scan. Not
  yet tested.
- The agent works in the dev server process. Its render browser starts for
  each render, which costs about a second.

## Develop

```sh
bun install
bun test
bun run typecheck
CHROMIUM=/path/to/chromium CALIPER_TEST_MODULES=/path/to/react-project/node_modules bun test test/navigation.test.js
CHROMIUM=/path/to/chromium bun run verify:browser -- --url http://127.0.0.1:5173 --root /path/to/project
CHROMIUM=/path/to/chromium node scripts/verify-css-loading.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-integration.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-scenarios.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-checks.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium ./scripts/verify-authored-agent-cli.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-checks-ui.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-expectations.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-frame-commit.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-authored-checks.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-authored-agent-cli.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-authored-ui.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-authored-package.mjs
CHROMIUM=/path/to/chromium node scripts/verify-code.mjs --url http://127.0.0.1:5173 --root /path/to/project --part src/ui/atoms/Button.atom.part.tsx
CHROMIUM=/path/to/chromium node scripts/verify-fast-saves.mjs
```

`scripts/verify-fast-saves.mjs` checks that a page shows the last of two saves
made 20 ms apart, before and after a reload. Vite's own watcher drops the second
save; `PLAIN=1` runs the same check without Caliper and shows that bug.
`ATOMIC=1` saves by renaming a temporary file, as many editors do.

`scripts/verify-css-loading.mjs` creates a temporary React project and starts
real Vite servers. It checks exact stylesheet sets, shared motion, CSS modules,
missing imports, hot reload, take isolation, explicit globals and Setup
provenance. The supplied `node_modules` must contain React and React DOM. The
check neither changes the supplied project nor uses its Vite cache.

`scripts/verify-scenarios.mjs` runs a local interactive consumer in real Vite and
Chromium. It checks parent-owned state changes, transitive scenario browsing,
state-owned takes, composed CSS overrides, frame isolation, URL restoration,
five container sizes, related renders, stale declarations, removed-state take
recovery and retained preview errors. It makes no model
calls and changes no supplied project files.

`scripts/verify-checks-ui.mjs` exercises the Checks window through real Chromium:
run progress, findings, saved-image approval, stale results, page reload, take
selection, unchanged Replace, five size-ladder shapes, and a constrained Caliper
container inside a larger browser window. It writes screenshots for review.

`scripts/verify-checks.mjs` uses a temporary React consumer to check the public
CLI, both device sizes, render errors, browser errors, empty states, spill,
accessibility failures, unstable images, saved-baseline approval, take comparison,
and the agent tool's findings. It also proves that reports do not block Replace.
It makes no model calls or changes to the supplied project.

`scripts/verify-code.mjs` checks the code pane against a running dev server.
It types in a real file and checks that the file on disk changes, no take
starts and the frame renders. Then it undoes the edit and checks that the file
is back. It starts a take in the project at `--root`, and checks the take's
frame, the diff and its line count, Revert, the state lenses, and the layout at
four window sizes. It makes no model calls. It writes the real file back and
discards every take it starts, even when a step fails. Pick a part with two or
more states to check the lenses.

`scripts/verify-takes.mjs` checks the Takes panel against a real model: it
starts takes from the chrome, waits for the agents, checks every take frame,
takes screenshots at three window sizes and discards the takes.

`scripts/verify-integration.mjs` checks alternate preview, unchanged original
renders, real click behavior, revision-bound review/apply, and review controls at
five container sizes. It uses a temporary React consumer. Add `--live` to also
exercise naming and alternate preparation through the configured local proxy.

`nix develop` provides Bun, Node and `CHROMIUM`. The browser check renders
every part of a running project and checks true size, scaling, calibration, a
visible error and reload on save. It writes screenshots to
`/tmp/caliper-verify`.

The design decisions behind this shape are in
[`docs/decisions.md`](docs/decisions.md). The previous, larger Caliper is on
the `legacy` branch.
