# 177-FIXTURES — the re-transcribed reference corpus

Captured 2026-07-30 from `~/BoardSmithGames/{seven,one-two-punch}/rulebook/` immediately after both
were re-transcribed under the current (post-2026-07-27) transcription contract.

**This does not replace `174-FIXTURES/`.** That archive stays frozen and untouched: it is what
Phases 174–177 actually measured against, and every number those phases reported is only
reproducible against it. Overwriting it would silently invalidate their evidence. The *difference*
between the two fixture sets is itself the record of what was wrong.

## Why a new set was needed

`174-FIXTURES/` was archived 2026-07-29 but holds content transcribed under the **superseded**
contract, which had no `Visual (p.N):` line type. Consequences, measured:

- `seven` — every art/layout/typography note misfiled as `Derived (p.N):`, gathered under three
  invented `## Visual notes (p.N)` headings that the current contract explicitly forbids.
- `one-two-punch` — visual content marked with the older `Derived (p.N) — diagram description:` /
  `— art:` qualifiers, plus two visual notes carrying no qualifier at all.
- **Zero `Visual (p.N):` lines existed anywhere in either game.**

Phases 174, 175, 176 and 177 all measured against that corpus. Roughly half of Phase 177's
"rule-bearing inferences under test" were descriptions of pictures being handed to a text-only
judge — a question with no available correct answer. See `../177-EXPERIMENTS/README.md`.

## What changed

| | Derived | Visual | Old qualifiers | Forbidden headings |
|---|---|---|---|---|
| `seven` (174-FIXTURES) | 10 | 0 | 0 | 3 |
| `seven` (here) | **3** | **6** | 0 | **0** |
| `one-two-punch` (174-FIXTURES) | 12 | 0 | 6 | 0 |
| `one-two-punch` (here) | **11** | **10** | **0** | 0 |

`seven`'s three surviving `Derived` lines are exactly the ones two independent blind classification
passes both called genuinely text-derivable (`../177-EXPERIMENTS/classification-*.md`) — the
re-transcription reproduced that classification without seeing it.

## One quote-level defect fixed, and why it matters

`seven/02-solo-variant.md`'s old quote line **truncated** the final solo-challenge sentence,
dropping "in no particular order". The old `Derived (p.2)` line existed only to record the missing
phrase — so the inference was correct and the *quote* was broken.

The Track B experiment, reading those same truncated quotes, reported the inference as contradicted.
It found the right location and blamed the wrong party. That is the origin of the guard recorded in
`../177-EXPERIMENTS/README.md`: **an inference cannot be judged against unverified quotes.** With
the quote now complete, the compensating `Derived` line is gone.

Nothing in Phases 174–177 was checking quote lines. This corpus is the first where they were
verified verbatim against the source pages.

## Verification performed

- Both games re-transcribed via the real `BS-DISPATCH-V2` contract handshake, the subagent reading
  `ingest/transcription-subagent.md` directly rather than a composed prompt (composing it is the
  documented failure that caused the original defect).
- `seven`: all page-1 and page-2 quote lines checked verbatim against the rendered source pages.
- `one-two-punch`: quote lines checked against the PDF text layer; three wording errors in the
  prior transcription corrected ("exhaust" not "attack", a dropped "first", "your" respective
  corners).
- `MANIFEST.md` carries sha256 for every file.

## Totals

14 `Derived` lines and 16 `Visual` lines across both games — versus 22 `Derived` and 0 `Visual`
in `174-FIXTURES/`.
