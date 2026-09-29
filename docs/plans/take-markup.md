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

## Open

- What a mark carries besides its place (keep or change, note, voice).
- What sending does: a follow-up in the same take, or a new take.
- Marks across takes ("take 2's header in take 3").
- Versions, since each follow-up can still make a good part worse.
- Where marks live, and whether they survive a restart.

## Facts checked

- Take frames are same-origin iframes, so Caliper can find the element under
  a click. The Takes view already shows the original and every take side by
  side (`src/client/chrome.js`, `Shown._tag === "Takes"`).
- Follow-up prompts to one take already exist (`/takes/:n/prompt`).
