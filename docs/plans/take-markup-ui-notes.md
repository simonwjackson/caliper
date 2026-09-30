# Take markup, phase 4: UI notes (branch `markup/ui`)

Run 2, phase 4 (cut B), UI worker. Built on the frozen Step 0 contract
(`76ff680`) from `main` at `7488ae2`. This file records what the UI branch
built, the choices for states the mockup did not draw, the contract requests,
and the gate evidence. Behaviour: `take-markup.md`. Appearance: decision 35.

The served chrome still gets `markup: Unavailable` from core, so none of this
shows until the core worker lands. Everything below runs on the gallery's
local fixtures.

## What is built

| Area | Files |
|---|---|
| Mark glyph (atom) | `canvas/MarkPin.tsx`: two-tone teardrop for a click, letter tab for a box, hollow dashed when lost, dimmed when unresolved |
| Marks on a screen | `canvas/MarkLayer.tsx`: pins and boxes at `rect * scale`; only the pin and the tab take a press |
| Mark surface | `canvas/MarkSurface.tsx`: the clear layer in mark mode (planner choice 1); click is a point, drag is a box, in device CSS px; Pin and Area key controls |
| Note editor | `canvas/NoteEditor.tsx`: name tag, one line, Enter or Escape closes, Done |
| Mark mode button | `bar/MarkModeButton.tsx`: the pin button at the left of the bar; M toggles, Escape leaves |
| Draft | `bar/Draft.tsx`, `bar/DraftTake.tsx`, `bar/DraftMark.tsx`, `bar/DraftButton.tsx`, `bar/draft.css` |
| Send | `bar/NewTakeMenu.tsx`: while the draft holds marks the split's main half is Send with its count, and New take moves to the top of the menu |
| Frames | `canvas/DeviceFrame.tsx`: dashed ink edge 4 px outside, the surface, the pins, the editor under the frame |
| Canvas line | `canvas/Canvas.tsx`: "Mark mode. Click or drag on a frame. M leaves." and the Re-place line |
| Layout | `layout.ts` `draftHeight`; Darkroom sets `--dr-draft-h`; the bar sets `--dr-draft-room` |
| Fixtures | `fixtures/markup.ts` (local marks through the shared Send policy), 8 new views in `fixtures/views.ts`, markup actions in `fixtures/scenario.ts` |
| Parts | 9 new part files, and markup states on the Darkroom, Canvas, ComposerBar and DeviceFrame parts |
| Gates | `scripts/ui/applicable.ts` markup rules; 6 markup gates in `scripts/ui/verify.mjs`; `test/ui-markup.test.ts` |

The `takes` fixture now has markup `Ready` with an empty draft, and its
experiment frames are markable. The real files are not (phase 6).

## Choices for undrawn states

