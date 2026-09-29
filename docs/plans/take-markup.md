# Take markup (draft, interview in progress)

Status: being settled with the user. Not built. When the interview ends, the
settled parts become a numbered decision in `docs/decisions.md`.

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

## Open

- Whether a mark that other notes only point to also makes a new take.
- Lineage display and cleanup. Decision 3 makes the chain of takes the
  version history, so no versions inside a take are needed.
- Whether you can mark the original, not only takes.
- Where marks live, and whether they survive a restart.

## Facts checked

- Take frames are same-origin iframes, so Caliper can find the element under
  a click. The Takes view already shows the original and every take side by
  side (`src/client/chrome.js`, `Shown._tag === "Takes"`).
- Follow-up prompts to one take already exist (`/takes/:n/prompt`).
