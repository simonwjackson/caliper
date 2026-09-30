# Visual direction: Darkroom (seventh pass)

The chosen direction for Caliper's chrome, 2026-09-28. Decision 34 in
`docs/decisions.md` records it, and decision 35 records how take markup
looks. Decision 36 now chooses React for the eventual chrome and self-editing;
these HTML files remain visual references, not the live renderer. Two other
directions (Bench, Tiles) were shown and dropped the same day; they are in this folder's history at `d2acd70`. The Darkroom passes are
`40a76c1`, `03d63a5`, `9056d03`, `416c6a5`, `daea00b`, `a057ac8` and
`d60973f`.

`b-darkroom.html` is one page. `?state=` picks the state and `b.css` is the
one stylesheet. Sections that changed in the second pass live in `parts/` and
`assemble.mjs` splices them in. `index.html` is the gallery; `out/` holds
every render at desk (1600 × 1000), unfolded Fold (1000 × 680) and folded
phone (416 × 640), light and dark.

## Seventh pass: nothing the Takes panel held may be lost

Moving takes onto the canvas removed the Takes panel. An audit of
`src/client/chrome.js` found six things that panel holds and the mockup had
no place for. Each now has one:

| The panel held | Now |
|---|---|
| The plan review: editable directions, the strange one, Back, "Start N takes" (decisions 16, 33) | `plan`: the directions wait on the canvas in the slots their takes will fill. The bar keeps the prompt, read only, with Back and Start. |
| A take's log, direction and "Created in" note | `log`: click the take's name. Its record opens as the side panel. |
| Review alternate | The foot of the record. |
| Stop | The record's header, while the take runs. Not drawn: no state shows a running take. |
| The take count and "Send to take N" | `menu`: New take is a split button. The menu holds 1 take, 2 to 4 planned, and Send to take N (Shift+Enter). |
| The agent line and skills | The foot of the same menu, in the dimmest ink. An agent that fails to load must show in the bar, where the prompt is. Not drawn. |
| Image attachments (decision 32) | A clip in the field, thumbnails above it. |

Three open points from the sixth pass are settled here:

- Pins are two-tone: a white fill, a dark ring and a dark letter. They read
  on a white part and on a black one. Marks do not get a hue, so the
  no-accent rule holds.
- The editor has no chip row. You type a mark's name, the matches drop down
  with a crop of each, and Enter makes a token. Clicking a mark on another
  frame while the editor is open does the same (not drawn). Twenty marks no
  longer make a wall of chips.
- The pair view falls back to the newest take only when the canvas cannot
  hold one pair at true size: two frames and one gap. On the ODIN 2 PORTAL
  (604 px a frame, 40 px gap) that is any canvas narrower than 1,248 px.
  The rule is per device, from the canvas width. Not drawn: every takes
  state shows the RG353M.

Layout fixes: the bar reads its own width with a container query, so it
stacks on the Fold as on the phone; a take's record hides the parts panel
between 44 and 72 rem; on the phone the record is a sheet over the lower
half, so the stage keeps half the height (decision 22).

## What changed in the second pass, and why

| Feedback | Change |
|---|---|
| The items around takes felt like noise | Takes moved out of the panel onto the canvas, in one row beside the real files. Under a frame there is only its name and a dot if a check failed. The right panel is gone in that state. Accept, Discard and Revise sit in the one bar at the bottom, with the composer. |
| Need to see takes together and comment on what works | Click a take to focus it; drop numbered pins on the image, each with a note. "Revise from notes" sends them to the agent. Staged, not built. |
| Not keen on the yellow | No accent hue. Selection, focus, the live knob and the primary button use ink. The product is the only colour on screen. `?accent=sky` keeps one cool alternative for comparison. |
| Checks modal: less slop | Donut, badge pills and footer copy removed. One total line, then a glyph column (tick, cross, dash) per group. Failed group first with its reason inline. |
| Knobs: show, do not tell | Sliders for numbers. The whole 16-colour palette is the control for a colour. A container threshold is a bar with the threshold mark and a "now" line for the part's current size. Only the live knob shows its source path. Skipped outputs fold into one line. |

## Sixth pass: the canvas as one grid