| State | Choice |
|---|---|
| Mark button with nothing to mark | Hidden when no frame is markable, mark mode is off and the draft is empty (first run). Shown disabled with the frame's reason when the draft has marks but no frame takes one, for example while Send runs, so the row does not jump. |
| Send placement | Drawn: Send is the split's main half. New take then sits at the top of the split menu as "New take from the prompt", and Ctrl+Enter in the prompt still starts it. Cost: New take is one tap deeper while the draft holds marks. |
| Send blocked | Disabled with the policy's reasons in its title. The draft button gets a warn dot. Each take in the draft says "waits" in the warn colour; a lost mark's reason shows under that mark. |
| Sending | Send shows a running dot and "Sending N marks"; the draft's edit, Remove and Re-place buttons are disabled; mark mode is off. |
| Send refused | An alert above the well: "Send did not go through." and the reason. Send stays enabled when core says so. |
| Re-place | The canvas line says "Re-place 3A: click or drag on its take. Esc cancels." The mark's row says where to click, with Cancel. |
| Running parent | The take's reason from the policy in the draft, under its name. |
| Keyboard marking | Tab reaches Pin and Area at the foot of each markable frame. While one has focus, a target shows on the frame: arrows move it by a 32nd of the width, Shift and arrows size an area, and the button places the mark at the target. Area without a sized target places a quarter-size box round the target. |
| Where the note editor opens | Under the frame that shows the mark; in the draft beside the note when the draft is open; above the well when no frame on the canvas shows the mark (another device or state). |
| The draft's size | The draft unfolds over the canvas as one card with the bar, as drawn, instead of pushing the canvas up. The canvas keeps its size, so no frame reflows when the draft opens. Its height is `min(draftHeight(chrome height), room above the bar)`, and it scrolls inside itself. |
| Draft thumbnails | The take's own page in a second, inert, lazily loaded iframe, scaled to the thumbnail. Not registered with `onFrameMount`, so it does not reload on file changes while the draft is open. A take whose marks are on another device or state shows a plate: "Placed on ODIN 2 PORTAL". |
| Marks on other devices | Listed in the draft with "Placed on Default, ODIN 2 PORTAL". No pin is drawn on the canvas, as planner choice 2 says. |
| Pins outside the viewport | Clamped to the nearest edge of the screen, so every pin stays in reach. |
| Mark after Z | The fixture letters follow planner choice 5 (AA, AB); the UI shows whatever letter core sends. |

Not built: "Clear all" from the mockup's draft head. The contract has no such
action, and removing each mark in turn would race the revision check.

## Contract requests (for the coordinator; the UI did not change the contract)

1. **Where a point pin's tip goes.** `MarkPin.rect` is the resolved rect. The
   UI draws a Point's tip at the rect's centre. If core sends the element's
   box, the pin sits at the element's centre, not where you clicked. Proposal:
   document that a Point's rect has no size and sits at the clicked point, or
   add the point to `MarkPin`.
2. **Policy reasons name opaque ids.** `planSend` writes "Mark m-3a: …". The
   UI hides a group reason that repeats a lost mark's own reason, so the id
   does not show for lost marks. Other reasons (duplicate id, missing parent)
   would still show the id. Proposal: reasons use the mark's name (3A).
3. **Thumbnail source.** If a second page load per marked take is too costly,
   the contract needs a thumbnail URL for each draft group (for example the
   last render PNG).

## Gates and evidence

Run in `.worktree/markup-ui`:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | passes |
| `bun test test/ui-parts.test.ts test/ui-layout.test.ts test/ui-markup.test.ts` | 79 pass, 0 fail |
| `bun test test/chrome-contract.test.tsx test/send-plan.test.ts` (frozen) | 16 pass, 0 fail |
| `scripts/verify-chrome-contract.mjs` (frozen) | 17 scenarios, 106 hooks, passes |
| `scripts/build-chrome.mjs` | builds |
| `scripts/ui/verify.mjs` | 226 gates pass after the rebase onto `5b77701` (225 before it): 34 fixtures at 3 sizes, 106 hooks, actions, keyboard, preservation, 8 sizes of reachability (now including `mark`, `draft` and `sendFailed`) |

Before this branch, `scripts/ui/verify.mjs` on `7488ae2` passed 170 gates and
failed one: "the union over fixtures is every CAL hook", missing the 16
markup hooks.

The markup gates in `scripts/ui/verify.mjs` prove, on the gallery:

- A click on take 6 at a quarter of its width is `onMarkPoint(key, {160, 240})`
  on the 640 x 480 RG353M; a drag is the right box, and a reverse drag too.
- A press at the middle of a phone-sized frame is `{320, 240}`.
- The note editor takes focus at a new mark and keeps it through a stream
  update; Enter closes it and focus returns to the pin; Escape in a note does
  not leave mark mode; M leaves mark mode.
- The page in a frame gets none of the marking presses and does not reload
  (its tap count and single mount hold); with mark mode off it takes clicks.
