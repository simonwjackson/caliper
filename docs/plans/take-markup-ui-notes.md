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
