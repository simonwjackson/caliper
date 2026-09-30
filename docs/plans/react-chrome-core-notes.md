# React chrome core notes

Branch: `chrome/core`, based on `8d23556`. Run 1, Sol-owned files only.
This is the unstyled core integration, not the Darkroom design. No merge,
rebase, push or deployment is authorized for this worker.

## Implementation

| Boundary | Implementation |
|---|---|
| State and rendering | `app/state.ts` holds selection, connection, preferences, composer, plan and frame reports. Pure `app/view.ts` returns a detached, recursively frozen `ChromeView`. It does not freeze or mutate server values. |
| Actions and transport | `app/runtime.ts` owns stable actions, captured request inputs, outstanding operations and exact-take preflight. `app/entry.tsx` mounts the unchanged reference, subscribes through `useSyncExternalStore`, reads SSE and validates HTTP responses. `app/wire.ts` uses the existing domain contracts and validates values before state conversion. |
| Selection | Take selection binds its creation timestamp, including in newly saved URLs. A reused numeric id does not silently select its replacement. Initial takes responses cannot erase a deep link before project discovery. Removed subjects keep their record and Discard, but cannot authorize replacement or prompts. |
| Composer and plans | Plan ids survive direction edits/removal. Cancel invalidates late replies without clearing the prompt. Completion clears only unchanged submitted input. Successful directions leave retry work before refresh, so a failed refresh cannot relaunch them. Concurrent Stop does not release another outstanding operation's lock. |
| Frames | Keys include preview and take creation identity. Unchanged keys/source retain their iframe. Replacement nodes start Loading. Same-origin messages must match the registered frame, preview and its current `window.caliperReport`; old-document messages cannot replace new evidence. Geometry callbacks do not publish a render loop. |
| Code and alternate diffs | `app/code.ts` and `app/integration.ts` own editor effects and retained documents. Both lazily load `code-editor.js` and use UI-owned `editorAppearance`. Accept/follow-up flush code, refresh server data and recheck creation identity. Alternate Apply also rechecks subject availability, revision, render checks and explicit behavior review. |
| Knobs and literals | `app/knobs.ts` and `app/knobs-discovery.ts` retain located source spans/versions. Input changes CSSOM; commit writes once; cancel restores. Conflicts remain visible. Promotion requires the reviewed name/home. No slider maximum is invented. |
| Checks | `app/checks.ts` retains saved evidence and reconciles late HTTP/SSE responses. Image eligibility uses exact first/repeat evidence, load/failure callbacks and explicit review. Stale and take reports cannot authorize baselines. Close does not cancel; Stop is separate. |
| Delivery | `chrome.config.js`, `src/build/chrome.js` and the build script produce manifest-listed React/React DOM assets and a lazy editor chunk. Consumer Vite transforms only the product-frame bootstrap, not chrome dependencies. Linked checkouts require a build; `prepack` builds packed assets. |
| Recovery tool | `src/build/tool.js` installs the exact baseline archive and frozen lock separately under `~/.cache/caliper/tools/8d23556f6c8f43b315a873c8a6d6dc8ddc10b322`. Startup checks archive, source and lock hashes. This pin retains the baseline DOM outer chrome; it inspects the current subject's React source. It is not a pin of this uncommitted migration. |

The browser-safe integration proposal schema is in
`src/takes/integration-contract.js`; `src/takes/integration.js` retains its
public export. This avoids pulling Node filesystem/crypto modules into the
chrome bundle. Legacy chrome, Code, Knobs, Checks, integration and DOM rendering
modules are removed. Legacy CSS and public layout/geometry helpers remain
untouched for their UI owner; the new reference does not load those styles.

Ordinary replacement remains reporting-only. Typed follow-up edits its selected
take. This branch adds no marks, chains, persistent markup draft or new follow-up
semantics.

## Contract requests and workarounds

