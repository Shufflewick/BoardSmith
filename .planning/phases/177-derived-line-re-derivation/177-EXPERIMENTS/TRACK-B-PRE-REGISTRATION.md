# Track B Pre-Registration (written BEFORE any enumerator/reconciler dispatch)

Timestamp: 2026-07-30, before first `claude -p` call.

## Design under test
Two independent enumerators (A, B) read ONLY the stripped quote text of a passage and each
list every rule-relevant fact they can establish, tagged with the source sentence. A
reconciler C sees both lists (never the original slice) and buckets facts as
Both-found / A-only / B-only. Reconciled facts are then cross-referenced by hand (me) against
the slice's actual `Derived` lines to produce corroborated / uncorroborated / missed.

## Passage granularity chosen
Per-slice (whole file), not per-citation-header. Reason: several existing `Derived` lines
synthesize across multiple citation blocks within one file (e.g. seven's line 21, "full deck
is therefore 7×4×4=112 cards", combines the Definitions block's card count with the
Distribution of Cards block's numbers-and-colors line — two different citation headers).
Per-citation-header passages would make that synthesis structurally impossible for an
enumerator to reach, which would manufacture "missed" facts that are really just an artifact
of over-slicing. Per-slice keeps the same scope the original transcriber had when writing the
Derived line.

## Corpus
5 files (the "five rule slices", excluding `00-visual-survey.md` meta-files and `INDEX.md`):
- seven/live/01-definitions-and-components.md
- seven/live/01-overview-setup-and-play.md
- seven/live/02-solo-variant.md
- one-two-punch/live/01-setup-and-round-structure.md
- one-two-punch/live/02-action-cards-and-resolution.md

## Framing variation between A and B (disclosed in advance)
Both get identical stripped quote text. Enumerator A is prompted as a rules-lawyer building a
reference sheet ("list every fact a player would need to play correctly"). Enumerator B is
prompted as a fact-extraction auditor ("list every discrete, checkable factual claim, including
numeric/structural claims, independent of how a player would use it"). Both output the same
JSON schema: `[{fact, source_sentence, confidence}]`. This is the only prompt difference.

## Target lines under test (per the task)
- Current design's wrong-target failures: seven 8, 14, 19, 21, 36, 38, 11, 17;
  one-two-punch 52, 49.
- Image-description lines expected to be unreachable from text alone: seven 8, 14, 19, 33, 42,
  17; one-two-punch 49, 89.
- (Line 8/14/19 in seven live with a companion "the printed example text reads X while the
  images show Y" detail is a genuinely interesting edge: the *quote itself* states one set of
  numbers and the Derived line reports a *different* set from the image — text alone cannot
  corroborate or refute it either way.)

## My expectation, stated before running anything
I expect this design to be a real improvement over the current one on the wrong-target
failures (problem 1), because nobody has to guess which single fact is "the" fact — matching
happens after the fact, symmetric between two independent lists. I expect roughly 6-8 of the
10 wrong-target lines to land cleanly as "corroborated" (both enumerators independently state
something matching the Derived line's substance).

I expect the image-description lines to NOT fully self-sort as hoped. Concretely: I predict the
pure diagram/art-description lines (seven 42, 17, 33; otp 89, and otp's diagram lines) will
correctly land as uncorroborated (nothing in the text supports them). But I predict at least
one or two of the "diagram redescribes a numeric/structural fact that IS also stated or
strongly implied in the prose" lines (seven 8, 14, 19 — the Set/Run/Distribution examples,
which pair a diagram with an adjacent quoted "example: 5, 5, 5" line) will land as
CORROBORATED even though they are image-observations, because the enumerators will read the
adjacent quoted number sequence and independently state a matching numeric fact, and my
cross-reference (matching on substance, not on "is this from an image") will call that a
match. I expect this to complicate the "free filter" hope in observation 2 — I will report
this explicitly rather than declare a clean win.

I do NOT expect strong new "missed" facts from a 5-passage, mostly-short-slice corpus; if any
appear I will treat them as anecdotal, not a systematic advantage, given the corpus size.

## Concrete failure outcome I will call the design AGAINST if it occurs
If reconciled Both-found facts, when spot-checked by me against the actual quotes, are wrong
or unsupported in more than ~1 in 5 samples, I will report the agreement signal as unreliable
regardless of how many nominal "corroborations" it produces — two independent runs of the same
model sharing a blind spot is exactly the failure mode named in the task, and a high nominal
corroboration rate built on shared error is not an improvement over the current design's noise,
it is a different flavor of the same problem.

## Dispatch count budget
5 passages × 2 enumerators + 5 reconciliations = 15 `claude -p` dispatches, vs. the current
design's 28 for the same corpus.
