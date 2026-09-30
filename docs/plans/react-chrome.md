# React chrome: contract and two-agent build

Status: Run 1 (phases 1 to 3) is merged on `main` as of 2026-09-30. The chrome
is React, drawn as Darkroom, and Caliper opens and edits its own parts through
a pinned tool. See "Run 1 merge record" at the end. Run 2 (phases 4 to 6, take
markup) is not planned yet. Phase 7 (real hardware) is not done.

## Scope and sequence

| Phase | Result | Completion gate |
|---|---|---|
| 0 | Commit the local view/action contract, hooks, unstyled reference renderer, shared dependencies and worker instructions on `main`. | Strict types, contract examples, current tests and the contract browser gate pass. Neither worker has started. |
| 1 | Bundle the chrome with its own React. Add a pinned tool copy that opens the subject checkout and its first chrome part. | The tool shows subject source at device size. The chrome works with a consumer on another React major, without sharing its React. |
| 2 | Implement the Darkroom shell as React regions: navigation, frame/caption, cards, Code, Knobs, Checks and Calibrate. Register annotated design tokens. | Current behavior remains reachable. Region scenarios and the composed chrome pass browser and visual gates at the size ladder. |
| 3 | Move takes onto the canvas. Add the composer, split menu, plan slots and take record. Remove the old Takes panel. | The tool makes three takes of its subject's bottom bar and accepts one. Every capability in the inventory below remains reachable. |
| 4 | Add marks on takes, mark mode/Alt-click, lost marks and a shared persistent draft. | Marks survive reload/restart, reach another chrome, and preserve a state reached by input. |
| 5 | Add Send and chains, history, copied files and agent context. | Accept/discard and missing ancestors follow take-markup decisions 3 to 5 and 11 to 13. |
| 6 | Add cross-take references and original marks. | Send counts follow decisions 6 to 8, and read access never widens the write fence. |
| 7 | Verify real monitors, Fold touch, keyboard/accessibility, frame performance and deployment. Resolve remote history before shipping. | Deploy the merged build and use it on Pico. Record failures and a week of daily-use evidence. |

Run 1 implements phases 1 to 3 in two parallel worktrees. Run 2 is planned after
Run 1 merges, so marks and references can be designed in Caliper itself. Run 1
must not implement draft marks, chains or new follow-up semantics merely because
the mockup depicts them. Typed follow-ups still edit their selected take.

## Shared interface

`src/client/ui/contract.ts` declares `ChromeView`, `ChromeActions` and region
states. This is a local rendering interface, not a new HTTP schema. Existing
server schemas and domain types remain authoritative for wire payloads. Core
validates wire values and produces an immutable snapshot through one pure
`toChromeView` adapter. UI never imports app state or performs fetch/storage I/O.

`src/client/ui/Chrome.tsx` exports the default `Chrome({view, actions})` renderer.
It is an unstyled executable reference, not the Darkroom implementation. It is
not wired into `src/pages.js` or the plugin. Its native disclosure controls let
core test actions before the styled UI lands. It does not prove production
layout, focus restoration, frame performance, CodeMirror behavior or server I/O.

`src/client/ui/hooks.ts` exports `CAL` and `calSelector`. Use the same hook on
inline and overflow versions of a control. A hook exists only when its capability
applies to that state. The union of contract examples exercises all 92 hooks;
every fixture is not required to expose every hook.

| Identity | Attribute |
|---|---|
| Part/state selection | `data-part`, `data-state` |
| Take action/navigation | `data-take` |
| Frame/select control | `data-frame-key` |
| Plan input/removal | `data-direction` |
| Knob input/palette | `data-knob`, with `data-token` on a token option |
| Literal form | `data-literal` on its region and fields |
| Code/source control | `data-file` |
| Check result/attestation | `data-index`, scoped under its run |

Scope queries to their region before matching identity. Multiple controls can
share a hook and identity, such as a file in tabs and the Files menu. UI classes
and hierarchy are not behavioral selectors. Tests still use accessible roles
and names to exercise normal browser input.

### Ordering and lifecycle

- Actions return immediately. Core captures identity, performs work, and reports
  progress/errors through the next snapshot. Core rechecks availability; disabled
  controls cannot authorize a write.