| Request or limit | Evidence | Workaround and cost |
|---|---|---|
| No frozen field/action signature change is requested. | Core uses the existing `ChromeView`, `ChromeActions`, `CAL` and `editorAppearance` exports. | Source versions, editor state and request identity stay in core controllers, not the rendering contract. |
| A UI-owned first subject part is absent on this branch. | Step 0 supplies `Chrome.tsx`, not UI-owned `*.part.tsx` regions. | `app/Reference.page.part.tsx` composes that actual renderer with explicit local empty-project inputs and working filter, tools and calibration. Ready, Calibrate and Unreachable are inspectable. They do not prove Darkroom/region coverage or the three bottom-bar takes plus Accept gate. The coordinator must run those UI-owned scenarios after integration. |
| The reference lacks authored-image captions. | Its authored image has the supplied alt text and evidence URL, but does not render `EvidenceImage.caption`. | Tests check image identity, alt text, URLs, loads and disabled take approval. UI must show the caption so interaction evidence is not mistaken for a baseline image. |
| Reference-only disclosure helper must stay within core ownership. | Native reference disclosures differ from legacy layout traversal. | `scripts/verify-helpers.mjs` uses CAL and normal disclosure controls. `scripts/reveal.mjs` is unchanged. This helper establishes functional reachability with scrolling, not the final UI's overflow or focus policy. |

## Reference-only layout limits

The reference uses native document flow. These are deferred, not passed:

| Gate | Why the reference cannot establish it |
|---|---|
| Rail/dock, navigation drawer, overflow groups and Preview/Takes pressed-state meaning | The Darkroom layout and temporary disclosure policy belong to UI. |
| No page/root overflow at the size ladder; controls within the viewport | Native scrolling makes controls reachable but does not establish containment or one-tap overflow depth. |
| Side-sheet/dock placement, minimum preview space and height budgets | The reference constrains frame width, not canvas height. |
| Divider keyboard/pointer/reset, drag capture and label scrubbing | The actions exist; final UI gestures are absent. Native number/range input tests are not pointer-scrub tests. |
| 44-pixel targets, Escape/focus restoration, touch behavior | Native control presence is not the final input/accessibility gate. |
| True-size/scaled grid geometry, 72 mm frame and 85.6 mm drawn outline | Preferences and geometry helpers are tested, but production physical fitting and real monitors are not. |
| Safe areas and overscroll policy at `/` and `/preview/` | PWA metadata/assets/installability are preserved; final CSS placement is absent. |
| Checks/alternate containment in narrow-tall, wide-short, tiny and embedded containers | Native dialog/content flow can overflow horizontally. |

`verify-code.mjs` and `verify-integration.mjs` retain their normal layout gates;
core uses `--reference`. Checks, authored UI and expectation scripts retain
layout assertions behind `--layout`. The regression aggregator passes
`--reference` through to alternate verification when requested. Other migrated
scripts print their exact deferred layout gates. The merged UI must restore or
replace every listed production layout assertion; reference success is not a
production-layout pass.

## Verification method

`test/chrome-app.test.ts` reads actual project/take HTTP snapshots and a saved
Checks report from real Chromium renders. It changes source and converts the
actual stale HTTP report, then checks that a late old report cannot restore
approval. Its dependency seam is installed before Vite computes optimization;
its cache stays in the temporary root, never the supplied dependency tree.

`test/project-server-host.mjs` hosts each HTTP fixture in real Node. This gives
Vite/esbuild a lifecycle separate from Bun's test cancellation. The caller still
owns real files and unchanged HTTP assertions. Startup waits until the fixture
files appear in `watcher.getWatched()`. Chokidar's `ready` event alone was early:
the failing SSE reproduction showed an empty watched map before the first write.
The fixture uses a separate origin and waits for shutdown before file removal.
This costs about 1–2 seconds per server. It does not fix Bun or esbuild.

The origin/file-fence test now creates `.env` in its initial fixture rather than
during the test. Creating it after startup triggered Vite's environment-file
restart and reset an HTTP connection. All ten refusal/file-preservation
assertions remain. Both this test and the source-change SSE test passed three
consecutive focused runs. `scripts/verify-fixture-startup.mjs` independently
checks real HTTP, immediate source-change SSE and shutdown.

`test/chrome-app-races.test.ts` uses typed domain snapshots, deferred transport
and iframe lifecycle doubles. It proves action ordering and rejection, not
browser rendering. The public browser gates complement those unit cases with
actual Vite, editors, frames, CSSOM, saved images and server writes.

