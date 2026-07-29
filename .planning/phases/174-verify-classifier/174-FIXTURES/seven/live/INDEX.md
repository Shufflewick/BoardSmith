# Rulebook Index — Seven

Edition: not stated in the rulebook (no edition/printing on cover, title page, or colophon) — pending designer confirmation

Source: rulebook/source/rules.pdf
Source hash: 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
Transcribed: 2026-07-29
`rules.pdf` (2 pages). This index is the term → slice cross-reference. It is built from the
transcription subagents' returned `citedTerms[]` lists; the slices themselves are the authority.

## Slices

| slice | pages | covers |
|-------|-------|--------|
| `00-visual-survey.md` | p.1-2 | VISUAL EVIDENCE (not rules): palette candidates, typography, card-face spec (~2:3 portrait, flat saturated rounded rectangles, large centered white numeral, white corner pips, black "+1"), diagrams. The durable handoff to the FIRST UI chunk's `ask` step. |
| `01-overview-setup-and-play.md` | p.1 | game identity, setup, the simultaneous round loop, game end, match structure |
| `01-definitions-and-components.md` | p.1 | hand / set / run definitions, deck composition, credits |
| `02-solo-variant.md` | p.2 | solo variant (DEFERRED — out of scope per brief) |

Note: `00-visual-survey.md` carries no rules and therefore contributes no terms to the Term → Slice
table below — but any `ui: touches|major` chunk MUST read it. It was omitted from this table in the
first draft of this index, which caused chunk `table-and-draw`'s term→slice sweep to structurally
miss it (caught by that chunk's redteam coverage adversary; see its CHUNK.md Redteam Round 1).

## Term → Slice

| term | slice |
|------|-------|
| "Ways to Score" card | `01-overview-setup-and-play.md` |
| best hand of 7 cards | `01-overview-setup-and-play.md` |
| best of 7 games | `01-overview-setup-and-play.md` |
| bonus point cards | `01-overview-setup-and-play.md`, `01-definitions-and-components.md` |
| colors (red, green, blue, purple) | `01-definitions-and-components.md` |
| discard pile | `01-overview-setup-and-play.md` |
| distribution of cards | `01-definitions-and-components.md` |
| game | `02-solo-variant.md` |
| game end | `01-overview-setup-and-play.md` |
| hand | `01-overview-setup-and-play.md`, `01-definitions-and-components.md` |
| match | `01-overview-setup-and-play.md`, `02-solo-variant.md` |
| match length | `01-overview-setup-and-play.md` |
| mess | `01-overview-setup-and-play.md` |
| multiple of 7 | `02-solo-variant.md` |
| numbers 1-7 | `01-definitions-and-components.md` |
| perfect solo match | `02-solo-variant.md` |
| public information | `01-overview-setup-and-play.md` |
| round | `01-overview-setup-and-play.md` |
| run | `01-definitions-and-components.md` |
| set | `01-definitions-and-components.md` |
| solo variant / single-player variant | `02-solo-variant.md` |
| the 7 scoring hands | `02-solo-variant.md` |
| total score | `02-solo-variant.md` |

## Open Rules Gaps (named-but-undefined in the source)

These are named by the rulebook but never defined in it. They are NOT to be reconstructed from
inference or outside knowledge — see `RULINGS.md` for their adjudication.

1. **"Ways to Score" card contents** — the card is dealt to every player at setup but its face is
   never reproduced or described. All scoring rules apparently live on it.
2. **"The 7 scoring hands"** — named in the solo variant; never enumerated or valued.
3. **Bonus point card ("+1") value** — the card exists in the deck (x7) and is added to the score at
   game end, but its scoring effect is never stated in rules text.
4. **Run example discrepancy** — the Run example's text reads "5, 6, 7" while the accompanying card
   images show 1, 2, 3. Both are legal runs under the stated definition ("3+ cards in numeric
   order"), so the rule itself is unambiguous; the illustration is simply inconsistent.
