---
phase: 167-skills-autonomy-rewrite
plan: 04
subsystem: bs-skills
tags: [autonomy, skills, process-gaps, ledger-reconciliation, rulings, fail-loud-sims, drift-tests, prose-spec]

# Dependency graph
requires:
  - phase: 167-03 (prior plan, same phase)
    provides: the >=50% context floor + sub-agent offload substrate and the
      loud-completion/chunk-level-line split this plan's close.md edits sit
      alongside (this plan's new Bookkeeping Sequence item is inserted
      immediately before that Chunk-Complete Line section)
provides:
  - build/close.md's Bookkeeping Sequence item 4, "Reconcile the paperwork
    ledgers (SKILLAUTO-08)" — audits the filings/library-gap, asset-debt,
    and waived-chunk ledgers against what the chunk actually changed and
    re-touches a filing when a fix lands; the terminal lock-release step
    renumbered to item 5, unchanged in substance and still last
  - state-machine.md's "Rulings Outrank Rulebook" strengthened with an
    explicit close-time re-touch obligation on RULINGS.md entries
  - check-status.md's waived-verifications (item 4) and asset-debt (item 5)
    sections explicitly framed as the ledgers close-reconciliation reads
  - build/build.md's library-gap filings section cross-referencing itself
    as a reconcilable ledger
  - build/test.md's fail-loud "sim exercised this chunk's new actions"
    assertion, alongside the pre-existing four SimulationResults
    zero-checks, instrumented via the new action's own execute() callback
    rather than a fabricated coverage API
  - build/playtest.md's Build-Stamp Freshness section reinforced against a
    stale/non-exercising human playtest run
  - two SKILLAUTO-08 drift describe blocks in build-chunk.test.ts (close
    reconciliation + RULINGS re-touch, and fail-loud sims) plus one in
    status-tools.test.ts (ledgers surfaced for reconciliation)
affects: [167-05 (asserts the 60% ceiling + Part D disciplines this plan's
  edits did not disturb survived)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ledger-reconciliation-at-close: a Bookkeeping Sequence step that
      doesn't scan state itself but cites the existing check-status.md
      reader as the source of truth for what changed, then performs the
      one write check-status.md (read-only) cannot: re-touching a stale
      filing/ruling once the fix that resolved it has already landed."
    - "Fail-loud-via-instrumentation, not fabricated API: when the real
      return-shape (SimulationResults) lacks a coverage field the process
      gap needs, the fix instruments the actual code path (the action's own
      execute() callback) rather than inventing a phantom field on a typed
      interface that doesn't have it."

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/build/close.md
    - src/cli/slash-command/bs/build/build.md
    - src/cli/slash-command/bs/check-status.md
    - src/cli/slash-command/bs/state-machine.md
    - src/cli/slash-command/bs/build/test.md
    - src/cli/slash-command/bs/build/playtest.md
    - src/cli/slash-command/bs/build-chunk.test.ts
    - src/cli/slash-command/bs/status-tools.test.ts

key-decisions:
  - "The reconciliation step was inserted as Bookkeeping Sequence item 4
    (renumbering the pre-existing lock release from item 4 to item 5)
    rather than appended after the release, since the plan's edit-target
    anchor and acceptance criteria both require the lock release to stay
    the sequence's terminal write — inserting before it, not after,
    is the only way to satisfy both 'add a reconciliation step' and
    'release stays terminal' simultaneously."
  - "Updated close.md's and playtest.md's pre-existing 'four-item sequence'
    references to 'five-item' (and one 146-REVIEW-pinned test assertion in
    build-chunk.test.ts) rather than leaving them stale, since the light
    path reuses the Bookkeeping Sequence BY NAME and an uncorrected count
    would immediately drift from the actual step count this plan changed."
  - "test.md's fail-loud assertion instruments the chunk's own new
    action's execute() callback with a counter instead of inventing a
    fake per-action coverage field on SimulationResults — the real
    interface (src/testing/random-simulation.ts) has no such field, and
    the plan's action text explicitly forbids inventing one."
  - "Named an explicit exemption for zero-new-action chunks (pure refactor
    or asset-only) in test.md's fail-loud gate, since the gate is framed
    as required/hard rather than advisory and an unstated exemption would
    otherwise read as a blanket requirement that can't be met by chunks
    with no new actions to exercise."

