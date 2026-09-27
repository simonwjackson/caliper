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
usage. **Review changes** shows the exact before and after files. The comparison
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
```

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
