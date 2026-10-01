# Workspaces, slice 1: high-fidelity mockup

Status: approved by the user on 2026-10-01, as decision 45. The build follows it.
The plan is [`docs/plans/workspaces.md`](../../../plans/workspaces.md). Slice 1
is the path from a question to an answer: the workspace, its question, state
rows, the planner and ideas, the board on one device, questions and answers,
and discard.

Open `index.html` for every image, or serve the live mockup:

```sh
docs/design/mockups/workspaces/shoot.mjs              # render out/*.png and index.html, and check every size
docs/design/mockups/workspaces/shoot.mjs serve 5313   # live, on every interface: ?state=board
bun test docs/design/mockups/workspaces/plan-board.test.ts
```

## States

| `?state=` | Shows |
|---|---|
| `new` | A new workspace: no question and no rows. The parts list shows a pin on every state. |
| `frame` | The question is in the bar and three states are pinned. The real files fill the Today column. |
| `planning` | The planner turns the question into three ideas. The columns wait as plates. |
| `running` | Idea 1 is done. Ideas 2 and 3 still work. |
| `board` | Every idea is done. Idea 2 is focused. The questions are open beside the board. |
| `answer` | You answer an open question, with a reason. |
| `discard` | The ideas go. The question and its answers stay, and the workspace moves to Closed. |

`?side=closed` closes the questions. `?drawer=open` opens the parts drawer on a phone.

## What is real and what is staged

- **Every Pico screen is a real render.** Today is Pico's real files. Ideas
  1 to 3 are real edits, in `ideas/<n>.diff`. Caliper's take overlay rendered
  them with `caliper-render` on the RG353M, from a copy of Pico in `/tmp`. Your
  Pico checkout and its takes did not change.
- **"Same as Today" is measured.** Three idea cells are byte-identical PNGs to
  Today's (`cmp`). Those cells dim and say so.
- **The chrome is the real chrome.** The rail, the panels, the buttons, the
  caption and the region layout are the components and stylesheets in
  `src/client/ui`, with `planLayout` and `fitComposer` deciding where they go.
- **New and staged:** the workspace list, the pins, the board, the questions
  panel, the workspace bar and the discard dialog. The questions and answers
  are written for this mockup. Nothing is wired to a server.

Two findings came from the real renders, not from the design:

- Idea 3 has a real defect. The readout still says 7 carts, and the tally says
  1/9. The mockup shows this as an open question from idea 3's agent.
- Every take needs a record that names a part. To render the three ideas, their
  records had to point at Home. This is the gap the plan names.

## What the mockup decides

The user approved these on 2026-10-01 with "no notes".

1. **Workspaces live in the parts panel**, above Pages. There is no new rail
   tool. The selected workspace replaces the canvas with its board.
2. **You pin rows from the parts list.** While a workspace is open, every state
   has a pin. A part row counts its pinned states.
3. **The board compares, it does not accept.** An idea has Discard, and it takes
   follow-up prompts. It has no Accept. Promote is slice 4.
4. **Cells that match Today step back.** They dim and say "Same as Today", so the
   cells that changed are the ones you read. This needs a pixel comparison of
   each cell against Today: one more step for each render.
5. **The questions sit where a take's record sits**, in the side panel, or a
   sheet on a phone. The board's header has a Questions button with the count.
6. **Discard keeps the questions and answers.** The workspace moves to Closed
   and stays in the list.

Not drawn: an idea's record (its brief, log and files, as `TakeRecord` shows
for a take), the menu under Plan 3 ideas, a cell opened at true size, and a
Closed workspace.

## How the board adapts

`plan-board.ts` is one pure function, `planBoard(width, height, count)`. The
mockup runs it at every size, and the board's CSS takes its heights from the
same constants. The test sweeps every size from 150 × 60 to 2400 × 1400 and
checks that what is drawn fits.

| Board | Columns | Rows |
|---|---|---|
| Wide (desk with both panels at 75 %; Fold with the questions closed at 53 %) | All four | Stacked; the board scrolls |
| Narrower (Fold with the questions open, phone) | Today beside one idea, with a picker for the idea | Stacked |
| Short and wide (1280 × 300) | All four | One at a time, picker beside the cells |
| Narrow and short (phone while the bar holds a long question) | Today beside one idea, or one column | One at a time, picker above the cells |
| Tiny (240 × 180) | One | One at a time. The bar covers the board; the stage scrolls to it, as the chrome does today. |

A cell is never removed. A column or row that does not fit is one picker press
away, with its real label. Below 100 %, the caption says the board is scaled.

The ladder caught four defects before this version:

- A tiny board drew two cells at 22 %. More columns now appear only at 50 % or more.
- The column picker pushed the first row below the fold on a phone. The rule
  did not count the picker's height. It does now.
- A short strip showed one cell where four fit at the same height. When height
  is the limit, more columns cost nothing, so the rule keeps them.
- A side picker of three rows did not fit beside a short cell. The rule now
  checks that the whole picker fits.

## Costs and limits

- Thresholds are guesses: 50 % for a useful cell, 25 % as the floor, and every
  head height. Measure them in the real chrome.
- At 75 % on the desk, Pico's smallest text is hard to read. Opening a cell at
  true size is not drawn.
- The cells are still images. Slice 1 judges by looking. A d-pad path needs the
  authored checks of slice 2.
- `ideas/<n>.diff` are against Pico at korri `82f034c64`. To render them again:
  copy `surfaces/pico` to a temporary folder with its `node_modules` linked,
  apply each diff into `.caliper/takes/<n>/` with a `<n>.json` record, start Vite
  with `CALIPER_REGISTRY` set to a temporary folder, and run `caliper-render
  --take <n>` for each row.
