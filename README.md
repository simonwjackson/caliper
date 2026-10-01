# Caliper

Caliper shows a project's own UI parts at their true physical size on a
target device. It has two pieces (decision 37):

- **The plugin**, `caliper()`, a dev-only Vite plugin. You add one line to the
  project's `vite.config`. It reads the project's source to find the parts, the
  global CSS and the app's outer shell, and it serves the frames. It does not
  run the app to do this. It has no agent and no AI settings.
- **The Caliper app**, `bin/caliper.mjs`. One process on one port serves the
  chrome for every project whose dev server runs the plugin, with a project
  switcher. It owns the agent and its settings. It never starts a project.

## Use it

1. Register this checkout once per machine:

   ```sh
   cd /path/to/caliper && bun install && bun run build && bun link
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

3. Start the Caliper app once, and keep it running:

   ```sh
   cd /path/to/caliper && nix develop -c node bin/caliper.mjs   # --port 3132 --host 127.0.0.1
   ```

4. Run `vite` in the project. The plugin announces the dev server in
   `$XDG_RUNTIME_DIR/caliper/servers/` (or `~/.local/state/caliper/servers/`
   without that variable), and the app lists it at
   `http://127.0.0.1:3132/__caliper/`. Open it there. Each tab shows one
   project; open two tabs for two projects. The **Project** menu at the top of
   the parts panel opens another running project in the same tab.

5. Select **Calibrate** once for each monitor. Set the browser zoom to 100%,
   hold a credit card to the screen and change px per mm until the outline
   matches the card. The reference uses a number field, not a slider.

`vite build` never includes Caliper. The plugin sets `apply: "serve"`.

The chrome is the Darkroom design (decision 34), built in React
(`src/client/ui/Darkroom.tsx`). Tools sit on a rail at the left on a desk and
in a dock at the bottom on a phone. Takes are on the canvas, with the composer
bar under it; Knobs and the selected take's record share a side panel. Every
region has a `*.part.tsx` beside it, so Caliper can show and edit its own
chrome. The unstyled reference (`src/client/ui/Chrome.tsx`) stays as the
contract's executable spec. See
[`docs/plans/react-chrome.md`](docs/plans/react-chrome.md) for the merge record.

## How the app reaches a project

Everything goes through the app's one port. A project's dev server keeps the
port Vite gives it; the app reads it from the registry for each request.
A registry file only claims a server. The app asks the server at the file's
URL for its `hello`, at most every 2 s, and routes only when the answer
names the file's project and pid. It deletes a file that another server
answers for, and shows a project whose server does not answer as `Silent`
(decision 39).

| Path on the app | What it is |
|---|---|
| `/__caliper/` | The list of running projects. |
| `/__caliper/p/<id>/<path>` | `<path>` on the project's dev server. The chrome is `<base>__caliper/` under it. `<id>` is the first 12 hex digits of the SHA-256 of the project root. |
| `<base>__caliper/hmr/<id>` | The project's Vite HMR socket. The plugin sets `server.ws.path` to this (`server.hmr.path` before Vite 8.1). |
| `/__caliper/sw.js` | The routing service worker. |

The service worker sends each frame's requests, such as `/@vite/client` or
`/src/App.tsx`, to its project, and keeps the URL the frame asked for. It
caches nothing. A hard reload bypasses it; the chrome then reloads once,
normally. Frames share the chrome's origin, so all products share
`localStorage`, IndexedDB and cookies. A product's own WebSocket is not
routed, and a project that sets its own `server.ws` or `server.hmr` path, port,
client port, host or server is refused with a message. Two dev servers of one root are
shown as a problem and not routed. Only Chromium is tested.

Writes need a token. Each dev server makes one at start and keeps it only in
its registry file (mode `0600`). The app adds it when it forwards a write, so
the token never reaches a browser. The app refuses a write whose page is on
another origin. Anything that reaches the app's port can use every project
through it; the app listens on `127.0.0.1` unless you pass `--host`.

The app knows nothing about TLS or Tailscale. To reach it from another
device, put a TLS proxy in front of its one port. On `zao` that is
`caliper-tsnet` at `https://caliper.hummingbird-lake.ts.net`; see `deploy/`.

## Install the dev chrome