patterns-established:
  - "Fail-pre/pass-post drift-test discipline continued per 167-01/02/03
    precedent: each describe block's assertions were pinned against
    phrases confirmed absent from the pre-edit files (verified via the
    Read tool before any edit landed), then re-run against the edited
    prose and confirmed green before commit."

requirements-completed: [SKILLAUTO-08, PROC-01]

# Metrics
duration: 45min
completed: 2026-07-21
---

# Phase 167 Plan 04: Close-Time Reconciliation + RULINGS Re-Touch + Fail-Loud Sims Summary

**Closed the three B.9 "green but wrong" process gaps: a close-time step that reconciles the filings/asset-debt/waived-chunk ledgers against what each chunk actually changed and re-touches stale paperwork on a fix, a strengthened RULINGS.md re-touch obligation, and a fail-loud assertion that a random-sim (and, by extension, a human playtest) actually exercised this chunk's new actions rather than passing on the four zero-checks alone.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2/2 completed
- **Files modified:** 8

## Accomplishments
- `build/close.md`'s Bookkeeping Sequence gained item 4, "Reconcile the paperwork ledgers
  (SKILLAUTO-08)" — inserted immediately before the (renumbered, still-terminal) lock release —
  which audits the filings/library-gap ledger (citing `build/build.md`'s FILE-don't-patch
  Boundaries), the asset-debt ledger, and the waived-chunk ledger (both citing `check-status.md`'s
  read-only surfacing items by name) against what this chunk changed, and re-touches (marks
  resolved/updated) a filing or ruling a fix this chunk landed already resolved or advanced. An
  explicit "no ledger changes this chunk" fallback prevents a silently-skipped step from looking
  identical to a step that never ran.
- `state-machine.md`'s "Rulings Outrank Rulebook" gained a "Close-time re-touch (SKILLAUTO-08)"
  paragraph making explicit that RULINGS.md is a live, re-touched store, not a write-once log —
  close's ledger-reconciliation step is the mechanism that keeps a ruling entry from silently
  drifting from what the code actually does.
- `check-status.md`'s item 4 (waived verifications) and item 5 (asset debts) now each explicitly
  name themselves as the source-of-truth ledger close-reconciliation reads, cited by name — never
  re-derived — and `build/build.md`'s library-gap filings section cross-references itself the
  same way.
- `build/test.md`'s random-sim item (item 5 of the Ordered Sequence) gained a required fail-loud
  "sim exercised this chunk's new actions" assertion alongside the pre-existing four
  `SimulationResults` zero-checks — implemented by instrumenting the new action's own `execute()`
  callback with a counter (since `SimulationResults` has no per-action coverage field to assert
  against, and the plan explicitly forbids inventing one), framed as a hard gate with an explicit
  exemption for chunks with zero new actions.
- `build/playtest.md`'s Build-Stamp Freshness section gained a reinforcement paragraph naming the
  human-playtest analog of the same silent-coverage failure — a clean-looking playtest that never
  actually reached the chunk's new behavior — and tying the fix back to the existing item-by-item
  Verified Checklist discipline.
- Two new `describe('SKILLAUTO-08` blocks in `build-chunk.test.ts` (close-time reconciliation +
  RULINGS re-touch; fail-loud sims) and one in `status-tools.test.ts` (ledgers surfaced for
  reconciliation) pin all of the above.

## Task Commits

Each task was committed atomically:

1. **Task 1: Close-time ledger reconciliation + strengthened RULINGS/filing re-touch (close.md, build.md, check-status.md, state-machine.md) (+ drift tests)** - `7752aa24` (feat)
2. **Task 2: Fail-loud sims — assert the sim exercised this chunk's new actions (test.md, playtest.md) (+ drift tests)** - `b008fb7b` (feat)

_Both tasks are `tdd="true"`: each commit bundles its drift describe block(s) together with the
prose edits that turn them green — the plan's frontmatter is `type: execute`, not `type: tdd`, so
the plan-level commit-splitting requirement does not apply, per the same precedent 167-03
documented. RED was confirmed by construction: every new marker phrase asserted in the drift
describes (`reconcil`, `re-touch`, `EXERCISED`, `SKILLAUTO-08`, the ledger names) was read and
confirmed absent from the corresponding file via the Read tool BEFORE any prose edit landed for
this plan; GREEN was confirmed by running `npx vitest run` against the edited files before each
commit._

