# Design Session — Settle the Look Before Any Code

Referenced by `build-game.md` Step 1b and `build-chunk.md` Step 0: it runs once per game, after
the sketch is approved and before the first chunk is built, whenever `DESIGN.md` does not exist.
**No game code is written until the designer signs off here.** It replaces any per-chunk design
choice: the first chunk already builds the game's own board, in the signed-off design, with the
Action Panel beside it.

The session's output is three things, written only at sign-off: `DESIGN.md`
(`templates/DESIGN.template.md`), the game's theme file `src/ui/theme.css` that the game's UI
imports directly, and the gallery of mocks, archived in `design/gallery/` as reference. The
audit's design review (`build/design-review.md`) checks every UI chunk against them.

## Who Does What

The designer talks to the main thread, never to a subagent. The main thread (the `/bs-build-game`
orchestrator, or the `/bs-build-chunk` session) conducts the session: it shows the designer the
gallery, takes their requests, and records the sign-off. It never draws a mock itself.

The mocks are made by a fresh subagent of the `judgement` role (`npx boardsmith agent judgement`;
`routing.md`), dispatched with the `frontend-design` skill: its brief says to invoke that skill
first and hold every mock to it. Each round of mocks is one dispatch, logged as a
`### Dispatch N` entry with `Work: design-session` in `design/run-log/design-session.md`
(`templates/RUN-LOG.template.md`). The brief carries the inputs below, what the designer asked for
this round in their own words, and the gallery's current state; it returns a one-paragraph
summary of what changed in the gallery. The subagent writes only under `design/gallery/`.

## Inputs

- `rulebook/00-visual-survey.md` — the box art, component, palette and mood evidence ingest
  recorded. This session does not re-interview the designer for facts already there.
- `ASSETS.md`'s component inventory and aspect ratios, and the rulebook slices themselves, for
  **real content**: real card names, the real component counts, realistic hand sizes and board
  sizes, the player counts in `SKETCH.md` "## Player Counts". A mock with placeholder boxes or
  "Card 1" labels does not show the designer their game.
- `SKETCH.md`'s Ordered Chunk List, for which screens and reusable components the game will have.
- The core loop's player choices, from the rulebook, for the Action Panel's content.

## The Gallery

Throwaway, static HTML and CSS under `design/gallery/`, opened straight from disk: no framework,
no build step, no request off the machine (system fonts, or font files saved beside the page). It
is not Vue and not the engine, which do not exist yet. One page, `design/gallery/index.html`, has:

1. **Five distinct directions**, each a whole-screen mock of the game's main table: the board,
   every player area, the current player's hand or supply, and the Action Panel. Distinct means
   different in palette, type and composition, not five tints of one layout. Span the range the
   visual survey allows: at least one that wears the physical game's palette and mood, and at
   least one original. A direction that copies the physical game's box art or trade dress needs
   the designer's standing to use it; say so beside it.
2. **A direction switcher** that swaps the whole screen between the five.
3. **A per-component switcher** for every reusable component the game needs: the card, a player
   area, the board, each modal or dialog, any token, die or track the sketch implies. Each
   component offers its version from every direction, plus any extra variants the designer asked
   for. Picking a component's version re-renders it **inside the whole-screen mock**, so the
   designer can take the board from one direction and the cards from another and see them
   together.
4. **The Action Panel in every mock**, beside the custom board, listing the real choices the
   current player has in plain text, since every action a player can take is in the panel.
5. **Light and dark**, and **1440px and 390px**: a theme toggle and a width toggle that resize the
   mock's frame, so every option can be seen in all four.
6. **The current selection in the URL hash** (for example
   `#direction=b&card=d&board=a&theme=dark&width=390`), so a combination survives a reload and
   can be named exactly.

Every direction's colors are CSS custom properties: the `--bsg-*` tokens BoardSmith's own chrome
and Action Panel use (`docs/ui-components.md` "Theming" lists them) and the game's own `--game-*`
tokens. That is what lets the signed-off palette become the theme file unchanged.

**Motion is described, not built.** For each key interaction (a card drawn, a piece moved, a
score changing) the gallery lists the motion intent in one line, such as "card flies from deck
to hand". No animation is built here; the animation chunk builds them later
(`ingest/sketch-derivation.md` Section 3).

Before showing it, the subagent screenshots every direction at 1440px and 390px in light and
dark, looks at each, and fixes what is wrong.

## Iterating With the Designer

Give the designer the one thing to open, a `file://` link to the gallery, and ask what they like.
They may ask for more variants of any screen or component, a change to one direction, or a blend;
each request is a new dispatch that adds to the gallery (new variants are added beside the old,
never in place of them, so a choice the designer liked is not lost). Keep going until they are
satisfied. Every request and answer is the designer's: record each question you put to them in
`QUESTIONS.md` as you ask it (`orchestrate/questions.md`).

## Checks Before Sign-Off

When the designer has a combination they want, run these on exactly that combination before
asking them to sign it off, in a fresh subagent of the `judgement` role (`Work: design-check`,
logged beside the mock dispatches), with Playwright (a BoardSmith dependency) and axe-core (in
every game's devDependencies):

- **Contrast:** axe's `color-contrast` rule over the gallery page set to the chosen combination,
  in light and dark, at 1440px and 390px: zero violations. Text on every ground, the Action
  Panel included.
- **Colorblind:** screenshots of the same four views under Chromium's emulated protanopia,
  deuteranopia, tritanopia and achromatopsia (the DevTools protocol's
  `Emulation.setEmulatedVisionDeficiency`). Every distinction the game relies on (seat colors,
  suits, card types, what can and cannot be chosen) still reads, and none is carried by color
  alone.

A failure goes back to the mock subagent to fix, and the checks run again. Tell the designer what
changed and why, in their terms. Never ask for sign-off on a combination that has not passed.

## Sign-Off (Gate-Before-Write)

Show the designer the checked combination and ask for an explicit yes. Presenting is not
approving: write nothing below until they say yes. Only the designer signs a design off; an
orchestrated run with no designer present leaves the session open (`Open Gate:` in `RUN.md`,
`orchestrate/run-state.md`), and nothing is built until they answer.

After the yes, in this order:

1. Fill the sign-off's `QUESTIONS.md` entry with their answer.
2. Write `src/ui/theme.css` from the chosen combination: the `--bsg-*` overrides for both schemes
   in the four selectors `docs/ui-components.md` "Theming" gives, and the `--game-*` tokens. Import
   it from the game's `src/ui/index.ts`.
3. Write `design/DESIGN.md` from `templates/DESIGN.template.md`, every section in its order: the
   sign-off and both checks' results, the chosen direction and each component taken from
   elsewhere, the theme file, typography, a recipe per component naming its mock, every motion
   intent, the placeholder policy, and the Do / Don't list with the hard rule verbatim.
4. Commit the gallery as it stands, as the archived reference.
5. Set `SKETCH.md`'s `## Design Session` pointer to `signed-off`.

Commit all of it in one commit naming the sign-off.

## Downstream

The core-loop chunk builds the game's own board from `DESIGN.md` and the theme file and makes it
the game's default UI (`src/ui/uis.ts`), with the Action Panel always beside it; there is no
AutoUI stage to cut over from. Every later UI chunk reads the same two files, and the audit's
design review checks it against them and the gallery. Changing the design after sign-off is
itself a chunk (`state-machine.md` "Restyle Rule").
