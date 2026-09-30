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

# Phase 6: references and marks on the original (branch `markup/p6-ui`)

Run 2, phase 6, UI worker, from `markup/p6` at `7187273` on the frozen
contract (`89c4a77`) and core (`7187273`). Behaviour: plan decisions 6 to 8,
planner choices 13 and 14. Appearance: decision 35, mockup states `mark` and
`draft`. Core already serves this phase, so the served Darkroom shows all of
it; the gallery fixtures follow core's labels and the shared Send policy.

The Mobbin search the brief asks for did not run: this session has no Mobbin
tools. The type-ahead follows the mockup and the combobox pattern (focus
stays in the field, the list names its active option).

## What is built

| Area | Files |
|---|---|
| Pure policy | `references.ts`: `typedName` (the name typed at the caret: a take number, or 0, and up to three letters, at the start of a word), `matchReferences`, `insertReference` (the name replaces what was typed; one space after it; the caret after that), `noteSegments` (names set apart; joined, the note is unchanged), `cropView` (the part of a page a crop shows), `VISIBLE_REFERENCES` = 5 |
| Type-ahead | `canvas/NoteEditor.tsx`: typing a name offers `editor.references` whose name starts with it. ArrowDown and ArrowUp move (and wrap), Enter or Tab picks, Escape closes the list and keeps the note and mark mode, ArrowDown opens it again, typing on opens it again. A press picks and does not take focus. The field is a `combobox` with `aria-activedescendant`. The hint reads "Type 0 or a take number to point to a mark. Enter closes." |
| The list | `canvas/ReferenceList.tsx`: a `popover="manual"` card at window level, under the field or over it when there is more room there, so neither the draft's scroll nor the canvas clips it. It hides while its field is scrolled out of sight. Each option: a crop, the name, core's label, the note with its own names set apart. At most 5 options and 5 crop pages; "3 more match. Type more of the name." |
| Crop (atom) | `atoms/RefCrop.tsx`: `crop.src` in an inert, lazily loaded iframe at `crop.viewport`, scaled and moved so the mark is in a 64 x 48 box. The window keeps the box's shape, holds a region with half its size again round it, a point with a fifth of the page's width round it, and stays inside the page. A two-tone ring marks a point, a box a region. `crop: null`: a dashed plate that says "No picture" |
| Names in notes (atom) | `atoms/NoteText.tsx`: the names of `mark.references` as small bordered tokens (the mockup's `.ref`) in the draft row's notes, in each option's note, in the draft's outcome sentence and in the prompt line. The text is never rewritten |
| Pins' titles | `canvas/MarkLayer.tsx`: "Mark 6B: Too heavy, like 0A. Points to 0A." A lost pin adds its reason |
| Draft outcome | `bar/DraftTake.tsx`: the head is the group's label ("**Original** the real files", "**Take 6** Cover at half"); under it, `outcome.label` with hook `draft-outcome` and `data-outcome`. NewTake reads in ink 2; PointedTo in ink 3 with the picture at 78 %, as a pair's parent is drawn: material to compare with, not the take that changes; WithPrompt in ink. "waits" in warn stays at the right while the group is blocked. The draft's head counts "on 4 takes and the real files" |
| The original | `DeviceFrame`, `Canvas`, `DraftMark`: the real files take mark mode, pins and the note like a take; the Re-place lines say "the real files" |
| Prompt line | `bar/ComposerBar.tsx`: `composer.marks.label` (hook `prompt-marks`) at the top of the well, above the text, where attached images sit, with the names set apart |
| New take stays first | `bar/NewTakeMenu.tsx`: while marks go with the typed prompt, New take stays the split's main half and Send moves to the top of its menu (same hook, `marks-send`). Without a prompt Send is the main half again, as in phase 4 |
| Fixtures | `fixtures/markup.ts`: marks on the original (`sourceOf`), core's group labels and outcome sentences, `references` per mark, the open note's options with crops (lost: null), `composer.marks` while a prompt is typed. `fixtures/scenario.ts`: a press on the real files places 0A, 0B; `onPrompt` moves marks in and out of the prompt; `onStart` takes them out of the draft. Four fixtures in `fixtures/views.ts`; every fixture's real files take marks now |
| Parts | `NoteText`, `RefCrop`, `ReferenceList`, and phase 6 states on `NoteEditor`, `MarkLayer`, `DeviceFrame`, `Canvas`, `DraftMark`, `DraftTake`, `Draft`, `ComposerBar` and the Darkroom page |
| Gates | `scripts/ui/applicable.ts` (the three hooks), 8 reference gates in `scripts/ui/verify.mjs`, `scripts/ui/verify-served-typeahead.mjs` on the served chrome, `test/ui-references.test.ts` |

### Fixtures

| Fixture | What it holds |
|---|---|
| `references` | The mockup's draft with references: 0A on the real files, 6B "... like 0A", 5A "Restore 0A here, with the spacing of 3A". The real files and take 3 are PointedTo; 6, 5 and 2 make takes: "Send · 3 new takes". The draft is open |
| `typeahead` | The mockup's mark state: mark mode on, the note at 6B ends "... like 0", so the list offers 0A and 0B with crops. 3A is lost (no picture); 2A was placed on the ODIN 2 PORTAL (a 1920 px crop) |
| `original` | 0A and 0B on the real files in mark mode: "Send · 1 new take" |
| `withPrompt` | First run with a typed prompt: "0A and 0B go with this prompt.", the group's outcome is WithPrompt, New take is the main button |

## Choices for undrawn states

| State | Choice |
|---|---|
| Where the list opens | At window level beside the field, not inside the card as drawn: the card sits in the canvas's scroll, in the draft's scroll or above the well, and each would clip or grow with an inline list. It covers the note's hint and Done while it is open; a pick or Escape shows them again |
| A name typed in full | Still offered, so Enter on "0A" writes "0A " and keeps the note open; a second Enter closes it. A pick or Escape closes the list for that word until you type on |
| Which names start a list | A number and up to three letters at the start of a word; not after a point, so "0.5" is a number. Letters match in either case and the pick writes core's capitals |
| Many matches | 5 drawn, the rest counted. Only drawn options load a crop page |
| A mark below the first screen | The crop shows the page as it loads, at the top: see limits |
| The mark button on first run | Shown: the real files take marks, so there is something to mark (the phase 4 rule) |
| Where a mark was placed | A draft mark says "Placed on ..." only when no frame on the canvas shows it. Before, the draft compared core's preview label ("Chip · Default") with the selection's ("Default"), so on the served chrome every mark said "Placed on Chip · Default, RG353M" (seen on this branch before the fix; inferred to be on `main` since phase 4) |

## Contract requests (for the coordinator; the UI did not change the contract)

1. **A picture per crop.** Each drawn option loads the take's page in an
   iframe, up to 5 at a time. Core already saves a crop round each mark for
   the agent. A `crop.image` URL (that PNG) would be cheaper, would show a
   mark below the first screen, and would match what the agent sees.
2. **A point's crop rect.** The UI draws a ring when `crop.rect` has no size
   and a box otherwise, because `ReferenceOption` has no `kind`. The served
   chrome sent an Alt-click with no size (seen in `served-typeahead.png`, not
   asserted). Document it, or add `kind`.
3. **Phase 4 request 1 still stands** for `MarkPin.rect` on the canvas.

## Gates and evidence

Run in `.worktree/p6-ui`, one at a time, none beside a build:

| Gate | Result |
|---|---|
| `nix develop -c bun run typecheck` | passes |
| `nix develop -c bun test test/ui-parts.test.ts test/ui-layout.test.ts test/ui-markup.test.ts test/ui-references.test.ts test/ui-chains.test.ts test/chrome-contract.test.tsx test/send-plan.test.ts` | 143 pass, 0 fail |
| `nix develop -c bun run build` | builds |
| `nix develop -c node scripts/ui/verify.mjs` | 320 of 320 (the brief's start: 267 of 268, the hook union short of the three new hooks): 41 fixtures at 3 sizes, 114 hooks, 8 reference gates, 19 fixtures at 8 sizes of reachability |
| `nix develop -c bun run verify:chrome-contract` (frozen) | 20 scenarios, 114 hooks, passes |
| `nix develop -c node scripts/verify-references.mjs --darkroom` | 3 of 3 |
| `nix develop -c node scripts/verify-markup.mjs --darkroom` | 7 of 7 |
| `nix develop -c node scripts/verify-chains.mjs --darkroom` | 5 of 5 |
| `nix develop -c node scripts/ui/verify-served-typeahead.mjs` | 9 of 9 |

The reference gates prove, on the gallery:

- `typeahead`: the note has focus; a note ending in 0 offers 0A and 0B, the
  first active, one crop page each; ArrowDown and ArrowUp move and wrap, and
  the field's active descendant follows; Enter writes `... like 0B ` through
  `onMarkNote("m-6b", ...)`, closes the list, keeps the note and focus;
  typing "and 5" offers 5A and Tab writes it; with the list closed Enter
  closes the note.
- Filtering: "0b" narrows to 0B, Backspace widens again, no number closes the
  list, "3" offers 3A with no picture and no page, "3Z" matches nothing, "6"
  (the note's own take) offers nothing, and "2" offers 2A with a 1920 px page.
- Escape closes the list and keeps the note, its text, focus and mark mode;
  ArrowDown or typing on opens it again; Escape with the list closed closes
  the note and still keeps mark mode.
- A press on an option picks it and focus stays in the note.
- `references`: each group's outcome hook, `data-outcome` and text are core's;
  every note reads as written and its `.dr-ref` tokens are its `references`;
  the outcome's names are set apart; take 3's picture is at 0.78; 6B's pin
  title ends "like 0A. Points to 0A."; picking 0A in the draft's own editor
  turns the original's outcome into "Pointed to by 6A, 6B and 5A".
- `withPrompt`: the prompt line reads "0A and 0B go with this prompt." in the
  well, New take is the main half and Send is in the menu; an empty prompt
  takes the line away and puts Send first; Ctrl+Enter calls `onStart` and
  the marks leave the draft.
- `original`: the real files have the dashed edge and their pins' labels; a
  press is `onMarkPoint("real", {480, 120})` and opens 0C; the keyboard's Pin
  places at {320, 240}; the draft names the group "Original · the real files"
  with "Send makes a new take from the real files."
- At the 8 ladder sizes the list shows, the field is on screen, the list is
  inside the window and does not cover the field, and every option is in the
  list or its scroll.

`verify-served-typeahead.mjs` runs a live subject, real frames and core:
Alt-click marks 0A, 2A and 1A; typing "use 2" offers only 2A and its crop
loads core's frame URL; Enter and then "and 0" plus Tab write
"use 2A and 0A " through core with the caret after each pick; the draft says
PointedTo, PointedTo, NewTake, sets 2A and 0A apart, and says no "Placed
on" for marks on the shown state.

### Screenshots

`nix develop -c node scripts/ui/shoot.mjs typeahead references original withPrompt`
and the served gate write them (the folder is ignored by git). Looked at:

- The note editor with the type-ahead: `scripts/ui/out/typeahead-desk-dark.png`,
  `typeahead-desk-light.png`, `typeahead-phone-dark.png`,
  `typeahead-phone-light.png`, and `scripts/ui/out/compare/typeahead-desk-dark.png`
  beside the mockup's `mark` state.
- The draft with PointedTo groups: `scripts/ui/out/references-desk-dark.png`,
  `references-fold-light.png`, `references-phone-dark.png`.
- `scripts/ui/out/withPrompt-desk-dark.png`, `withPrompt-phone-light.png`,
  `original-fold-dark.png`.
- The served chrome: `scripts/ui/out/served/served-typeahead.png`,
  `served-draft.png`.

## What is not proved, and limits

- A crop shows the page at the top, as it loads. A mark further down a page
  that scrolls falls outside its crop (request 1).
- Each drawn option loads a live page: up to 5 while the list is open.
- The field is a plain input, so the name being typed is not drawn as a token
  inside it, as the mockup draws "0".
- The list covers the note's hint and Done while it is open.
- In the light scheme the 78 % of a PointedTo picture lightens it, as it does
  a pair's parent.
- Only names that start with a number are offered; there is no way to browse
  every mark without typing a take number.
- Not tried on a real Fold, or with touch.