- Accept and typed follow-up flush pending code saves first. Core owns the
  replacement/discard confirmation and the exact-take preflight. Ordinary
  Replace remains reporting-only. Alternate apply still needs the exact reviewed
  revision, passing checks and the explicit product-behavior attestation.
- Plan direction ids survive editing/removal. Cancelling a plan invalidates
  pending results without discarding the prompt. No title is an identity.
- Frame keys include take creation identity because numeric take ids can be
  reused. Preserve a frame while its key and source stay unchanged. UI calls
  `onFrameMount(key, node)` and unregisters with `null`. Core owns report-message
  validation, reloads and CSSOM observation. UI owns measured geometry and calls
  `onFrameGeometry`. Core must not publish geometry back in a render loop.
- UI owns layout from its container's width and height. Device CSS viewport and
  drawn physical size remain distinct. No control disappears at small sizes.
  The reference only constrains frames by width; final height budgets belong
  to Opus's layout implementation.
- `onEditorMount` and `onReviewDiffMount` are stable lifecycle callbacks. UI owns
  host placement, core owns editor creation/update/destruction. Retain editor
  state across stream updates. Changes from disk do not call `onCodeEdit`.
  `src/client/ui/editor-appearance.ts` exports `editorAppearance`, a CodeMirror
  extension list owned by Opus. It starts empty for the reference renderer.
  Core uses it for both editors and review diffs, rather than inventing a theme.
- Knob ids identify the active variant and declaration. Core retains located
  source versions and rejects stale writes. Input changes live CSSOM only;
  commit writes once; cancel restores without writing. UI gets token options
  from core and does not discover them itself. Unbounded numbers have no
  invented slider maximum. Scrubbing remains a UI gesture over these actions.
- Image approval needs current saved evidence, eligible real files, both renders
  loaded and explicit review. Core updates approval availability when image load
  or failure callbacks arrive. Authored evidence cannot become a baseline.
  Closing Checks does not cancel its run. Stop is a separate action.
- Temporary disclosures, palette opening, focus, keyboard precedence and drag
  capture belong to UI. Context selection, open effect-bearing panels and draft
  input data belong to core. Preserve focused input identity during updates.

### Contract examples and gates

`test/fixtures/chrome-view.ts` supplies fresh typed examples. The 11 examples
exercise ready, empty, connection failure, editor load/failure, running take,
plan review/planning, alternate review and check progress/results. They are
contract inputs, not replacements for composed product scenarios or live server
snapshots. Some examples place multiple loaded regions together to exercise the
reference seam. They do not specify valid final panel composition. At integration,
the coordinator adapts the examples and browser navigation to the real UI while
retaining hook coverage, action arguments and identity assertions.
`test/fixtures/chrome-scenario.ts` records action calls and updates
explicit local inputs. It does not claim to implement server writes.

`test/chrome-contract.test.tsx` checks hook coverage, immutability at the scenario
seam, import boundaries and positive/negative type probes.
`scripts/verify-chrome-contract.mjs` bundles the real reference renderer and uses
Chromium input. It checks prompt/count/follow-up, images, plan editing/removal,
knob preview/commit, exact alternate revision, image attestation, separate
close/stop, and iframe identity across updates. It makes no model calls and
changes no consumer files.

```sh
nix develop -c bun run typecheck
nix develop -c bun test
nix develop -c bun run verify:chrome-contract
```

Step 0 pins React/React DOM 19.2.4 and their type packages 19.3.0. Existing
CodeMirror packages remain available. `tsc` uses `jsx: preserve` with `noEmit`;
Bun's browser build compiles JSX. With `checkJs` and imported React package JSON,
`react-jsx` also pulled React's own untyped runtime files into the typecheck.
The preserve setting avoids that error without disabling strict checking.
Core must test the JSX transform in its chosen production build.

### Step 0 verification record

Verified on 2026-09-29 with Node 24.18.0, Bun 1.3.3 and Chromium from
`nix develop`.

| Gate | Evidence |
|---|---|
| Strict types | `nix develop -c bun run typecheck` passes, including imported immutable device, review and editor-mode values. |
| Contract browser | `nix develop -c bun run verify:chrome-contract` passes all 11 examples and the union of 92 hooks. No uncaught errors or React warnings. |
| Full tests | `nix develop -c env CALIPER_TEST_MODULES="$PWD/node_modules" bun test` reports 397 pass, 0 fail and 1,752 assertions across 35 files. The process exits 0. |
| Rapid-save repeat | Three isolated runs each of the unchanged rapid-save test on `d29f85d` and the current source pass. Both use the installed dependency tree. |

