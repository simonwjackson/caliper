# Take markup, Run 2: build plan

Status: phase 4 Step 0 is built. Production markup is not connected.
Phase cut B is confirmed. The user also confirmed that Send waits for every
marked take: lost marks and running parents block the entire pass.
The remaining planner choices are not user-confirmed.

Behaviour: `docs/plans/take-markup.md` decisions 1 to 13. Appearance:
`docs/decisions.md` 35 and the mockup states `takes`, `mark`, `draft` and
`agent`. Foundation: `docs/plans/react-chrome.md` (Run 1, merged at `12cb7b9`).
This plan replaces that file's one-line rows for phases 4 to 6. Where this plan
makes a choice that the user has not made, it says so under "Planner choices".

## Phase cut (settled: B)

`react-chrome.md` cuts Run 2 as: phase 4 marks and the draft, phase 5 Send and
chains, phase 6 references and marks on the original. After phase 4 you can
place marks, but you cannot send them. Nothing tests the main question, which
is whether marks give better takes than screenshots, until phase 5 is done.

| Cut | Phase 4 | Phase 5 | Phase 6 | Cost |
|---|---|---|---|---|
| A. As written | Marks, mark mode, Alt-click, lost marks, draft | Send, chains, history, pair view, accept and discard | References, marks on the original | Phase 4 gives nothing you can use. The biggest risk is tested last. |
| B. Send early (recommended) | Marks, mark mode, Alt-click, lost marks, draft, **Send making new takes shown flat**, with `parent`, `chain` and history stored | Pair view, chain history, accept and discard rules | References, marks on the original | Until phase 5 lands, takes pile up flat, the way decision 11 was meant to prevent. Phase 4 is larger. |

The user chose B on 2026-09-30. It is the option C from the interview (Q15).
Phase 4 of cut B stores every record field that phase 5 needs, so phase 5
changes only how takes are shown and removed, not what is stored.

## What exists today (verified at `12cb7b9`)

- Frames are same-origin iframes. `src/client/app/runtime.ts` keeps each frame
  node by key (`onFrameMount`) and reloads take frames when a take's file
  changes. A reload loses any state reached by input.
- `FrameView.key` includes take creation identity because take numbers are
  reused: `store.create` picks `max(used) + 1` (`src/takes/store.js:155`), so
  discarding the newest take frees its number.
- Copying a take into a new take exists only in `src/takes/integration.js`
  `begin`, for alternates.
- The first message of a take's agent is built in `firstMessage`
  (`src/agent/take-agents.js:498`): prompt, direction, source, one render PNG.
- `renderJobs` (`src/render/render.js`) opens each job in Playwright Chromium at
  the device's CSS viewport and writes a PNG. It has no way to draw on the page.
- The event stream sends `project`, `code`, `takes` and `checks` events
  (`src/plugin.js`). Take routes live in `src/agent/api.js`.
- `ChromeView` and `ChromeActions` (`src/client/ui/contract.ts`) have no marks,
  chains or draft.

## Planner choices

The user did not make these. Each one is reversible before its phase starts.

1. **Marks are placed through an overlay, not inside the frame.** In mark mode
   the UI puts a transparent layer over each markable frame. It turns a click
   or a drag into device CSS px with the frame's geometry, and calls
   `onMarkPoint(frameKey, point)` or `onMarkRegion(frameKey, rect)`. Core then
   runs `elementFromPoint` (or finds the elements inside the rect) in that
   frame's document and builds the anchor. The frame never gets the click and
   is never reloaded, so a state reached by input stays (phase 4 gate). This
   keeps the Run 1 split: UI owns gestures and geometry, core owns frames.
   Alt-click and Alt-drag outside mark mode have no overlay, so core listens in
   the capture phase on each frame document and calls the same path.
   Cost: two input paths to test. Alt-drag may never reach the page on Linux
   desktops that move windows with Alt-drag (plan decision 9).

2. **What a mark stores.** Take identity (`take` and its `created` time, or
   `original`), preview part and state, device, letter, note, and an anchor:
   `point` or `region`, the rect in device CSS px from the document origin, a
   selector, tag, classes, the first 80 characters of text, and `afterInput`.
   `afterInput` is true when the frame got pointer or key input since its last
   load. A mark shows only on frames with the same take identity, preview and
   device. The draft lists the others with their device.

