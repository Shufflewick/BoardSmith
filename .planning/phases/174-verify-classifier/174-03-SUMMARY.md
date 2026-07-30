---
phase: 174-verify-classifier
plan: 03
subsystem: verify-classifier-core
tags: [verify-pipeline, classification, pairing, provenance, staleness, real-data-proof]
requires:
  - "174-01 — real archived pass-1-vs-pass-2 fixtures (174-FIXTURES/) and the measured presentation-marker inventory (174-PROOF.md section 1)"
  - "174-02 — verify-run.ts's exported ledger helpers and ClassificationRecord schema (not yet consumed by this plan; that is 174-04)"
provides:
  - "src/cli/commands/verify-classify.ts — PROVENANCE_KINDS, RULE_DELTA_KINDS, PRESENTATION_EXCLUSION_MARKERS, isPresentationLine, ruleBearingLines, deriveStale, PageSpan, livePageSpan, parseRangeId, PAIR_KINDS, SlicePair, pairSlices, ProvenanceResult, resolveProvenance — all pure/read-only, no ledger writes, no CLI registration"
affects:
  - "src/cli/commands/verify-classify.ts (plan 174-04) — will import pairSlices()/resolveProvenance()/deriveStale() and wire them into ClassificationRecord + the verify-classify-* CLI commands"
tech-stack:
  added: []
  patterns:
    - "Enumerated frozen-array + derived-type constants (FINDING_KINDS/PRESENTATION_LEXICON shape), never hand-written unions"
    - "Union-find over page-span overlap for m:n group pairing — a new mechanical pattern, no direct prior analog in this repo"
    - "resolveProvenance() composes chunk-provenance.ts's exported computeVerificationScope/resolveCitedSlices/parseVerifiedAgainst rather than re-deriving hash/citation logic"
key-files:
  created:
    - src/cli/commands/verify-classify.ts
    - src/cli/commands/verify-classify.test.ts
  modified: []
decisions:
  - "ruleBearingLines() excludes bare 'p.N, <label>:' citation headers (they name a page, they carry no rule) in addition to blank/heading/presentation lines — the quoted sentences and Derived (p.N): lines that follow a header are the actual rule-bearing content. This split was not explicit in 174-PLAN.md's action text; derived from measuring the real one-two-punch live slices, where total content lines = header lines + quote lines + Derived lines exactly (44 = 11 + 28 + 5, and 58 = 15 + 36 + 7), so header exclusion is a defensible, test-pinned refinement rather than a guess."
  - "pairing-3's test uses the real seven fixture's literal ledger data (all 6 staged units share rangeId '1-2', matching 174-01's actual verify-run-record calls) rather than the PLAN.md action text's illustrative '1 live, 3 staged' example — the real archived RUN.md ledger tags every staged unit with the same coarse range, so the honest page-overlap join over real data produces ONE group with all 3 live slices and all 6 staged units (the exact 6-vs-3 asymmetry 174-01-SUMMARY.md and 174-RESEARCH.md measured), not a subdivided 1-vs-3 split. Documented here since the acceptance-criteria text named the illustrative counts; the test instead asserts the group counts actually produced by pairSlices() over the real ledger shape, which is the true measured asymmetry this decision exists to catch."
  - "A staged unit or live slice with no derivable span becomes its own singleton unpaired-slice group with a synthetic {first:0,last:0} span rather than making SlicePair.span optional — kept the interface's non-optional span field exactly as the plan specified, and the sentinel is documented at the pairId derivation site (pairId is 'unspanned-<name>' for these, never colliding with a real 'pages-N-M' id)."
metrics:
  duration: "~1 session"
  completed: "2026-07-29"
---

# Phase 174 Plan 03: Verify Classifier Core (Enumerated Codes, Presentation Filter, Pairing, Staleness, Provenance) Summary

Built the mechanical, judgment-free half of the verify classifier as pure functions, tested against
the real archived pass-1-vs-pass-2 fixtures plan 174-01 produced: the three enumerated code sets, the
dual-schema presentation-exclusion filter, the many-to-many page-overlap pairing algorithm, the
single-input staleness derivation, and three-state hash-only provenance resolution. No ledger writes,
no CLI command registration — that is plan 174-04.

## What was built

**Task 1 — Enumerated codes, the presentation-exclusion filter, and the staleness map.**
`PROVENANCE_KINDS` (`source-changed`/`source-unchanged`/`unknown`), `RULE_DELTA_KINDS`
(`cosmetic`/`sharper`/`contradictory`/`unclassified`), and `PRESENTATION_EXCLUSION_MARKERS` are all
`Object.freeze([...] as const)` arrays with derived types, following `FINDING_KINDS`'s shape.
`PRESENTATION_EXCLUSION_MARKERS` covers exactly the three forms `174-PROOF.md` section 1 measured
against the real fixtures: the post-170 `Visual (p.N):` form and the pre-170
`Derived (p.N) — diagram description:`/`— art:` forms — no third legacy qualifier exists in the real
data (verified by a sweep across all four fixture trees). `isPresentationLine()` is driven entirely by
that constant. `ruleBearingLines()` strips blank lines, markdown headings, bare `p.N, <label>:`
citation headers, and presentation lines, returning the rest — verified exactly against the real
`one-two-punch` live slices (`presentation-1`/`1b`), where the formula (total content lines − citation
headers − legacy-qualified lines) matches `ruleBearingLines()`'s output length precisely for both real
rule slices. `deriveStale()` is a single-parameter function backed by a total `Record<RuleDelta,
boolean>` map; `staleness-2` pins its arity (`deriveStale.length === 1`) and asserts `PROVENANCE_KINDS`
never appears in its source region.

