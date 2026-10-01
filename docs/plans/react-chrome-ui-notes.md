# React chrome: UI notes (Opus, branch `chrome/ui`)

Run 1, phases 1 to 3 of the look, on the frozen contract from `8d23556`.
This file records what the UI branch built, the choices it made for states
the mockup did not draw, the contract requests, and the gate evidence.

## What is built

| Area | Files |
|---|---|
| Composed chrome (page) | `src/client/ui/Darkroom.tsx`, default export `Darkroom({ view, actions, scheme? })` |
| Layout policy | `src/client/ui/layout.ts`: `planLayout`, `frontSheet`, `codeHeight`, `fitBar`, `fitTools`; tests in `test/ui-layout.test.ts` |
| Design tokens | `src/client/ui/tokens.css`: 20 tokens registered with `@property`, each declaration annotated with knob hints (`@label`, `@min`, `@max`, `@step`) |
| Regions | `tools/` rail and dock, `nav/` parts panel, `canvas/` frames, plan slots, caption, calibrate, `bar/` composer and New take split menu, `side/` take record, alternate review, Knobs, `code/` code pane, `checks/` Checks window |
| Atoms | `atoms/` Button, Icon, Notices, Panel, MenuButton |
| Editor look | `src/client/ui/editor-appearance.ts`: Darkroom CodeMirror theme and highlight, on the same tokens |
| Parts | A `*.part.tsx` beside every component (33 part files), with states from local fixtures |
| Fixtures | `src/client/ui/fixtures/`: 26 views and a scenario with local action behavior |
| Gallery and gates | `scripts/ui/`: `serve.mjs`, `shoot.mjs`, `verify.mjs`, `applicable.ts` |

`src/client/ui/Chrome.tsx` (the unstyled reference) is unchanged. The frozen
contract test and `verify:chrome-contract` still run against it and pass.

## Choices for undrawn states

Mobbin references checked: Microsoft Copilot's running research card (a
progress line and Cancel beside the work) and Cofounder's "Running tool"
line in the agent log. Both keep the running indicator where the work is.

| State | Choice | Where to see it |
|---|---|---|
| Running take | The take's frame keeps its page and gains a thin moving ink line under it; its caption says "Working" with a pulsing dot. No hue. The record's facts say "Working", a line moves under them, and the last log line is the running tool with "working". Motion stops under `prefers-reduced-motion`. | `running-*` |
| Stop | One action in three places, all `take-stop` with the take's id: the record's header (where the eye lands), the bar's focused take (where Accept is), and the code pane's header while it follows the agent. Accept stays in place, disabled with "Wait for the agent, or stop it", so the row does not jump when the agent ends. | `running-*`, `codeWatching-*` |
| Stopped take | The record says "Stopped" in the bad colour with the reason as a bordered line; the frame caption says "Stopped" and carries the reason in its title. | `failedTake-*` |
| Agent failed to load | An alert line in the bar, above the prompt, with a 3 px bad edge: "The agent did not load." then the reason, then the fix in quieter ink. New take is disabled with the reason. The prompt stays editable; typing is not lost. The same text is at the foot of the New take menu. | `agentFailed-*` |
| Agent off | A quiet status line in the bar: "No agent is set up", the hint, and "Takes you have stay reviewable." | `agentOff-*` |
| Planning | The slots show "Planning 3 directions" with a moving line; the bar shows the same and Cancel (`plan-back`). | `planning-*` |

## One meaning for a pressed tool on the dock

The mockup marked Preview and Takes both pressed. The build uses one rule:
**a pressed tool is the thing in front.** Exactly one mark shows on the dock.

- Preview: the canvas with nothing over it. Its bar shows.
- Takes: the focused take's record as the sheet in front, when one is open.
- Code, Knobs: their sheet in front.
- Parts is a drawer toggle (`aria-expanded`). While the drawer is open it is
  in front, so it takes the mark and the active tool loses it until it closes.

Checks and Calibrate are windows over the tool in front. Closing one brings
back the tool that was in front before it opened (decided 2026-10-01).
Close, Escape, a click on the scrim, Done and a second press of Calibrate
all close a window. Before this, the app kept the window's tool pressed with
nothing in front, and the gallery moved to Takes.

`frontSheet(plan, active, side)` in `layout.ts` is this rule; its tests are in
`test/ui-layout.test.ts`. A sheet that is not in front stays mounted behind,
so the editor and knob state survive. On the desk the rail has no Preview,
as drawn, because nothing covers the canvas there.