3. **Selector.** Build it from the element up to `#caliper-host`: an `id` or a
   `data-*` test attribute when one exists, otherwise `tag:nth-of-type(n)` for
   each step. Cost: a take edit that adds a sibling above the element moves the
   mark to the wrong element with no warning. A text check limits this: a
   mark whose element's text no longer starts with the stored text is lost.

4. **Lost marks.** Each chrome re-resolves every shown mark after each frame
   load and each draft change. A mark is lost when the selector matches
   nothing, matches an element with no box, or fails the text check. Lost is
   computed in each chrome, not stored. Re-place makes the next mark click move
   that mark. **Send is blocked while the draft has a lost mark**, with the
   reason, because decision 10 says a lost mark is never dropped quietly.
   The user confirmed this blocking rule during Step 0. The selector and
   re-resolution details remain implementation proposals.

5. **Letters.** Letters are per take identity, A to Z, then AA, AB and so on.
   A letter is not reused while its mark is in the draft. This answers the
   open item "letters after Z".

6. **The draft on the server.** `.caliper/marks.json` holds
   `{ revision, marks[] }`. Routes: `GET /__caliper/marks`,
   `PUT /__caliper/marks/<id>`, `DELETE /__caliper/marks/<id>`,
   `POST /__caliper/marks/send`. Every write sends `revision`; a stale write is
   refused, and the chrome reloads the draft. The stream gets a `marks` event.
   This is last write wins per mark with a revision check, which is stricter
   than decision 10 and does not change its meaning.

7. **One Send policy, shared.** A pure module, `src/takes/send-plan.js`, turns
   the draft and the takes into the list of new takes, which marks each gets,
   and why a take gets none. The chrome uses it for the Send label and the
   draft's per-take line; the server uses it again at Send. This is how
   `src/client/images.js` already shares one policy between both sides.

8. **Which takes can be marked.** Experiments and, in phase 6, the original.
   Not alternates: they have their own review and exact-revision apply. A
   running take can be marked, but Send is blocked for it until its agent
   stops, because the copy would catch it halfway through an edit.
   The user confirmed that one running parent blocks the entire Send, not
   only that parent's new take.

9. **Record fields for chains.** A new take's record gets
   `parent: { take, created }`, `chain: { take, created }` (the chain's first
   take, copied from the parent, so a discarded middle take never splits a
   chain), `history` (the full text history of decision 13) and `marks` (the
   marks it was sent). The copy moves out of `integration.js` into one
   `store.fork(take, record)` that both paths use.

10. **The picture the agent gets.** At Send, the server renders the parent
    take at the mark's preview and device with a new `RenderJob.annotations`
    list. After the verdict, the render page draws the two-tone pins and boxes
    at the stored rects, then takes a second screenshot. Marks with
    `afterInput` get a line in the brief: "placed after input; the picture
    shows the state before input". Cost: for those marks the picture and the
    pin disagree. There is no way to screenshot the user's own live frame from
    the dev server. See "Unknowns".

11. **The brief.** The first message of a markup take is built by a new
    `markupMessage`, next to `firstMessage`. It holds the history, then this
    pass's marks (letter, note, element line), then the picture, in the layout
    of the mockup state `agent`. Its format is a tested pure function.

12. **Typed follow-ups do not change in Run 2.** "Send to take N" still edits
    the take in place. This stays an open item in `take-markup.md`.

13. **Phase 6 read access.** A referenced take joins a read-only list for the
    new agent. `read_file` and `list_files` take an optional `take` from that
    list. `edit_file` and `write_file` have no such field, so the fence of
    decision 15 does not change. A crop of the referenced take's picture
    around the mark goes with the brief.

14. **Phase 6 marks on the original.** An unreferenced mark on the original
    makes one new take from the real files at Send. When you type a prompt and
    press New take, the original's marks go into the planner's input and the
    agents' first messages instead, and they leave the draft. Cost: two ways
    for original marks to leave the draft, so the draft must say which one
    will happen.