Red mark: the original's top edge sat lower than the chains' frames, because each chain was a free flex item with its own head. Orange: the gap inside a pair (1.25 rem) was half the gap between chains (3 rem), so pairs read as glued.

The takes canvas is now one CSS grid. Every frame is one column of the same width. Each band has two rows: a head row that every chain shares, and a frame row. The original has no head, so it starts on the frame row and its top edge lines up with every other frame. A chain spans two columns with subgrid, so the gap inside a pair is the same `--gap` (2.5 rem) as the gap between chains. The history strip and the note editor both sit inside the band so nothing overlaps the next one.

## Fifth pass: three marks

| Mark | Feedback | Change |
|---|---|---|
| Gutters | The bar's left gutter was 1 rem past the panel, the right was 1 rem to the edge, and they read as different | One `--gutter` token. The parts panel, side panel, bar, code pane and subject all derive from it: `--free-l` is two gutters plus the panel width. |
| A | The draft still read as generated | The draft is the marked takes in a row, marks drawn on, each note under its mark. Same shape as the canvas. Selectors are gone from the draft; the agent gets them, you do not need them. |
| B | The chevron's space and baseline | The `▸` glyph is gone. A drawn 5 px chevron, centred on the x-height, 0.3 rem after the text, the same on the chain head and the checks fold. |

## Fourth pass: the seven marks

| Mark | Feedback | Change |
|---|---|---|
| A | Knobs cramped | Row padding 0.4 to 0.85 rem; groups 1.4 rem apart |
| B | Too much around the frame | The pill above is plain text. Below is one dim line: device names as the switch, then width and true size, in the dimmest ink |
| C | Fold successes, focus on failures | Failed groups only; passes fold into "9 passed ▸". The window is as tall as its content |
| D | Empty bar sloppy | One field, one button. Mark, focused take, count and Send appear only when there is something to act on |
| E | Agent brief off brand | A card in the chrome's type: section headings, each mark as its pin glyph and the note, element on a dim line. This pass's marks are the one raised section |
| F | Draft sloppy | Mirrors the canvas: thumbnail with marks drawn, then each mark as pin and note, element on a dim line |
| G | Canvas too tight | Chains 3 rem apart, 1.25 rem inside a pair, chain history folded behind "3 in chain ▸" |

## Third pass: take markup (`docs/plans/take-markup.md`)

The plan settles behaviour (decisions 1 to 13) and lists nine surfaces for
the designer. Each is in one of four states: `takes`, `mark`, `draft`, `agent`.

| Surface | Where | How it looks |
|---|---|---|
| Mark mode | `mark` | A pin button at the left of the bar, filled when on. Every frame gets a dashed ink edge at 4 px offset and a crosshair. The slate says "Mark mode: click or drag on any frame. M leaves." |
| A mark | `takes`, `mark` | A click is a teardrop pin with its letter. A drag is a region: a 2 px ink box with a light fill and the letter on a tab at its top-left corner. Named by take and letter: 0A on the original. |
| The note editor | `mark` | A card under the marked frame. The mark's name on a filled tag and one text line. Enter saves. (Seventh pass: the chip row is gone.) |
| A reference | `mark`, `draft` | In a note, "0A" is a small bordered token. In the editor you type the name and pick from a list with a crop of each mark. (Seventh pass: type-ahead, not chips.) |
| A lost mark | `takes`, `mark`, `draft` | A hollow dashed pin on the frame, a dashed entry in the type-ahead, and in the draft a warn-coloured "element not found" with Re-place. |
| The draft and Send | `draft` | "7 marks ▾" at the right of the bar unfolds the draft above it, grouped by take, each group saying what Send does for it. Send carries the count: "Send 7 marks, 2 new takes". |
| The pair view | `takes` | Each chain is a head, an optional history strip, and a pair: parent at 78 % opacity, newest take at full. A chain with no follow-up is one frame. On the phone: newest only, "parent · 3 in chain" one tap away. |
| Chain labels | `takes` | "6 ← from 1 (4 discarded)" in the chain head; the strip shows 1 → 4 (struck) → 6. A chain made before an accept is dimmed with "made before take 8 was accepted" in warn. |
| What the agent sees | `agent` | The parent's screenshot with pins drawn in white, beside the text brief built from the take records. |