## Other design choices

- The chrome keeps the browser's 16 px rem, the mockup's rem, so the mockup's
  thresholds are the chrome's (the legacy chrome used 15 px).
- The phone dock adds Calibrate, which the mockup dropped. When the dock or
  rail is too short, `fitTools` moves Calibrate, Checks, Knobs, then Code into
  a More menu with their labels. No tool is removed.
- One layout rule replaces the mockup's per-state exception: the side panel
  wins width before the parts panel, and the canvas needs 24 rem beside
  docked panels when it shows the bar, 18 rem when it does not. On the Fold
  this reproduces both drawn cases: the record hides the parts panel; Knobs
  do not.
- The composer bar shows while one state is on the canvas and Takes,
  Preview or a plan is in front. The all-states view has no composer: a take
  belongs to one state (decision 20). The mockup's grid state agrees.
- `fitBar` uses one row while the field keeps 16 rem beside the groups, then
  the field alone on the first row, then one row per group. On the Fold this
  gives two rows where the mockup drew three.
- Frames stay at true size on the phone, one column, and scroll. The
  mockup's two columns at 68 % were scaled without saying so (decision 8).
- The take count in the New take menu is a `menuitemradio` group, as drawn.
- The parts drawer is a UI-owned disclosure. The Parts button calls
  `onNavOpen` only when the column can dock at this size.
- A knob's source line shows only while the knob is live (focused or being
  dragged) or has news (a write result or a problem), as the mockup asked.
  Touch reaches it by touching the control.
- Menus are fixed-position, so no scrolling region clips them. When the room
  is too short for the canvas floor and the bar (for example 240 × 180), the
  stage scrolls inside itself; the page never scrolls.

## Contract requests

Each request has evidence and the workaround in this branch.

| # | Request | Evidence | Workaround |
|---|---|---|---|
| 1 | Serve `Darkroom` as the renderer, and adapt the frozen contract gate's navigation to it. | The frozen test and `verify:chrome-contract` import `src/client/ui/Chrome.tsx` and use its reference navigation: a `<select>` for the count, "New take options" as a `<summary>`, every region rendered at once. Darkroom renders Knobs or a record by `tools.side`, and the count is a menu radio group. | `Chrome.tsx` is unchanged, so the frozen gates pass. `scripts/ui/verify.mjs` covers the same actions with Darkroom navigation. At integration, swap the import (same props) and port the navigation. |
| 2 | Define `onTool` effects to match the dock meaning. | Darkroom derives the sheet in front from `tools.active` and `tools.side`. | Assumed: `onTool("preview")` closes the side panel; `onTool("takes")` shows the record if one is open; `onTool("knobs")` opens Knobs. The Knobs close button calls `onTool("preview")`. The fixture scenario implements exactly this. |
| 3 | Add a check badge to `FrameView`. | The mockup draws a dot under a frame whose checks failed; `FrameView` has only `verdict` and `run`. | The caption shows verdict and run notes only. |
| 4 | Add the state's label to `CanvasView`. | The mockup's title is "Game Detail  Default"; `Selection.label` in the contract example is "Button · Default in Page · Menu open". | The title shows `canvas.title` and `selection.label`. Core should give a short label. |
| 5 | Add the part's current size to threshold knobs. | The mockup draws a "now 19em" line on a threshold's bar. The README says those values were invented; `KnobView` has no such value. | Thresholds show the scrub label and the typed value, with no rail. |
| 6 | Delete `src/client/layout.js`, `test/layout.test.js`, `src/client/chrome.css` and `src/client/checks.css` once the legacy chrome is gone. | Legacy `chrome.js` still imports `planLayout` from `layout.js`, and `pages.js` and `plugin.js` serve the two stylesheets on this branch. | The Darkroom policy is in `src/client/ui/layout.ts`. The legacy files are untouched so this branch still typechecks and serves. |
| 7 | Bundle component CSS and the font. | Each region imports its CSS, and `tokens.css` loads `assets/PublicSans.ttf` (OFL, copied from the mockups). | `scripts/ui/lib.mjs` builds with `bun build --asset-naming "[name].[ext]"`, which emits `gallery.css` and the font. Core owns the production build. |
| 8 | Mount core's editor and review diffs inside `.dr-root`. | `editorAppearance` reads `--dr-*` tokens. | The code pane and review hosts are inside the root; the gallery's fixture editor proves the look. |

## Gates and evidence

