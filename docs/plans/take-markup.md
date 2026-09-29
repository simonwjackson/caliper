# Take markup

Status: behaviour settled (decisions 1 to 13 below). Appearance settled
(`docs/decisions.md` 35, drawn in `docs/design/mockups/`). Build order
chosen (below). Not built. Slice 0 is next.

## Problem

Each prompt to a take rolls the dice. A result often comes back mixed: some
parts are good, some are wrong. Today the user takes a screenshot, draws on
it, and sends the image. That is slow, and the user often answers several
takes at once. The talk that started this (Katie Dill, Stripe) showed
feedback as lettered markers A, B, C, D on the work.

The goal: say what you like and dislike about each of one or more takes, at
exact places, as fast as possible, with no screenshots passed by hand.

## Terms

- **Mark**: one lettered pin on a take, with a note.
- **Markup pass**: the set of marks you send together. It works like a code
  review: comment on many places, then submit once.

## Settled

1. **A mark attaches to the element under the click** (option B). The agent
   gets the pin drawn on the take's screenshot, plus the element's tag,
   classes, text and a selector. **A drag marks an area** (option D): the
   region on the screenshot, plus the elements inside it.
   - Not now: a source file and line per element. It needs a JSX transform in
     the product's dev build. Revisit if agents keep editing the wrong file.
   - Cost: a click on a pseudo-element or on empty space attaches to the
     parent element, which can be vaguer than meant.

2. **A mark carries a note only.** You click or drag, then type. The note
   says what you like or dislike, in your words ("love this", "too heavy").
   The agent reads the intent from the note.
   - Rejected: a separate keep or change flag, and a check that a kept element
     did not change. Voice notes are not part of this plan.
   - Cost: every mark needs typing. Nothing checks that a liked element
     survives the follow-up.

3. **Sending a take's marks makes a new take from the marked one.** Caliper
   copies the marked take's files into a new take, as "Prepare alternate"
   does in `src/takes/integration.js`. The new take's agent works on the
   marks. The marked take does not change, so a bad result costs nothing:
   discard it and mark the old take again.
   - Rejected: a follow-up in the same take (a bad result loses the good
     version), and saved versions inside one take (new storage and UI).
   - Cost: takes pile up. Lineage and cleanup must be shown and handled.