- A lost mark disables Send with its reason; Re-place moves it; Send is then
  ready; notes edit, marks remove, and the label follows.
- While Send runs nothing in the draft can change; a refused Send is an alert
  and can be retried; a running take blocks the whole pass.
- Keyboard: Pin and Area place marks at the target in device px.

### Screenshots

`scripts/ui/shoot.mjs mark draft marked draftReady replacing sending sendFailed markRunning`
writes `scripts/ui/out/<fixture>-<size>-<scheme>.png`, and for `mark` and
`draft` a side-by-side with the mockup in `scripts/ui/out/compare/`.

## What is not proved

- Anything with real data: persistence, a second chrome, selector drift,
  Alt-click, the agent's picture. Those are core's and the phase 4 gate's.
- M does not work while keyboard focus is inside a frame's page; the key
  goes to the frame's own document.
- Touch on the Fold. The surface sets `touch-action: none`, so a drag marks
  instead of scrolling; the canvas scrolls outside the frames. Not tried on
  the device.

# Phase 5: chains on the canvas (branch `markup/p5-ui`)

Run 2, phase 5, UI worker, from `main` at `78df06c` on the frozen Step 0
contract (`6a6ec00`, `78df06c`). Commit `020c61b`. Behaviour: plan decisions
11 to 13, planner choices 15 to 20. Appearance: decision 35, mockup state
`takes`.

The served chrome still gets a chain of one for every take from core, so
until the core worker lands it shows each take as "N no follow-up". That is
true of the wire today. Everything below runs on the gallery's fixtures.

## What is built

| Area | Files |
|---|---|
| Chain (organism) | `canvas/Chain.tsx`: the head, the history when open, and the pair, parent then shown take. It spans the three rows of its band with subgrid, and two subgrid columns when it holds a pair |
| Chain head | `canvas/ChainHead.tsx`: bold take, "← from 1" in ink 2, "(1 discarded)" in ink 3, "no follow-up" for a chain of one, the flag, the swap and "3 in chain" |
| Chain history | `canvas/ChainHistory.tsx`: steps oldest first with arrows; present steps are buttons that call `onTake`; discarded steps are struck `span`s with `aria-disabled` |
| Accept flag (atom) | `atoms/Flag.tsx`: `Fold` in the chain head is a `details` whose summary is the label (warn ink, dotted underline, title with the reason) and opens to the reason; `Full` in the record writes the reason out |
| Fit rule | `layout.ts` `pairFits(frame, gap, canvas)`: two frames at true size and one gap against the canvas width |
| Canvas | `canvas/Canvas.tsx`: loose frames first, then chains; reads `--dr-gap-now` (now a registered length) for the rule; `data-pairs="fit" \| "solo"` on the canvas |
| Device frame | `canvas/DeviceFrame.tsx`: `before` draws the page at 78 %; `hidden` keeps a frame mounted but not drawn |
| Take record | `side/TakeRecord.tsx`: the lineage line and the full flag. No accept note (choice 20) |
| Fixtures | `fixtures/chains.ts` (take records and an accept log through `planChains`, as core does); three families in `fixtures/views.ts`; `onChainHistory`, `onChainSolo` and `onTake` rebuild the chains in `fixtures/scenario.ts` |
| Parts | `Chain`, `ChainHead`, `ChainHistory`, `Flag`, and chain states on `Canvas`, `DeviceFrame`, `TakeRecord` and the Darkroom page |
| Gates | chain rules in `scripts/ui/applicable.ts` (the swap applies only while `data-pairs` is `solo`); 9 chain gates in `scripts/ui/verify.mjs`; `test/ui-chains.test.ts`; `pairFits` tests in `test/ui-layout.test.ts` |

### Fixtures