`scripts/verify-chrome-core.mjs` runs the public gates on disposable consumers.
The take workflow uses a deterministic local OpenAI-compatible endpoint through
the real planner/agent transport. It does not use a paid model, establish model
quality or perform the subject bottom-bar acceptance gate. The product-knob
entry in that runner uses its small consumer fixture; separate worker evidence
also covers Pico Library's eight frames and literal promotion.

## Evidence

Core-owned verification passed on the final branch sources. The reference-only
layout limits and UI-owned phase completion gates remain deferred.

| Command/evidence | Observed result |
|---|---|
| `nix develop -c bun run typecheck` | Passed on the final app and fixture-host sources. |
| `nix develop -c bun run build` | Passed on final app sources. Entry: `entry-CfJ_zRLe.js`, 591.18 KB / 144.07 KB gzip. Lazy editor: `editor-C1cGz89Y.js`, 774.16 KB / 229.82 KB gzip. No Node-only browser imports. Final package verification also runs prepack. |
| `nix develop -c bun run verify:chrome-contract` | Passed again after the final app/fixture changes: 11 scenarios, 92 hooks, real browser action/identity gates. Frozen renderer, types, examples and helpers are unchanged. |
| `nix develop -c bun test test/chrome-app-races.test.ts` | 20 pass, 0 fail, 75 assertions on final sources. This includes the startup-order, preference, reused-id URL and invalid-timestamp cases. |
| `nix develop -c env CALIPER_TEST_MODULES="$PWD/node_modules" CALIPER_TEST_TOOL=1 bun test` | Final full suite: 478 pass, 0 fail, 2,013 assertions across 44 files. Exit 0. Raw logs: `/tmp/pi-processes-heBQop/proc_cdcf-stdout.log` and `proc_cdcf-stderr.log`. Build-cancel diagnostics remain visible. No fatal goroutine diagnostic appears in this final log. |
| First full test attempt | 471 pass, 1 skip, 2 fail, 1,987 assertions. One rapid-save failure received step 9 rather than 10. The new live-report fixture hit optimizer navigation during checks; its installation/cache seam was corrected. Logs: `/tmp/pi-processes-heBQop/proc_2e33-stderr.log`. |
| In-process full-test retries | The concurrent retry exited 1 after 617 seconds. The serial retry had 422 passes and 56 timeouts. A Code SSE timeout preceded subsequent fixture startup timeouts. Logs: `/tmp/pi-processes-heBQop/proc_7f0b-stderr.log` and `proc_ff97-stderr.log`. Do not claim the upstream Bun/esbuild cause is fixed. |
| First Node-hosted full suite | 477 pass, 1 fail, 2,003 assertions. The remaining failure was the environment-file restart in the origin/file-fence fixture. That fixture now initializes `.env` before server startup. Logs: `/tmp/pi-processes-heBQop/proc_64d4-stderr.log`. |
| `nix develop -c node scripts/verify-chrome-core.mjs` | Final current-build aggregate: all 21 entries exit 0 after 572 seconds. Includes real Code/Takes, attachments, CSS, scenarios, reporting/authored gates, Knobs/product, PWA, alternate integration, ten rapid-save trials and linked/packed package checks. Summary: `/tmp/nix-shell.xUEh3M/caliper-core-gates-M06Qjd/summary.json`. Stdout/stderr for every gate are beside it. |
| Public browser run before final retry | All individual reporting, scenario, attachment, knob, PWA and package paths passed. Code failed because the runner's one-line fixture had no interior line for its edit assertion; the fixture is now multiline. Alternate containment failed without `--reference`; the runner and regression aggregator now pass that explicit flag. Evidence: `/tmp/nix-shell.BLl00g/caliper-core-gates-J6T3dv`. |
| `nix develop -c bun run verify:chrome-delivery` | Final run passed linked/packed React 19.2.4 versus 18.3.1, independent dispatchers, lazy editor, consumer-resolution isolation and source HMR/filter retention. The verified baseline pin shows actual default, Calibrate and Unreachable subject states and refuses writes to itself. Summary/screenshots/request graphs: `/tmp/nix-shell.Dqnyil/caliper-chrome-delivery-7tXbME/summary.json`. Packed tarball SHA256: `b7fbf2186e7520ff1d7c98ab1fdef2967bec4b89f5ee979d154c9403f3e98cf7`. |
| Fixture startup regression | Both `nix develop -c node scripts/verify-fixture-startup.mjs` and the Bun caller pass real HTTP, immediate source-change SSE and fixture shutdown. |
| Ownership and whitespace | `git diff HEAD` and untracked-file checks show no frozen UI, shared fixtures, plan, decision, legacy reveal or UI-owned CSS/layout edits. `git diff --check` passes. Final strict typecheck passes after the delivery prepack run. |

