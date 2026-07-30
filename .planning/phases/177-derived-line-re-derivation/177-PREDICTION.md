# Phase 177 Plan 06: Derived-Line Re-Derivation — Distribution Prediction

**NO DISPATCH HAS BEEN RUN. NO VERDICT EXISTS YET.** This file is written entirely from a close,
line-by-line manual reading of the 22 real `Derived (p.` lines and their surrounding quoted material in
`~/BoardSmithGames/seven/rulebook/*.md` (pinned `a03f38d4792af9dfc7c798be69686fc3230f54dd`) and
`~/BoardSmithGames/one-two-punch/rulebook/*.md` (pinned `7e69471bd8980a854f3e351f2f486e1fb6f712b9`),
cross-checked against the byte-identical `174-FIXTURES/{seven,one-two-punch}/live/*.md` snapshots (only
`INDEX.md` metadata differs — provenance header lines added after the fixture was captured — every
`Derived (p.` line and its surrounding quote content is unchanged). No `verify-derive-recheck` CLI
exists yet (that is plan 07's job); no `claude -p` subprocess has been invoked for this file. This
prediction is committed on its own, in its own commit, before that CLI or any dispatch exists, so plan
07 can cite this commit's hash as proof the expectation predates the measurement.

## Interpretation rules, fixed BEFORE any result exists

These three rules govern how the eventual measured distribution will be read. They are stated now,
before any verdict, specifically so they cannot be chosen after the fact to fit whatever number comes
back.

**(a) A large `underivable` share is a REAL FINDING about the ingest contract, not a defect to tune
away.** If the real measured run returns a much higher `underivable` count than predicted below, that
means quote lines do not carry what the original transcription pass actually used — a genuine gap in
`/bs-ingest-rules`'s output, worth reporting as-is. It will never be "fixed" by relaxing decision 5's
blind-payload independence rule to let the deriving subagent see more context.

**(b) A UNIFORM distribution in EITHER direction proves consistency, not discrimination, and will be
labelled that way.** Phase 176's full 60-line corpus returned a uniform 60/60 single verdict and was
honestly recorded as proving the mechanism is consistent, not that it discriminates between good and bad
rulings. If this run also returns something close to uniform (e.g. everything `agrees`, or everything
`underivable`), the write-up will say exactly that — a mechanism returning the same verdict on every line
regardless of content has not been shown to discriminate.

**(c) Zero `not-rule-bearing` verdicts would be SUSPICIOUS.** At least 5 of `seven`'s 10 lines below are
predicted `not-rule-bearing` (pure art/layout description with no supporting quote at all), and this
research was already directly confirmed in 177-RESEARCH.md Pitfall 1 before this file was written. A
real run reporting zero `not-rule-bearing` verdicts on the real 22-line corpus would mean the
rule-bearingness judgment step is not doing its job, not that the corpus happens to be 100% rule-bearing.

## Predicted totals (22 lines)

| Verdict | Predicted count | % |
|---|---|---|
| `agrees` | 9 | 41% |
| `not-rule-bearing` | 9 | 41% |
| `underivable` | 3 | 14% |
| `disagrees` | 1 | 5% |
| **Total** | **22** | **100%** |

**This prediction commits to an `underivable` share under 20%, and defends that explicitly rather than
hedging to a "safer" higher number**, per the plan's own escape hatch ("if that is genuinely what the
per-line reading supports, say so explicitly and defend it, do not hedge to a comfortable number"). See
"Why this diverges from 177-RESEARCH.md's hedge" below — the per-line reading below directly refutes
research's own worked example of underivability (the `seven` deck-math line), and most of the corpus
splits cleanly into either (i) directly confirmable arithmetic/restatement of quoted numbers, or (ii)
pure art/layout description with no rule content at all, rather than the middle "rule-bearing but
diagram-dependent" bucket research's Question 2 worried was large. The 3 genuine `underivable` lines
below are real, structural cases — a component-count split never stated per-color, a page-heading-only
procedural claim, and a colophon icon/edition detail the quoted copyright sentence never states — not a
token few chosen to clear a 20% bar.

## Per-line predictions

### `seven` (10 lines, pinned `a03f38d4792af9dfc7c798be69686fc3230f54dd`)

#### `rulebook/01-definitions-and-components.md`

**Line 8** — `Derived (p.1): The Set example is illustrated by three card images side by side: a green 5,
a red 5, and a purple 5.`
**Predicted: `not-rule-bearing`.** The only quoted text nearby is `"Set: 2+ cards with matching
numbers."` / `"example: 5, 5, 5"` — no colors are quoted anywhere; this is pure card-art illustration
description with no rule content.

**Line 14** — `Derived (p.1): The Run example is illustrated by three card images side by side: a red 1,
a blue 2, and a red 3 (the printed example text reads 5, 6, 7 while the accompanying card images show 1,
2, 3).`
**Predicted: `not-rule-bearing`.** Same shape as line 8, plus an editorial note about a text/image
mismatch — an observation about the illustration, not a stated rule.

**Line 19** — `Derived (p.1): The Distribution of Cards diagram shows four rows of cards numbered 1
through 7, one row per color — red, green, blue, and purple — each row annotated "x 4". Below them is a
single black card showing "+1" annotated "x 7".`
**Predicted: `agrees`.** The quote at `p.1, Distribution of Cards:` already states `"There are numbers
ranging from 1-7 in 4 colors, with 4 copies of each card. In addition, there are 7 bonus point cards."`
— the same quantities (1-7, 4 colors, 4 copies, 7 bonus cards) the diagram restates, so a blind
re-derivation grounded in that quote reproduces the same counts even though it cannot reproduce the
diagram's specific layout wording.

**Line 21** — `Derived (p.1): The full deck is therefore 7 numbers x 4 colors x 4 copies = 112 numbered
cards, plus 7 "+1" bonus point cards.`
**Predicted: `agrees`.** Direct arithmetic over the SAME quoted sentence as line 19 (`"numbers ranging
from 1-7 in 4 colors, with 4 copies of each card"` → 7×4×4 = 112; `"there are 7 bonus point cards"`
stated directly). **This is the one place this prediction explicitly diverges from
177-RESEARCH.md's Question 2**, which used this exact line as its worked example of
Derived-depends-on-Derived underivability, reasoning that line 21's only support was line 19's diagram
description. A closer read shows the raw quantities (1-7, 4 colors, 4 copies, 7 bonus cards) are already
present in directly quoted prose two lines above the diagram description, independent of it — the
arithmetic does not need the diagram line at all. This is exactly the kind of hedge the project's own
history of "verify hedges empirically before they anchor a fix" flags for re-checking rather than
inheriting uncritically.

**Line 33** — `Derived (p.1): Card art is minimal and bold: rounded-corner rectangles in flat saturated
color (red, green, blue, purple) with a large white number centered, plus small white pip dots in the
corners. Bonus cards are black with a white "+1". Aspect ratio of the depicted cards is roughly portrait,
approximately 2:3.`
**Predicted: `not-rule-bearing`.** No supporting quote anywhere on this page describes card shape,
corner style, pip dots, or aspect ratio — pure visual/art description.

#### `rulebook/01-overview-setup-and-play.md`

**Line 36** — `Derived (p.1): The round structure is draw 2 / discard 1, netting +1 card per round;
starting at 3 cards and ending at 10 cards means 7 rounds, matching the 7 discards stated as the count at
game end.`
**Predicted: `agrees`.** Fully supported by three separate quotes: Setup's `"draw 3 cards"`, Round's
`"draws 2 cards"` / `"discards 1 card"` / `"you will have 7 discards when the game is over"`, and Game
End's `"After all players have 10 cards, the game ends."` — the 7-round arithmetic (3 start, net +1 per
round, 10 end) and the "7 discards" cross-check are both directly quoted.