**Task 2 — Page-span extraction and many-to-many pair grouping.** `livePageSpan()` derives a live
slice's page span purely from its own `^p\.(\d+),` citation-header lines — never `INDEX.md`, verified
directly against `one-two-punch`'s live slices (which carry no `## Slices` table at all) as well as
`seven`'s. `parseRangeId()` parses a staged unit's ledger `rangeId` (`"N-M"`) into the same `PageSpan`
shape, throwing an actionable error on anything else. `pairSlices()` is a pure function (zero `fs.`
calls in its own region) that unions live and staged nodes via a union-find over pairwise page-span
overlap, so an m:n group forms as a single connected component rather than an approximated 1:1 lookup.
Group `kind` is `paired` (both sides present, at least one side rule-bearing), `unpaired-slice` (only
one side present, naming `missingSide`), or `presentation-only` (both sides present but zero
rule-bearing lines on each) — every group is reported, none silently dropped, including a staged unit
with no `rangeId` (its own `unpaired-slice` group, `missingSide: 'live-missing'`) and a live slice with
no derivable span at all. `pairId` is derived deterministically from the group's merged page span
(`pages-<first>-<last>`), proven stable across repeated calls and shuffled input order (`pairing-5`).
Verified against the real `seven` fixture (3 live rule slices, 6 staged units, all sharing the
archived ledger's `rangeId: "1-2"`): `pairSlices()` produces exactly one `paired` group containing all
9 files — the real 6-vs-3 asymmetry both `174-01-SUMMARY.md` and `174-RESEARCH.md` measured for this
exact game, handled as a normal group rather than a finding.

**Task 3 — Provenance resolution.** `resolveProvenance(projectDir, liveSlices)` composes
`computeVerificationScope()`, `resolveCitedSlices()`, and `parseVerifiedAgainst()` from
`chunk-provenance.ts` — no re-implemented sha256-of-archive, no re-derived citation-resolution logic.
Ladder: no archive at all → `unknown` naming the scope reason; every `CHUNK.md` in the project scanned
for whether it cites the pair's live slices, collecting every recorded `Source hash:`; no recorded
hash at all → `unknown` (decision 2b — the actual current state of both reference games, neither of
which has ever recorded a `Source hash:` anywhere); any recorded hash differing from current →
`source-changed`; all recorded hashes matching current → `source-unchanged`. `resolveProvenance` takes
exactly two parameters (`projectDir`, `liveSlices`) with no `label`/`ruleDelta` parameter through which
a classification subagent's opinion could reach it — `provenance-6` pins that `deriveStale` cannot
accept a `ProvenanceResult` and that no call site threads provenance into it.

## Deviations from Plan

None that change behavior — two test-construction decisions, both documented in this Summary's
frontmatter `decisions` list and both within this plan's explicit "Claude's Discretion" grant (test-file
organization, pair-id derivation scheme):

1. `ruleBearingLines()` additionally excludes bare `p.N, <label>:` citation headers (not stated in
   `174-CONTEXT.md`/`174-PATTERNS.md` verbatim) — derived directly from measuring that the real
   `one-two-punch` live slices' total content-line count equals exactly (citation headers + quoted
   lines + `Derived` lines), making header exclusion the principled reading of "rule-bearing content"
   rather than an arbitrary choice.