Open the app on a secure origin (localhost or HTTPS) and use the browser's
Install action. The install opens Caliper in fullscreen, with standalone and
minimal-UI fallbacks. Android gets regular and maskable icons; iOS gets a home-screen
icon and viewport metadata. Safe-area placement still needs the styled UI. The manifest,
icons and install scope are the app's `/__caliper/`, whatever a project's Vite
base is. They do not replace the product's own manifest or icons.

This is still a dev tool. Keep the app and the project's Vite server running
while using the installed app. The service worker only routes; Caliper does not
work offline. To rebuild
its icons after changing chrome colors, run `nix develop -c node scripts/gen-icons.mjs`
in this checkout. Run `nix develop -c node scripts/verify-pwa.mjs` to check the
install metadata and browser installability on a test product. The reference
reports safe-area layout as deferred; it does not pass that layout gate.

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
so one that throws fails alone. All frames use the same device CSS viewport. The reference scales each frame
by available width. It does not fit frames to a canvas height budget; that
layout remains for UI integration. Click a frame's label
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

`knobs` gives [knob hints](#tune-design-inputs-with-knobs) by custom property
name, for CSS the project cannot annotate:
`knobs: { "--pico-pixel-rows": { label: "Pixel rows", min: 180, max: 720, step: 10 } }`.
A hint comment in the CSS wins over it.

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

The agent runs in the Caliper app, for every project. Projects carry no AI
settings; `caliper({ agent })` is an error. Turn the agent on in the app's
settings, `~/.config/caliper/config.json` (`$XDG_CONFIG_HOME`, or the file
`CALIPER_CONFIG` names):

```json
{
  "agent": {
    "model": "gpt-5",
    "baseUrl": "https://api.openai.com/v1",
    "reasoning": "medium"
  }
}
```

`api` chooses the API the agent speaks:

| `api` | Endpoint | `baseUrl` |
|---|---|---|
| `chat-completions` (default) | Any server that speaks OpenAI's `/chat/completions`: OpenAI, OpenRouter, Ollama, LM Studio, vLLM, LiteLLM and most proxies | Required, with its `/v1`, for example `http://localhost:11434/v1` |
| `responses` | OpenAI's `/responses` | Required, with its `/v1` |
| `anthropic` | The Anthropic Messages API | Optional. Default: `https://api.anthropic.com` |
| `google` | The Gemini API | Optional. Default: `https://generativelanguage.googleapis.com/v1beta` |

For example, `{ "agent": { "model": "claude-opus-4-8", "api": "anthropic" } }`
calls Anthropic directly. `reasoning` is one of off, minimal, low, medium,
high, xhigh, max. `contextWindow` and `maxTokens` set the model's limits in
tokens. For a model that pi-ai's catalog knows on `anthropic` or `google`,
Caliper takes the limits and thinking rules from the catalog. Any other model
gets a 200,000-token context window and 32,000 tokens per answer. The app
reads the file when it starts a project's agent, so restart the app after you
change it.

The API key never goes in the file; the app refuses a file that holds one. Set
`CALIPER_AGENT_API_KEY` in the environment of the app, whichever `api` you
use. `apiKeyEnv` names a different variable, for example `"ANTHROPIC_API_KEY"`.
Caliper reads the key from no other place. A server that needs no key, such as
a local Ollama, still needs the variable set to any value. Caliper needs no
`pi` binary.

The agent reaches a project only through its plugin: each file read, write
and edit is one call to `POST <base>__caliper/host` on the dev server, with
the server's token. The plugin runs the call against its own take store, so
its fence decides what the agent can write. The app's agent renders the
project's dev server directly, and needs `CHROMIUM` in the app's environment
to see its work. Checks still run in the plugin, so the shell that starts
Vite needs `CHROMIUM` too. The Takes panel shows the model,
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
"change the cart component". Every direction starts as a take as soon as the
planner answers; there is no step to review them. While the planner works,
blank slots hold the takes' places and the bar says "Planning 3 takes…" with
Cancel. Each take's agent follows one direction and knows the titles of the
others. The take's record keeps the direction as a folded **Brief**. To drop a
direction you do not want, discard its take. The planner returns fewer
directions when the prompt has only one sensible answer, and the bar says why.
It costs one model call of about 10 s.

When you ask for three or more takes, one direction is the **strange
direction**. It is still a real answer to the prompt, but it breaks the part's
current pattern on purpose, so the most probable answer is not the only one
you see. It uses one of the takes, not an extra one. Its record's Brief says
"strange". Discard its take if you do not want it. For a precise fix, the
planner can leave it out and says why.

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
conversation lives only in the Caliper app: after the app restarts, the take's
files remain, and its next prompt starts a new conversation. A restart of the
project's dev server keeps the conversation; the agent's file calls fail
until the server is back.

### Attach reference images

A prompt can carry up to 4 images: a mockup, a screenshot of a product you
like, or a photo of the device. Use **Add image**, paste into the prompt box,
or drop files on the composer. Caliper takes PNG, JPEG, WebP and GIF, up to
5 MB each. It refuses SVG and other types, because model APIs do not read
them. The server checks each image's bytes, not only the type the browser
sends.

The images go to the planner, to every take a plan starts, and to the take's
agent. The model gets them after the part's source and its current render,
with a line that names them as reference material. A follow-up prompt can
carry its own images.

Caliper keeps a take's images in `.caliper/takes/<n>.images/`, beside the
take's folder and not in it. Replace never copies an image into the project.
Discard and Replace delete the images. After a restart, the take's next
prompt gives the new conversation every earlier image again. The conversation
shows each prompt's images as thumbnails that open the full image.

Cost: the model reads every image of a prompt once for each take. Four
images on a plan of four takes are 16 image inputs, plus the planner's 4.

### Give the agent skills

The agent uses [Agent Skills](https://agentskills.io): folders that hold a
`SKILL.md` with a `name` and a `description` in YAML front matter, then
Markdown instructions. Skills made for pi, Claude Code or another client work
unchanged. Caliper looks in these folders, and the first skill found with a
name wins:

1. `.agents/skills/` in the project root, then in each parent folder up to the
   Git root, so a monorepo can share skills.
2. Each folder that `agent.skills` in the app's settings adds, in order.
3. `~/.agents/skills/`.

The plugin finds and reads the project's skills; the app reads the others.

A home folder often holds skills for coding work that do not help a take. Choose
the skills by name:

```json
{
  "agent": {
    "model": "gpt-5",
    "baseUrl": "https://api.openai.com/v1",
    "skills": {
      "include": ["intrinsic-design", "frontend-design"],
      "exclude": [],
      "folders": ["~/design/skills"]
    }
  }
}
```

`include` keeps only these skills (default: all found), `exclude` drops these,
and `folders` adds folders of skills, or one skill's folder.

`skills: ["./design/skills"]` is short for `{ folders: [...] }`, and
`skills: false` turns skills off. A name in `include` or `exclude` that matches
no skill shows as a problem, since it is usually a typo. A filtered skill is
gone: the agent does not see it, and `/name` cannot load it. Folders are
absolute or start with `~/`. The settings apply to every project.

Caliper does not read `~/.pi/agent/skills/` or `.claude/skills/` unless you add
them: those folders belong to other clients, and hold skills that expect a
shell, which the take agent does not have. A skill under your home folder also
exists only on your machine, so a teammate's takes do not get it.

The agent sees only each skill's name and description, about 100 tokens per
skill. When your request matches a description, it calls `activate_skill` to
load the instructions, and `read_skill_file` to read a file the skill refers to.
Type `/name` in a prompt to load a skill yourself; a skill with
`disable-model-invocation: true` loads only this way. The planner sees the
names and descriptions too, so a direction can name the skill its take should
use. Caliper reads the skills again for each new agent, so a new or changed
skill needs no restart.

The composer lists the skills under the model. It also lists the problems:
a missing folder, a skill with no description (skipped), a name that differs
from its folder, or a skill hidden by another with the same name.

Costs: every take pays for the list of names and descriptions, even when it
loads no skill; `include` keeps that list short. The agent decides from the description alone, so it can skip a
skill that applies. Name the skill with `/name` when it must apply. A project's
skills are as trusted as its `vite.config`, which Vite already runs.

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

The **Code** button opens the code pane. It needs no agent. The core reference
supports editing and diffs. Side-by-side/stacked placement and divider gestures
remain UI integration work.

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

The pane uses CodeMirror 6 in Caliper's own lazy bundle. The project's Vite
does not transform those dependencies. The current editor chunk is about
230 KB with gzip. Code and alternate-review diffs load it when needed. The
pane has no type checking or completion from the project's types yet.

## Tune design inputs with knobs

The **Knobs** button opens a panel of the design inputs that the part on the
stage uses. Caliper finds them in the project's CSS; there is nothing to set
up. A knob is one declaration in a source file. While you drag a knob, every
frame shows the new value at once, and no file changes. When you let go,
Caliper writes the value into that declaration, once, and Vite reloads the
frames from the file.

A knob is a custom property registered with `@property`, a plain custom
property that the part reads, or a `@container` threshold:

```css
/** How many virtual pixels the short side holds. @label Pixel rows @min 180 @max 720 @step 10 */
@property --pico-pixel-rows {
  syntax: "<number>";
  inherits: true;
  initial-value: 360;
}
```

The knob edits the declaration that sets the property on the part. Caliper
finds it by trying a test value in each declaration and seeing which elements
change, so the browser decides the cascade, `@container` and `@media`
included. When no rule sets the property on the part, the knob edits the
`initial-value` of its `@property` rule.

| Registered syntax and value | Control |
|---|---|
| `<length>`, `<number>`, `<integer>`, `<percentage>` and other numbers | Drag the label sideways, or type a value. Shift moves ten steps. With `@min` and `@max`, a slider too. |
| `<color>` with a raw colour | A colour field and its text. |
| Any syntax, with a value of `var(--p8-black)` | The sibling tokens: the `--p8-` properties declared beside `--p8-black`. The knob writes `var(--p8-navy)`, never the colour itself. |
| An ident list, such as `small \| medium \| large` | A select. |

Some registered properties are not knobs. The panel lists each one under
**not knobs** with the reason: a value that `@keyframes` animates, a value
computed with a math function such as `calc()`, `max()` or `clamp()`, a value
that combines tokens, a syntax with no control yet, and a declaration Caliper
cannot place in its file.

A plain custom property, one that no `@property` registers, is a knob when the
part reads it:

```css
.card {
  --pad: 6px;
  padding: var(--pad);
}
```

The part reads a declaration when a test value in it changes a property that
names it in a `var()`, directly or through other custom properties, on an
element of the part or its `::before` or `::after`. Caliper tests every
element, not a sample. `@keyframes` and inline styles count as readers too. A
plain property that the part does not read, such as an unused palette colour,
does not show. Its control comes from its value: a length, a number or a
percentage scrubs, a colour is a colour field, and `var()` of one token is the
token picker. A value built with a math function is an output and shows under
**not knobs**, as for a registered property.

A `@container` threshold is a knob too. Each length in the condition of a
`@container` rule that applies to the part is one knob:

```css
/** @label Narrow stage */
@container stage (width < 45em) and (height >= 40em) {
  .cart { display: none; }
}
```

This rule gives two knobs, "Narrow stage · Stage width <" and "Narrow stage
· Stage height >=". A rule applies to the part when a style rule inside it
matches an element of the part, whether the condition holds now or not.
Caliper reads the `min-width: 400px` form, the `width < 45em` form and a
range such as `30em < width < 60em`. A length in a `style()` query is not a
threshold. A threshold scrubs from 0 up, with no top, and a knob writes only
its length, for example `45em` to `50em`. While you drag, Caliper deletes the
rule in each frame and inserts it again with the new condition, because the
browser does not let a script change a condition in place.

A **hint** is a doc comment directly above the declaration or its `@property`
rule, or above the `@container` rule. A hint above a `@container` rule applies
to each threshold in it. `@label` names the knob, `@min`, `@max` and `@step` shape its range, and
`@knob ignore` hides it. Only a comment that opens with `/**` holds hints, and
Caliper reads them from the source file, because the browser drops comments.
The prose of the comment above `@property` shows under the knob. The `knobs`
[option](#options) gives the same hints from `vite.config`.

Select a take in the takes view to tune the take instead: its knobs write the
take's copy of the file, and the real file does not change until Replace. The
panel's header says which files it edits. The agent's next prompt names the
file, as for any edit by hand.

A write names the version of the file the knob read. If the file changed in
the meantime, for example from your editor or the code pane, Caliper does not
write, says so, and the knob shows the file's value. A save to the same file
during a drag does not lose the dragged value in the frames. Click the file
name under a knob to open that file in the code pane.

### Make a literal a token

A **literal** is a value written straight into a rule, such as
`padding: 12px` or `color: #ff77a8`: one length, percentage, number or colour,
with no `var()` and no math. Open **Literals** at the foot of the Knobs panel
to see the literals that win on the part. Caliper looks for them only while
the section is open. A literal that another rule overrides on the part, or
whose change shows nothing, such as `border: 0` with no border style, is not
listed.

**Make a token** opens a form. Caliper suggests a name from the tokens beside
it, the rule and the property, for example `--pico-cart-padding`. **Put it in**
lists the rules that already declare custom properties and reach every
element the literal is on, most tokens first. The form says both edits before
Caliper makes them:

```text
Adds --stage-width: 300px; to .theme (tokens.css:44), and writes var(--stage-width) in its place (card.css:15).
```

**Create token** adds the declaration after the last custom property of that
rule and puts `var(--stage-width)` where the literal was. The part looks the
same, and the new token shows as a knob. Caliper refuses a name that is not a
custom property or that the frames already declare, and both edits wait if
either file changed since Caliper read it. In a take's frame, both edits go to
the take's copies.

Caliper turns on Vite's `css.devSourcemap`, because a knob maps a rule in the
browser to its source file through it. Served CSS is larger in development.

Costs and limits: the Knobs and Takes panels never show at the same time.
Finding which plain
properties a part reads costs about 40 ms per frame, and up to about 700 ms on
a page with 280 elements. A plain property is a knob only for the states on
the stage: a value that only a hidden state reads does not show. The `knobs` option gives no hints to a `@container` threshold.
A literal in a `::before` or `::after` rule, or in a shorthand with more than
one value, is not listed. Caliper does not check the part after the edits. It
offers only rules that reach the literal's elements. Caliper refuses a knob in
nested CSS, `@layer`, `@scope` and `@starting-style`, which are not tested.
Tailwind, Sass and CSS modules are not tested. Only Chromium has run the
panel. The code pane still saves over a change made elsewhere, so a pane save
after a knob's write replaces it.

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
and results; `node` must be on PATH, and it must be real Node. Do not start the
dev server with `bunx --bun` or `bun --bun`: they make `node` mean Bun, and
every render then fails with "The browser worker started under Bun, not Node".
This avoids intermittent Playwright transport
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
- Only Vite projects can use Caliper: Vite 6, 7 or 8. The delivery gate runs
  Vite 6.4.2, 7.3.6 and 8.3.1 consumers; Caliper itself builds with 8.3.1.
- A take cannot show a change that goes through a conditional CSS `@import`
  (`layer`, `media`, `supports`), Sass, Less or Tailwind's source scan. Not
  yet tested.
- The agent works in the Caliper app, one worker thread per project. Its
  render browser starts for each render, which costs about a second. Each
  file call to the plugin is one HTTP round trip on the machine.
- The app and every dev server must run on one machine: the registry is a
  local folder.

## Develop

The app state in `src/client/app/` drives the Darkroom renderer through the
contract in [`docs/plans/react-chrome.md`](docs/plans/react-chrome.md).
Caliper builds React/React DOM and lazy CodeMirror chunks into
`dist/chrome`; the Caliper app serves them under `/__caliper/assets/`, and
the consumer's Vite never resolves them. Product frames still use the consumer's
React. A linked checkout needs `bun run build` after chrome changes. `bun pack`
builds the artifacts through `prepack`. Consumer production builds omit Caliper.

Self-hosting uses a separate recovery tool, pinned to one commit
(`TOOL_REVISION` in `src/build/tool.js`), not this checkout's plugin. Install
it with `nix develop -c bun run tool:install`, then run
`nix develop -c bun run dev` and the tool's own Caliper app with
`nix develop -c bun run tool:app` (port 3133), and open this checkout from it.
The tool shows the chrome's
own parts (the bar, the canvas, the side panel and the rest) as this
checkout's source, and its take agent edits them. Its archive, source and lock
hashes are checked before startup, and the install builds its own chrome
bundle. To restore a missing or changed copy, run
`nix develop -c bun run tool:install -- --repair`. A bad accept breaks only
this checkout, never the tool you use to undo it. The pin moves only by hand:
commit the change, run `scripts/tool-pin-hashes.mjs <commit>`, put the four
values in `src/build/tool.js`, and install with `--repair`.

`nix develop -c node scripts/verify-central.mjs` checks the app with the real
chrome and plugin: two projects on ports Vite picks, tabs on each, HMR, web
workers, a stopped service worker, a hard reload, a restart on a new port, the
switcher, the token and one take through the host endpoint. `--via <url>`
runs it through a TLS proxy.

Run the unchanged contract gate with
`nix develop -c bun run verify:chrome-contract`. Run live public gates on
disposable consumers with `nix develop -c node scripts/verify-chrome-core.mjs`.
The latter runs 21 gates against the built Darkroom chrome, layout assertions
included. It uses a deterministic local model endpoint for take transport, not
a paid model. Run `nix develop -c bun run verify:chrome-delivery` for
linked/packed React-major isolation, source HMR, lazy editor delivery and
pinned-tool self-hosting. Run `nix develop -c node scripts/ui/verify.mjs` for the
Darkroom regions: 26 fixtures at three sizes, every hook, keyboard, frame and
editor preservation, and reachability at eight sizes. None of these prove
real-device input.

```sh
nix develop -c bun install
nix develop -c bun run build
nix develop -c env CALIPER_TEST_MODULES="$PWD/node_modules" bun test
nix develop -c bun run typecheck
CHROMIUM=/path/to/chromium CALIPER_TEST_MODULES=/path/to/react-project/node_modules bun test test/navigation.test.js
CHROMIUM=/path/to/chromium bun run verify:browser -- --url http://127.0.0.1:5173 --root /path/to/project
CHROMIUM=/path/to/chromium node scripts/verify-css-loading.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-integration.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium ./scripts/verify-attachments.mjs --modules /path/to/react-project/node_modules
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
CHROMIUM=/path/to/chromium node scripts/verify-knobs.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-knobs-product.mjs --root /path/to/project --part src/Button.part.tsx
```

`scripts/verify-knobs.mjs` runs the Knobs panel on a temporary project shaped
like Pico's tokens: discovery and refusals, live input that writes the
file once on commit, a `@container` threshold, a plain custom property, literal
promotion, token choices, a take's copy, HMR during input and five window sizes.
Label-pointer scrubbing, capture and dock/sheet layout remain deferred on the
reference. Screenshots go to
`/tmp/caliper-verify-knobs`. `scripts/verify-knobs-product.mjs` copies a real
project to a temporary folder, prints every knob and refusal Caliper finds for
one part, previews and commits the first number knob of a property, a plain
custom property and a `@container` threshold, then lists literals and makes
the first one a token, and checks that no element of the part changed its
value. `--with ../../contracts` copies a
folder the project imports from, at the same place. The real project never
changes.

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
selection and unchanged Replace. Add `--layout` after UI integration to require
five size-ladder shapes, embedded-container containment and focus restoration.
These assertions remain in the script; the reference explicitly defers them.

`scripts/verify-checks.mjs` uses a temporary React consumer to check the public
CLI, both device sizes, render errors, browser errors, empty states, spill,
accessibility failures, unstable images, saved-baseline approval, take comparison,
and the agent tool's findings. It also proves that reports do not block Replace.
It makes no model calls or changes to the supplied project.

`scripts/verify-code.mjs` checks the code pane against a running dev server.
It types in a real file and checks that the file on disk changes, no take
starts and the frame renders. Then it undoes the edit and checks that the file
is back. It starts a take in the project at `--root`, and checks the take's
frame, the diff and its line count, Revert, the state lenses, and samples
four window sizes. Add `--reference` to report its layout gates as deferred
when you run it against the unstyled reference renderer. It makes no model calls. It writes the real file back and
discards every take it starts, even when a step fails. Pick a part with two or
more states to check the lenses.

`scripts/verify-takes.mjs` checks takes on the canvas against a configured model: it
starts takes from the chrome, waits for the agents, checks every take frame,
takes screenshots at three window sizes and discards the takes. With
`--accept --root <project>` it first accepts one take through the chrome,
checks that the take's files replaced the real ones and that the other takes
remain. Run that against a scratch checkout: the accepted edit is real.

`scripts/verify-integration.mjs` checks alternate preview, unchanged original
renders, real click behavior, revision-bound review/apply, and review controls at
five container sizes. Against the unstyled reference renderer, add
`--reference` to defer that containment gate. It uses a temporary React consumer. Add `--live` to also
exercise naming and alternate preparation with a real model. `--live`,
`verify-markup-model.mjs` and `verify-references-model.mjs` use the agent in
`~/.config/caliper/config.json` and the key in the script's own environment;
the last two take `--model` to try another model on that endpoint.

`nix develop` provides Bun, Node and `CHROMIUM`. The browser check renders
every part of a running project and checks calibration actions, a visible error
and reload on save. It reports final physical sizing, overflow and height-budget
layout as deferred on the reference. It writes screenshots to
`/tmp/caliper-verify`.

The design decisions behind this shape are in
[`docs/decisions.md`](docs/decisions.md). The previous, larger Caliper is on
the `legacy` branch.