| Fixture | What it holds |
|---|---|
| `takes` (changed) | The mockup: 6 ← from 1 (1 discarded, take 4), 5 ← from 2, and 3 alone, flagged because take 8 of the Button changed `PicoButton.css`, which take 3 also changes (reason `Files`). The frames and their keys are the same as before, so the phase 4 marks still sit on them |
| `chainHistory` | The same takes an hour later plus take 7, a second pass on take 1: a branch. Take 1's history is open: Take 1, Take 4 (struck), Take 6, Take 7 |
| `chainsAccepted` | After take 8 of Game Detail was accepted: chains 1, 2 and 7 ← from 3 (1 discarded, take 5) are all flagged. Chain 3 → 7 remembers `solo: "Parent"`. Take 7's record is open |
| `chainsOdin` | The mockup's chains on the ODIN 2 PORTAL |

## Choices for undrawn states

| State | Choice |
|---|---|
| Where the grid puts things | Bands of three rows (heads, open histories, frames). Every item spans three rows with subgrid, so heads line up and every frame's top lines up with the real files, which have no head. A loose frame keeps one wrapper in every mode (`display: contents` outside Takes), so a mode change does not remount it |
| The open history | A line of text steps under the head, in its own band row, so frames in the band stay aligned. No thumbnails (see requests) |
| The flag's reason on the canvas | A disclosure: tap, click or Enter opens the reason on its own line under the head. The summary also has the reason as its title |
| The fallback | One frame per chain, the one `chain.solo` names. The other frame stays mounted and hidden, so a swap or a resize keeps the state reached in it. "Show take 1" or "Show take 6" sits in the head beside "3 in chain", as a link in ink 2. A parent shown alone keeps its 78 % |
| A flagged chain | Its frames at 60 %, as the mockup draws. After an accept on the same part every chain is flagged, so every take frame is at 60 % (`chainsAccepted`) |
| A head too narrow for one line | A spacer pushes the flag and the controls to the right while the line holds them; what wraps starts the next line at the left. No width threshold |
| Scroll bar | The canvas reserves its scroll bar gutter on both edges, so a scroll bar that comes and goes cannot flip the fit back and forth |
| A very short canvas | Frames are fitted to at least 6 rem of height. Before, a 240 × 180 chrome scaled frames almost to nothing, and a take's name under its frame went with it; the canvas now scrolls. This changes the `wide-short` and `tiny` ladder renders for every canvas |

## Contract requests (for the coordinator; the UI did not change the contract)

1. **What "(N discarded)" means.** The plan (decision 13), decision 35, the
   mockup ("6 ← from 1 (4 discarded)") and this brief ("7 ← from 3 (5
   discarded)") read N as the discarded take's number. `lineageLabel` counts
   discarded takes, and `test/chains.test.ts` expects "6 ← from 1 (1
   discarded)". The UI draws the label core sends, so the brief's fixture
   reads "7 ← from 3 (1 discarded)" with take 5 struck in the history.
   Decide which reading is meant; if it is the take number, `lineageLabel`
   and its test change (both frozen).
2. **A picture per history step.** The mockup draws a 28 px thumbnail on each
   step. `ChainStepView` has no image, so the strip is text. A present step
   could carry its frame's `src` or a render URL; a discarded step has none.
3. **Discarded step labels.** Screen readers do not announce strike-through.
   Proposal: document that a `Discarded` step's label says so in words, as
   the contract fixture does ("Take 4, discarded"). The gallery does.

## Gates and evidence

Run in `.worktree/p5-ui` at `020c61b`:

| Gate | Result |
|---|---|
| `nix develop -c bun run typecheck` | passes |
| `nix develop -c bun test test/ui-parts.test.ts test/ui-layout.test.ts test/ui-markup.test.ts test/ui-chains.test.ts test/chrome-contract.test.tsx test/chains.test.ts` | 119 pass, 0 fail |
| `nix develop -c bun run build` | builds |
| `nix develop -c node scripts/ui/verify.mjs` | 268 of 268 (225 of 226 at `78df06c`): 37 fixtures at 3 sizes, 111 hooks, the union, actions, 9 chain gates, keyboard, preservation, 15 fixtures at 8 sizes of reachability |
| `nix develop -c bun run verify:chrome-contract` (frozen) | 19 scenarios, 111 hooks, passes |