The full-suite result is not a clean teardown. Esbuild reports
`fatal error: all goroutines are asleep - deadlock!` after the test summary.
An intervening full rerun failed `test/late-changes.test.js`, receiving step 5
instead of 6. The rapid-save implementation and test are unchanged. The latest
full run passes, but the cause of the intermittent failure is not established.
A full archived baseline attempt timed out in the Bun-as-Node guard test; it
cannot establish a clean baseline. These issues remain open, not fixed by this
contract. Do not treat exit 0 alone as proof of clean process shutdown.

## Behavior inventory for Run 1

This inventory extends the seventh-pass audit. Read the implementations, not
only this table, before migrating them.

| Source | Required contract behavior |
|---|---|
| `chrome.js` navigation/setup/scenarios | Parts filter, independent expansion, named states, state-owned takes, compare/all views, badges, subject versus preview context, whole/child scenario selection, unavailable-take recovery, source provenance and visible derivation errors. |
| `chrome.js` frames/calibration | Keyed iframe reuse, original/all/take previews, alternate's own scenario, frame verdict/problems, device selection, calibration/reset, true-size/scaled/uncalibrated warning, URL and saved preferences. |
| `chrome.js` composer/plan | Prompt, Ctrl/Meta+Enter, modified follow-up, picker/paste/drop images, removal/limits/errors, 1 to 4 takes, editable/removable directions, strange note, Back/Cancel, pending requests, partial launches, agent/skills/off/failure visibility. |
| `chrome.js` record/take actions | Name/name issue, subject/device/creation context, changed files, log with images/tools/manual edits, running/failed/empty log, Stop, Discard, Replace/Accept and alternate preparation. Stale subjects block writes but keep review/discard reachable. |
| `integration-review.js` | Preparation, revision-bound review/refresh/check/apply, proposal strategy/shared behavior/preserved callers/usage/preview, changed-file diffs, Open in Code and behavior attestation. |
| `code-pane.js`, `code-editor.js` | File tabs/menu/filter/import groups/statistics, retained selection/scroll, per-state lenses, real/take/watching modes, read-only running take and Stop, diff/Revert/navigation, debounced save/Ctrl+S, unsaved text and disk notices, flush before actions. |
| `knobs-panel.js`, `knob-cssom.js`, `knob-values.js` | Registered/plain/threshold discovery/refusals, source links, number typing/scrub/bounded slider, color text/input, ident choices, token options, live input/reapply, commit/conflict/failure, literals and reviewed name/home promotion. |
| `checks-panel.js`, `checks-view.js` | Selected/all scopes on both devices, late-response reconciliation, progress/Stop, failures/cancellation/stale history, automatic and authored details/provenance, saved images/full-size links/report download, exact-image review/approval, part badges and reporting limits. |
| `layout.js`, `device-frame.js`, CSS, PWA | Container-based layout, sheet height budgets, overflow groups, divider keyboard/pointer/reset, physical viewport truth, safe areas, Caliper-scoped installation, no page-level hidden scroll. |

Not drawn yet: running take, Stop and agent-load failure. Opus supplies those
states in its local gallery, then checks them in the merged tool. The phone's
Preview/Takes pressed-state ambiguity must have one meaning. These are UI
choices within decision 34, not permission to change take semantics.

## File ownership

The coordinator freezes `contract.ts`, `hooks.ts`, this plan and the shared
contract fixtures during the run. Requests go to separate notes files, with
an evidence-backed description and a workaround. Neither worker changes the
contract unilaterally. Do not weaken a gate to conceal a missing capability.