Costs: three chains plus the original is seven frames, and at 1600 wide they
wrap to two rows of RG353M. On the ODIN 2 PORTAL a pair alone is 1,208 px, so
that device shows the newest take only at any desk width under about 1,900
px. The editor covers the frame below it while open. Mark letters run out at
Z; the plan does not say what comes after.

## States

| `?state=` | Shows |
|---|---|
| `takes` | The original and three chains as pairs, take 6 focused with two marks |
| `mark` | Mark mode on, the note editor open at 6B |
| `draft` | The draft unfolded above the bar |
| `plan` | Three directions on the canvas before their takes start |
| `menu` | The New take menu open, with one image attached |
| `log` | Take 6's record open in the side panel |
| `agent` | What take 9's agent received |
| `empty` | First run: the real files, the composer, one sentence |
| `knobs` | Knobs panel: registered, thresholds, what the part reads, literals |
| `code` | Code pane under the stage with a take diff |
| `grid` | All five states side by side at true size |
| `checks` | Checks window over the room |
| `calibrate` | Credit-card outline and the scale slider |
| `error` | A part that throws: the frame carries the failure |
| `parts` | Phone only: the parts drawer |

## Run

```sh
docs/design/mockups/serve.mjs          # http://[::]:5312/, any host, all interfaces
docs/design/mockups/render.mjs         # writes out/*.png through the dev shell's Chromium
docs/design/mockups/render.mjs knobs   # one state
docs/design/mockups/assemble.mjs       # splice parts/*.html back into the page after editing
docs/design/mockups/probe.mjs b-darkroom 416 640   # prints each region's box
```

All scripts run through `nix develop`. The page loads Public Sans from
`assets/fonts/` (copied from nixpkgs), never from a CDN.

## What is real and what is staged

- The screen in every frame is one real render of Pico's Game Detail part on
  the RG353M (279 px wide, which is 72 mm at 3.875 px/mm). The other states
  and the takes are the same screen re-tinted with CSS filters.
- Pins and notes on a take, and "Revise from notes", are a proposal. Nothing
  in the chrome does this today.
- The knobs are Pico's real declarations: `--pico-pixel-rows`,
  `--pico-pixel-min`, `--pico-bg`, `--pico-accent`; the thresholds in
  `PicoGameFacts.css:27` and `PicoLaunchStage.css:118`; the roles the part
  reads. The "now 19em" marks are invented. The literal is invented.
- The code diff is invented but shaped like Pico's CSS. Check names and
  statuses match `src/client/checks-panel.js`. The error text matches the
  shape `src/client/frame.js` produces.
- On the phone, knobs and code show the ODIN 2 PORTAL, which cannot fit at
  true size, so the caption carries the scaled warning decision 8 requires.
  Takes, grid and error show the RG353M at true size.

## Rules the direction keeps

- Decision 6 and 8: one frame at true size; a scaled frame says so; a part
  that throws shows its error in the frame and in readable copy.
- The drawing remains plain HTML and CSS. Decision 36 replaces decision 10
  for the React implementation; the drawing does not constrain its framework.
- Decision 22: layout is a function of the container. One `@container`
  rule at 44 rem reflows every state to the phone form. Every control stays
  reachable at both sizes.
- Decision 27: Knobs share the Takes region and the rail switches them. With
  takes on the canvas, the right panel holds Knobs or a take's record.
  Decision 34 records the change.
- `b774276`: the page does not scroll; each region scrolls inside itself.

## Costs

- Takes on the canvas need room. At 1600 wide the free room holds the real
  files plus three RG353M takes in one row; a fourth wraps. On the ODIN 2
  PORTAL (604 px each) only two fit side by side at true size, so a take
  review on that device wraps or scales, and scaling must say so.
- With no accent hue, "selected" and "live" are both ink rings. The live knob
  adds a halo to tell them apart. If that proves too quiet in use, the `sky`
  accent is one token away.
- Pins are a new interaction and a new data shape (per take, per state). The
  agent has to be told what a pin means.
- The rail hides tool names on the desk; the phone dock shows them.
- On the phone dock, Preview and Takes both read as pressed, because the
  takes canvas is the preview with takes on it. The build must pick one
  meaning. Not settled here.
- Sizes in this mockup use a 16 px rem. The chrome uses 15 px
  (`src/client/layout.js`). Thresholds here are not the chrome's numbers.