## Remaining costs and limits

The UI merge, real region scenarios, bottom-bar acceptance, real-device input
and deployment remain coordinator work. No reference screenshot establishes
Darkroom appearance.

The new snapshot conversion clones full view data on publication. It preserves
DOM/editor identity, but frame/render performance still needs phase 7 evidence.
The recovery tool needs explicit updates; current subject edits cannot update
its pin.

Source versions retain the existing CSS write policy. Code saves still have the
existing overwrite policy, and in-flight cross-client discard/recreate races
are not proven safe by client preflight. No server idempotency key is added.
A POST accepted by the server without a received acknowledgement can still
create an unknown take; the partial-launch fix protects successes whose ids
were received.

The known rapid-save intermittent failure and post-summary esbuild goroutine
deadlock remain outside this migration. `The build was canceled` also appears
in successful API test retries. Record the actual diagnostics; exit 0 does not
prove clean teardown. Do not claim that these problems were fixed here.

## Run 2, phase 4: core worker (marks, draft and Send)

Branch: `markup/core`, based on `7488ae2`. Core-owned files only. The frozen
contract, hooks, Send policy, contract fixtures and reference `Chrome.tsx` are
unchanged. No merge, re-pin or deploy is authorized for this worker. The
served Darkroom renders none of the markup yet; that is the UI worker's part.

### What is built

| Boundary | Implementation |
|---|---|
| Draft storage | `src/takes/marks.js` keeps `{ revision, marks }` in `.caliper/marks.json`, written atomically. Every write names its revision; a stale one throws `StaleDraft`. A broken file is reported, never replaced. The server picks each mark's id and its letter: A to Z, then AA, AB (`nextLetter`). |
| Schemas | `src/takes/marks-contract.js` (browser-safe typebox) is shared by the server and the chrome. Rects are document-origin CSS px. |
| Routes | In `src/agent/markup.js`, reached through the takes API: `GET marks.json`, `POST marks`, `POST marks/<id>` (note or anchor), `POST marks/<id>/remove`, `POST marks/send`. A stale revision gets 409 with the current draft. The stream sends a `marks` event on every change and on connect. |
| Anchors | `src/takes/anchor.js`: `anchorAt` (element under a click), `anchorIn` (smallest element holding a drag, plus up to 12 outermost elements inside), `locateAnchor` (selector, box and 80-character text-prefix checks; a found mark moves with its element) and `drawMarks`. The last two are self-contained so the headless render runs their source. |
| Placing, lost marks, Alt input | `src/client/app/markup.ts`. Overlay gestures call `place`. Each frame load attaches capture listeners: Alt-click and Alt-drag place a mark and swallow the click; other pointer or key input sets `afterInput`. Scroll, resize, DOM mutations, frame reports, device changes and takes events re-run `locateAnchor`. A mark not shown in this chrome is `Unresolved` and blocks Send, as Step 0 froze. |
| Notes | The editor opens on each new mark. A note saves 400 ms after typing stops, on close, and before Send. A refused note save retries once against the reloaded draft (last write wins per mark). |
| `store.fork` | One copier for alternates and marks: every edited file, no images, no half-copied take on failure. `integration.begin` uses it. |
| Records | New takes store `prompt`. A take made from marks stores `parent`, `chain`, `history` (`prompt`, `direction`, `lineage`, earlier `passes`) and the `marks` it was sent. It does not copy the parent's name or direction, so its agent names it. |
| Pictures | `RenderJob.annotations` finds each mark in a fresh render, draws two-tone pins and boxes, and saves `*.marks.png`. The worker contract carries annotations and the `annotated` result. |
| Brief | `markupMessage` (`src/agent/markup-message.js`) is pure: lineage, first prompt, direction, earlier passes, this pass (note, element, selector, region contents, after-input line), one caption per picture, the write fence, and the subject source. |
| Send | Rechecks agent readiness, revision and `planSend` on the server, renders every picture, and refuses the whole pass if any mark without `afterInput` is missing from its fresh render. Then, with no await in between, it rechecks the revision, forks every parent, releases the sent marks and starts all agents. The pictures become the new take's first-prompt images, so the record log shows them and a restart keeps them. |

