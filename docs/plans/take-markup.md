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

## Open

- What the new take's agent knows: the old conversation, or a fresh start.
- Marks across takes ("take 2's header in take 3").
- Versions, since each follow-up can still make a good part worse.
- Where marks live, and whether they survive a restart.

## Facts checked

- Take frames are same-origin iframes, so Caliper can find the element under
  a click. The Takes view already shows the original and every take side by
  side (`src/client/chrome.js`, `Shown._tag === "Takes"`).
- Follow-up prompts to one take already exist (`/takes/:n/prompt`).
