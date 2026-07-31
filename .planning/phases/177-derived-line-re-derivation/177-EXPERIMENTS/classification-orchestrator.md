# Classification — orchestrator's independent pass

Written BEFORE seeing the independent classifier's output. Question applied to each
`Derived (p.N):` line: **could this content be reconstructed from the quoted text alone,
by someone who cannot see the page?**

TEXT-DERIVABLE = yes. REQUIRES-SIGHT = no, needs to look at the page.

## seven/live/01-definitions-and-components.md

| Line | Content (abbrev) | Class | Reason |
|---|---|---|---|
| 8 | "Set example is illustrated by three card images side by side: green 5, red 5, purple 5" | REQUIRES-SIGHT | Quotes give `example: 5, 5, 5`. Colors and the fact it's rendered as images are visual only. |
| 14 | "Run example illustrated by three card images: red 1, blue 2, red 3 (printed text reads 5,6,7 while images show 1,2,3)" | REQUIRES-SIGHT | Same. Note: carries a REAL rule discrepancy (text vs image mismatch) that only sight reveals. |
| 19 | "Distribution diagram shows four rows numbered 1-7, one per color, each annotated x4; below a black +1 card annotated x7" | REQUIRES-SIGHT | Restates a diagram's layout. The underlying counts ARE in quoted text (line 17), but "four rows, annotated x4, below them" is spatial. |
| 21 | "full deck is therefore 7 numbers x 4 colors x 4 copies = 112 numbered cards, plus 7 +1 bonus cards" | TEXT-DERIVABLE | Pure arithmetic on quoted line 17. The word "therefore" marks it as inference. **This is the archetype of a correct `Derived` line.** |
| 33 | "Card art is minimal and bold: rounded-corner rectangles, flat saturated color, large white number, pip dots... aspect ratio roughly 2:3" | REQUIRES-SIGHT | Pure art description. Sits under a `## Visual notes (p.1)` heading. |

## seven/live/01-overview-setup-and-play.md

| Line | Content (abbrev) | Class | Reason |
|---|---|---|---|
| 36 | "round structure is draw 2 / discard 1, netting +1/round; 3 to 10 cards means 7 rounds, matching the 7 discards at game end" | TEXT-DERIVABLE | Arithmetic + cross-reference across quoted rules. Archetype of a correct `Derived` line. |
| 38 | "Rounds are played simultaneously by all players, not in turn order" | TEXT-DERIVABLE | An inference about rule structure from the quoted procedure. Possibly contestable but reachable from text. |
| 42 | "rules page is a single wide landscape panel, saturated yellow background, black bold sans-serif headings, four columns" | REQUIRES-SIGHT | Page layout/typography. Under `## Visual notes (p.1)`. |

## seven/live/02-solo-variant.md

| Line | Content (abbrev) | Class | Reason |
|---|---|---|---|
| 11 | "The final challenge sentence ends 'in each game during the match in no particular order.'" | BORDERLINE | It quotes source text, so the content IS in the page's text — but it is a statement ABOUT the text's structure ("the final sentence ends..."), not a rule inference. Not rule-bearing either way. |
| 17 | "Page 2 is a wide landscape panel, solid purple background, white bold sans-serif... word SEVEN rotated diagonally ~45 degrees" | REQUIRES-SIGHT | Page layout. Under `## Visual notes (p.2)`. |

## one-two-punch/live/01-setup-and-round-structure.md

| Line | Content (abbrev) | Class | Reason |
|---|---|---|---|
| 30 | "box contains 2 Boxer Cards, 16 Action Cards, 6 Guard Cards, 1 Rules Sheet" | TEXT-DERIVABLE | Reads off a quoted Contents list. |
| 52 | "Each player has 8 Action Cards (16 total across two colors) and 3 Guard Cards" | TEXT-DERIVABLE | Division of the quoted component counts by two players. |
| 56 | ring layout diagram — QUALIFIED `— diagram description` | REQUIRES-SIGHT | Explicitly qualified; already excluded by the mechanism. |
| 68 | Plan-phase diagram — QUALIFIED `— diagram description` | REQUIRES-SIGHT | Explicitly qualified. |
| 79 | Fight-phase diagram — QUALIFIED `— diagram description` | REQUIRES-SIGHT | Explicitly qualified. |

## one-two-punch/live/02-action-cards-and-resolution.md

| Line | Content (abbrev) | Class | Reason |
|---|---|---|---|
| 49 | "Each Action Card entry is headed by a small red icon (lightning bolt for Jab, chevron for Retreat/Advance, X for Block...)" | REQUIRES-SIGHT | Icon shapes. NOT qualified — slips through as rule-bearing. |
| 56 | first Punch example — QUALIFIED `— diagram description` | REQUIRES-SIGHT | Explicitly qualified. |
| 61 | second Punch example — QUALIFIED `— diagram description` | REQUIRES-SIGHT | Explicitly qualified. |
| 82 | "The first Tip implies each player's set of cards includes two Rest cards" | TEXT-DERIVABLE | Inference from a quoted Tip. Archetype of a correct `Derived` line. |
| 89 | "Publisher logo reads ALRIGHT GAMES; a not-for-children-under-3 icon appears beside the copyright. No edition stated." | REQUIRES-SIGHT | Logo/icon observation. NOT qualified. (The "no edition stated" half is a text-absence claim.) |
| 91 | boxer illustration — QUALIFIED `— art` | REQUIRES-SIGHT | Explicitly qualified. |
| 95 | "This section marks no rules as variants, optional modules, or advanced/expert rules" | BORDERLINE | A claim about ABSENCE in the text. Reachable from text (you can see nothing is so marked), but it is not an inference producing a new fact. |

## Summary (orchestrator's pass)

- Total `Derived` lines: 22
- Explicitly qualified (already mechanically excluded): 6 — all in one-two-punch (56, 68, 79, 56, 61, 91)
- **Of the 16 unqualified "real dispatch candidates":**
  - TEXT-DERIVABLE: 6 — seven 21, 36, 38; otp 30, 52, 82
  - REQUIRES-SIGHT: 8 — seven 8, 14, 19, 33, 42, 17; otp 49, 89
  - BORDERLINE: 2 — seven 11; otp 95

## The asymmetry this explains

one-two-punch's transcriber used `— diagram description` / `— art` qualifiers; seven's did not.
So the mechanism excluded 6/12 for one-two-punch and 0/10 for seven. That is not a property of
the two games — it is a property of two transcription passes applying the convention
inconsistently. seven's visual lines are indistinguishable, to the code, from real inferences.

## Predicted consequence for the existing mechanism

A REQUIRES-SIGHT line has no correct answer available to a text-only blind subagent. The only
honest verdict is `underivable`. Any other verdict is noise. Cross-referencing 177-GOAL-MEASUREMENT.md's
per-line results: seven 33 and 42 (both REQUIRES-SIGHT) landed `underivable` and scored PASS;
seven 8, 14, 17 (also REQUIRES-SIGHT) landed `disagrees` and scored FAIL. Same category, opposite
scores — confirming these are coin-flips, not measurements.
