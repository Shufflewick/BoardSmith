# Pre-registration — CHECK-04 replacement, third reference game (`doom-machine`)

Committed alone, before any `claude -p` dispatch. Corpus: 11 rule slices (`01-*`, `02-*`, `CARDS.md`
— excludes `00-visual-survey.md`, `INDEX.md`, `OPEN-QUESTIONS.md`, none of which carry `Derived`
lines), 19 `Derived` lines total. Two source PDFs (`rules.pdf`, `cards.pdf`); `CARDS.md` alone is
sourced from `cards.pdf`, the other 10 slices from `rules.pdf`.

## What I already know before dispatching (read, not measured)

- The independent blind classification (`doom-classification-independent.md`) rates 13/19 lines
  TEXT-DERIVABLE, 2 REQUIRES-SIGHT (`CARDS.md` L19-22, L30 — pure card-geometry/color description),
  2 BORDERLINE (`01-card-anatomy.md` L11, `CARDS.md` L271), plus mixed cases.
- Manual read of the 19 lines' own slices identifies 3 real single-slice arithmetic candidates
  (`01-destroying-a-machine-part.md` L16 and `01-gameplay-loop-and-phase-i.md` L15, both
  5+5=10; `01-objective-and-setup.md` L34, 9-3=6 — all with both operands stated in the SAME
  slice's own quote lines) and one genuine CROSS-SLICE reference: `02-card-effect-icons.md` L25
  ("a part's die landing on an icon... triggers the corresponding effect") restates a claim whose
  verbatim source sentence lives in a DIFFERENT slice (`02-machine-phase.md` p.7), not this one —
  dual enumeration is scoped per-passage, so this slice's own two enumerators structurally cannot
  see the corroborating sentence.
- No plain absence-claim `Derived` line exists in this corpus (unlike `one-two-punch` L128/L132) —
  I predict the `'absence'` classification path is never proposed here at all, a genuine
  "does the category even fire" test distinct from "does it work."
- `boardsmith ingest-archive` is single-source: recording `cards.pdf`'s provenance after
  `rules.pdf`'s silently overwrote the `Source:`/`Source hash:` header (empirically confirmed on a
  disposable test-then-revert against this exact project before this file was written). The project
  provenance flag (`QuoteVerifiedProvenance.obtain()`) is per-PROJECT, not per-slice — once
  `rules.pdf` is recorded, `CARDS.md`'s `cards.pdf`-sourced suspect findings will ALSO read as
  quote-verified, despite `cards.pdf` never having been checked. This is disclosed here as a known,
  reasoned-through (not yet measured-in-classification-output) design gap, separate from the
  hit-rate question below.

## Concrete, falsifiable failure predictions

1. **Grounding rejections exceed 15% of "both" claims.** Baseline was 0/221 (two runs, two small
   hand-prepared games). This corpus is denser, uncleaned, and includes `CARDS.md`'s
   two-bucket-only convention — if the corroboration-rate result was an artifact of corpus
   cleanliness rather than the design, rejections should rise materially here. FAILURE if the
   combined rejection rate across all "both" claims in run 1 exceeds 15%.

2. **At least one of the two REQUIRES-SIGHT `CARDS.md` lines (L19-22, L30) resolves to
   `corroborated` or `corroborated-by-composition`.** Both are pure card-geometry/color
   description with real rule content riding alongside (position-1-is-HP-slot, dead-space
   wraparound) in the SAME paragraph — if the reconciler credits the surrounding rule content's
   corroboration to the whole line, a line that is substantially a visual read would get a false
   "well-supported" verdict. FAILURE if either line receives anything other than `uncorroborated`
   or a `quote-unverified`-style downgrade.

3. **`02-card-effect-icons.md` L25 (the cross-slice case) resolves to anything other than
   `uncorroborated`.** Dual enumeration is scoped to one passage; this line's corroborating
   sentence lives in a different slice's quote lines, which neither this slice's enumerators nor
   its reconciler ever see. FAILURE if it resolves to `corroborated`,
   `corroborated-by-composition`, or is flagged `absence` — any of those would mean the reconciler
   fabricated a match that isn't actually in this passage's two lists.

4. **Determinism does not fully hold on a representative 3-slice re-run subset**
   (`01-objective-and-setup.md` — arithmetic; `02-card-effect-icons.md` — cross-slice;
   `CARDS.md` — sight-line self-sorting). FAILURE if any of these 3 slices' final classifications
   differ between run 1 and run 2 for any of their `Derived` lines.

## What would count as a genuinely positive result

Grounding rejections stay near 0, no REQUIRES-SIGHT line is falsely corroborated, the cross-slice
line is honestly reported `uncorroborated` (not fabricated), and the 3-slice determinism check
holds — i.e., none of the four predictions above materializes. That would be real evidence the
prior corpus's clean numbers were not an artifact of hand-preparation. Any one of the four
materializing is reported plainly as the headline finding, not smoothed over.

## Dispatch shape

Two enumerators per slice on genuinely different model families
(`claude -p --model claude-opus-5`, `claude -p --model claude-haiku-4-5-20251001`), one reconciler
per slice (`claude -p --model claude-sonnet-5`). 11 slices x 3 dispatches = 33 real dispatches for
run 1. Determinism re-run: the 3 named slices above, unchanged inputs, x 3 dispatches = 9 more —
42 real dispatches total. Both `rules.pdf` and `cards.pdf` hashed before this file was written and
will be re-hashed after all dispatches complete.
