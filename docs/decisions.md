# Decisions

These decisions shaped the fresh start on 2026-09-26. The `legacy` branch holds
the earlier Caliper: a multi-project launcher, per-project descriptors and
adapters, and a design studio. It grew to about 40,800 lines, and loading a
project stopped being reliable. Change a decision below only with new evidence,
and record the change here.

| # | Decision | Why |
|---|---|---|
| 1 | Caliper is a dev-only Vite plugin, `caliper()`, with `apply: "serve"`. The project adds it to its own `vite.config`. There is no launcher, profile or descriptor, and no CLI that starts or configures a project. A CLI may only read a running dev server (see 14). | The project's own Vite config already runs its CSS pipeline, aliases and plugins. Legacy never ran it, so each project needed hand-written copies that drifted. This reverses legacy's rule that Caliper must not appear in the project. A dev-only config line is honest wiring. |
| 2 | Near-zero config. Caliper derives the parts, the app entry, the global CSS and the wrapper from source, without running JavaScript. | Every hand-written setting is a setting that can go stale. |
| 3 | Caliper shows each derived value and the file and line it came from. A failed derivation is visible and names its fix. | A heuristic that fails silently renders an unstyled frame with no explanation. |
| 4 | `caliper({ entry, wrap, css })` exist as overrides when derivation fails or a project's global styles do not follow the direct-entry convention. See 17 for `css`. | Options stay in the one file the project already has. |
| 5 | `*.part.tsx` files are product. They stay in the project and are the default part glob. | Only the product knows what realistic example data is. |
| 6 | Each part renders in one `iframe` per device, sized to the device's CSS viewport and scaled to its physical width. | A scaled `div` gives container queries the device, but media queries, `vw` and `window` still see the monitor. The `iframe` also keeps Caliper's code apart from the project's React. |
| 7 | Credit-card calibration gives px per mm, stored in the browser. It holds at 100% browser zoom. | One measurement per monitor makes millimetres real. |
| 8 | Every failure shows a visible error. A frame drawn smaller than true size says so. | "It rendered" is not the same as "it rendered correctly". |
| 9 | The first scope is a part list, one device frame, calibration and reload on save. | Legacy built the studio before loading was reliable. |
| 10 | Caliper's chrome is plain DOM with no framework. Decision 36 replaces this choice for the React migration. Until that migration lands, this row describes the live chrome. | It must not share React, or anything else, with the project. Decision 36 keeps that isolation requirement. |
| 11 | No request interception and no fetch swapping. A part supplies its own data. | Legacy rule D8, kept. |
| 12 | The goal after the viewer is fast AI iteration. A **take** is one version of a component that an agent proposes. A take is a folder of edited copies of project files, at the same relative paths. One Vite server shows the real part and every take, each in its own frame. A frame opened for a take tags each project module it imports. Caliper serves the take's copy of a file when one exists, and the real file when not. In a take frame, Caliper loads each local stylesheet that the global CSS `@import`s as its own module. Accept copies the take's files over the real files. | You rejected one Vite server per take as too heavy. The `spike/takes` branch (`spike/FINDINGS.md`) tested this on Pico: the take shows its CSS and TSX edits, React stays single, a save updates only the frames it affects, and each extra take adds about 100 ms to a page part's load. Vite inlines `@import` from disk and skips plugin `load`, so the take tag cannot pass through it. Not yet tested: Tailwind, Sass and Less, and where take folders live. |
| 13 | A part file can hold more than one **state**. The default export is the state `default`. Each other exported component whose name starts with an upper-case letter is a named state, for example `export const NoResults = () => ...`. Caliper reads the states from the source without running it, and makes the label from the export name: `NoResults` shows as "No results". | The states and takes need one format that stays in product files, with no adapter. The rule matches React's naming rule for components and Storybook's named exports, so a helper or a `name` string is never a state. The cost: an exported upper-case component that is not a state shows in the list. |
| 14 | An agent sees its work through `caliper-render`, a CLI with a skill file. It reads the project's running dev server, renders the frame page in a headless Chromium at the device's CSS viewport, and prints JSON: the frame's verdict, its problems, uncaught browser errors, and any element that reaches past the screen. It writes one PNG per state and device. | The agent loop needs the agent to see the result without you. `docs/research/agent-render.md` compares Storybook MCP, Storycap, Playwright CLI and Chrome DevTools MCP. Microsoft recommends a CLI plus a skill for coding agents, because it costs fewer tokens than MCP. The render code is separate from the CLI, so an MCP tool can use it later. The CLI reads the server, and copies no project config, so the drift that decision 1 prevents cannot happen. |
| 15 | The agent that makes takes runs **inside the Vite dev server**, on `@earendil-works/pi-agent-core` (the loop) and `@earendil-works/pi-ai` (model calls). One agent per take, many at once, in one process. `caliper({ agent: { model, baseUrl, reasoning, api, apiKeyEnv } })` configures it in `vite.config`; `reasoning` goes to the model on every request. The key comes only from an environment variable (default `CALIPER_AGENT_API_KEY`, from the shell or `.env` files), never from `vite.config`. `~/.pi/agent/cliproxyapi.json` is an optional fallback for the base URL and key, and its key goes only to its own base URL. The agent has five tools: `read_file`, `list_files`, `edit_file`, `write_file` and `render`. Writes land only in its take; `render` returns the verdict and the PNGs to the model. The chrome drives takes through `POST /__caliper/takes` and hears about them on the event stream. The key never reaches the browser. | You want the main interaction inside Caliper, through your CLIProxyAPI. Running pi as a subprocess (legacy's way) needs the `pi` binary and pi set up for every user, loads your whole agent setup per take, and gives the agent `bash` and `edit` everywhere, so it needed an extension to fence it. The pi SDK in-process pulls in pi's terminal UI and probably its stored settings. The engine packages need neither: another user needs only an OpenAI-compatible endpoint and a key. Costs: `pi-ai` is pre-1.0 (pinned at 0.87.1) and pulls the Anthropic, OpenAI, Google and AWS SDKs; no pi skills, `AGENTS.md`, saved sessions or failover; a take's conversation ends when Vite stops. Verified on Pico through the proxy with `claude-opus-5-5`: a take takes 26 to 31 s. |
| 16 | Several takes from one prompt start from a **plan**. One planner call (`POST /__caliper/takes/plan`) sees the prompt, the part's source and how it renders, and proposes up to N directions through a `propose_directions` tool call, or fewer with a reason. You edit the directions in the Takes panel, then one agent per direction starts in parallel. Each agent's first message carries its direction and the titles of its siblings'. One take still starts at once, without a plan. Decision 34 moves the review onto the canvas once slice 0 is built. | Three agents given the same prompt and context made nearly the same take: same files read, same sample art, same choices. One agent making every take in turn would force variety, but runs the takes one after another and grows one context with every screenshot. The plan keeps one agent per take folder, so the write fence is unchanged, and keeps the takes parallel. Verified on Pico's Home with "I need to see more variation on the games": planned in 10 s into realistic data, edge-case data and a cart component change; the three takes came out clearly different. Cost: one extra model call per multi-take prompt, and a review step. |
| 17 | Caliper injects only side-effect stylesheet imports made directly by the app entry, in source order. The selected part loads its component styles through Vite. The app import walk still discovers the wrapper and reports unresolved imports, but does not turn nested styles into globals. `caliper({ css: [...] })` replaces the injected list with explicit root-relative stylesheet paths; `[]` injects none. Setup identifies the convention and override. | After Pico moved CSS imports into components, the old walk still injected all 53 stylesheets into each part. That hid missing imports and kept unrelated styles in each frame. Entry-only injection exposes the real dependencies without interpreting CSS selectors. Cost: projects with global styles in an App or bootstrap module must move those imports or set `css`; wrapper styles must be global too. Plain global CSS import chains retain the take-flattening step. Component CSS import chains in takes fail rather than silently losing styles; use JS/TS imports there. This change does not implement Reach analysis or add support for unverified CSS preprocessors. |

## 18. Product-owned working scenarios

Caliper's goal is AI speed while maintaining, as nearly as possible, a
hermetically sealed, fully composable and browsable collection of page states.
This foundation extends decisions 5, 11, 12 and 13. It keeps product-owned part
files, explicit data, the take overlay, and the named-export state convention.

A scenario belongs to the product. It supplies explicit local data, initial
state, and action behavior without requiring a live backend. The seal surrounds
its inputs and dependencies. The components inside retain their real composition
and behavior. Product wiring supplies local implementations through explicit
inputs or dependencies, not request interception or global fetch replacement.

A page state shows that real composition under a scenario. Every declared page
state must be reachable in Caliper and reproducible from its declared inputs.
Actions must produce the state changes the scenario declares. Fixture data alone
does not prove interaction behavior, and a no-op callback does not verify an action.

Caliper selects and renders product scenarios. It must not substitute unrelated
standalone child fixtures and call the result a valid composed page state.
A child's render function does not specify which parent inputs or repeated child
instance to change. The product owns those relationships. For example, an empty
library can make a page remove its shelf entirely. Replacing only the shelf
bypasses that page behavior.

Keep the component an agent edits separate from the composed scenario where its
change is judged. A take belongs to a state for review, but its implementation
edits can affect other states. Verify shared edits across relevant scenarios.
Accepting a take still copies its edited files over the real files, as decision
12 specifies. Review ownership does not make those changes state-local.

The cost is explicit scenario authoring and maintenance of fixtures and coverage.
AI can help author both. Passing declared scenarios does not prove every
possible combination works. Fully browsable means every declared state is
reachable and reproducible, not that all theoretical combinations are enumerated.

### Implementation status

Caliper now separates editing and viewing contexts, groups takes under states,
and browses declared composed scenarios. Decisions 19 and 20 define that
implementation. The product still owns fixture isolation and action behavior.
Caliper does not prove hermeticity, infer child-to-parent input mappings, or
verify every theoretical state combination.

## Reviewed alternate integration

The user approved reviewed alternate integration on 2026-09-27. An alternate
means an additional supported product choice, not a mandatory copied component
or a mandatory new prop. The agent proposes a named variant when the existing
component contract fits, or a separate component with shared unchanged behavior.

Preparation creates a separate proposal take. The experiment remains available
for replacement. Product files do not change during preparation or review.
The proposal names its strategy, shared behavior, preserved defaults, caller
usage, and a new product-owned preview state. Review shows before and after files.
Take-only modules and states render through the overlay before acceptance.

Apply requires the exact reviewed revision, passing render checks, and explicit
confirmation that the reviewer checked product types, interactions, and callers.
Render checks cover every existing declared state on both built-in devices.
They compare two original baselines, then the proposal, then render the alternate.
Intentional empty originals are valid. An unstable baseline is inconclusive,
not a passing result. The alternate must render visible content without spill.
The confirmation is a human attestation, not an automated product-test runner.

Checks persist across restart but cannot authorize later edits. Project file
changes, additions, or source-experiment changes require a fresh proposal.
Proposal edits require resubmission and new checks. Apply preflights paths and
rolls back failed copies. It does not promise recovery from a process crash.

This extends replacement acceptance without making shared edits state-local.
Costs are another agent pass, review, and full render checks that can take minutes.
Screenshots cannot prove interaction behavior. Broad source baselines invalidate
work after unrelated edits, and animation can prevent stable comparisons.

Names are descriptive metadata generated by the take agent, or inherited from a
planned direction. Numeric take IDs remain stable. Old records remain valid.
Missing names remain visible instead of being presented as model-generated text.

The review uses GitHub's separation of description, changed files, and final
action. It does not copy its full pull-request workflow. Reference inspected:
https://mobbin.com/screens/e9bad011-d5c5-4e8d-b56f-4fba2ffde691.

## Automatic check reports

The user chose reporting rather than a mandatory replacement gate. Phase 1
adds automatic checks to the chrome's Checks window, `caliper-render --check`,
and the take agent's `render` tool with `checks: true`. Ordinary Replace and the
existing reviewed alternate gate keep their behavior. No new scenario or
authored-check export is introduced.

Corrected after user feedback: the first implementation exposed reports only
through the CLI and agent. That was not the approved scope. Reporting instead
of gating does not remove the UI. The chrome must let people run checks, read
findings, compare saved images and approve reviewed real-file baselines without
a terminal.

Reports distinguish detected failures, human review, inconclusive evidence,
checks not run, and passes. Empty content and spill need review because Caliper
cannot infer whether they are intentional. An unavailable axe audit or unstable
image must not look like a pass. Axe scans the product host for WCAG A/AA rules;
it cannot establish interaction correctness or full-page accessibility.

Each check run retains two fresh renders in a unique directory. Visual baselines
are explicit local records, approved from saved images after review rather than
from a new unreviewed render. Approval verifies those images still match the
report. Take images cannot become product baselines. Baseline approval records
visual intent, not permission to accept files, and never suppresses other checks.
The baseline directory belongs to one consumer project. Environment changes are
inconclusive until reviewed again.

This reuses the render engine but does not weaken or replace the alternate
preservation check. That check requires unchanged originals and a valid new
alternate. A general report permits intentional visual changes and reports their
need for review. Costs are two renders plus axe per check run, exact-image
sensitivity to fonts and animation, manual image comparison, and stored images
that need manual cleanup. Sources are not frozen during a report. These results
cover only listed states, not all consumers, hermeticity or product behavior.

### Checks in the chrome

Checks opens a native dialog from the bar, or from More when space is limited.
It runs the selected preview or all declared states on both devices. A selected
take applies its overlay to that scope. The report names the take explicitly.
A separate session-local API owns progress, findings, saved image access, source
invalidation and approval. It needs no agent or model. The latest report survives
page reloads but not a Vite restart. Accepted baselines remain on disk.

Each state/device row expands into findings and the two saved renders. When a
baseline exists, its image at check time appears alongside them. Approval needs
an explicit review checkbox and applies only to that real-file result. It cannot
approve a take, changed evidence, or an out-of-date UI report. Source changes
mark the report stale without hiding the historical observations. Part-list
badges describe only the latest run's coverage, not universal safety.

The dialog follows the Caliper container, even inside a larger browser window.
`planChecks(width, height)` chooses image columns and compact header spacing.
Its controls stay reachable by scrolling; Close stays visible. The existing bar
policy moves Checks into More as a whole group. The design keeps Caliper's tokens
and uses compact status rows with expandable findings, as in the inspected
[AirOps run log](https://mobbin.com/screens/6dadd86c-1a15-47ea-b654-a45132bb45d1).
It does not add a separate workflow canvas or permanently shrink the preview.

Costs: one active UI run at a time, latest-report-only navigation, conservative
source invalidation, and evidence in `.caliper/checks` that needs manual cleanup.
The modal blocks editing while open; close it while checks run to keep working.
Checks still do not prove interactions or discover every affected consumer.

## Authored checks: browser input

The user chose browser input for authored checks attached to a state. Checks
send clicks, typing and keyboard input, then assert observable results. The
initial API does not expose product commands such as a fixture host's
`press("options")`. Calling a product command directly can pass while the
browser input handler is broken.

The product scenario owns local data, initial state and real action behavior.
The authored check sends input and asserts the result. Caliper owns isolation,
device size, timeouts and evidence. Prefer established query, interaction and
assertion tools over Caliper-specific equivalents. Select libraries after
verifying their fit with Vite and take overlays.

The user requires a modern public authoring API and permits mature internal
dependencies. A Chai dependency does not disqualify a module. Chai-style chains
are not the target authoring syntax. Evaluate typed DOM matchers, browser
compatibility and useful failure messages, not package age alone.

On 2026-09-28 the user approved the complete
[authored-check v1 contract](plans/authored-checks-v1.md), informed by the
[library-fit spike](research/authored-checks.md) and
[modular/full-runtime comparison](research/vitest-browser-mode.md).
The implementation uses the approved modular contract. Verification covers the
real Vite/frame route, both device sizes, linked/packed delivery, and all three
reporting paths. Chromium-only evidence does not establish physical-device input
or other-browser behavior.
The reporting-only Replace policy and existing reviewed alternate gate stay
unchanged. This extends the earlier input-boundary decision; it does not replace
product-owned scenarios from decision 18.

A part may export lowercase literal `checks`, keyed first by state export name
and then by stable, nonblank check name. `default` means the default export.
Inline arrow functions, function expressions, and methods are accepted, including
`as const` and `satisfies` wrappers. Static discovery rejects computed keys,
spreads, getters, duplicates, unknown states, imported maps, and nonfunctions with
file/line diagnostics. Value wildcard re-exports are also rejected because they
can hide imported checks; explicit named exports and type-only wildcards remain
available. This conservatively rejects unrelated value wildcard exports too.
Reusable browser-safe helpers remain callable inside a
callback, including lazy imports that follow take overlays. Public `StateChecks`
types come from `@simonwjackson/caliper/checks` without a second state-name list.

The browser-local context provides Testing Library `canvas`, `within`, and
`waitFor`; synchronous standalone Vitest `expect` with jest-dom; and awaited
Playwright-backed `input.click(element)`, `input.type(element, text)`, and
`input.press(element, key)`. The helper modules resolve from Caliper's installation
and load only for checks. No full Vitest/Jest runner, synthetic user-event input,
Node-owned product execution, second dev server, or new config is introduced.

Queries default to `#caliper-host`. Input can target product portals in the same
frame body. It rejects foreign documents, child iframes, detached elements, and
Caliper diagnostic controls. Authors must re-query after re-renders and inside
`waitFor`; there is no automatic action replay or Caliper locator language.
Covered/disabled targets, unintended focus changes, and concurrent input fail.
These are targeting guards, not a security sandbox. Navigation testing and
product-command dispatch remain out of scope.

Each named check runs serially in a fresh Chromium context at the chosen device
viewport and scale factor 1, after a non-Loading frame verdict. Empty content can
be valid; failed frames block execution. Unlike initial-state screenshot renders,
authored checks do not fast-forward animations. Startup, checks, input, evidence,
and cleanup are bounded. Stop, CLI signals, source invalidation, and Vite shutdown
cancel queued and active browser work, including the initial visual passes.
Real hanging and non-yielding callback tests verify deadlines and owned-process
exit. The driver uses Playwright's pipe transport and Chromium's public
`SystemInfo.getProcessInfo` to identify the owned browser for last-resort
termination. Playwright WebSocket connection timed out under Bun 1.3.3 while the
same probe worked under Node. Repeated Bun pipe runs also stalled intermittently.
When Vite runs under Bun, Caliper runs browser work in a fixed trusted Node worker
with schema-validated jobs, progress, cancellation, and results over IPC. Product
modules still run only in Chromium. Node-hosted Vite uses the driver directly.
This costs one Node process per run under Bun and requires `node` on PATH.
`node` must be real Node. `bunx --bun` and `bun --bun` put Bun on PATH as `node`;
the worker then ran under Bun, forked itself again, and on 2026-09-28 reached 154
processes and exhausted a 31 GiB machine three times. The worker now exits at
once with a clear error when it runs under Bun, so the chain is one level deep.
A server started with `--bun` cannot render; it fails fast instead.
It does not create another Vite server or import take code into Node. CDP ownership
setup is bounded and cancellable. No private Playwright fields are used.

Schema-owned report v2 retains initial-state images and adds separate named
authored results, source locations, reasons, duration, observed errors, and
optional interaction images. `Passed` means a normal callback return without
observed errors and with current source identity. `Failed` includes assertion,
input, declaration, import, browser, and timeout failures. `Inconclusive` records
cancellation, changed sources, navigation, or lost infrastructure. `NotRun` records
missing declarations or work that never started. A callback return does not prove
a useful assertion. Product expectations cannot waive authored failures;
`Accepted` remains an automatic-findings status. Old v1 reports stay readable
as visual evidence, never interaction coverage.

The UI, CLI, and agent use one source-revision and reporting policy. Source or
helper changes stop remaining work and retain completed observations as stale
history. This is not source freezing. Take-aware server discovery includes
new take states and parts. Reports disclose the take, edited files, and literal
declaration changes; unchanged callback text does not prove unchanged helpers.
Passing take-defined expectations does not claim preservation of the original
contract. Output inside the product must be under `.caliper/checks`; other
project-local output would count as a source edit and is rejected before writing.
Output outside the product remains supported. This restriction avoids silently
excluding a source directory from invalidation.
Cancellation before complete visual evidence must not fabricate images
or let an empty result list imply success.

The Checks window exposes named results, reasons, progress, provenance, and Stop;
closing the dialog alone does not cancel. The CLI includes declarations and
problems in `--list`, keeps `--check` exit 0 as “report written,” and exits
nonzero on interruption after cleanup. The agent forwards the SDK AbortSignal,
keeps initial-state images first within its four-image limit, and exposes omitted
interaction evidence through image and report paths. Baseline approval still
concerns initial-state visual intent only.

Costs: each authored check adds browser work and another scenario render.
Caliper owns input transport, focus validation, deadlines, cleanup, lazy dependency
delivery, and conservative source invalidation. Authors own scenario inputs,
action behavior, assertions, and coverage. Linked and packed consumers, fresh
context isolation, portals, action guards, hanging callbacks, source/take identity,
legacy report compatibility, all three public reporting paths, and cancellation
have real-browser or public-contract gates in the repository. Source identity is
conservative, not a filesystem snapshot or a network/security sandbox.

Cost: browser input does not cover every controller or native-device path.
Those paths retain product-level tests. Add a product-command interface only
when a concrete scenario demonstrates the need, and state which input handling
that check bypasses. Browser checks do not prove physical-device input behavior.

## Product-owned expectations

The user chose a separate `Accepted` status on 2026-09-28. A matching exception
is not a clean pass. Product part files can export literal `expectations`, keyed
by state, for expected emptiness, bounded spill, and specific axe violations.
Static derivation validates this data without executing source. Composition links
do not propagate exceptions. Take frames read declarations from their overlay.

An empty expectation passes only when both samples are empty. Visible content
fails that expectation. Spill exceptions name an exact measured element path,
one viewport edge, a positive maximum distance in CSS pixels, and a reason.
Accessibility exceptions name one axe rule, its exact target array, and a reason.
These targets are identities copied from observations, not broad selector filters.

Reports retain raw findings, accepted reasons and counts. Every unresolved node
and edge keeps its normal status. Unavailable evidence is inconclusive; incomplete
axe findings still need review. Unused declarations need review and removal.
Invalid declarations accept nothing. Changed declarations between samples are
inconclusive and accept nothing. Browser and render failures cannot be waived.
The UI, CLI, and agent consume the same report contract. Ordinary Replace and the
reviewed alternate gate keep their existing behavior. Baseline approval records
images, not exceptions.

Real React regression tests reproduced stale Empty warnings over delayed content
and an unresolved suspended root incorrectly reported as Empty. Frame readiness
now follows a React commit. DOM changes update the verdict and remove only the
empty warning. Root suspension reaches the watchdog. This does not infer product
readiness: an inner Suspense boundary that commits a null fallback is observable
empty content. The product still owns reproducible scenario inputs and behavior.

Costs: exact targets need maintenance; a narrow exception can still conceal a
real defect. Reasons do not prove WCAG compliance or scroll reachability. Check
renders now retain every spilling element, making some reports larger. The check
environment version changes to 2, requiring review of older baselines. Accepted
findings have a separate label and use the chrome's existing accent token rather
than the passing color. Existing expandable result rows remain, as in the inspected
[Klaviyo import history](https://mobbin.com/screens/7b815936-117a-4695-8a9b-429403b4c671).

## Implementation choices

| # | Decision | Why |
|---|---|---|
| 19 | Composed previews run product-owned scenarios. An optional literal `composition` export in a part maps its state exports to child `{ part, state }` references. Caliper reads and validates those links without executing source. It browses the links in both directions, including transitive parents, but never substitutes standalone child fixtures or changes parent inputs. The product owns deterministic fixture data and action behavior. | The user chose coherent page behavior over automatic visual substitution. An empty library can remove a shelf and change the whole page; inserting an empty shelf bypasses that behavior. Caliper cannot infer parent inputs from an arbitrary child render function. Cost: the product must author and test the links. Caliper validates references, not whether the rendered composition matches them, avoids every external dependency, or covers all possible states. |
| 20 | Takes belong to an editing part and state. Optional `context` records the declared composed scenario used to judge that subject. Navigation nests takes under their state; the planner, agent and default render distinguish subject from context. The render tool can check every subject state and its declared parent scenarios. Existing take records without context remain isolated. | The editing scope and viewing scope must be separate to work on a low-level component inside a page. State ownership organizes review; it does not isolate shared source edits to that state. Acceptance still replaces files. Removed subjects or context declarations block prompts and acceptance rather than silently changing the take's meaning. Declared related checks do not discover every affected consumer or prove interactions. |
| 21 | Caliper has a code pane, built from CodeMirror 6 packages with no wrapper. The chrome loads them from Caliper's own `node_modules` through an import map in the chrome page, one ES module per package, with no bundler. The project's Vite never sees them. The pane shows the files of the editing subject: the part file and every local module and stylesheet it imports, walked as the take sees them. Editing a real file saves it to the project after a pause in typing, or at once with Ctrl+S (`POST /__caliper/code/file`), as in any editor; Vite reloads the frames. The save overwrites only a file that exists inside the project, outside `node_modules`, `.git`, `.caliper` and environment files, and only from Caliper's own page. Editing a take's file saves to the take (`POST /__caliper/takes/<n>/file`); text equal to the real file removes the take's copy. A take's file shows as a diff against the real file, with a Revert button on each change and no per-change accept. While a take's agent works, the pane is read-only and follows the files the agent changes. The agent's next prompt names the files you edited by hand. The alternate review shows each changed file in the same read-only diff, with an Open in Code button. Changed 2026-09-27: the first version never wrote a real file. Your first edit of a real file started a take instead. You rejected that as not a normal editing experience. | You want code in Caliper with a high bar for product fit. CodeMirror is plain DOM (decision 10), needs no workers, and ships a first-party merge view. Monaco is several times larger and needs workers. The import map keeps real package versions in `bun.lock`, keeps TypeScript types for the chrome, and adds no build step or generated file. A real file behaves as it does in your own editor, so the pane adds no rule to learn. Takes still hold agent work, and Replace still copies a take over the real files (decision 12). Human and agent edits to a take share one take and one conversation. Costs: a real edit changes the project at once, with no review; undo in the pane and Git are the way back. The pane loads 19 unminified packages (1,379 KB, or 355 KB with gzip) the first time it opens. It caches them by version. Two versions of one CodeMirror package stop the pane, with a named error. There are no type errors, completion from the project's types, or per-change accept yet. |
| 22 | The chrome's layout is one pure function, `planLayout(width, height, open)` in `src/client/layout.js`, of the chrome's own box in rem. chrome.js writes its plan as data attributes on `.cal`, and chrome.css places the regions from them. The bar spans the chrome. The part list is a column or a drawer. The Takes panel is a column, a panel under the stage, or a tab. The code pane sits beside or under the stage, or is a tab. The stage keeps at least half the height under the bar, so at most one pane stacks under it. When the whole set of panes does not fit that way, Preview, Code and Takes become tabs that fill the work area, and the part list becomes a drawer. The tab decision assumes every pane is open, so opening a pane never flips the chrome into tabs. The bar fits itself with `fitBar`: one row, then the title on its own row, then Calibrate and then the devices move into a More menu. Decision 34 changes the regions this function places; until slice 0 is built, this row describes the code. | On a folded phone (about 412 × 660 px) the old container queries stacked the list, the stage, the code pane and the Takes panel. The device frame got 99 × 74 px, list rows were cut, the caption overflowed and the code pane sat below a hidden scroll. On an unfolded Fold (about 1030 × 572 px) the bar wrapped and the code pane showed only its tabs. The skill `intrinsic-design` asks for one tested policy of width and height, with every control at most one tap away. Shipped AI builders (Mimo, Claude, Gemini, AI Studio on Mobbin) switch preview and code with one segmented control, keep the prompt at the bottom of the chat, and span one toolbar over the panes. Costs: at small sizes you cannot see the preview while you type a prompt; you switch tabs. The thresholds are guesses, not measured on a desk. The plan uses the code pane's default share, not the share you dragged. CSS mirrors the plan's sizes by hand, so a change must touch both files. |
| 23 | A **knob** is a view of one declaration in a source CSS file. While you drag, Caliper changes that rule in each frame's live CSSOM. On release, Caliper writes the file and Vite's reload confirms it. Caliper never overrides a token from outside the rule that declares it. To place a live rule in the source, Caliper turns on `css.devSourcemap`, pairs the CSSOM with the served text by order and selector, and maps through the inline sourcemap; with no mapping, it refuses. To find which declaration wins for an element, Caliper puts a sentinel value into each candidate declaration and reads which elements change (knockout), so the browser runs the cascade. A `@container` threshold previews by deleting the rule and inserting it again. A `MutationObserver` on each `<style>` puts active live edits back after Vite reloads the sheet, and a knob finds its rule again by file and offset. Caliper never writes the file during a drag, only on release. Caliper supports only the latest Chromium, Firefox and Safari. Built for registered properties on 2026-09-28; see 27 for what the build changed. | The `spike/knobs` branch (`spike/knobs/FINDINGS.md`) tested this on all 52 Pico parts at two devices. Vite rewrites `url()` and inlines `@import`, so the served text is not the source; without a sourcemap, an inlined child rule paired silently with the wrong parent rule. With the map, 184 of 184 custom property declarations landed on the right source offset. Knockout agreed with the DevTools protocol on 135,424 of 135,424 (element, property) pairs. A static resolver refused 288, because no browser API evaluates `@container` from JavaScript. `conditionText` is read-only in Chromium; delete and insert changed layout in 17 of 17 rules in 0.1 ms or less. Vite sets the text of the same `<style>`, so an unrelated save during a drag lost the live edit in 19 of 20 frames; the observer lost 0. Legacy's inline override and its Pico `--pico-bg: inherit` hack are not needed. Costs: `devSourcemap` makes served CSS larger; knockout costs about 1.7 ms per declaration with 40 elements; only custom properties were tested, only in Chromium at first. A follow-up spike repeated it in Firefox 144 and WebKit 26 (Playwright builds, not Safari): pairing, `@container` and the observer gave the same results; knockout agreed on 135,424 pairs in Firefox and 135,374 in WebKit, whose 50 misses were all the computed `--pico-px` and returned no winner, never a wrong one (a knob should refuse when no winner is found but the value differs from `initial-value`). Writing the file on each of 60 drag steps 16 ms apart left every frame on an older value after release in 7 of 12 runs, across all three browsers; Vite applied only 12 to 17 updates, and the cause (Vite's watcher or Caliper's `hotUpdate`) is not found. Live edits showed the final value in 12 of 12 runs, at 11 to 20 ms p50 with 12 frames in Chromium and Firefox. With 12 frames, headless WebKit took 73 to 75 ms p50 even live. `@property` `initial-value` edits live by delete and insert. Not yet tested: Safari itself, standard properties for promoting a literal, two writers on one file (the code pane has no version check either), which declarations a part's `var()` reads, and `@layer`, nesting, CSS modules, Tailwind and Sass. |
| 24 | Caliper sends the `change` events that Vite's watcher drops. Vite 6 bundles chokidar 3, which throttles `change` per file for 50 ms and discards a save inside that window without sending it later. `src/late-changes.js` listens to chokidar's unthrottled `raw` events. After a raw event within 100 ms of a `change`, it waits 70 ms after the file goes quiet, compares the file's mtime and size with what it saw at the last `change`, and emits `change` on the watcher when they differ. It covers every writer: an agent, the code pane, Replace, a knob and the user's own editor. | Found by the knob spike (decision 23). With plain Vite 6.4.2, two saves 20 ms apart left the page on the first save in 20 of 20 trials, including after a full page reload, because Vite had cached the first version. Saves 70 ms apart passed 20 of 20. Rename saves, as editors make them, failed the same way. Vite 8.3.1 still lists `chokidar ^3.6.0` (not run). An agent's two edits to one file in one turn, and format-on-save, are ordinary ways to hit it. With the fix: 20 of 20 two-save trials, 10 of 10 sixty-save trials and 20 of 20 rename trials showed the last save, and a single save still sends one update. `test/late-changes.test.js` and `scripts/verify-fast-saves.mjs` check it. Rejected: a second `change` from each Caliper writer (misses the user's editor), and polling or `awaitWriteFinish` (slower for every save, and project config against decision 2). Costs: it depends on chokidar's `raw` event and its `watchedPath` detail, which are not a documented Vite API, so a Vite upgrade can break it silently; the test would catch that. A dropped save still reaches the page about 70 ms late. Tested on Linux only. Not yet reported to Vite. |
| 25 | The take agent uses **Agent Skills** (agentskills.io), loaded progressively as the spec's client guide describes. `src/agent/skills.js` finds `SKILL.md` folders in `.agents/skills/` of the project and each parent up to the Git root, then in the folders `agent.skills` lists, then in `~/.agents/skills/`; the first skill with a name wins, and a hidden duplicate is reported. It parses front matter with `yaml`, leniently: a missing description skips the skill, cosmetic faults only warn. The system prompt lists names and descriptions; `activate_skill` (names as an enum) returns the body without front matter, wrapped in `<skill_content>` with the folder's files listed, once per conversation; `read_skill_file` reads inside that one folder. `/name` in a prompt loads a skill directly, including one with `disable-model-invocation: true`. The planner sees the catalog. `TakesSnapshot.skills` shows skills and problems in the Takes panel. `agent.skills: false` turns skills off. `agent.skills: { folders, include, exclude }` adds folders and chooses skills by name; a filtered skill leaves the catalog and cannot load through `/name`, and an unknown name is a reported problem. `~/.pi/agent/skills/` and `.claude/skills/` load only when listed. | The user asked for skills that follow the standard, so skills written for pi or Claude Code work in takes. Progressive loading keeps a take that needs no skill at about 100 tokens per skill, not the full text. `.agents/skills/` is the spec's cross-client folder, and project scope first matches its precedence rule. Other clients' own folders stay opt-in: they hold skills that expect a shell, which the take agent does not have, and a home-folder skill makes takes differ between machines. A dedicated tool, not `read_file`, reaches skills outside the project without widening the project fence. Filters by name exist because a home folder of general coding skills (36 on the first real machine) costs about 2,000 tokens per take and offers skills that a take cannot use. Costs: the catalog costs tokens on every take unless `include` limits it; activation depends on the model matching the description; skills that name missing tools can confuse the model; there is no trust prompt, so a cloned project's skills load as its `vite.config` already runs; conversations are not compacted, so skill content is never pruned but also never limited. |
| 26 | Caliper **discovers knobs from the CSS itself**, and hints fill the gaps. Four kinds, all edited by the model of decision 23: a registered `@property` whose winning declaration is not set in `@keyframes` and is not a `calc`, `min`, `max` or `clamp`; a declaration whose value is `var()` of a sibling token, shown as a picker over those tokens, never as a raw value; a length in a `@container` condition; and a plain `--x: value` that the selected part reads. The control comes from the registered `syntax`: a length or number scrubs with no range and takes a typed value, an ident union is a select, a colour is a colour field. A **hint** is a doc comment directly above the declaration, for example `/** @label Pixel rows @min 180 @max 720 @step 10 */` or `/** @knob ignore */`. Caliper reads hints from the source text, because the CSSOM drops comments. `caliper({ knobs })` in `vite.config` can give the same hints, for CSS that a project cannot annotate. Promoting a literal puts the new token beside its sibling tokens, and you confirm the selector and name before the write. In a take's frame, a knob edits the take's copy of the file; everywhere else it edits the real file. Agreed 2026-09-28. Slice 1 (registered properties, token picker, hints) is built; see 27. Slice 2 (`@container` thresholds) is built; see 28. Slice 3 (plain custom properties) is built; see 29. Slice 4 (promoting a literal) is built; see 30. | You want knobs that the design itself exposes, with no Caliper artifact required, and you accept filling gaps by hand. Legacy made registration the opt-in, but Pico registers 6 properties and 2 of them are outputs (`--pico-px` from `max()`, `--pico-cycle` from `@keyframes`), so registration alone is not intent. Standard CSS has no min, max, step or label, so hints exist. A comment next to the declaration moves with it through renames and edits by an agent; a config list drifts silently. Take-scoped knobs match the code pane (decision 21): tuning a take does not change the project until Replace. Costs: the comment convention is Caliper's own, not a standard. Scrubbing with no range has no rail to show where a value sits. The skip rules can still show an internal value or hide a real input; the hint corrects it. Not yet tested: finding which declarations a part's `var()` chains read (knockout shows where a value reaches, not that it is used), knockout for standard properties, which literal promotion needs, and two writers on one file. |
| 27 | Knobs slice 1: registered properties. The **Knobs panel** shares the region `planLayout` places for the Takes panel; the bar's Takes and Knobs buttons switch it, and `planLayout` does not change. With tabs, the Knobs view keeps the preview and puts the knobs under it. The chrome reads each frame's CSSOM itself, since frames share its origin. **Discovery** runs over every rendered frame of the variant: a registered property that no `@keyframes` sets; knockout on up to 60 elements inside `#caliper-host`. Its `@property` `initial-value` is the knob only when no style rule sets it on the part; a value that no found declaration explains is refused. An output is a value built with any CSS math function (`calc`, `min`, `max`, `clamp`, `round` and the rest). A value that uses `var()` other than as one whole reference is refused. Only a doc comment (`/**`) holds hints; the prose of the comment above `@property` becomes the knob's note. **Locating** (`POST /__caliper/knobs/locate`) pairs the chrome's CSSOM summary with the served text and maps through the sourcemap. Its `sourcesContent` is the text the map describes, so the knob's version is that text's hash, and a file that changed after the frame loaded it is refused until the frame reloads. Knobs inside nested CSS, `@layer`, `@scope` and `@starting-style` are refused, as untested. **Writing** (`POST /__caliper/knobs/write`) names the version, the value's offsets and its text; any change to the file since then is a 409 and no write. A take's write is an edit by hand, so the agent's next prompt names the file. A take's flattened global stylesheet now blanks each local `@import` to a comment of the same length, not a longer one, so its offsets are the file's. After a reload, a live value goes back into its rule by sheet, CSSOM path and selector; decision 23 said by file and offset, which the next discovery still does. The code pane keeps saving with no version check. Under decision 34 the Takes panel goes away, and Knobs share the side panel with a take's record instead. | Checked by `scripts/verify-knobs.mjs` (8 checks in Chromium: discovery and refusals, one write on release, the token picker, a take's copy, a save during a drag, five sizes) and `scripts/verify-knobs-product.mjs` on a copy of Pico: on `PicoButton` and on all 8 states of `PicoLibrary`, 4 knobs (Pixel rows, Pixel min, Bg, Accent) and 2 refusals (`--pico-px` from `max()`, `--pico-cycle` from `@keyframes`); a drag changed all 8 frames and wrote the file once, on release; the panel was ready 1.2 to 1.7 s after the page opened. A fifth region would change the tab decision, which assumes every pane is open, and move sizes that dock today into tabs; Takes and Knobs both act on the variant the code pane shows. A knob is judged by the frame while you drag, so a Knobs tab that hides the preview would be useless. In the check's fixture, Caliper's wrapper kept the initial value outside the theme rule, and counting it made a second "Bg" knob. Putting a live value back by path needs no server trip per stylesheet change, and the write's precondition stops a stale location from writing. The code pane's promise to save over an outside change stays until its own conflict design exists; a pane save during a drag makes the knob's release refuse. Costs: Takes and Knobs never show at once. With tabs, the stage gives up to 45% of its height. While the panel is open, every stylesheet change runs discovery again, 150 ms after the last one. Only Chromium ran the panel; Firefox and Safari did not. Until the next discovery, a live value can go into another rule with the same selector at the same path. A code pane save can still overwrite a knob's write. `css.devSourcemap` is now on for every project, so served CSS is larger. |
| 28 | Knobs slice 2: `@container` thresholds. A `@container` rule **applies to the part** when a style rule inside it matches an element in `#caliper-host`, with pseudo-elements and user-action states (`:hover`, `:focus` and the like) left out of the match, whether the condition holds now or not. Each length in a size feature of its condition is one knob: the `min-width: 400px` form, the `width < 45em` form, and each side of `30em < width < 60em`; not a length in `style()` or `scroll-state()`, a ratio, or a unitless zero. **Locating** takes the target `@container`: the served at-rule maps through the sourcemap to the source at-rule, and the knob gets its condition as written, from after `@container` to `{`. A **write** replaces only the threshold's length, with the version check of 27. The **live edit** deletes the rule and inserts it again with the source condition, every live threshold of that rule in it, and the rule's body as the browser holds it. A live edit replaces the rule only when its condition is the one the frame loaded or one a live edit inserted; a condition is compared as the browser writes it, parsed in a sheet of its own. A hint goes above the `@container` rule and applies to each threshold in it; a threshold scrubs from 0 with no top unless `@min` or `@max` says otherwise. The label is the container's name without its prefix, the feature and the comparison, for example "Stage width <". | Decision 26 lists a length in a `@container` condition as a knob, and the spike (decision 23, U3) showed delete and insert in 17 of 17 Pico rules. Knockout does not apply: a threshold is not a value that reaches an element. A rule that matches no element of the part changes nothing you can see, so it is not a knob; a rule whose condition is false now still is, because moving its threshold is how you make it hold. The file keeps its own spelling of the condition, since the write changes only the length. Checked by `scripts/verify-knobs.mjs` (a 300 px stage with `width < 280px`: a drag to 310px changed the frame live, wrote only the length once, and left one rule per condition; a rule for an element that is not on the stage gave no knob) and `scripts/verify-knobs-product.mjs` on a copy of Pico: `PicoGameStage` gave 7 threshold knobs from 4 rules in 2 files, and `PicoLibrary` 7 from 5 rules in 3 files, with no refusal; a threshold drag changed the frame's rule and wrote one length on release. Costs: a rule used only under `:hover` or through a pseudo-element counts only when another selector in it matches. Several rules can share a label, and the row under the label names the condition and the file. Two thresholds of one rule compose in the live edit, which no browser check covers. `caliper({ knobs })` gives no hints to a threshold, because it is keyed by custom property. Only Chromium ran it. |
| 29 | Knobs slice 3: plain custom properties. A **plain** property is one that style rules declare and no `@property` registers. The part **reads** a plain declaration when a test value in it changes one of its **readers** on any element in `#caliper-host`, the host included, or on a `::before` or `::after` that renders. The readers are the standard longhands that name the property in a `var()`, directly or through other custom properties, found in style rules, `@keyframes` frames and the part's inline styles; a shorthand's longhands come from the browser (`setProperty(name, "inherit")` on a probe). Two test values: one typed from the value (`rgb(1, 2, 3)`, `4321px`, `4321`), when it has a type, then `caliper-knockout`, which makes every reader invalid at computed-value time. A declaration of `var()` takes its type from the value the host sees. A plain declaration the part does not read is not shown at all. The control comes from the value: `syntaxOfValue` gives `<length>`, `<number>`, `<percentage>` or `<color>`, and then decision 26's rules apply (a math function is an output, `var()` of one token is the picker). Locating, writing, the live edit and hints are those of a registered property's declaration. | The spike on branch `spike/knob-reads` (`spike/FINDINGS.md`, part 1) answered decision 26's open question on Pico, 52 parts at RG353M, against a ground truth that reads every standard property of every element whose value of the property changes: this method agreed on 4,760 of 4,760 (frame, declaration) pairs, 1,195 of them reads. Reach, which slice 1 uses for registered properties, named 2,820 declarations that change nothing, mostly palette and role tokens. The same readers on 60 sampled elements missed 109 reads, such as the carts with `data-shell="4"`, so every element is tested. Without `@keyframes` frames in the graph, 2 reads through `pico-cycle` were missed. One typed value alone missed 1 more than both. On a copy of Pico, `PicoGameStage` shows 19 plain knobs (9 palette colours and 10 token references), and 16 plain properties under not knobs (15 outputs and one font list with no control); a drag of `--pico-key-ratio` on `PicoLibrary` changed the frame's rule and wrote once on release. Costs: in the spike, testing every plain declaration took 39 ms per frame p50 and 667 ms at most, on a page with 282 elements; the Knobs panel on `PicoLibrary` became ready 2.1 s after the page opened, not 1.3 s. A property that only a state not on the stage reads does not show. The palette shows as separate colour knobs beside the role tokens that point at it, so a page can list many knobs. Only Chromium ran it. |
| 30 | Knobs slice 4: promoting a literal to a token. A **literal** is a standard declaration whose value is one length, percentage, number or colour, with no `var()` and no math function (`literalType`); a `0` is a length when the property takes one. The **Literals** section of the Knobs panel looks for them only while it is open. A literal **wins** on the part when a test value of its type (`literalSentinels`, the first that `CSS.supports` accepts) changes a longhand on an element of the part **that its rule matches**; every element of the part is tested. A **home** is a top-level style rule that declares custom properties and whose selector matches each element the literal wins on, or an ancestor of each (`tokenHomes`), most custom properties first; its **anchor** is its last custom property, located as any declaration. The form suggests a name (`suggestTokenName`: the first home's namespace, the rule's last class without it, the property), lets you change the name and the home, and says both edits before Caliper makes them. `POST /__caliper/knobs/promote { take, name, literal, home }` checks the version and text of both spans, refuses a name the home's file already declares, then adds `name: literal;` on a new line after the anchor, with the anchor's indent, and puts `var(name)` where the literal was; both edits in one file are made together, and neither file changes on a conflict. The chrome refuses a name that any frame declares or registers. The new token is then a plain knob (29). In a take's frame both edits go to the take's copies. | Decision 26 asked for a spike on knockout for standard properties first. The spike on branch `spike/knob-reads` (`spike/FINDINGS.md`, part 2) compared knockout with the DevTools protocol on Pico, 104 frames, 9,067 (element, longhand) pairs: plain knockout named 1,571 wrong declarations, because `getComputedStyle` gives used values and a parent's `width: 100%` changes its children's widths; keeping only the rules that match the element gave 0 wrong. Its 3,538 misses were declarations whose change shows nothing at that size, 3,536 of them `border: 0` with no border style, so a literal knockout cannot see is not offered. `computedStyleMap()` found more, but Firefox lacks it. Rules inside `@media` or `@container` are not homes, because the token would vanish when the condition fails. The CSSOM writes `0` as `0px`, so the source's text is the literal and locating checks it against the served CSS. Checked by `scripts/verify-knobs.mjs` (a literal made a token in another file after a refused taken name, both files as expected, the part the same, and a plain knob for the token) and `test/knobs-api.test.js` (two files, one file, a taken name, a changed file, a take), and on a copy of Pico with `scripts/verify-knobs-product.mjs`: `PicoGameStage` listed 10 literals and `PicoLibrary` 38, found 129 and 269 ms after the section opened; making `line-height: 1.5` a token kept the value of all 22 and all 282 elements. Costs: a literal in a `::before` or `::after` rule, in a shorthand with more than one value, or that shows nothing at this size is not listed. A shorthand that the CSSOM writes as one declaration but the source as several should be refused when located (inferred from the locate code; Pico showed none). The suggested name can read oddly (`--p8-stage-width` beside palette tokens); you confirm it. Caliper does not check the part after the edits; it offers only homes that reach the literal's elements, and a home's rule can still be overridden where the token is read. Only Chromium ran it. |
| 31 | Caliper's install manifest and icons live under the plugin's `/__caliper/` route, including any Vite base. The manifest uses that path for its start URL and scope, not the product origin root. The chrome restores the legacy fullscreen display fallback, home-screen icons, metadata and safe-area padding. There is no service worker or offline cache. | The user chose a Caliper-only install on 2026-09-28. The plugin runs inside a product's Vite server (decision 1), so a root-scoped manifest or assets in the product's `public/` would claim or overwrite product routes. Relative manifest URLs follow the Vite base. This installs only from a secure context, such as loopback or HTTPS. The dev server must be running for the installed app to work; it does not provide offline use. Legacy never registered a service worker. |
| 32 | A take prompt can carry **images**, and only images: PNG, JPEG, WebP or GIF, at most 4 per prompt and 5 MB each. One policy module, `src/client/images.js`, holds the types and limits for the chrome and the server; the server also checks each image's leading bytes against its type (`src/agent/images.js`). You attach by picker, paste or drop. The images reach the planner, every take a plan starts, and the agent's first message and follow-ups, after the part's source and render, with one text line that names them as reference material, not the render. The take store keeps them in `.caliper/takes/<n>.images/`, beside the take folder, with their names and types in the take record; a new take's record never inherits another's images. The take log's `User` entry names the files its prompt carried, and `GET /__caliper/takes/<n>/images/<file>` serves them with `no-store`. After a restart, the new conversation's first message carries every earlier image of the take. Prompt endpoints accept a larger JSON body (`MAX_IMAGES_BODY`); writes stay same-origin JSON POSTs. | The user chose images only on 2026-09-28, as gap 5 ("better inputs") of the review of Katie Dill's talk: specific source material keeps the agent away from the most probable answer. The model and planner already took image content from renders, so this needed no new model path. Links need server-side fetching, and Mobbin pages need a login; text files are not needed yet. Images outside the take folder cannot reach the project through Replace, and `.caliper/` is already ignored by Git. Take numbers are reused after a discard, so the image route must not be cached. Costs: every image is sent once per take, so a four-take plan with four images sends 16 image inputs plus 4 to the planner; JSON base64 adds a third to the upload; images are not removed from a take one by one. The alternate-integration take starts with no images. |
| 33 | **Protect the strange.** When you ask for 3 or more takes, the planner makes one direction the **strange direction** and marks it `strange: true`. It is a real answer to the prompt that breaks the part's current pattern on purpose: a different structure, a different way to show the data, or a different interaction. It uses one of the N takes, not an extra one. The planner may leave it out for a request with one sensible answer, and then says why in `note`. With 2 takes, the tool schema has no `strange` field and the prompt does not mention it. `cleanPlan` keeps at most one mark, and the note only when it explains something missing. The Review step shows the strange direction with a dashed border and a one-line explanation, and you can remove it there. Its take card says "strange", and its agent is told not to drift back to the usual pattern. | The user chose this on 2026-09-28, from Katie Dill's talk "How to scale intent, quality, and artistry with AI": a model gives the most probable answer, so a board of takes tends to show one pattern three ways. Decision 16 already forces the directions apart, but each still has to be "reasonable", which favours the usual pattern. A strange direction costs no extra model call and no extra take. Verified live on Pico Home with "I need to see more variation on the games", under Node: 3 takes planned in 14 s into a wider fixture catalog, distinct cart art, and a strange "Shelves by platform" that replaces the single row with stacked shelves and cart silhouettes by format; 2 takes planned in 7 s with no strange direction. Rejected: an extra take on top of N, which costs one more agent for every prompt; a switch in the Takes panel, which adds a control and gets used less. Cost: with 3 takes, you get one fewer ordinary direction. Without a written point of view for the product, "the current pattern" is only what the planner sees in the part's source and screenshot. |
| 34 | The chrome's visual direction is **Darkroom**, drawn in `docs/design/mockups/` (seventh pass, `d60973f`). Built for phases 1 to 3 on 2026-09-30 (`b19e815`): the shell, Checks, Knobs, Code, Calibrate, takes on the canvas, the composer bar and New take menu, plan slots and the take record. Take markup (decision 35) is not built. The room is dark, or a pale lightbox in light mode, and the part is the only colour on screen. There is no accent hue: selection, focus and the live knob use ink. Panels are opaque cards with one edge and no blur, one `--gutter` from the room's edge and from each other. Tools sit on a rail at the left on a desk and in a dock at the bottom on a phone. The part's name sits above its frame, and under the frame is one line in the dimmest ink: the devices as the switch, the width, and "True size". **Takes are on the canvas, not in a panel**: the real files, then each chain of takes, in one CSS grid where every frame is one column and one gap apart. A bar under the canvas holds the composer, the focused take's Accept and Discard, the draft and Send. New take is a split button; its menu holds the take count, Send to take N, and the agent's model and skills. A plan's directions (16, 33) wait on the canvas in the slots their takes will fill. The side panel holds Knobs or a take's record: its log, direction, Review alternate and Stop. Checks list failures first and fold the passes into one line. For `planLayout` (22): `takes` stops being a place; a new `side` place (column, sheet or closed) holds Knobs or a take's record; the bar becomes a rail on a desk and a dock on a phone; tabs give way to the dock and to sheets no taller than half the height, so the stage keeps its share; the composer bar is a new region under the canvas. | The user reviewed six passes on 2026-09-29 and marked each one. "The items around a take feel like noise" and "I need to see takes together to comment on what I like" moved takes out of the panel onto the canvas. "Not keen on the yellow" removed the accent hue. "The gutters must be the same" gave one gutter token. "Too tight, creates tension" gave one gap for pairs and chains. An audit of `src/client/chrome.js` in the seventh pass found six things the Takes panel held that the canvas had no place for (see the mockup README); each now has one, so nothing becomes unreachable. Checked by rendering 15 states at 1600 × 1000, 1000 × 680 and 416 × 640, light and dark, and by `docs/design/mockups/widths.mjs`, which found no box wider than its parent in the bar or a take's record. Costs: the restyle touches `chrome.css` (2,292 lines), `planLayout`'s output type and `test/layout.test.js`. The canvas needs room: at 1600 px a fourth RG353M take wraps. With no hue, "selected" and "live" are both ink rings; the live knob adds a halo. The mockup uses a 16 px rem and the chrome 15 px, so its thresholds are not the chrome's. Not drawn: a running take, Stop, an agent that failed to load. Open: on the phone dock, Preview and Takes both read as pressed. |
| 35 | **Take markup looks as drawn** in `docs/design/mockups/`, states `takes`, `mark`, `draft` and `agent`, for the behaviour in `docs/plans/take-markup.md`. Not built. Mark mode is a pin button at the left of the bar, filled when on; every frame gets a dashed ink edge 4 px outside it and a crosshair, and a line above the canvas says how to leave. A click makes a teardrop pin with its letter, and a drag makes a 2 px box with the letter on a tab at its top-left corner. Both are two-tone: white, a dark ring and a dark letter. The note editor is a card under the marked frame with the mark's name and one line; you point at a mark by typing its name and picking from a list that shows a crop of each. A lost mark is a hollow dashed pin, and the draft shows "element not found" with Re-place. The draft unfolds above the bar as the marked takes in a row, each with its marks drawn on and its notes under it, and what Send does for it beside its name. Send carries the count, for example "Send · 2 new takes". A chain's head reads "6 ← from 1 (4 discarded)" and folds its history behind "3 in chain"; the parent sits at 78 % opacity beside the newest take; "made before take N was accepted" is in the warn colour. The pair falls back to the newest take only when the canvas cannot hold two frames and a gap at true size, per device, with the parent one tap away. The agent gets the parent's screenshot with the same two-tone pins. | The plan asked for nine surfaces and gets one state or element for each. Ink pins vanish on a black part such as Pico's, and white ones on a white part; two-tone reads on both and keeps decision 34's no-hue rule. A row of chips for every mark in the draft becomes a wall at 20 marks; type-ahead stays one line. The fallback rule is written from the canvas width because the ODIN 2 PORTAL needs 1,248 px for one pair and the RG353M needs about 600. Costs: letters past Z are not defined. The note editor covers part of the band under it while open. On the unfolded Fold the draft row scrolls sideways, and the cut-off take is the only cue. Alt-click (plan decision 9) has no drawing; it makes the same pin. The fallback is not drawn for the ODIN 2 PORTAL. |
| 36 | The chrome becomes React with its own bundled React and React DOM. Product frames retain the consumer's React. A pinned tool copy inspects and edits a separate subject checkout. See the section below and `docs/plans/react-chrome.md`. Built on 2026-09-30: `09106cf` (state, actions, delivery, tool), `b19e815` (the Darkroom renderer served), `fdcdbc8` (frames wait for the first dependency bundle). The tool is pinned to `0fa0cdb`. | The user chose "chrome become React" and self-editing. The frame loader renders React parts, so retaining plain DOM would require a second rewrite. Costs: a build step, explicit tool updates and new isolation/integration gates. |

## 36. React chrome with an isolated tool copy

Approved by the user on 2026-09-29: "chrome become React". The user also requires
that Caliper can edit its own design. The current frame loader renders React
parts, while the chrome uses plain DOM and global state. A restyle followed by
self-editing support would rewrite the chrome twice. This is new evidence for
replacing decision 10, not for weakening isolation in decision 6.

The chrome becomes React with its own bundled React and React DOM. The
consumer's Vite must not resolve those imports. Product frames keep using the
consumer's React. Runtime verification must establish independent copies,
including a consumer on another React major. Comparing version strings alone
does not establish isolation. CodeMirror keeps using Caliper-owned dependencies,
with its appearance owned by the UI implementation.

A pinned tool copy loads the subject checkout. Accept can change or break the
subject, but cannot replace the tool used to inspect and recover it. Updating
the pinned tool is an explicit build/deploy action. Chrome regions become
product-owned `*.part.tsx` files with local inputs and real action behavior,
under decisions 5, 13 and 18. Shared source edits still affect other scenarios.

The first run covers React/self-hosting, the Darkroom shell and takes on the
canvas. Marks, Send/chains and references follow in a second run, after the tool
can edit its subject. `docs/plans/react-chrome.md` defines the phases, ownership,
contract and acceptance gates. It extends the slice order in the take-markup
plan without adding markup behavior to slice 0.

Step 0 establishes `src/client/ui/contract.ts`, stable `data-cal` hooks, an
unstyled reference renderer, dependencies and JSX typechecking. It does not
switch the served chrome to React. UI reads an immutable `ChromeView` and calls
stable `ChromeActions`; app wiring owns I/O, state conversion and action guards.
The two agents freeze the contract while working in separate worktrees. Opus
owns appearance and layout. Sol owns state, effects, build and serving.

Costs: React adds a dependency and a build step. A pinned tool requires explicit
updates. The contract needs an inventory of current behavior. Reference-renderer
checks do not prove the final layout or live-server behavior. Integration must
exercise both implementations together before deployment. Step 0 is built;
the React migration, self-hosting and Darkroom remain unbuilt.