**Line 38** — `Derived (p.1): Rounds are played simultaneously by all players, not in turn order.`
**Predicted: `underivable`.** The word "simultaneous" appears only in the section HEADING (`p.1, Round
(Simultaneous):`), never inside any quoted body sentence. If the blind-derivation payload construction
(decision 5, quote-lines-only) supplies only quoted prose bodies and not citation-header titles — the
more conservative reading of "quote lines" — this claim has no textual support to re-derive from at all.

**Line 42** — `Derived (p.1): The rules page is a single wide, landscape panel with a saturated yellow
background, black bold sans-serif section headings, and black sans-serif body text arranged in four
columns. Small card images are embedded inline within the text as rule-bearing illustrations.`
**Predicted: `not-rule-bearing`.** Pure page-layout/visual description; no quote anywhere states
background color, column count, or typography.

#### `rulebook/02-solo-variant.md`

**Line 11** — `Derived (p.2): The final challenge sentence ends "in each game during the match in no
particular order."`
**Predicted: `disagrees`.** The quoted material has FOUR challenge sentences in sequence; the phrase
`"in no particular order"` is quoted as part of the THIRD sentence (about achieving a multiple of 7 —
`"...you would have to achieve a score of 1 of each in no particular order."`), not the actual final
(fourth) sentence (`"attempt to get one of each of the 7 scoring hands in each game during the match."`),
which does not end with that phrase at all. A blind re-derivation reading the same quotes would surface
this exact mismatch — the original line misattributes which sentence the phrase belongs to.

