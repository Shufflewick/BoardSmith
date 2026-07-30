---
phase: 176-stale-chunk-repair
plan: 04
subsystem: cli
tags: [skill-text, drift-guard, no-fork, stale-claim-sweep, router]

# Dependency graph
requires:
  - phase: 176-stale-chunk-repair
    plan: "176-03"
    provides: verify/ruling-recheck.md, verify/repair-dispatch.md, verify-ruling-recheck CLI, verify-repair CLI
provides:
  - "verify-game.md — swept router with Step 5 (Ruling Re-Check, CHECK-01) and Step 6 (Repair Dispatch, CHECK-02) added, Close renumbered to Step 7, all three discovered stale claims rewritten in place"
  - "verify.test.ts — no-fork guard sourcing lens/repair-bound marker phrases from build/audit.md and build/repair.md at test time, positive delegation pin, absence pins for both retired boundary sentences, routing pins for both new steps, step-numbering contiguity check, no-hardcoded-count guards, decision-11 Interpretation guard — both negative-pin classes empirically proven to fail on re-introduction"
affects: [176-05-check-01-live-proof, 176-06-check-02-live-proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cite-the-source-array over restate-the-list: an enumerated set that lives in code (REPAIR_GATE_DISPOSITIONS) is cited by name from skill text, never re-typed as an inline list, so the citation cannot go stale when the array gains or loses a member."
    - "Drift-guard markers sourced from the real file at test time, with a companion presence assertion against that same file, so a reworded template fails the test loudly instead of silently disarming the guard."
    - "Negative pins proven, not trusted: temporarily reintroduce the exact retired text, observe the assertion fail with the real diff, then revert — a pin never observed to fail is not evidence it works."

key-files:
  created:
    - .planning/phases/176-stale-chunk-repair/deferred-items.md
  modified:
    - src/cli/slash-command/bs/verify-game.md
    - src/cli/slash-command/bs/verify.test.ts

key-decisions:
  - "The Step 4 repair-gate disposition enumeration was not just stale in ONE way (Phase 176's forward-reference) but in a SECOND, previously-unlisted way: it named only three of REPAIR_GATE_DISPOSITIONS's four values, omitting not-applicable. Verified this was a real omission, not a deliberate exclusion, by reading printImpactHumanReport (verify-impact.ts:1099-1122): it iterates ALL four dispositions and prints any group with entries, so not-applicable groups genuinely can appear in the report this step formats. Fixed by dropping the inline list entirely and citing REPAIR_GATE_DISPOSITIONS by name — per the plan's own preference for dropping a hardcoded count over incrementing it."
  - "A THIRD stale claim was found beyond the two named in advance and the disposition-enumeration candidate: Step 0's 'A clean close (Step 5) releases the line to exactly none' became stale as soon as Close renumbered from Step 5 to Step 7. This is exactly the sweep's own warning proven true — a naive fix of only the two pre-named lines would have left this survivor, mirroring 175's missed 'eight-item' variant."
  - "verify/adjudication-gate.md (created in Phase 175, not in this plan's files_modified) carries the identical class of defect — a three-value disposition enumeration omitting not-applicable, and a 'Phase 176's job' forward reference now stale as a label (though still true in effect). Left untouched per the SCOPE BOUNDARY rule (out-of-scope file for this plan) and logged to deferred-items.md with a concrete recommendation for whoever next touches that file."
  - "Ruling Re-Check (CHECK-01) and Repair Dispatch (CHECK-02) were given their OWN numbered steps (5 and 6) rather than folding CHECK-01 into the repair step, since CHECK-01 re-validates ALL non-superseded rulings regardless of chunk staleness (decision 14: all ~62 rulings across both reference games) while CHECK-02 only processes Step 4's stale-chunk subset — conflating the two into one step would misrepresent CHECK-01's broader scope."

patterns-established:
  - "A hardcoded enumeration of a code-owned constant array is itself a stale-claim risk class, distinct from (but the same shape as) a hardcoded step/item count — cite the array, never restate its members, the same discipline 175-01 applied to state-machine.md's Consistency Check item count."

requirements-completed: []  # CHECK-01/CHECK-02 still need 176-05/06's live proof before full closure.

# Metrics
duration: ~70min
completed: 2026-07-30
---

# Phase 176 Plan 04: `verify-game.md` Sweep + Repair Routing + No-Fork Drift Guards Summary

**Full-file sweep of `verify-game.md` found a THIRD stale claim beyond the two named in advance
(a stale step-number cross-reference) plus a second stale dimension inside one of the named
claims (a three-of-four disposition enumeration) — all rewritten in place, with two new routed
steps and drift guards proven to actually fail when violated.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 2/2 completed
- **Files modified:** 2 (`verify-game.md`, `verify.test.ts`), 1 new (`deferred-items.md`)

## Full Swept Claim Inventory

Every claim in `verify-game.md` that asserts what the skill does/does not do, enumerates a count,
or names an owning phase, checked against this phase's actual landed behavior:

| # | Claim (location, pre-edit) | Verdict | Disposition |
|---|---|---|---|
| 1 | Line 15: "It never runs a build and never edits a chunk's design." | **FALSE** (named in advance) | Rewritten: narrowed to "does NOT run the BUILD pipeline's `investigate`/`redteam`/`ask`/`build` steps to scaffold a new chunk" (still true) + new sentence stating repair MAY change an existing stale chunk's code (decision 12, now true). |
| 2 | Lines 20-21: "There is no flag or path anywhere in this skill that writes staged output into a live location." | **TRUE** — verified: neither new step promotes staged→live; lens agents read staged slices as INPUT only, never write them anywhere. | Left BYTE-IDENTICAL (confirmed via `git diff` showing zero change on those two lines). |
| 3 | Line 109 (pre-edit) bolded sentence: "Performing the repair itself is Phase 176's job — this step decides only which chunks need it." | **FALSE** (named in advance) | Rewritten to point at the concrete new Step 6 (`verify/repair-dispatch.md`) instead of a phase-number forward reference. |
| 4 | Line 109 (pre-edit): repair-gate disposition enumerated as exactly three values (`reopen-playtest`, `close-without-replaytest`, `unknown-drift`). | **FALSE — a SECOND, previously-unlisted stale dimension of claim #3.** `REPAIR_GATE_DISPOSITIONS` has FOUR values; `not-applicable` was silently omitted. Verified against `printImpactHumanReport` (`verify-impact.ts:1099-1122`): it iterates ALL four dispositions and prints any non-empty group, so `not-applicable` genuinely can appear in the report this step formats — this was not a deliberate, correct exclusion. | Dropped the inline list entirely; the sentence now cites `verify-impact.ts`'s `REPAIR_GATE_DISPOSITIONS` by name instead of restating its members, per the plan's stated preference for dropping a count over incrementing it. |
| 5 | Step 0, line 71 (pre-edit): "A clean close (Step 5) releases the line to exactly `none`." | **FALSE — the THIRD stale claim, found only by the full sweep, not named in advance.** Close moved from Step 5 to Step 7 the moment Steps 5 and 6 were inserted. | Rewritten to "(Step 7, below)". |
| 6 | Intro paragraph: delegate-file list ("dispatches to `verify/source-resolution.md`, `verify/staging-dispatch.md`, and `verify/classification-dispatch.md`"). | **STALE by omission** — did not name the two files this phase adds. | Updated to include `verify/ruling-recheck.md` and `verify/repair-dispatch.md`. |
| 7 | "It does not explain the status enum, the consistency check, or the session lock inline" | **Still TRUE** — checked; unaffected by the new steps. | Unchanged. |
| 8 | Context-Economics Hard Rule: "The orchestrator never opens a slice — staged or live." | **Still TRUE** — checked against both new skill files: `ruling-recheck.md` states the orchestrator "never reads a ruling body or a slice itself"; `repair-dispatch.md`'s lens dispatches (which DO read slices) are separate fresh-context subagents, never the top-level orchestrator itself. | Unchanged. |
| 9 | Step 3's closing sentence: "acting on them ... is Step 4's job, below." | **Still TRUE** — Step 4 numbering unchanged. | Unchanged. |
| 10 | Step 4's opening: "classification of all pairs completes first (Step 3, above)" | **Still TRUE.** | Unchanged. |
| 11 | Step 0's "Consistency Check ... restate its items" (no hardcoded count, per 175-01's own fix) | **Still TRUE** — re-verified the fix from 175-01 survives this plan's edits untouched. | Unchanged. |
| 12 | Close's closing bullets and "There is no promotion of a staged slice over a live one, at this or any earlier step." | **Still TRUE** — the new steps (5, 6) sit BEFORE Close and do not promote anything; Close's own preconditions (`verify-run-status`/`verify-classify-status` both complete) were considered for whether they should ALSO gate on ruling-recheck/repair completion, but left untouched — extending Close's gating condition is a behavior/architecture change outside this plan's declared scope (Rule 4 territory), not a stale-claim fix. | Unchanged; noted here for the next plan's awareness. |
| 13 | `verify/adjudication-gate.md` § 6 (a SIBLING file, not `verify-game.md` itself): identical three-of-four disposition enumeration + a "Phase 176's job" forward reference. | **FALSE** in the same way as claim #4, and now a stale label (though still true in effect) in the same way as claim #3 — but this file is OUTSIDE this plan's `files_modified` scope. | Left untouched; logged to `deferred-items.md` with a concrete fix recommendation for whichever plan next touches that file. |