**Plan metadata:** committed separately per `<final_commit>` protocol.

## Files Created/Modified
- `src/cli/slash-command/bs/build/close.md` - added Bookkeeping Sequence item 4 "Reconcile the
  paperwork ledgers (SKILLAUTO-08)"; renumbered the terminal lock release to item 5 (unchanged in
  substance, still the sequence's last write); updated the light-path "four-item" reuse citation
  to "five-item"
- `src/cli/slash-command/bs/build/build.md` - cross-referenced the library-gap filings section
  (Boundaries item 3) as a reconcilable ledger close re-touches
- `src/cli/slash-command/bs/check-status.md` - framed item 4 (waived verifications) and item 5
  (asset debts) as the source-of-truth ledgers close reconciliation consumes
- `src/cli/slash-command/bs/state-machine.md` - added "Close-time re-touch (SKILLAUTO-08)" under
  "Rulings Outrank Rulebook"; updated the light-path bookkeeping description to name the ledger
  reconciliation step
- `src/cli/slash-command/bs/build/test.md` - added the required fail-loud "sim exercised this
  chunk's new actions" assertion to item 5 (random-sim playthrough), with a
  counter-instrumentation example and an explicit zero-new-action exemption
- `src/cli/slash-command/bs/build/playtest.md` - reinforced Build-Stamp Freshness against a
  stale/non-exercising human playtest run