| Owner | Writable files |
|---|---|
| Opus, `cliproxyapi/claude-opus-5-5`, branch `chrome/ui` | `src/client/ui/**` except `contract.ts` and `hooks.ts`; `src/client/layout.js`, `src/client/device-frame.js`, `src/client/frame.css`, `test/layout.test.js`, `test/device-frame.test.js`; removal of `src/client/chrome.css` and `src/client/checks.css`; `scripts/ui/**`, new UI-owned fixture tests, `docs/plans/react-chrome-ui-notes.md`. |
| Sol, `cliproxyapi/gpt-6.1-sol`, branch `chrome/core` | `src/client/app/**`; migration/removal of legacy chrome/panel/pane/DOM modules; `code-editor.js` behavior, with old appearance moved behind `editorAppearance`; `knob-cssom.js`, `knob-values.js`, `scenarios.js`, `frame.js` behavior; plugin/pages/server/agent/build code; `src/types.d.ts`; `package.json`, lock/config/Nix files; `scripts/verify-*.mjs` and existing tests except the frozen contract and UI-owned tests; `README.md`, `docs/plans/react-chrome-core-notes.md`. |

The frozen files include `test/chrome-contract-types.ts`,
`test/chrome-contract.test.tsx`, `test/fixtures/chrome-view.ts`,
`test/fixtures/chrome-scenario.ts`, `scripts/fixtures/chrome-contract.tsx` and
`scripts/verify-chrome-contract.mjs`. Sol can add tests alongside them. Opus
writes full visual fixtures and real region parts inside its UI directory.
Preserve the public device/geometry and pure numeric-helper signatures used by
the contract. A needed signature change is a coordinator request.

Core removes old rendering after migrating its behavior. It does not restyle
legacy markup or change CodeMirror colors/type/spacing. Opus does not edit build
configuration or network/state modules. The empty `editorAppearance` export
lets core remove the mixed legacy theme without waiting for Opus. Core retains
installed dependency APIs so neither worker needs to change shared setup.

Do not deploy the intermediate core branch as the completed design. Its
unstyled renderer is intentional until UI integration. Core must keep functional
browser assertions passing; layout assertions wait for the real UI. Record
which layout gates cannot pass on the reference. At merge, every real gate runs.

## Worker instructions

### Opus

Read decisions 18, 34 to 36, the contract and the mockup README. Load
`frontend-design`, `intrinsic-design`, `atomic-decomp` and `caliper-parts`.
Search Mobbin before new UI states; keep the approved Darkroom direction.
Implement real regions with adjacent product-owned parts, explicit scenarios
and action behavior. Do not create a separate lab renderer. Apply registered
annotated tokens, one gutter, one canvas grid/gap, opaque cards and ink selection.
Own `planLayout` and tests around both sides of each threshold. Use a gallery
with local input fixtures until core lands. Keep controls reachable at generous,
medium, narrow-tall, wide-short and tiny sizes, including the three mockup sizes
in light and dark. Do not import `src/client/app`.

Verify types, applicable hooks, keyboard/focus, frame/editor preservation and
visual states. Record screenshot paths and undrawn-state decisions in the UI
notes. Commit only owned files. Do not merge or deploy independently.

### Sol

Read decision 18, current runtime limits, the contract and inventory. Build
explicit app state, pure `toChromeView`, stable actions and server adapters.
Reuse the existing server schemas, check policy, take fence, source-version and
CSSOM behavior. Add tests that convert real server snapshots, including removed
subjects and stale reports, into valid views. Wire the renderer through the
contract and the editor/iframe lifecycle callbacks. Bundle owned dependencies
under `/__caliper/`, retain lazy CodeMirror behavior and include built artifacts
in linked/packed consumers. Configure self-hosting with a separately pinned tool.

Use `CAL` hooks for behavioral scripts. Run unit/types/browser gates, React
isolation with another consumer major, source HMR and linked/packed delivery.
Record commands, artifacts and any reference-only layout limits in core notes.
Do not invent appearance or introduce marks/chains. Commit only owned files.
Do not merge or deploy independently.

## Integration and shipping

1. Finish Step 0 and commit it on local `main`. Create `.worktree/ui` and
   `.worktree/core` from that exact commit. Install dependencies in each tree.
   Starting either worker is a separate user action.
2. Review each branch's owned diff and evidence. Resolve contract requests on
   the coordinator branch, then rebase affected work. Do not guess around a
   missing field without recording it.
3. Rebase core onto current `main` and fast-forward it. Rebase UI onto the new
   `main` and fast-forward it. Keep unrelated worktrees and edits untouched.
4. Run types, unit tests and every applicable verification script against the
   real merged components. Use `README.md` for module/browser prerequisites.
   Do not claim a reference-renderer pass proves production integration.
