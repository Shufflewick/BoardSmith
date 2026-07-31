---
phase: 177-derived-line-re-derivation
plan: 16
subsystem: cli-verify (rulebook provenance)
tags: [check04-replacement, provenance, quote-verified, real-dispatch-corpus]

# Dependency graph
requires:
  - plan: 177-15
    provides: The 14-line, two-run classification measurement whose 4 `quote-unverified` downgrades
      this plan exists to resolve, and the exact reconciler proposals (run1/run2 raw JSON) reused
      here unmodified to re-run classification.
  - phase: 177-derived-line-re-derivation (177-EXPERIMENTS/README.md, CORRECTION section)
    provides: The reasoning for why `QuoteVerifiedProvenance` exists and must not be weakened.
provides:
  - Rulebook source provenance recorded for both reference games
    (~/BoardSmithGames/seven, ~/BoardSmithGames/one-two-punch), via the existing
    `boardsmith ingest-archive rules.pdf` command — no new provenance mechanism invented.
  - Confirmation that `QuoteVerifiedProvenance.obtain()` now returns non-null for both games
    (`computeVerificationScope() === SCOPE_FULL`), and that all 4 previously-downgraded
    `quote-unverified` lines resolve, on real re-classification, to `uncorroborated` — none to
    `contradicted`.