### Deviations from the plan's proposals

- Routes are `POST`, not `PUT`/`DELETE`. `refuse()` accepts only JSON `POST`s, and the chrome transport sends only `GET` and `POST`.
- The server, not the chrome, assigns ids and letters, so two chromes never pick the same letter.
- The server also rechecks location, in the annotated render. A mark placed after input cannot be rechecked there; it is drawn at its stored place, and the brief says so.
- Send is refused while the agent is off, so a pass is never spent on takes that cannot run.
- The mark's preview may be the take's subject or any declared scenario of it, not only the take's recorded context, because the Takes canvas can show a take in the current context.

### Contract readings the UI worker should know

- A `Point` pin's `rect` has zero size at the click point. Draw the pin tip at `x, y`. A `Region` rect is the box.
- `Replacing` ends after one placement and returns to the mode before it.
- Pins exist only on frames with the mark's take identity, preview and device. Other marks appear only in the draft, as `Unresolved` with a reason that says what to show.
- `onSend(revision)` with an old revision posts a notice and sends nothing.

### Verification

| Command | Result |
|---|---|
| `nix develop -c bun test test/marks.test.js test/anchor.test.ts test/markup-api.test.js test/chrome-markup.test.ts` | Unit, real-Chromium anchor, live-server route/Send, and app-wiring tests pass. Send is exercised with real renders and a refusing model endpoint. |
| `nix develop -c node scripts/verify-markup.mjs` | 7 of 7 browser gates, no model spend: Alt-click marks and the part does not react; an open menu stays open when mark mode turns on and a point and a region are placed, with no frame reload; a second chrome sees the draft and its mark reaches the first; a reload keeps notes, and a mark placed after input is lost until the input repeats; the draft survives a Vite restart; a changed take turns its mark lost and blocks Send until it is removed; Send makes 2 new takes whose briefs hold only their own marks and one picture each. Evidence (pictures with pins, screenshots, `summary.json`) prints at the end. Last run: `/tmp/nix-shell.B60Mv8/caliper-markup-evidence-8NDCZJ`. |
| `nix develop -c bun run typecheck` | Passes. |
| `nix develop -c bun run verify:chrome-contract` | 17 scenarios, 106 hooks. The frozen gate is unchanged and passes. |
| `nix develop -c env CALIPER_TEST_MODULES="$PWD/node_modules" bun test` (after `bun run build`) | 570 pass, 1 skip, 1 fail, 2,557 assertions across 51 files. The failure is the known 60-second timeout in `test/authored-execution.test.js`, which also fails at `110205a`. Without a build, the chrome-page and delivery tests fail because `dist/chrome` is missing; that is setup, not this change. |

The gate uses the unstyled reference renderer on the real app wiring
(`scripts/fixtures/markup-harness.tsx`). It proves effects, not Darkroom layout.
The real-model gate on the pinned tool and Pico, the re-pin and the deploy are
coordinator work after the UI branch lands.

### Costs and limits

- A mark placed after input (an open menu) is lost after any reload until the user repeats the input, and Send is blocked meanwhile. The fix is an input replay, a new plan.
- Selector drift: an edit that adds a sibling above an unnamed element can move a mark. The text check turns most such moves lost; an element with the same leading text is not caught.
- Alt-drag on the user's Linux desktop is not tested; the gate drives Chromium directly.
- The picture shows the viewport at scroll 0. A mark below the fold is listed as outside the picture.
- A pin can cover a short label in the picture; the brief repeats the element's text.
- Rendering the pictures happens inside the Send request; any concurrent draft write during it makes Send answer 409.