15. **Accept flag.** Accept appends `{ take, created, part, state, at }` to
    `.caliper/accepted.json`. A take of the same part made before that time is
    flagged "made before take N was accepted". Cost: a take whose part differs
    but whose files overlap is not flagged.

## Phases

Each phase: a Step 0 contract change by the coordinator, then work in
worktrees, then the gate, then a fast-forward onto `main`, a re-pin of the
recovery tool, and a deploy to the Pico target. Use the Run 1 ownership split
(UI: `src/client/ui/**`; core: `src/client/app/**`, server, agent, render) and
the Run 1 rule that a worker does not change the frozen contract.

### Phase 4 (cut B): marks, draft and Send

Contract: `ChromeView.markup` (mode, draft groups, Send availability and
label, open editor), `FrameView.marks` (pins with letter, rect, lost) and
`FrameView.markable`. Actions: `onMarkMode`, `onMarkPoint`, `onMarkRegion`,
`onMarkNote`, `onMarkRemove`, `onMarkReplace`, `onDraftOpen`, `onSend`. New
hooks for each. Fixtures for an empty draft, a draft with a lost mark, a
blocked Send and a running Send.

Core and server: choices 1 to 11. UI: the pin button, the dashed frame edge and
crosshair, pins and boxes, the note editor, lost pins, the draft row above the
bar, the Send button, as drawn.

Gate:
- Unit: `send-plan.js` counts; selector and lost rules; letters past Z; stale
  revision refused; `store.fork` copies every edited file and no images;
  `markupMessage` text.
- Browser, no model: a mark survives a chrome reload and a Vite restart; a mark
  made in one chrome appears in a second one; an open menu in a frame stays
  open when mark mode turns on and a mark is placed; Alt-click marks without
  mark mode; a changed take turns a mark lost and blocks Send.
- Real model, on the pinned tool and a scratch subject, then on Pico: mark 2
  of 3 takes, Send once, 2 new takes run in parallel, each brief holds only its
  own marks and the picture shows the pins.

### Phase 5: chains on the canvas

Contract: the Takes canvas groups frames into chains (head, parent or nearest
existing ancestor, gap label, history count, accept flag). Actions:
`onChainHistory`. Core: accept removes every take with the same `chain`;
discard removes one take; `accepted.json`; the per-device fallback of decision
35 (one pair needs two frames and a gap at true size).

Gate: accept and discard follow plan decisions 11 to 13, including a discarded
middle take ("7 ← from 3 (5 discarded)"), a flagged chain after accept, and
the fallback on RG353M and ODIN 2 PORTAL widths. Every take stays reachable at
the size ladder.

### Phase 6: references and marks on the original

Contract: reference tokens in notes, type-ahead with crops, marks on the
original frame. Core: the reference rule of decision 7 in `send-plan.js`,
choices 13 and 14, planner input with marks.

Gate: "use 2A here" gives take 3's agent 2A's element, crop and read access
to take 2; a write to take 2 fails; a take whose marks are all referenced gets
no new take; the Send label matches the server's result; "0A" from a note
never makes a take; an unreferenced "0A" makes one take from the real files.

## Unknowns to settle early

| Unknown | Why it matters | How to settle it |
|---|---|---|
| Marks after input | The agent's picture shows the state before input. | Phase 4 ships the `afterInput` line. If you often mark open menus, the fix is an authored-check-style replay of your input, which is a new plan. |
| Selector drift | A take edit can move a mark onto another element. | Count lost and wrong marks while using phase 4 on Pico. |
| Alt-drag on this desktop | It may never reach the page. | Test on the user's own desktop in phase 4. |
| Cost per pass | Three new takes run about 30 s in parallel, and each makes one extra render for the picture. | Record times in the phase 4 gate. |

## Phase 4 Step 0 record

The coordinator built the contract, fixtures and shared Send policy in
`markup/contract`, from `110205a`. This does not complete phase 4. No workers
started, no marks are persisted, and no markup agent is launched.

`ChromeView.markup` distinguishes unavailable markup from a loaded draft.
The loaded draft contains its revision, mode, groups, open note editor and
Send state. `FrameView` adds markability and projected pins. A pin distinguishes
located, lost and unresolved locations. Unresolved locations also block Send,
so loading a frame cannot authorize an unchecked mark.

