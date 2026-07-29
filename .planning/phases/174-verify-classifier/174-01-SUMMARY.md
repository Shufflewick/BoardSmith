---
phase: 174-verify-classifier
plan: 01
subsystem: verify-classifier-fixtures
tags: [verify-pipeline, fixtures, real-data-proof, presentation-markers]
requires: []
provides:
  - "174-FIXTURES/ — real pass-1 (live) and pass-2 (staged) rulebook slices for seven and one-two-punch, hash-manifested"
  - "174-PROOF.md section 1 — measured basis for CONTEXT.md decision 12b's presentation-marker exclusion constant"
affects:
  - "src/cli/commands/verify-classify.test.ts (plans 174-03/174-04) — will copy these real-slice fixtures into a tmpdir"
tech-stack:
  added: []
  patterns:
    - "Reused Phase 173's verify-run-init/-status/-record + BS-DISPATCH-V2 transcription-subagent dispatch unchanged, via a real `claude -p` subprocess as the closest faithful equivalent to a Task-tool dispatch (no internal Task tool exposed to this executor, matching 173-PROOF.md §3's own documented constraint)."
key-files:
  created:
    - .planning/phases/174-verify-classifier/174-PROOF.md
    - .planning/phases/174-verify-classifier/174-FIXTURES/MANIFEST.md
    - .planning/phases/174-verify-classifier/174-FIXTURES/seven/ (live/, staged/, RUN.md, INDEX.md)
    - .planning/phases/174-verify-classifier/174-FIXTURES/one-two-punch/ (live/, staged/, RUN.md, INDEX.md)
  modified: []
decisions:
  - "Both games' 2-page rulebooks were dispatched as a single page range (1-2), matching Phase 173's own precedent for seven and reusing its documented resolution of the inline-transcription-exception ambiguity."
metrics:
  duration: "~1 session"
  completed: "2026-07-29"
---

# Phase 174 Plan 01: Real Pass-1-vs-Pass-2 Fixture Production Summary

Produced the real pass-1-vs-pass-2 material this entire phase is validated against — reusing
Phase 173's adoption + re-transcription pipeline unchanged against fresh `cp -R` copies of both
reference games, then archiving it in-repo with a hash manifest so it survives scratch cleanup.

## What was built

**Task 1 — Preflight, copies, install, source adoption.** Preflighted both originals
(`seven` confirmed pinned at `a03f38d4792af9dfc7c798be69686fc3230f54dd`, porcelain-empty;
`one-two-punch` HEAD recorded, not asserted clean per the documented pre-existing-dirty-state
exception). `cp -R`'d both into `$SCRATCH`, ran a real `npx boardsmith claude --local --force`
install on each, and adopted each copy's source rulebook via a real `boardsmith ingest-archive`
call (Case 2 of `source-resolution.md` — exactly one root candidate, no `--edition`). Both copies
now carry exactly one file under `rulebook/source/` and an `INDEX.md` `Source hash:` line matching
a fresh `shasum -a 256` of the archived file — the state neither reference game was in before this
plan ran.

**Task 2 — Real pass-2 re-transcription.** For each copy: `verify-run-init` (single page range
`1-2`, matching both games' 2-page rulebooks), a real dispatch of a fresh-context subagent using
the `BS-DISPATCH-V2` pointer block copied byte-identical from `staging-dispatch.md`, then
`verify-run-record` for every unit the subagent's structured return named, then
`--complete-range`. `seven` produced 6 staged files against 3 live rule slices (reproducing
`173-PROOF.md`'s own 6-vs-3 measurement of this exact game exactly); `one-two-punch` produced 6
staged files against 2 live rule slices (a 3x fan-out). Every pre-existing live `rulebook/*.md`
file confirmed byte-identical (sha256) to its pre-pass-2 state — pass 2 wrote nothing over pass 1.
The dispatch's raw return was grepped independently for slice-body markers (`^p\.[0-9]*,`,
`Derived (p\.`, `Visual (p\.`) — zero matches for both games, and the orchestrator's own transcript
never opened a live or staged slice directly.

**Task 3 — Archival + presentation-marker inventory.** Copied both games' live and staged
material, byte-unmodified, into `174-FIXTURES/<game>/{live,staged}/`, plus each run's `RUN.md`
ledger and a per-game `INDEX.md`. Wrote `174-FIXTURES/MANIFEST.md` with both source HEAD hashes,
both run-ids, the exact reproducible command sequence, and a table of all 23 archived files' sha256
+ scratch-copy origin path — independently re-verified 23/23 match. Measured the real
presentation-marker inventory: `seven` live has 0 `Visual (p.` / 0 legacy-qualifier `Derived` lines
out of 10 total `Derived` lines; `one-two-punch` live has 0 `Visual (p.` but 5
`— diagram description` + 1 `— art` out of 12 total `Derived` lines — matching
`174-RESEARCH.md`'s prior measurement of the untouched originals exactly, no contradiction. A
sweep for any third legacy `— <qualifier>` form found only the two known ones (`art`,
`diagram description`). Reconfirmed both `~/BoardSmithGames` originals byte-identical
(whole-tree sha256 diff empty) before and after the entire plan's run.

## Deviations from Plan

None — plan executed exactly as written. The one honestly-reported constraint (no internal
Task/Agent tool exposed to this executor, so a real `claude -p` subprocess stood in for dispatch)
is not a deviation from the plan's own instructions — it is the identical, already-documented
resolution `173-PROOF.md` §3 used for the same constraint, and the plan's `<read_first>` list
explicitly points to that section as the harness to reuse.

## Known Stubs

None. All fixture content is real command/subagent output, never hand-written or invented.

## Self-Check: PASSED

- FOUND: `.planning/phases/174-verify-classifier/174-PROOF.md`
- FOUND: `.planning/phases/174-verify-classifier/174-FIXTURES/MANIFEST.md`
- FOUND: `.planning/phases/174-verify-classifier/174-FIXTURES/seven/staged/01-round.md` (sample)
- FOUND: `.planning/phases/174-verify-classifier/174-FIXTURES/one-two-punch/staged/02-tips.md` (sample)
- FOUND commit `598561fc` (docs(174-01): produce real pass-1-vs-pass-2 fixtures...)
- FOUND commit `300dfc6e` (docs(174-01): archive real live+staged fixtures with sha256 manifest)
- All 23 MANIFEST.md hash rows independently re-verified 23/23 match (see `174-PROOF.md` Task 3)
- Both `~/BoardSmithGames` originals confirmed byte-identical before/after (whole-tree sha256 diff empty, both games)