All commands run from the worktree through `nix develop` on 2026-09-29.

| Gate | Command | Result |
|---|---|---|
| Types | `nix develop -c bun run typecheck` | Passes |
| Layout and part tests | `nix develop -c bun test test/ui-layout.test.ts test/ui-parts.test.ts test/chrome-contract.test.tsx test/layout.test.js test/device-frame.test.js` | 98 pass, 0 fail. Both coverage gates were seen to fail: an extra component in a file, and a component with no part. |
| Full suite | `nix develop -c env CALIPER_TEST_MODULES="$PWD/node_modules" bun test --timeout 120000` | 460 pass, 0 fail, 37 files, exit 0 in 39 s. An earlier run without `--timeout` hung and hit a 30-minute limit; the cause was not found. |
| Frozen contract | `nix develop -c bun run verify:chrome-contract` | 11 scenarios, 92 hooks (reference renderer, unchanged) |
| Darkroom browser gate | `nix develop -c node scripts/ui/verify.mjs` | 171 of 171 pass. There were no page errors or React warnings. |
| Renders | `nix develop -c node scripts/ui/shoot.mjs` | 158 renders and 68 mockup comparisons |

What `verify.mjs` proves:

- **Hooks.** For 26 fixtures at 1600 × 1000, 1000 × 680 and 416 × 640, every
  applicable hook is present and none appears where it does not apply. The
  UI-owned menu and drawer are opened first. `scripts/ui/applicable.ts`
  states applicability from the contract. The union covers all 92 CAL hooks.
- **Actions.** Real input reaches each action with the right identity:
  prompt, Ctrl+Enter, Ctrl+Shift+Enter, count, follow, attach and remove,
  Accept and Discard, device, frame select, state, compare, expand, filter
  and context. It also covers plan edit, remove, Start, Back and Cancel,
  Stop from the bar and the record, knob input then one commit, cancel,
  tokens, choice, literal name, create and cancel, and source links. It
  covers alternate attestation with exact revision apply and check, image
  approval after review, check run and stop, and Escape closing Checks
  without Stop. It covers code steps, files filter and open, divider keys,
  save and retry, calibrate, record close, alternate preparation and files.
- **Keyboard and focus.** The menu opens on the checked item; arrows, End,
  Enter and Escape work, and focus returns to the button. The drawer takes
  focus, and Escape returns it to Parts. The dock marks one tool. The Checks
  dialog holds focus. Keyboard focus shows an ink ring. Typing through
  stream updates keeps focus and every character. Palette arrows commit.
- **Preservation.** A tap inside take 6's frame survives a stream update,
  resizes to the Fold, phone and desk, and opening Knobs. The frame mounts
  once and unregisters on unmount. Desk frames are 279 px, which is
  72 mm at 3.875 px/mm. Typed editor text survives an update, the move to a
  sheet, and a hidden sheet. The editor is created once and never destroyed.
- **Reachability.** At 1920 × 1200, 960 × 1000, 390 × 900, 1280 × 300 and
  240 × 180, and at the three mockup sizes, 9 fixtures pass. The page never
  scrolls, every visible control is on screen or in a scroll region, and
  every applicable control exists.

### Screenshots

Renders are in `scripts/ui/out/` (ignored by Git; regenerate with
`shoot.mjs`), named `<fixture>[-<act>]-<desk|fold|phone>-<dark|light>.png`.
Side-by-side comparisons with the mockup render are in
`scripts/ui/out/compare/`. Fixtures with a drawn mockup state: `takes`,
`empty`, `prompt-menu` (menu), `plan`, `log`, `knobs`, `code`, `grid`,
`error`, `checks`, `calibrate`, `takes-drawer` (parts, phone only).

## What could not pass or is not proved

- The mockup's chains, pins, draft, Send and the agent brief are Run 2 and
  are not built. The takes canvas shows single frames, not parent pairs. The
  `takes`, `mark`, `draft` and `agent` comparisons differ there on purpose.
- The comparisons are by eye, not pixel diffs. The known differences are the
  grid's column count (auto-fit at true size), the phone's single column,
  two bar rows on the Fold, and the record's file list.
- Only Chromium ran. Firefox and Safari, real monitors, Fold touch and frame
  performance with many frames are phase 7.
- The gallery's editor stands in for core's. Integration with core's real
  editor, server snapshots, HMR and self-hosting is not tested here.
- Every threshold in `layout.ts` is a guess until someone measures it on a
  real desk and Fold.
