---
phase: 171-provenance-recording
plan: 07
subsystem: cli
tags: [provenance, chunk-check, chunk-provenance-status, proc-01, real-reference-games, honesty-record]

# Dependency graph
requires:
  - phase: 171-provenance-recording
    plan: 04
    provides: "chunkCheckCommand() — the command exercised end-to-end against both reference games"
  - phase: 171-provenance-recording
    plan: 05
    provides: "chunkProvenanceStatusCommand() + projectProvenanceState — asserted on before/after real-game --json output"
  - phase: 171-provenance-recording
    plan: 06
    provides: "the skill-text wiring this plan explicitly does NOT exercise (close/ingest-check invocation remains unproven)"
provides:
  - "171-PROOF.md — the PROC-01 record: real command invocations, verbatim output, real counts (12, 17, 29), and an honest limitations section, run against copies of both reference games"
  - "confirmation that all 29 pre-existing chunks across seven and one-two-punch classify unknown before any chunk-check runs, and all 29 flag verifiedWithoutProvenance"
  - "confirmation that every chunk-check run on both games lands on code-conformance-only/pre-provenance-project, never source-missing"
  - "an independent shasum spot-check matching a recorded cited-slice hash exactly"
  - "F-1 edition normalisation demonstrated on live data: two different raw Edition: strings collapse to one byEdition bucket"
  - "a filed todo for F-3 (boardsmith.json stub description/playtime ownership)"
affects: ["PROC-01", "milestone sign-off for v4.9's provenance-recording phase"]

tech-stack:
  added: []
  patterns:
    - "Proof-only plan: no source files modified, files_modified frontmatter is the PROOF document alone"
    - "cp -R (never git clone) to preserve untracked working state faithfully when copying a reference project for a writing command to run against"

key-files:
  created:
    - .planning/phases/171-provenance-recording/171-PROOF.md
    - .planning/todos/pending/boardsmith-json-stub-ownership.md
  modified: []

key-decisions:
  - "The plan anticipated seven's live chunk prose would exercise the genuinely-ambiguous bare `rulebook/01` shorthand citation (seven has two 01- slices). It does not — every citation in seven's real chunks uses full slice filenames; the shorthand form only appears live in one-two-punch, where it is unambiguous (only one 01- slice there). Recorded this honestly in 171-PROOF.md as a limitation of what this specific run demonstrates rather than silently treating the plan's anticipated scenario as observed. The ambiguity-resolution logic itself remains proven by its Wave-0 unit fixture, confirmed still green in the full suite."
  - "one-two-punch's working tree was not byte-clean at the start (two pre-existing deleted-file entries unrelated to this plan, present before Task 1 ran). The plan's literal acceptance text ('git status --porcelain prints nothing') was not met. Recorded plainly in 171-PROOF.md rather than glossed over — the actual invariant (this plan does not mutate one-two-punch) is proven instead by an identical before/after comparison."
  - "All chunk-check runs (not just the plan's minimum-3-chunk instruction for seven) were run against every chunk in both games, because the plan's own Task 2 acceptance criteria require the post-run status to show unknown:0 for both games, which is only reachable if every chunk has been checked."

requirements-completed: [PROV-01, PROV-02, PROV-03]

# Metrics
duration: ~45min
completed: 2026-07-28
---

# Phase 171 Plan 07: PROC-01 Proof Against Real Reference Games Summary

**`chunk-check` and `chunk-provenance-status` proven end-to-end against copies of both real, pre-contract reference games — 29/29 chunks classify `unknown` before any run and `code-conformance-only`/`pre-provenance-project` (never `source-missing`) after, one hash independently cross-checked, both re-runs idempotent and byte-identical, and the plan's anticipated ambiguous-shorthand scenario honestly recorded as not occurring in live prose rather than silently assumed.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-07-28 (approx)
- **Completed:** 2026-07-28
- **Tasks:** 3
- **Files modified:** 0 source files; 2 files created (`171-PROOF.md`, a todo)

## Task Commits

1. **Tasks 1–3 combined (proof-only plan, no incremental commits between tasks — all evidence gathered, then the record and todo committed together):** `9af068b2` (docs)

## What Was Proven

- **Task 1 (read-only invariant + before-state):** `seven` confirmed clean at
  `a03f38d4792af9dfc7c798be69686fc3230f54dd` before AND after. Both copies' pre-run
  `chunk-provenance-status --json` showed `unknown: 12`/`17`, `full: 0`, `codeConformanceOnly: 0`,
  `projectProvenanceState: "pre-provenance"`. `verifiedWithoutProvenance.length` matched an
  independently-grepped verified-chunk count exactly for both games (12 and 17).