Take identity is `{ take, created }`. Mark actions use opaque draft ids.
A take number plus letter is only a display name. Placement actions take a
frame key and numeric device CSS px from the iframe viewport. Core converts
those points into document-origin anchors and projects stored anchors back
into viewport rectangles. UI does not discover selectors or read frame documents.

The coordinator added `onMarkEdit(id | null)` to open or close an existing
note. The original action list lacked that operation. `onMarkReplace` remains
a separate operation. `onSend(revision)` captures the displayed draft revision.
Core must reject stale revisions, recheck parent identity and location, and
block the whole pass if any marked parent is running. Typed follow-ups stay
unchanged.

`src/takes/send-plan.js` is a pure, browser-safe policy over validated inputs.
It groups marks by exact take identity and returns `Empty`, `Blocked` or
`Ready`, with one count and label shared by both callers. A blocked result
authorizes no groups. Missing parents, reused take numbers, alternates,
duplicate mark ids and unresolved locations remain visible blockers. References
and original marks are not part of this phase 4 policy. This module does not
validate wire payloads or resolve anchors.

The existing unstyled `Chrome.tsx` runs the added contract controls and an
example overlay. Its native coordinate buttons exercise point and region
callbacks with keyboard input. These buttons, its jitter threshold and its
plain pin buttons do not specify the production design. Decision 35 remains
the visual contract. The shipped-reference check inspected the anchored comment
editor in [Higgsfield](https://mobbin.com/screens/f04d66dd-9181-4921-83cc-76330b2b57ac).
It supports keeping the note tied to its marked object, not a new visual direction.

The served Darkroom still receives unavailable markup, empty pin lists and
disabled markability. Direct production markup callbacks report that the
controller is not connected. They make no requests and no file writes.

### Freeze and ownership

Freeze `src/client/ui/contract.ts`, `src/client/ui/hooks.ts`,
`src/takes/send-plan.js`, `test/send-plan.test.ts`, the contract fixtures,
`test/chrome-contract-types.ts`, `test/chrome-contract.test.tsx`,
`scripts/fixtures/chrome-contract.tsx`, `scripts/verify-chrome-contract.mjs`,
and the executable reference `src/client/ui/Chrome.tsx` during the worker run.
Requests for changes go to the coordinator. Keep the Run 1 UI/core split.
Core owns storage and schemas, anchor resolution, location checks, Alt input,
forking, annotated renders and agent launch. UI owns the production overlay,
pins, notes, draft, focus, layout and touch gestures. Do not weaken a gate.

### Verification and limits

Typecheck and build pass. The final targeted run passes all 54 Send policy,
contract and decomposition tests. A read-only review found a stale per-parent
decision after mark removal; the coordinator fixed it and added a regression.
The reviewer verified the correction. The browser gate passes 17 scenarios
and all 106 hooks. It checks
point conversion, reverse-drag rectangles, scaling at 416 px, note focus across
updates, note reopening, draft disclosure, revision capture and blocked Send.
The frame's reached input state survives turning mark mode on and placing marks.

The full-suite run before the final fixture correction reports 550 pass,
1 skip and 1 fail. The failure is the existing
60-second timeout in `test/authored-execution.test.js`. An isolated retry and
an unchanged detached `110205a` worktree both reproduce that timeout. This is
not a clean full-suite pass. The first run also caught two reference-component
decomposition failures; the coordinator fixed them without changing their gates.

The public browser, code and takes smoke gates also pass against the built
served chrome. They do not prove markup behavior. A broader core-gate attempt
stopped at its 120-second command limit before completion. Several existing
scripts explicitly defer layout checks despite the README's broader description.
Do not present that attempt as a completed 21-gate or layout result.

The reference does not prove persistence, multi-chrome synchronization,
selector drift, Alt input, real-model context, production layout or Pico input.
These remain phase 4 integration gates. Step 0 does not move the recovery-tool
pin or deploy an unfinished markup feature. Re-pin and deploy after the full
phase lands, as required above.

## Next stop point

Step 0 is the frozen basis for the phase 4 UI and core workers. Do not start
phase 5, add references, or mark the original as part of phase 4. The next work
is the production implementation, followed by the full phase gate.