## Accomplishments

- Rewrote `verify-game.md`'s known-false line 15 to distinguish "does not scaffold a new chunk the
  BUILD pipeline's way" (still true) from "repair may change an existing chunk's code" (now true).
- Rewrote Step 4's closing sentence to drop the stale three-of-four disposition enumeration in
  favor of citing `REPAIR_GATE_DISPOSITIONS`, and to point the repair-ownership sentence at the
  concrete new Step 6 instead of a bare phase-number forward reference.
- Found and fixed the sweep's third (previously unnamed) stale claim: Step 0's "clean close (Step
  5)" cross-reference, now Step 7.
- Added Step 5 (Ruling Re-Check, CHECK-01) dispatching `verify/ruling-recheck.md`, and Step 6
  (Repair Dispatch, CHECK-02) dispatching `verify/repair-dispatch.md`; renumbered Close to Step 7
  and updated every cross-reference (Steps 0, 3, 4, 6 all cite the correct renumbered targets).
  Added both new files to Reference Files in the existing one-line bullet style.
- Verified lines 20-21's "no flag or path ... writes staged output into a live location" sentence
  remains byte-identical (confirmed via `git diff` showing zero change on those exact lines,
  achieved by isolating the sentence into its own paragraph rather than letting it reflow with the
  edited prose above it).