4. **The new take's agent starts fresh, with a short text history.** It gets
   the copied files, the marked take's screenshot with the pins drawn on it,
   the list of marks, and, as text only: the first prompt, the planner's
   direction, and the marks from each earlier pass in the chain. Caliper
   builds the history from the take records, so it survives a restart. Each
   take records the take it came from.
   - Rejected: a fresh start with no history (the agent may undo choices made
     on purpose), and a copy of the old conversation (it grows with every
     pass's screenshots and is lost on restart).
   - Cost: the old agent's own reasoning is lost. A fix that no mark named has
     no record of why it was made.

5. **One Send for every marked take.** Marks stay a draft until you send.
   Send makes one new take for each marked take, and their agents run in
   parallel, like submitting a code review. The button shows the count, for
   example "Send 7 marks on 3 takes".
   - Rejected: a Send per take, and both kinds of Send.
   - Cost: no agent starts until the whole pass is done. With takes at 26 to
     31 s each (decision 15), results arrive about 30 s after Send.

6. **A note can point to a mark on another take.** Marks are named by take
   and letter, for example "2A". A note on take 3 that says "use 2A here"
   gives take 3's new agent the element of mark 2A, a crop of take 2's
   screenshot around it, and read access to take 2's files. Writes stay in
   the agent's own take folder, so the fence in decision 15 does not change.
   - Rejected: no references between takes (the agent cannot see the other
     take), and a merge pass that makes one take from several (a new action
     and a rule for which take is the base).
   - Cost: a new reference syntax in notes. The agent must move code between
     takes, and can get it wrong when both takes changed the same file. The
     base is always the take where you wrote the note.

7. **A take whose marks are all pointed to makes no new take.** A marked
   take gets a new take only when it has at least one mark that no other
   note points to. Its pointed-to marks also go to that new take. The Send
   button shows the result, for example "Send 7 marks, 2 new takes".
   - Rejected: a new take for every marked take (wasted runs, and an agent
     that may change what you only pointed at), and a checklist at Send (an
     extra step on every pass).
   - Cost: Caliper works out intent from the references. To change a take
     whose marks are all pointed to, add one more mark on it. A wrong guess
     shows in the button count, not as a question.

8. **You can mark the original fully.** Marks on the original are named
   "0A", "0B" and so on. A take's note can point to them ("restore 0A"), and
   pointing to one never makes a take. A mark on the original that no note
   points to starts a new take from the real files, by the same rule as
   decision 7. When you also type a prompt, the marks go with it, and the
   planner (decision 16) reads them when it proposes directions.
   - Rejected: marks on takes only (you cannot point at the product), and
     marks on the original for pointing only (marks cannot start work).
   - Cost: marks become a second way to start takes. The planner prompt and
     the Takes panel get a new entry path to test. Recommended build order:
     after marks on takes work, since this only adds to them. The order is
     not settled.

9. **A mark mode you switch on, plus Alt-click.** One key (for example `M`)
   or one bar button turns mark mode on and off. While it is on, a click or
   drag in any frame makes a mark, and the part does not react. It works the
   same with a mouse and on touch, and suits a long pass. Outside mark mode,
   Alt-click or Alt-drag makes one quick mark, and a plain click uses the
   part.
   - Rejected: mark mode only (an extra key press for one quick mark), Alt-click
     only (no touch), and a Takes view that always marks (you cannot mark a
     state reached by clicking).
   - Cost: two ways to do one thing, and more to test. Alt-click does not
     work on touch. A part that uses Alt-click loses it in Caliper. Some Linux
     desktops move the window on Alt-drag, so Alt-drag may not reach the
     page there. The chrome must show clearly that mark mode is on, for
     example with a coloured frame edge and a cursor change.
   - Correction: commit `ace0bd8` first recorded this as mark mode only. The
     user chose mark mode plus Alt-click.
   - Not checked: that turning the mode on keeps a state you reached by
     clicking, such as an open menu. It should, if marking does not reload
     the frame.

10. **Draft marks live on the dev server.** The draft is stored in
    `.caliper/marks.json`, next to the takes, and reaches every open chrome
    on the event stream. It survives a chrome reload and a Vite restart, and
    the desk and the Fold see the same draft. After Send, each mark moves
    into the record of the new take it went to, which gives decision 4 its
    history.
    - Rejected: the page only (a reload loses the pass), and `localStorage`
      (one draft per browser, so no desk-to-Fold pass).
    - Cost: two open screens edit one draft, and the last write wins. A draft
      can go stale: if a take changes or its element is gone, the mark's
      selector may match nothing. Caliper shows such a mark as lost and does
      not drop it quietly.

11. **The Takes view shows the newest take of each chain next to its
    parent.** Each chain appears as a before and after pair, beside the
    original. Older takes in the chain fold into that chain's history, and
    you can open them.
    - Rejected: every take flat (a wall of frames after a few passes), and the
      newest take only (seeing what a pass changed needs extra clicks, which
      weakens decision 3).
    - Cost: twice the frames. Three chains plus the original is 7 frames. At
      small sizes, such as the Fold, the layout falls back to the newest take
      only, with the parent one tap away (intrinsic layout, decision 22).

12. **Accept removes the accepted chain and flags the other chains.** You can
    accept any take in a chain. Accept copies its files over the real files
    (decision 12), then removes every take in that chain, because the work is
    now in the product. Other chains for the same part stay, labelled "made
    before take N was accepted".
    - Rejected: keep every take (the panel grows, and a later accept from
      another chain can quietly undo the first), and remove every take for
      the part and state (other directions are lost).
    - Cost: the older takes of the accepted chain cannot be opened or marked
      again. Git holds the result, not the steps. The flag only warns: a
      flagged take accepted later still replaces the files accepted before,
      unless its agent rebuilds it first.

13. **Discarding a take removes only that take.** Its children stay. Each
    take stores its full text history (decision 4) in its own record when it
    is made, so no take depends on its parent to build its history, and no
    discard or accept can break a history. The pair view (decision 11) shows
    a take next to its nearest ancestor that still exists, labelled for
    example "7 ← from 3 (5 discarded)".
    - Rejected: removing the take and all its children (one click can remove
      good work further down), and allowing discard of the newest take only
      (slow, and it blocks clean-up).
    - Cost: records repeat some history text down the chain. A pair can
      compare across a gap, so the label must say so.

## Build order

Chosen on 2026-09-29 by the agent, under the user's instruction to go on
alone until the work is ready to build. It is the three-slice option put to
the user, with the visual direction (decision 34) as slice 0. Change it
before slice 0 starts if it is wrong.

| Slice | What lands | Plan decisions |
|---|---|---|
| 0 | The Darkroom restyle of today's chrome: tokens, rail and dock, cards, the caption under the frame, takes on the canvas, the bar with the New take menu, the plan review on the canvas, a take's record in the side panel, Knobs and Checks. `planLayout` gets its new places (decision 34). No new take behaviour. | none |
| 1 | Marks on takes, mark mode and Alt-click, the draft on the dev server, Send, chains as pairs, accept and discard rules | 1 to 5, 9 to 13 |
| 2 | References between takes | 6, 7 |
| 3 | Marks on the original | 8 |

Why slice 0 first: slices 1 to 3 draw on the canvas that slice 0 makes.
Built in the old skin first, every take surface would change twice. Slice 0
is also the only slice with no new data: CSS, DOM moves and `planLayout`.

Cost: one slice passes with no new take behaviour to use. Slice 0 removes
the Takes panel, so it must carry every capability the panel holds (the
seventh-pass audit in the mockup README) or it leaves one unreachable.

## Open

- Typed follow-ups. "Send to take N" (the New take menu) still changes the
  take it is sent to. Decision 3 makes marks start a new take instead. The
  two paths stay side by side in slice 0. Whether a typed follow-up should
  also make a new take is not decided.
- Letters after Z on one take.

## For the visual designer

The decisions above fix behaviour, not appearance. Design these surfaces.
Read `~/.agents/skills/frontend-design/SKILL.md` and
`~/.agents/skills/intrinsic-design/SKILL.md` first. Caliper's chrome is plain
DOM (decision 10), and its layout is one function of the chrome's own size
(decision 22). It must work on a desk monitor and on a Galaxy Z Fold, with a
mouse and with touch. Nothing may become unreachable at any size.

- **Mark mode.** The bar button, and how every frame shows that the mode is
  on (decision 9).
- **A mark.** The lettered pin for a click, and the region for a drag. Names
  are take number plus letter: "2A", and "0A" on the original.
- **The note editor.** It opens at a new mark, takes typed text only
  (decision 2), and must be fast to write and close.
- **A reference in a note.** How "use 2A here" looks, and how you pick the
  mark you point to (decision 6).
- **A lost mark.** A mark whose element is gone after a change or restart
  (decision 10).
- **The draft and Send.** Where the whole draft is listed, and the Send
  button with its count, for example "Send 7 marks, 2 new takes" (decisions 5
  and 7).
- **The pair view.** Each chain as a before and after pair beside the
  original, the chain history you can open, and the fallback to the newest
  take only at small sizes (decision 11).
- **Chain labels.** For example "5 ← from 2" and "7 ← from 3 (5
  discarded)" (decision 13), and the flag "made before take N was accepted"
  (decision 12).
- **What the agent sees.** The take's screenshot with the pins drawn on it
  (decision 1). This image is for the model, not only for the user.

Done on 2026-09-29: `docs/decisions.md` 35 records each surface, and the
mockup's `takes`, `mark`, `draft` and `agent` states draw them in the
Darkroom direction (decision 34).

## Facts checked

- Take frames are same-origin iframes, so Caliper can find the element under
  a click. The Takes view already shows the original and every take side by
  side (`src/client/chrome.js`, `Shown._tag === "Takes"`).
- Follow-up prompts to one take already exist (`/takes/:n/prompt`).