2. `pairing-3`'s test asserts the real `seven` fixture's actual 3-live/6-staged single-group outcome
   (driven by the archived ledger's literal `rangeId: "1-2"` for all six units) rather than the
   `174-03-PLAN.md` action text's illustrative "1 live and 3 staged" example, which does not occur in
   the real archived data under a rangeId-keyed pairing. The real measured asymmetry (6 vs. 3) is the
   one both prior plans' Summaries record, and it is what the test proves.

## Known Stubs

None. Every function is fully implemented and exercised against either real archived fixture data or
hand-built regression fixtures for edge cases (unpaired slices, presentation-only groups, malformed
rangeIds) that real archived data does not happen to exhibit.

## Corrective follow-up (2026-07-29)

Plan 174-03's pairing implementation keyed the staged side's page span off the ledger `rangeId`
(174-CONTEXT.md decision 4's first amendment). Executing it against the real archived fixtures
exposed why that is wrong, documented above as this Summary's Deviations item 2: `rangeId` records
which DISPATCH produced a staged unit — an engineering artifact of transcription-pipeline
granularity, not a content fact. Both reference rulebooks are 2-page books, and Phase 173's
pipeline dispatched each as a single range, so every staged unit in both `seven` and
`one-two-punch` carried the identical `rangeId`, making every staged span identical, overlapping
every live span, and collapsing each game into ONE pair group regardless of what the staged
content actually said. That destroys the pairing granularity decision 4 exists to provide and made
decision 14b's line-level bar unmeasurable at the group level.

**Fix:** `livePageSpan()` — the single function `pairSlices()` now calls for BOTH the live side and
the staged side — no longer only scans anchored `^p.N,` citation headers; it scans every `p.N`
occurrence anywhere in a slice's own text (a bare citation header, a `Derived (p.N):` /
`Named-but-undefined (p.N):` / `Visual (p.N):` line, or an inline cross-reference like `(p.2)`
inside a sentence). This is what makes the mechanism truly symmetric: the staged side derives its
span from its own content exactly as the live side already did, and `rangeId` is retained on the
staged-unit input record for traceability but is no longer read anywhere in `pairSlices()`.
`parseRangeId()` had no caller left once the pairing path stopped using it, so it and its dedicated
test were removed as dead code rather than left in place (project rule: no backward-compatibility
shims).

**Prove Before Fix — actual measured group counts, both games, before and after:**

| Game | Before (rangeId-keyed) | After (content-keyed) |
|---|---|---|
| `seven` (3 live, 6 staged) | 1 paired group (all 9 files) | 1 paired group (all 9 files) |
| `one-two-punch` (2 live, 6 staged) | 1 paired group (all 8 files, not previously tested) | 1 paired group (all 8 files) |

**The group count did NOT change on these two real fixtures — reported plainly, not smoothed
over.** Measuring the individual staged spans after the fix shows the mechanism IS now genuinely
content-derived (five of `seven`'s six staged units resolve to a single page, one to the other; in
`one-two-punch`, four of six resolve to a single page) — but in BOTH games, at least one staged
unit's own prose genuinely bridges both pages: `seven`'s `01-about-and-setup.md` contains
`Derived (p.1): ... the Solo Variant (p.2).`, a real forward-reference inside its own transcribed
content; `one-two-punch`'s `01-round-structure.md` and `02-punch-examples-discard.md` are each
explicit in their own headings/notes ("continues on p.2" / "begun on p.1") about spanning the
page break. Because a page-overlap union-find merges any two spans that share a page, these
genuinely cross-page staged units bridge the p.1 cluster and the p.2 cluster back into one
connected component in both games — a real property of the transcribed content, not a defect in
`pairSlices()`.

The diagnosis (rangeId coupling pairing granularity to dispatch granularity, an unrelated
engineering decision) was correct and the fix was necessary for correctness and traceability
regardless: had either reference game been dispatched as two ranges instead of one, the pre-fix
code would have produced a **wrong** group split keyed to dispatch boundaries rather than content;
that risk is now gone. But on THESE two specific fixtures, fixing it does not itself yield finer
groups, because the real transcribed content — not the dispatch/ledger — is what bridges the pages.
A new test, `pairing-3c`, proves the mechanism itself is capable of splitting into two groups on
non-bridging content (hand-built, two single-page spans on each side), isolating that the
one-group-per-game outcome on the real fixtures is a fact about this specific transcribed content,
not a `pairSlices()` limitation. `pairing-3` and `pairing-3b` replace the superseded rangeId-keyed
version, asserting the real measured per-unit spans and the real measured group count directly,
including with deliberately wrong/absent `rangeId` values on every staged unit to prove the
grouping is now unaffected by whatever `rangeId` says.

**Files modified:** `src/cli/commands/verify-classify.ts` (`livePageSpan()` broadened; `pairSlices()`
now calls it for both sides; `parseRangeId()` removed), `src/cli/commands/verify-classify.test.ts`
(`pairing-3` rewritten, `pairing-3b`/`pairing-3c` added, `parseRangeId` test removed, `pairing-7`
retitled to reflect that `rangeId` is now irrelevant to its outcome).

**Verification:** `npx vitest run src/cli/commands/verify-classify.test.ts` — 24/24 passed.
`npm test` — 3648/3648 passed (full suite; 3647 baseline − 1 removed `parseRangeId` test + 2 new
pairing tests = 3648, no regression). `npx tsc --noEmit -p .` — clean (only the pre-existing,
unrelated `docs/seed-to-state.test.ts` rootDir diagnostic).

## Self-Check: PASSED

- FOUND: `src/cli/commands/verify-classify.ts`
- FOUND: `src/cli/commands/verify-classify.test.ts`
- FOUND commit `4efbccce` (feat(174-03): enumerated codes, dual-schema presentation filter, staleness map)
- FOUND commit `37698edb` (feat(174-03): page-span extraction and m:n page-overlap pairing)
- FOUND commit `07462ab1` (feat(174-03): three-state provenance resolution, hash-only)
- `npx vitest run src/cli/commands/verify-classify.test.ts` — 23/23 passed (presentation, staleness, pairing, provenance blocks all green)
- `npm test` — 3647/3647 passed (full suite; baseline 3624 + 23 new tests, no regression)
- `npx tsc --noEmit -p .` — clean (only the pre-existing, unrelated `docs/seed-to-state.test.ts` rootDir diagnostic)