- Extended `verify.test.ts` with: a no-fork guard reading its lens-marker phrases live from
  `build/audit.md` (with a companion presence assertion against that same file); a same-shape
  guard for `build/repair.md`'s round-bound sentence and its three round-3 triage labels
  (co-occurrence of all three, not any single label, is the fork signal — a single label alone is
  plausible incidental prose); a positive pin that `repair-dispatch.md` actually contains both
  delegation paths; absence pins for both retired boundary sentences; routing pins for both new
  steps and their Reference Files bullets; a step-numbering contiguity check; guards against any
  hardcoded step count, reference-file count, or repair-gate disposition list reappearing; and a
  decision-11 guard that no `bs/verify/*.md` file instructs reading `## Interpretation` outside a
  negation window. `ALL_VERIFY_FILES` extended to include both new files so the pre-existing
  decision-16 and SC-4 guards cover them too.
- Updated three PRE-EXISTING pinned tests that hardcoded the pre-176 shape: the "does not rebuild
  the project" phrase (now the narrowed claim), the six-step count (now eight), and "Step 5 naming
  Close" (now Step 7).
- **Both negative-pin classes were empirically proven to fail on re-introduction, then reverted:**
  1. Temporarily pasted the fidelity-lens marker phrase ("you are checking the CODE against the
     RAW SOURCE") into `repair-dispatch.md`'s "Why by reference" section, ran the suite, and
     observed `CHECK-02 no-fork guard ... > no file under bs/verify/ contains a lens-template
     marker phrase` fail with `AssertionError: expected '# Repair Dispatch...' not to contain
     'you are checking the CODE against the...'` — then reverted the file from a pre-edit backup
     (`git diff --stat` confirmed zero remaining change).
  2. Temporarily reinserted "It never edits a chunk's design." into `verify-game.md`'s intro
     paragraph, ran the suite, and observed BOTH the narrowed-claim pin ("states plainly it never
     scaffolds a new chunk...") and the absence pin ("does not contain either retired boundary
     sentence") fail with the real received text logged — then reverted from a pre-edit backup
     (`git diff --stat` confirmed zero remaining change).
- Logged `verify/adjudication-gate.md`'s identical-class defect (out-of-scope file for this plan)
  to `.planning/phases/176-stale-chunk-repair/deferred-items.md` rather than fixing it here.

## Task Commits

Each task was committed atomically:

1. **Task 1: Sweep verify-game.md, add repair/ruling-recheck routing** - `845c8533` (feat)
2. **Task 2: Drift guards in verify.test.ts** - `030b3c21` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/cli/slash-command/bs/verify-game.md` - swept, re-pinned router with Steps 5/6 added, Close
  renumbered to Step 7
- `src/cli/slash-command/bs/verify.test.ts` - no-fork guard, absence pins, routing pins, three
  existing tests updated for the renumbered/narrowed shape
- `.planning/phases/176-stale-chunk-repair/deferred-items.md` - new: logs `adjudication-gate.md`'s
  identical out-of-scope defect for a future plan

## Decisions Made

See key-decisions above for the full rationale on: the disposition-enumeration fix (cite the
array, don't restate a list), the third discovered stale claim, the `adjudication-gate.md`
scope-boundary deferral, and the two-separate-steps choice for CHECK-01/CHECK-02.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed the disposition enumeration's second stale dimension (three of four values)**
- **Found during:** Task 1's sweep
- **Issue:** Line 109's pre-edit sentence enumerated the repair-gate disposition as exactly three
  values, but `REPAIR_GATE_DISPOSITIONS` has four (`not-applicable` omitted), and
  `printImpactHumanReport` genuinely can print a `not-applicable` group.
- **Fix:** Dropped the inline enumeration; the sentence now cites `REPAIR_GATE_DISPOSITIONS` by
  name.
- **Files modified:** `src/cli/slash-command/bs/verify-game.md`
- **Commit:** `845c8533`

**2. [Rule 1 - Bug] Fixed the third, previously-unnamed stale claim (Step 0's "clean close (Step 5)")**
- **Found during:** Task 1's sweep
- **Issue:** Step 0 cited Close as "(Step 5)"; Close moved to Step 7 once Steps 5/6 were inserted.
- **Fix:** Updated the cross-reference to "(Step 7, below)".
- **Files modified:** `src/cli/slash-command/bs/verify-game.md`
- **Commit:** `845c8533`

**3. [Rule 1 - Bug] Updated three pre-existing pinned tests to match the renumbered/narrowed shape**
- **Found during:** Task 1's `npx vitest run` acceptance check
- **Issue:** Three EXISTING tests (not new) hardcoded the pre-176 shape: the exact "does NOT
  rebuild the project" phrase, a hardcoded six-step count, and "Step 5 naming Close" — all made
  stale by this plan's own renumbering/narrowing, per the task's explicit instruction to "update
  EVERY cross-reference to a renumbered step."
- **Fix:** Updated all three to assert the new narrowed claim, the new eight-step count, and Step
  7 respectively.
- **Files modified:** `src/cli/slash-command/bs/verify.test.ts`
- **Commit:** `845c8533`

### Out-of-Scope Discoveries (logged, not fixed)

**`verify/adjudication-gate.md`'s identical-class defect** — see key-decisions and
`deferred-items.md`. Not fixed here: the file is outside this plan's declared `files_modified`
scope (`verify-game.md`, `verify.test.ts` only), per the SCOPE BOUNDARY rule.

## Issues Encountered

None beyond the deviations and the logged out-of-scope discovery above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `verify-game.md` is fully swept: every claim it makes has been checked, and the file contains
  nothing this phase's own repair mechanism makes false.
- Steps 5 and 6 route to real, already-created skill files (`176-03`'s
  `verify/ruling-recheck.md` and `verify/repair-dispatch.md`) and real, already-registered CLI
  commands (`verify-ruling-recheck`, `verify-repair`) — 176-05 and 176-06 can proceed straight to
  live proof against these routes with no further authoring needed here.
- `deferred-items.md` gives 176-05/176-06 (or a later plan) a concrete, already-diagnosed fix for
  `adjudication-gate.md`'s sibling defect if either plan happens to touch that file anyway.
- `npm test`: 3886/3886 green (baseline 3876 + 10 new assertions across both tasks, zero
  regressions). `npx vitest run src/cli/slash-command/bs/verify.test.ts`: 66/66 green.

---
*Phase: 176-stale-chunk-repair*
*Completed: 2026-07-30*

## Self-Check: PASSED

All modified files and both commit hashes verified present on disk / in `git log --oneline --all`.