5. Inspect the gallery and the live tool/subject. Test three bottom-bar takes
   through Accept. Missing/hidden controls go to Opus; wrong data/effects go to
   Sol, with evidence. Test long paths/names, many takes, empty/error states and
   stale identities, not only the clean mockup data.
6. Deploy the merged build to the active Pico/tool target and verify it. If no
   target is available, record the exact deploy command and the blocker.
7. Remove completed worktrees after merge. Do not push over GitHub's divergent
   `main` without explicit permission. Remote-history reconciliation is separate.

Costs: the contract is broad because the current chrome has many capabilities.
It can still miss a state. Parallel isolated branches postpone real integration
until merge. Local fixtures do not establish hermeticity, interaction coverage
for every consumer, or real-device input. A pinned tool trades automatic updates
for recovery when the subject breaks.

## Run 1 merge record

Merged on 2026-09-30. Core (`09106cf`) landed first, then UI (`48f7fbd` to
`cadc80a`), then the integration commits below. The two branches touched no
common file and no frozen contract file.

| Commit | What integration needed |
|---|---|
| `18a32bf` | Serve `Darkroom` from the app entry. The build listed no stylesheet in its manifest, so the chrome loaded bare; `cssCodeSplit` fixes it. The page gave the root no height. The docked parts column started closed and closed on every selection; it is now a remembered preference. The part's own "select all states" control existed only while unfolded. |
| `d4ee49c` | Run every public gate with its layout assertions on. Checks became modal inside Caliper's own box, so an embedded chrome keeps it contained. A covered code or knobs sheet comes to the front on its tool instead of closing. Accessible names the gates rely on: preview scenario, knob labels, knob numbers as spinbuttons, frame titles, one literals live region. `reveal()` reaches Darkroom controls through the parts drawer, the New take menu, More tools and folded groups. |
| `fdcdbc8` | On a cold dependency cache, Vite's first bundle took 9 to 39 s here, past the 10 s frame watchdog. A frame page now waits for it, at most 60 s. The tool installs its own chrome bundle. |
| `1504766`, then this record's commit | Re-pin the recovery tool from `8d23556` (DOM chrome) to `fdcdbc8`, then to `e64a17a`, which adds the fixes found by opening Caliper in itself and Pico (`71333c5`, `e64a17a`). |

Evidence at `d4ee49c`/`b19e815` on one build: typecheck; `bun test` 541 pass,
0 fail; `verify-chrome-core.mjs` 21 of 21 gates with layout on;
`scripts/ui/verify.mjs` 171 of 171; `verify:chrome-contract` 11 scenarios and 92
hooks. At `8d470ba`: typecheck; `verify-chrome-core.mjs` 21 of 21;
`verify:chrome-delivery` linked, packed and self-host through the pin;
`verify:chrome-contract`; `bun test` 540 pass, 1 fail (see Open). At `e64a17a`:
`scripts/ui/verify.mjs` 171 of 171 and the browser, scenarios and checks-ui
gates again.

Phase 3 gate: in a scratch subject copy, the pinned tool planned three takes of
the composer bar with the real model (one strange direction), ran them, and
accepted one through the chrome. The take's files replaced the real ones and the
other two takes stayed. The accepted edit was not kept.

Changed behaviour a reviewer can see: the Checks copy uses the gates' labels
("Check selected preview", "Approve this image"); result rows start folded and
the reason shows in each row's summary line; a take row's approval block always
shows, disabled with its reason; the uncalibrated caption says "until
calibration".

Open, not fixed here:

- Real monitors, the Fold with touch, and many frames at true size (phase 7).
- The intermittent `late-changes` rapid-save failure and the esbuild shutdown
  message recorded in Step 0.
- Contract requests UI 3 to 5 (check badge on a frame, a short state label,
  a threshold's current size) are unanswered; the UI works around them.
- The cold first bundle is slow on this machine under load; the wait hides it
  but does not shorten it.
- `test/authored-execution.test.js` "named browser checks" times out at 60 s
  on this machine now. It fails the same way at `d29f85d`, before any Run 1
  work, and it passed in the full run at `b19e815`. Another session was
  running VM tests and Rust builds (load average 17 to 29 on 16 cores). Cause
  not found.