**Line 17** — `Derived (p.2): Page 2 is a wide landscape panel with a solid purple background, white
bold sans-serif heading and white body text in a single left-hand column. The right side is empty except
for the word "SEVEN" set in white bold italic sans-serif, rotated diagonally (reading upward at roughly
45 degrees). No diagrams or component images appear on this page.`
**Predicted: `not-rule-bearing`.** Pure page-layout/visual description with no quoted support and no
rule content; the line itself notes "no diagrams or component images appear on this page."

### `one-two-punch` (12 lines, pinned `7e69471bd8980a854f3e351f2f486e1fb6f712b9`)

#### `rulebook/01-setup-and-round-structure.md`

**Line 30** — `Derived (p.1): The box contains 2 Boxer Cards, 16 Action Cards, 6 Guard Cards, and 1
Rules Sheet.`
**Predicted: `agrees`.** Verbatim restatement of the quoted Contents line: `"2 Boxer Cards, 16 Action
Cards, 6 Guard Cards, 1 Rules Sheet."`

**Line 52** — `Derived (p.1): Each player has 8 Action Cards (16 total across two colors) and 3 Guard
Cards.`
**Predicted: `underivable`.** The "3 Guard Cards" half is directly quoted (step 4a: `"Place your three
Guard cards..."`). But "8 Action Cards" per player is never stated — Contents gives only the box-wide
total (16), and Setup only says `"take all cards of that color"` without stating the per-color split is
even. Deriving exactly 8 requires assuming an even split that the quoted text does not actually assert.

**Line 56 (setup diagram)** — `Derived (p.1) — diagram description: A layout diagram of the ring
showing three dashed-outline areas...`
**Predicted: `not-rule-bearing` (mechanically excluded before dispatch).** This is the ONE
`one-two-punch` line whose marker text (`— diagram description:` with no parenthetical qualifier)
exactly matches `PRESENTATION_EXCLUSION_MARKERS`, so it never reaches a subagent at all — `isPresentationLine`
drops it mechanically. Labelled `not-rule-bearing` here as the closest available bucket for the 22-line
total; the real pipeline never assigns it any verdict because it is filtered out before dispatch.

**Line 68 (Plan-phase diagram)** — `Derived (p.1) — diagram description (Plan phase): Two boxer cards
are shown at top...indicating the card nearest the boxer is the first action and the farther card is the
second action.`
**Predicted: `agrees`.** This is one of `177-RESEARCH.md`'s directly-verified regex-gap lines (the
`(Plan phase)` qualifier defeats the marker, so it DOES reach the subagent despite being diagram-shaped).
Its content is fully redundant with the already-quoted rule: `"Choose any two action cards... place them
in any order face-down... The card closest to your boxer is your first action and the other card is your
second action."` — confirmable directly from that quote.

**Line 79 (Fight-phase diagram)** — `Derived (p.1) — diagram description (Fight phase): Two action cards
shown face up side by side...An arrow at the right points to the corner number with the caption
"timing".`
**Predicted: `agrees`.** Also reaches the subagent past the same regex gap. The specific timing values
it depicts (Jab "01", Retreat "02") are directly confirmable against the quoted worked example: `"Red
would resolve their Jab first since it has a timing of 1 and Retreat has a timing of 2."`

#### `rulebook/02-action-cards-and-resolution.md`

**Line 49** — `Derived (p.2): Each Action Card entry is headed by a small red icon (lightning bolt for
Jab, chevron/arrow shapes for Retreat and Advance, an "X" for Block, a hand/glove mark for Punch, a dot
for Rest).`
**Predicted: `not-rule-bearing`.** No quoted text on this page mentions icon shapes at all — pure
glyph/appearance description.

**Line 56 (first Punch example diagram)** — `Derived (p.2) — diagram description (first Punch example):
Three Guard cards shown before the punch...An arrow points right to the after-state: two Guard cards
labeled "READY" and "EXHAUSTED"...`
**Predicted: `agrees`.** Matches the quoted worked example exactly: `"If you are punched and have one
ready and two exhausted Guards, you would lose one exhausted Guard."` — before-state (ready, exhausted,
exhausted) and after-state (ready, exhausted) both directly confirmable.