- `src/cli/slash-command/bs/build-chunk.test.ts` - new `describe('SKILLAUTO-08 — close-time
  reconciliation + RULINGS re-touch'` and `describe('SKILLAUTO-08 — fail-loud sims'` blocks
  (appended after 167-03's `SKILLAUTO-07` block, never rewriting it); updated one pre-existing
  146-REVIEW-pinned assertion (`CR-03`) from "four-item" to "five-item" to match this plan's
  Bookkeeping Sequence change
- `src/cli/slash-command/bs/status-tools.test.ts` - new `describe('SKILLAUTO-08 — ledgers
  surfaced for close reconciliation'` block

## Decisions Made
- Inserted the reconciliation step BEFORE the lock release (renumbering the release to item 5)
  rather than appending it after, since the plan's own edit-target anchor and this plan's
  verification criterion both require the release to remain the terminal write of the sequence.
- Propagated the resulting item-count change ("four-item" → "five-item") to every place in the
  repo that cited the Bookkeeping Sequence's exact item count by name — `close.md`'s own
  self-citation, `playtest.md`'s light-path citation, and one 146-REVIEW-era pinned regression
  test in `build-chunk.test.ts` — rather than leaving a now-stale count uncorrected, since the
  light path reuses this sequence BY NAME and an uncorrected count is exactly the kind of
  paperwork-drift this plan exists to prevent.
- Implemented the fail-loud sim assertion via action-level instrumentation (a counter inside the
  new action's `execute()` callback) rather than inventing a coverage field on `SimulationResults`
  — confirmed by reading `src/testing/random-simulation.ts` that no such field exists on the real
  interface, and the plan's action text explicitly prohibits inventing a fake one.

## Deviations from Plan

**1. [Rule 1 - drift maintenance] Updated the pre-existing "four-item sequence" citations to
"five-item" and corrected one 146-REVIEW-pinned test assertion.**
- **Found during:** Task 1, immediately after inserting the new Bookkeeping Sequence item.
- **Issue:** `close.md`'s own light-path-reuse sentence, `playtest.md`'s light-path bookkeeping
  citation, and `state-machine.md`'s light-path status-transition description all named the
  Bookkeeping Sequence's exact item count ("four-item") or listed its contents by name — the
  reconciliation step's insertion made all three stale the moment it landed. A pre-existing
  146-REVIEW-era pinned regression test (`build-chunk.test.ts` `describe('UIQ-05 — final-
  acceptance router coherence...')`, `it('CR-03: ...')`) also asserted the literal "four-item"
  phrase and would have gone RED against the new prose.
- **Fix:** Updated all four-item references to five-item (or, for `state-machine.md`, named the
  new reconciliation step explicitly in the light-path bookkeeping prose) and updated the pinned
  test's expected regex to match. This is exactly the class of paperwork-drift SKILLAUTO-08 exists
  to prevent, so leaving it uncorrected would have contradicted the plan's own purpose.
- **Files modified:** `build/close.md`, `build/playtest.md`, `state-machine.md`,
  `build-chunk.test.ts`.
- **Commit:** `7752aa24`.

No other deviations — both tasks otherwise matched the plan's edit targets, acceptance criteria,
and drift-test convention as written.

## Issues Encountered
Two regex line-wrap fixes were needed in the new drift tests (matching the same precedent 167-02/
167-03 established): `audit the paperwork, not just the code` and `never optional advice` both
wrap across a line break in the authored prose, so the corresponding `toMatch` assertions were
switched from literal-space regexes to `\s+`-tolerant ones before the first green run.

## PROC-01 Verification

- Confirmed every new marker phrase asserted in this plan's drift describes (`reconcil`,
  `re-touch`, `SKILLAUTO-08`, `waived-chunk ledger`, `asset-debt ledger`, `filings? / library-gap
  ledger`, `EXERCISED`, `silent-coverage failure`, `hard gate`, `zero new actions`, `Freshness
  guard reinforced`) was absent from the corresponding target file before this plan's edits — read
  directly via the Read tool during the read-first pass, prior to any Edit call for this plan.
- Confirmed pass-post for both `SKILLAUTO-08` describe blocks in `build-chunk.test.ts` and the one
  in `status-tools.test.ts` after each task's prose edits landed, via `npx vitest run`.
- `npx vitest run src/cli/slash-command/bs` green: 307/307 tests passing across all four suites
  (`templates.test.ts`, `ingest.test.ts`, `build-chunk.test.ts`, `status-tools.test.ts`) after both
  tasks landed.
- Confirmed the Phase-166 terminal lock-release step is still the LAST numbered item in
  `build/close.md`'s Bookkeeping Sequence: `grep -n "^[0-9]\. \*\*"` shows item 5, "Release the
  lock," as the final numbered entry, with the new item 4 ("Reconcile the paperwork ledgers")
  inserted immediately before it — not displaced, not appended after.

## TDD Gate Compliance

Both tasks are marked `tdd="true"` per the plan. Per this repo's established drift-test convention
(confirmed against 167-01/02/03 precedent), the RED and GREEN halves land in a single `feat(...)`
commit per task rather than separate `test(...)`/`feat(...)` commits — RED was confirmed by
construction (marker-phrase absence verified via direct file reads before any edit) rather than by
an intermediate failing-test commit. This plan's frontmatter is `type: execute`, not `type: tdd`,
so the plan-level commit-splitting requirement does not apply.

## Next Phase Readiness
- The close-time ledger reconciliation, RULINGS re-touch strengthening, and fail-loud sim/playtest
  assertions are now load-bearing for 167-05, which per `167-CONTEXT.md` asserts the 60% ceiling
  and Part D disciplines survived this phase's rewrite intact.
- No blockers. The Phase-166 terminal lock-release semantics, the exact
  "orchestrator never reads rulebook slices, BoardSmith docs, or generated code itself" wording,
  and every citation this plan touched (`build/build.md`, `check-status.md`) were preserved or
  correctly re-pointed — confirmed by the full green suite and the explicit lock-release-position
  grep above.

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/build/close.md
- FOUND: src/cli/slash-command/bs/build/build.md
- FOUND: src/cli/slash-command/bs/check-status.md
- FOUND: src/cli/slash-command/bs/state-machine.md
- FOUND: src/cli/slash-command/bs/build/test.md
- FOUND: src/cli/slash-command/bs/build/playtest.md
- FOUND: src/cli/slash-command/bs/build-chunk.test.ts
- FOUND: src/cli/slash-command/bs/status-tools.test.ts
- FOUND commit: 7752aa24
- FOUND commit: b008fb7b

---
*Phase: 167-skills-autonomy-rewrite*
*Completed: 2026-07-21*
