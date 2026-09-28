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
| 10 | Caliper's chrome is plain DOM with no framework. | It must not share React, or anything else, with the project. |
| 11 | No request interception and no fetch swapping. A part supplies its own data. | Legacy rule D8, kept. |
| 12 | The goal after the viewer is fast AI iteration. A **take** is one version of a component that an agent proposes. A take is a folder of edited copies of project files, at the same relative paths. One Vite server shows the real part and every take, each in its own frame. A frame opened for a take tags each project module it imports. Caliper serves the take's copy of a file when one exists, and the real file when not. In a take frame, Caliper loads each local stylesheet that the global CSS `@import`s as its own module. Accept copies the take's files over the real files. | You rejected one Vite server per take as too heavy. The `spike/takes` branch (`spike/FINDINGS.md`) tested this on Pico: the take shows its CSS and TSX edits, React stays single, a save updates only the frames it affects, and each extra take adds about 100 ms to a page part's load. Vite inlines `@import` from disk and skips plugin `load`, so the take tag cannot pass through it. Not yet tested: Tailwind, Sass and Less, and where take folders live. |
| 13 | A part file can hold more than one **state**. The default export is the state `default`. Each other exported component whose name starts with an upper-case letter is a named state, for example `export const NoResults = () => ...`. Caliper reads the states from the source without running it, and makes the label from the export name: `NoResults` shows as "No results". | The states and takes need one format that stays in product files, with no adapter. The rule matches React's naming rule for components and Storybook's named exports, so a helper or a `name` string is never a state. The cost: an exported upper-case component that is not a state shows in the list. |
| 14 | An agent sees its work through `caliper-render`, a CLI with a skill file. It reads the project's running dev server, renders the frame page in a headless Chromium at the device's CSS viewport, and prints JSON: the frame's verdict, its problems, uncaught browser errors, and any element that reaches past the screen. It writes one PNG per state and device. | The agent loop needs the agent to see the result without you. `docs/research/agent-render.md` compares Storybook MCP, Storycap, Playwright CLI and Chrome DevTools MCP. Microsoft recommends a CLI plus a skill for coding agents, because it costs fewer tokens than MCP. The render code is separate from the CLI, so an MCP tool can use it later. The CLI reads the server, and copies no project config, so the drift that decision 1 prevents cannot happen. |
| 15 | The agent that makes takes runs **inside the Vite dev server**, on `@earendil-works/pi-agent-core` (the loop) and `@earendil-works/pi-ai` (model calls). One agent per take, many at once, in one process. `caliper({ agent: { model, baseUrl, reasoning, api, apiKeyEnv } })` configures it in `vite.config`; `reasoning` goes to the model on every request. The key comes only from an environment variable (default `CALIPER_AGENT_API_KEY`, from the shell or `.env` files), never from `vite.config`. `~/.pi/agent/cliproxyapi.json` is an optional fallback for the base URL and key, and its key goes only to its own base URL. The agent has five tools: `read_file`, `list_files`, `edit_file`, `write_file` and `render`. Writes land only in its take; `render` returns the verdict and the PNGs to the model. The chrome drives takes through `POST /__caliper/takes` and hears about them on the event stream. The key never reaches the browser. | You want the main interaction inside Caliper, through your CLIProxyAPI. Running pi as a subprocess (legacy's way) needs the `pi` binary and pi set up for every user, loads your whole agent setup per take, and gives the agent `bash` and `edit` everywhere, so it needed an extension to fence it. The pi SDK in-process pulls in pi's terminal UI and probably its stored settings. The engine packages need neither: another user needs only an OpenAI-compatible endpoint and a key. Costs: `pi-ai` is pre-1.0 (pinned at 0.87.1) and pulls the Anthropic, OpenAI, Google and AWS SDKs; no pi skills, `AGENTS.md`, saved sessions or failover; a take's conversation ends when Vite stops. Verified on Pico through the proxy with `claude-opus-5-5`: a take takes 26 to 31 s. |
| 16 | Several takes from one prompt start from a **plan**. One planner call (`POST /__caliper/takes/plan`) sees the prompt, the part's source and how it renders, and proposes up to N directions through a `propose_directions` tool call, or fewer with a reason. You edit the directions in the Takes panel, then one agent per direction starts in parallel. Each agent's first message carries its direction and the titles of its siblings'. One take still starts at once, without a plan. | Three agents given the same prompt and context made nearly the same take: same files read, same sample art, same choices. One agent making every take in turn would force variety, but runs the takes one after another and grows one context with every screenshot. The plan keeps one agent per take folder, so the write fence is unchanged, and keeps the takes parallel. Verified on Pico's Home with "I need to see more variation on the games": planned in 10 s into realistic data, edge-case data and a cart component change; the three takes came out clearly different. Cost: one extra model call per multi-take prompt, and a review step. |
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

## Implementation choices

| # | Decision | Why |
|---|---|---|
| 19 | Composed previews run product-owned scenarios. An optional literal `composition` export in a part maps its state exports to child `{ part, state }` references. Caliper reads and validates those links without executing source. It browses the links in both directions, including transitive parents, but never substitutes standalone child fixtures or changes parent inputs. The product owns deterministic fixture data and action behavior. | The user chose coherent page behavior over automatic visual substitution. An empty library can remove a shelf and change the whole page; inserting an empty shelf bypasses that behavior. Caliper cannot infer parent inputs from an arbitrary child render function. Cost: the product must author and test the links. Caliper validates references, not whether the rendered composition matches them, avoids every external dependency, or covers all possible states. |
| 20 | Takes belong to an editing part and state. Optional `context` records the declared composed scenario used to judge that subject. Navigation nests takes under their state; the planner, agent and default render distinguish subject from context. The render tool can check every subject state and its declared parent scenarios. Existing take records without context remain isolated. | The editing scope and viewing scope must be separate to work on a low-level component inside a page. State ownership organizes review; it does not isolate shared source edits to that state. Acceptance still replaces files. Removed subjects or context declarations block prompts and acceptance rather than silently changing the take's meaning. Declared related checks do not discover every affected consumer or prove interactions. |
| 21 | Caliper has a code pane, built from CodeMirror 6 packages with no wrapper. The chrome loads them from Caliper's own `node_modules` through an import map in the chrome page, one ES module per package, with no bundler. The project's Vite never sees them. The pane shows the files of the editing subject: the part file and every local module and stylesheet it imports, walked as the take sees them. Editing a real file saves it to the project after a pause in typing, or at once with Ctrl+S (`POST /__caliper/code/file`), as in any editor; Vite reloads the frames. The save overwrites only a file that exists inside the project, outside `node_modules`, `.git`, `.caliper` and environment files, and only from Caliper's own page. Editing a take's file saves to the take (`POST /__caliper/takes/<n>/file`); text equal to the real file removes the take's copy. A take's file shows as a diff against the real file, with a Revert button on each change and no per-change accept. While a take's agent works, the pane is read-only and follows the files the agent changes. The agent's next prompt names the files you edited by hand. The alternate review shows each changed file in the same read-only diff, with an Open in Code button. Changed 2026-09-27: the first version never wrote a real file. Your first edit of a real file started a take instead. You rejected that as not a normal editing experience. | You want code in Caliper with a high bar for product fit. CodeMirror is plain DOM (decision 10), needs no workers, and ships a first-party merge view. Monaco is several times larger and needs workers. The import map keeps real package versions in `bun.lock`, keeps TypeScript types for the chrome, and adds no build step or generated file. A real file behaves as it does in your own editor, so the pane adds no rule to learn. Takes still hold agent work, and Replace still copies a take over the real files (decision 12). Human and agent edits to a take share one take and one conversation. Costs: a real edit changes the project at once, with no review; undo in the pane and Git are the way back. The pane loads 19 unminified packages (1,379 KB, or 355 KB with gzip) the first time it opens. It caches them by version. Two versions of one CodeMirror package stop the pane, with a named error. There are no type errors, completion from the project's types, or per-change accept yet. |
| 22 | The chrome's layout is one pure function, `planLayout(width, height, open)` in `src/client/layout.js`, of the chrome's own box in rem. chrome.js writes its plan as data attributes on `.cal`, and chrome.css places the regions from them. The bar spans the chrome. The part list is a column or a drawer. The Takes panel is a column, a panel under the stage, or a tab. The code pane sits beside or under the stage, or is a tab. The stage keeps at least half the height under the bar, so at most one pane stacks under it. When the whole set of panes does not fit that way, Preview, Code and Takes become tabs that fill the work area, and the part list becomes a drawer. The tab decision assumes every pane is open, so opening a pane never flips the chrome into tabs. The bar fits itself with `fitBar`: one row, then the title on its own row, then Calibrate and then the devices move into a More menu. | On a folded phone (about 412 × 660 px) the old container queries stacked the list, the stage, the code pane and the Takes panel. The device frame got 99 × 74 px, list rows were cut, the caption overflowed and the code pane sat below a hidden scroll. On an unfolded Fold (about 1030 × 572 px) the bar wrapped and the code pane showed only its tabs. The skill `intrinsic-design` asks for one tested policy of width and height, with every control at most one tap away. Shipped AI builders (Mimo, Claude, Gemini, AI Studio on Mobbin) switch preview and code with one segmented control, keep the prompt at the bottom of the chat, and span one toolbar over the panes. Costs: at small sizes you cannot see the preview while you type a prompt; you switch tabs. The thresholds are guesses, not measured on a desk. The plan uses the code pane's default share, not the share you dragged. CSS mirrors the plan's sizes by hand, so a change must touch both files. |