**Line 61 (second Punch example diagram)** — `Derived (p.2) — diagram description (second Punch
example): Three Guard cards before the punch, all labeled "READY"...after-state: three Guard cards
labeled "READY", "READY", "EXHAUSTED".`
**Predicted: `agrees`.** Matches the quoted worked example exactly: `"If instead, you have three ready
and no exhausted Guards, you would simply exhaust one card, leaving you with one exhausted and two
ready."`

**Line 82** — `Derived (p.2): The first Tip implies each player's set of cards includes two Rest cards.`
**Predicted: `agrees`.** The quoted Tip says `"You should never have both rest cards in your hand at the
same time."` — "both rest cards" is a direct, unambiguous textual statement of exactly two. This is
another place this prediction diverges from 177-RESEARCH.md's Question 2, which listed this line as an
example depending on "non-quote-line context" — the word "both" in the directly quoted sentence is
itself sufficient support.

**Line 89** — `Derived (p.2): Publisher logo reads "ALRIGHT GAMES"; a "not for children under 3" icon
appears beside the copyright notice. No edition or printing number is stated.`
**Predicted: `underivable`.** The Colophon quote confirms only `"All game content is © 2020 Alright
Games, all rights reserved..."` — the publisher name is loosely corroborated, but the "not for children
under 3" icon and the "no edition or printing number" observation describe purely visual page content
the quoted copyright sentence never states or implies. This is one of `177-CONTEXT.md`'s own named
borderline examples ("Publisher logo reads 'ALRIGHT GAMES'…") — predicted here as `underivable` rather
than `not-rule-bearing` because it makes a specific, checkable factual claim (icon presence, absence of
edition number) rather than being pure art/layout description.

**Line 91 (art illustration)** — `Derived (p.2) — art: A full-color illustration at the bottom right of
page 2 shows two boxers mid-fight...`
**Predicted: `not-rule-bearing` (mechanically excluded before dispatch).** The bare `— art:` marker
matches `PRESENTATION_EXCLUSION_MARKERS` exactly (no qualifier), so like line 56 above it never reaches a
subagent. Labelled `not-rule-bearing` for the total; the real pipeline assigns it no verdict at all.

**Line 95** — `Derived (p.2): This section marks no rules as variants, optional modules, or
advanced/expert rules.`
**Predicted: `not-rule-bearing`.** This is `177-CONTEXT.md`'s other named borderline example
("This section marks no rules as variants..."). Unlike line 89, this is a structural/meta observation
about the absence of a Variants section in this slice, not a claim about game rule content — predicted
`not-rule-bearing` rather than `underivable` because it states nothing a player would need to know to
play, only a fact about the document's own structure.

## Why this diverges from 177-RESEARCH.md's hedge (explicit, not silent)

`177-RESEARCH.md` Question 2 and Pitfall 2 both warn that a casual reading understates `underivable`,
and name `seven` line 21 and `one-two-punch` lines 82/95 as likely Derived-depends-on-Derived or
non-quote-line-context cases. A direct line-by-line re-read of the actual quoted text surrounding each
(done above) shows:

- `seven` line 21's arithmetic inputs (1-7, 4 colors, 4 copies, 7 bonus cards) are ALL present in
  directly quoted prose, not only in the diagram description research's example assumed was the sole
  support.
- `one-two-punch` line 82's "two Rest cards" claim is directly supported by the quoted word "both" in
  `"never have both rest cards in your hand at the same time"`.
- `one-two-punch` line 95 is judged `not-rule-bearing` here rather than `underivable` — CONTEXT.md itself
  names it a borderline case between the two, and this prediction resolves that ambiguity toward
  "not a game rule at all" rather than "a rule that can't be confirmed."

This does not mean `underivable` is absent from this corpus — 3 real, structural cases remain (line 38's
heading-only "simultaneous" claim, line 52's unstated per-color Action Card split, and line 89's
icon/edition detail with no quoted support) — but the corpus splits more cleanly into "directly
confirmable from quoted prose" and "pure presentation, no rule at all" than research's hedge anticipated.
Per rule (a) above, if the real measured run finds substantially more `underivable` than 3, that is a
real finding about what this hand analysis missed, to be reported honestly, not smoothed over.