- **Task 2 (chunk-check on real chunks):** All 29 chunks across both games ran `chunk-check` twice
  each (first run: exit 1, block created; second run: exit 0, `changed: false`, byte-identical
  file per independent `shasum -a 256` comparison). Every single one recorded
  `Scope: code-conformance-only` / `Reason: pre-provenance-project` — the `source-missing` STOP
  condition never fired. 11/12 one-two-punch chunks and 15/17 seven chunks resolved at least one
  real cited slice on real prose (exceeding the plan's ≥11/12 threshold for one-two-punch). One
  recorded slice hash was independently cross-checked with `shasum -a 256` and matched exactly.
  Post-run status showed `unknown: 0`, `verifiedWithoutProvenance: []`,
  `projectProvenanceState: "complete"` for both games. F-1 edition normalisation confirmed on live
  data: two different raw `Edition:` free-text lines both grouped under the single
  `"not stated in the rulebook"` bucket.
- **Task 3 (171-PROOF.md + re-assert invariant):** Written with What Was Run / What Was Observed /
  What This Proves / What This Does NOT Prove / read-only invariant before-and-after sections, per
  the plan's required shape. Both invariant checks re-run at the end: `seven` still clean at the
  same commit; `one-two-punch` byte-identical before/after (see Deviations below for the
  pre-existing dirty state honestly recorded rather than hidden). Scratch copies deleted.

## Full-Suite Verification

`npm test` — **229 files / 3407 tests passed**, matching the `171-VALIDATION.md` baseline exactly.
No test file was added or modified by this plan.

## Deviations from Plan

### Recorded honestly, not fixed (this is a proof-only plan; nothing to "fix")

**1. The plan's anticipated ambiguous `rulebook/01` shorthand does not occur in either game's live
chunk prose.** `171-CONTEXT.md`'s interface note states `seven` has two `01-`-prefixed slices,
implying a bare `rulebook/01` citation would be genuinely ambiguous there. A full grep of all 17
seven chunks (and, for contrast, all 12 one-two-punch chunks) for the bare shorthand pattern found
**zero** occurrences in seven — every citation there uses a full slice filename. The shorthand
form only appears live in one-two-punch (`block`'s chunk, 12 occurrences), where it is
unambiguous because one-two-punch has only one `01-`-prefixed slice. This is recorded plainly in
`171-PROOF.md` rather than treated as satisfied: what the resolver's ambiguity-handling logic
actually does when faced with two same-prefix candidates is proven only by its Wave-0 unit
fixture (confirmed still green), not by this run's live data. What this run DID prove on live,
messy prose is the same underlying "never guess, record verbatim" guarantee via a different real
case: 11 of seven's 17 chunks cite `rulebook/INDEX.md` directly (the index file itself, not a
slice), and every one of those citations is correctly recorded verbatim under `unresolved` rather
than silently dropped or misresolved.

**2. `~/BoardSmithGames/one-two-punch` was not byte-clean before this plan started.** Its working
tree carried two pre-existing deleted-file entries (`.boardsmith/runtime-bundle.mjs`,
`.boardsmith/runtime-entry.ts`) at the very first invariant check, before any command in this plan
touched anything. This plan's `git status --porcelain` re-check at the end showed the identical
two entries, unchanged — proving this plan did not mutate the file, but not satisfying the plan's
literal acceptance text ("prints nothing"). Recorded explicitly in `171-PROOF.md`'s "Deviation
from the literal acceptance text" section rather than silently passed over.

Neither deviation required a fix — this plan produces a proof document, not code, and the
honesty_requirement explicitly calls for recording exactly this kind of discrepancy rather than
overclaiming.

## What This Plan CANNOT Prove (honesty requirement, carried into 171-PROOF.md verbatim)

Per the plan's own `<honesty_requirement>`: nothing in this plan exercises a live
`/bs-build-chunk` session. Every command run was a direct CLI invocation
(`node bin/boardsmith.js chunk-check <slug> --project <copy>`), never a session following the
`close` skill-text instruction. Whether a live `close` invocation actually runs `chunk-check`, and
whether Phase 170's `ingest-check` Step-0 call actually runs on a live session, both remain
unproven — exactly as stated in `171-VALIDATION.md`'s "Known Unvalidated" section. The two
load-bearing guarantees that do NOT depend on a session following an instruction — the
machine-owned fence, and `chunk-provenance-status`'s `verifiedWithoutProvenance` flag
(severity-tiered by `projectProvenanceState`) — are what this plan actually demonstrated working
correctly on real data.

## Issues Encountered

None beyond the two honestly-recorded deviations above, neither of which blocked any assertion in
the plan's `<what_to_prove>` list.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- PROC-01 is satisfied for Phase 171: `171-PROOF.md` exists with real counts (12, 17, 29), real
  command output, and an honest limitations section.
- All three PROV requirements (PROV-01, PROV-02, PROV-03) are demonstrated against real,
  pre-contract project data, not only fixtures.
- The still-open question from `171-VALIDATION.md` stands unchanged and is explicitly named again
  in `171-PROOF.md`: whether a live `/bs-build-chunk` session actually invokes `chunk-check` at
  `close`, or `ingest-check` at Step 0. Both remain unproven by any plan in this phase; a live
  session run is the only thing that will settle them.
- F-3 (boardsmith.json stub field ownership after `init`) is filed at
  `.planning/todos/pending/boardsmith-json-stub-ownership.md` for a future phase to pick up.
- Both reference games confirmed untouched: `seven` byte-identical at
  `a03f38d4792af9dfc7c798be69686fc3230f54dd` before and after; `one-two-punch`'s (pre-existing,
  unrelated) dirty state identical before and after.

## Self-Check: PASSED

- `.planning/phases/171-provenance-recording/171-PROOF.md` — FOUND
  (`grep -c "pre-provenance-project"` → matches present; contains real counts 12/17/29, not
  placeholders)
- `.planning/todos/pending/boardsmith-json-stub-ownership.md` — FOUND
- Commit `9af068b2` — FOUND (`git log --oneline` confirms)
- `git -C ~/BoardSmithGames/seven rev-parse HEAD` → `a03f38d4792af9dfc7c798be69686fc3230f54dd`,
  `git status --porcelain` → empty (re-verified at summary-writing time)
- `git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD` → `7e69471bd8980a854f3e351f2f486e1fb6f712b9`
  (unchanged from the plan's own before/after record)

---
*Phase: 171-provenance-recording*
*Completed: 2026-07-28*