The chain gates prove, on the gallery:

- Desk, `takes`: one group per chain in the view's order; each heading's
  text is the chain's label; its frames are parent then shown; every frame
  key is drawn once and the real files are in no chain; the parent's page
  is at 0.78 and a flagged chain's at 0.6; the real files and the first
  pair start on one line; heads of one band line up.
- History: "3 in chain" opens with Take 1, Take 4, discarded, Take 6 and
  folds again; a frame keeps its tap count and mounts once; the discarded
  step is a struck `span` and a click on it calls nothing. In
  `chainHistory`, picking Take 7 calls `onTake("7")`, the head reads
  "7 ← from 1" and the bar says Take 7.
- Flag: one flag on take 3's head, in the warn colour, with the reason in
  its title; Enter opens the reason. The record writes lineage and reason
  out; the bar has neither an accept note nor a flag.
- RG353M: the Fold (1000 × 680) holds pairs and has no swap; the phone
  (416 × 640) shows the shown take, keeps the parent mounted, and "Show
  take 1" calls `onChainSolo(id, "Parent")`; the parent shows, nothing
  remounts, and it swaps back. A chain of one has no swap.
  `chainsAccepted` on the phone shows the parent core remembered.
- ODIN 2 PORTAL: the desk (1600 × 1000) holds an RG353M pair; switching to
  the ODIN 2 PORTAL turns both parented chains to one frame with a swap; a
  1920 × 1200 chrome holds the ODIN pair.
- Every take reachable, for `takes`, `chainHistory`, `chainsAccepted` and
  `chainsOdin` at the 8 ladder sizes: the fit matches the rule from the
  measured canvas; each chain's history toggle is in reach; each shown or
  parent frame's name is in reach or one swap away; every present step of
  every unfolded history is in reach; every take the state lists is on the
  canvas or a step.

Four existing gates changed because a parent is now hidden where its pair
does not fit, or for a race:

- The phone markup gate presses on take 3, a chain of one, not on take 1.
- The actions gate clicks take 3's name after switching to the ODIN 2 PORTAL.
- The Re-place gate presses higher on take 3: take 3 is now in the second
  band, and the open draft covers the lower part of it.
- The token list gate waits for its `requestAnimationFrame` focus. It failed
  once in a full run beside a parallel build and passed 3 of 3 alone.

### Screenshots

`nix develop -c node scripts/ui/shoot.mjs takes chainHistory chainsAccepted chainsOdin`
writes them (the folder is ignored by git). Looked at:

- `scripts/ui/out/compare/takes-desk-dark.png`: the mockup and this build side by side.
- `scripts/ui/out/takes-desk-dark.png`, `takes-phone-dark.png`, `takes-phone-light.png`
- `scripts/ui/out/chainHistory-desk-dark.png`, `chainHistory-fold-light.png`
- `scripts/ui/out/chainsAccepted-desk-light.png`, `chainsAccepted-phone-dark.png`
- `scripts/ui/out/chainsOdin-desk-dark.png`

## What is not proved, and limits

- Anything with core data: lineage on the wire, the accept log, the
  remembered side across a reload, accept removing a chain. Those are the
  core worker's and the phase 5 gate's.
- The scroll bar gutter costs up to 30 px of canvas width where a browser
  draws classic scroll bars. The gates run headless with hidden scroll
  bars, so that cost is not measured.
- The bands need CSS subgrid.
- If the fallback hides the frame whose mark has the note editor open, the
  editor is hidden with it until the swap, Escape or the draft.
- Every chain at 60 % after an accept on the same part is the mockup's
  dimming applied to choice 15's answer C. Worth a look by the user.
- Not tried on a real Fold, or with touch.