affects: [the-orchestrator-disposition-of-CHECK-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composed the existing Phase 170/171 provenance machinery (`boardsmith ingest-archive`,
      `computeVerificationScope`, `INDEX.md`'s `Source:`/`Source hash:` header) rather than
      inventing a second provenance notion for CHECK-04 — `QuoteVerifiedProvenance.obtain()`
      already delegates to `computeVerificationScope`, so recording provenance the ordinary way
      was sufficient with zero code changes to verify-enumerate.ts."
    - "Re-ran classification by reusing the real, unmodified `classifyDerivedLines` and
      `QuoteVerifiedProvenance.obtain` exports against the real reconciler proposals archived in
      177-15-MEASUREMENT/run1 and run2 (not hand-rewritten), rather than re-dispatching new
      claude -p calls — the reconciler's proposed classification for these 4 lines is a fixed
      input already on disk from a live run; only the provenance input changed."

key-files:
  created:
    - .planning/phases/177-derived-line-re-derivation/177-16-SUMMARY.md
  modified: []
  # Provenance recorded in the sibling game repos, not this repo:
  # ~/BoardSmithGames/seven/rulebook/INDEX.md, ~/BoardSmithGames/seven/rulebook/source/rules.pdf (new)
  # ~/BoardSmithGames/one-two-punch/rulebook/INDEX.md, ~/BoardSmithGames/one-two-punch/rulebook/source/rules.pdf (new)

decisions:
  - "Omitted --edition on both `ingest-archive` invocations. Both games' INDEX.md already carried
    a real, designer-authored Edition: line (free text, e.g. \"not stated in the rulebook...\");
    repairExistingIndex leaves an existing Edition: line untouched when --edition is omitted,
    which is the correct behavior here — nothing about this plan's provenance recording bears on
    the printed edition, and overwriting a real annotation with a normalized guess would not be
    factually honest."
  - "Did not investigate any line against the source page, because none of the 4 lines resolved
    to `contradicted` on re-classification — all 4 resolved to `uncorroborated`. The
    honesty-discipline instruction to check a newly-`contradicted` line against source never
    triggered because the precondition (a `contradicted` result) did not occur."

# Metrics
metrics:
  duration: "~40 minutes"
  completed: 2026-07-30
---

# Phase 177 Plan 16: Rulebook Source Provenance + CHECK-04 Re-classification Summary

Recorded rulebook source provenance for both reference games (`~/BoardSmithGames/seven`,
`~/BoardSmithGames/one-two-punch`) using the real, already-shipped `boardsmith ingest-archive
rules.pdf` command — no new provenance mechanism was written. `QuoteVerifiedProvenance.obtain()`
now returns a non-null instance for both games, and re-running `classifyDerivedLines` against the
real reconciler proposals from 177-15's two live-dispatch runs resolves all 4 previously
`quote-unverified` lines to `uncorroborated`. **None resolve to `contradicted`** — the
false-accusation failure mode the provenance guard exists to prevent (177-EXPERIMENTS/README.md's
CORRECTION, `seven:11`) did not fire on this corpus, so no source-page investigation was
triggered or needed.

## What was done

**1. Understood the existing machinery before writing anything.** Traced
`QuoteVerifiedProvenance.obtain(projectDir)` (`verify-enumerate.ts:598`) to
`computeVerificationScope(projectDir)` (`chunk-provenance.ts:95`), which requires exactly one
thing: `rulebook/INDEX.md` carries a `Source:` path and a `Source hash:` line, the file at that
path exists, and its SHA-256 matches the recorded hash. That is precisely what `boardsmith
ingest-archive <rulebook>` (`ingest-archive.ts:488`, registered in `cli.ts:159`) already produces —
it archives the source file under `rulebook/source/`, hashes it, and writes/repairs the
`Source:`/`Source hash:`/`Transcribed:` header in `INDEX.md`. No second provenance notion (and no
change to any BoardSmith source file) was needed.

**2. Recorded provenance for both games via the real CLI.**

```
cd ~/BoardSmithGames/seven && boardsmith ingest-archive rules.pdf --json
cd ~/BoardSmithGames/one-two-punch && boardsmith ingest-archive rules.pdf --json
```

Both commands archived `rules.pdf` to `rulebook/source/rules.pdf` and updated `rulebook/INDEX.md`
in place:

| Game | Archived sha256 | `INDEX.md` change |
|---|---|---|
| `seven` | `5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880` | inserted `Source:`/`Source hash:`/`Transcribed:` lines (existing `Edition:` line untouched) |
| `one-two-punch` | `e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea` | inserted `Source:`/`Source hash:`/`Transcribed:` lines (existing `Edition:` line untouched) |

Verified by direct `sha256sum` that the archived copy is byte-identical to each project's
`rules.pdf`. Both games' quote lines were re-transcribed 2026-07-30 under the current ingest
contract and verified verbatim against the source pages (per this plan's premise) — recording
provenance now is factually honest. `--edition` was deliberately omitted on both invocations (see
Decisions) so the designer-authored `Edition:` free text was left byte-identical.

**3. Confirmed the guard now passes, and re-ran classification.** A scratch script
(`reclassify.ts`, not committed — scratchpad-only, mirroring 177-15's own `analyze.ts`
precedent) called the real, unmodified `QuoteVerifiedProvenance.obtain()` against both project
directories:

```
seven provenance obtained: true { sourceHash: '5138858e...', edition: 'not stated in the rulebook' }
one-two-punch provenance obtained: true { sourceHash: 'e28d1875...', edition: 'not stated in the rulebook' }
```

Then re-ran `classifyDerivedLines` for the exact 4 lines 177-15 reported as `quote-unverified`,
using the real reconciler proposals verbatim from `177-15-MEASUREMENT/run1/reconcile/*.json`
(cross-checked identical in `run2/`) — all 4 were proposed `uncorroborated` with an empty cited-facts
list in both runs, so `groundedBoth`/`composed` were irrelevant to the outcome and were passed as
empty arrays (the `contradicted` branch is the only one that consults `citedFactIds`; a plain
`uncorroborated` proposal falls straight to the final branch).

## Result: all 4 lines resolve, per-line

| Slice | Line | Was (177-15, no provenance) | Now (provenance recorded) |
|---|---|---|---|
| `seven/01-overview-setup-and-play.md` | 38 | `quote-unverified` | **`uncorroborated`** |
| `one-two-punch/02-action-cards-and-resolution.md` | 117 | `quote-unverified` | **`uncorroborated`** |
| `one-two-punch/02-action-cards-and-resolution.md` | 128 | `quote-unverified` | **`uncorroborated`** |
| `one-two-punch/02-action-cards-and-resolution.md` | 132 | `quote-unverified` | **`uncorroborated`** |

**0 of 4 resolve to `contradicted`.** The guard's mechanical downgrade is gone (confirmed by a
control run with `provenance: null` on the same claims, which reproduces the original
`quote-unverified` result exactly), and every line resolves to a real, honest gap report
(`uncorroborated` — "No grounded fact corroborates this Derived line, and the rulebook source is
quote-verified, so the gap is reported rather than downgraded") rather than a mechanically
withheld verdict. Because none flipped to `contradicted`, the honesty-discipline instruction to
investigate a newly-contradicted line against its source page never had a case to act on — this is
reported as the true (non-)result, not glossed over.

**What this changes CHECK-04's picture to, combining with 177-15's full 14-line table:**

| Classification | 177-15 count | 177-16 count (this plan) |
|---|---|---|
| `corroborated` | 8 | 8 (unchanged) |
| `corroborated-by-composition` | 0 | 0 (unchanged) |
| `uncorroborated` | 2 | 6 (+4 — the 4 lines this plan resolved) |
| `contradicted` | 0 | 0 (unchanged) |
| `quote-unverified` | 4 | 0 (all 4 resolved) |

The `quote-unverified` bucket, mechanical and expected in 177-15, is now empty for this corpus —
every one of the 14 real `Derived` lines carries a genuine, provenance-backed classification.

## What this plan does NOT establish

- It does not change whether any of the 6 `uncorroborated` lines are real transcription defects —
  `uncorroborated` means "no grounded-both fact corroborates this line," not "this line is wrong."
  4 of the 6 are plausible presentation/meta observations (simultaneity note, "no edition stated,"
  "no variants marked") that a two-enumerator design built to catch numeric/rule fabrication is not
  well-shaped to corroborate in the first place — that is a corpus/design-fit observation, not a
  defect claim, and disposition of it belongs to the orchestrator alongside the rest of CHECK-04.
- It does not re-run the full 30-dispatch measurement. Re-classification reused the real, archived
  reconciler output from 177-15's two runs — the provenance input is the only thing that changed,
  and re-dispatching would have re-introduced live-model variance into a comparison that should
  isolate exactly one variable.
- It does not close CHECK-04 in `REQUIREMENTS.md`. Disposition is the orchestrator's, per this
  plan's explicit instruction.

## Deviations from Plan

None. The plan's four numbered steps were followed exactly: understood the existing machinery,
recorded provenance via the real CLI command for both games, re-ran classification and reported
the per-line change, and confirmed no line required source-page investigation because none resolved
to `contradicted`.

## Game-repo commits

Both games are git repositories on branch `sweep/v4.8-dework`. Both commits are scoped to the
provenance change only; `one-two-punch`'s two pre-existing `.boardsmith/` deletions were left
unstaged and untouched (confirmed via `git show --stat` on the new commit, and `git status --short`
after committing, which still shows exactly those two pre-existing deletions and nothing else).

- `seven` — commit `ecc96a8`: `rulebook/INDEX.md` (+4/-1), `rulebook/source/rules.pdf` (new,
  2194346 bytes)
- `one-two-punch` — commit `b843502`: `rulebook/INDEX.md` (+3), `rulebook/source/rules.pdf` (new,
  1084470 bytes)

Both archived files were verified byte-identical to each project's `rules.pdf` via `sha256sum`
before committing.

## Known Stubs

None — this plan writes no application code, UI, or data-flow stubs.

## Threat Flags

None. This plan records provenance metadata (a source file archive + hash + INDEX.md header) using
an existing, already-reviewed command (`boardsmith ingest-archive`) in its documented, intended
usage. No new network endpoint, auth path, file-access pattern, or schema change was introduced.

## Self-Check: PASSED

- FOUND: /Users/jtsmith/BoardSmithGames/seven/rulebook/source/rules.pdf
- FOUND: /Users/jtsmith/BoardSmithGames/seven/rulebook/INDEX.md (contains `Source hash:
  5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880`)
- FOUND: /Users/jtsmith/BoardSmithGames/one-two-punch/rulebook/source/rules.pdf
- FOUND: /Users/jtsmith/BoardSmithGames/one-two-punch/rulebook/INDEX.md (contains `Source hash:
  e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea`)
- FOUND commit (seven repo): ecc96a8 "docs(rulebook): record source provenance (archive rules.pdf +
  hash)"
- FOUND commit (one-two-punch repo): b843502 "docs(rulebook): record source provenance (archive
  rules.pdf + hash)"
- CONFIRMED: `QuoteVerifiedProvenance.obtain()` returns non-null for both project directories
  (verified live via the real function, not asserted).
- CONFIRMED: re-classification of all 4 previously `quote-unverified` lines, against the real
  177-15 reconciler output, resolves to `uncorroborated` (0 to `contradicted`).

## Full test run

`npm test`: **4094/4094 passed**, full suite, run from `/Users/jtsmith/BoardSmith` (baseline
4094 — this plan changed no BoardSmith source files, so the count is unchanged from before this
plan started).
