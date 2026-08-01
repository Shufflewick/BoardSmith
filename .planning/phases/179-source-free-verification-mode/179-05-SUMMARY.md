---
phase: 179-source-free-verification-mode
plan: 05
subsystem: testing
tags: [pre-registration, satisfiability-audit, vacuity-audit, provenance, verify-close-record]

requires:
  - phase: 179-source-free-verification-mode
    plan: 04
    provides: "verify/source-free-mode.md entered automatically from source-resolution.md's negative case; both Closes dispatch verify-close-record"
provides:
  - "179-PRE-REGISTRATION.md — the audited, pre-committed bar for plan 06's live proof: SC-1/SC-2/SC-3 restated with vacuity closed, decision 11(d)'s per-check minimum-findings table, the whole-tree staging protocol with exact commands, and a direct-read-corrected expected ScopeReason (source-missing, not pre-provenance-project)"
affects: [179-06-live-proof]

tech-stack:
  added: []
  patterns:
    - "Pre-registration committed alone, before any staging or dispatch — git ordering is the only proof the bar wasn't retrofitted to the result (177.1-06, 178-10's precedent, reused unmodified)."
    - "Vacuity audit by name on the phase's own headline success criterion (SC-1), not just as one row among several — a criterion 'satisfied by a mode that runs nothing' gets an explicit restated bar bound to a non-vacuous minimum-findings table, never left as a bare pass/fail on the literal sentence."
    - "SC-3's bar is the on-disk artifact (a real CHUNK.md's fenced ## Verified Against block, read back after the run) explicitly distinguished from the CLI's live recomputation of the identical value — the exact distinction the plan-checker BLOCKED this phase over."
    - "Self-correction left visible in the document rather than silently smoothed over when a first-pass code read (Rulebook source hash on the source-missing branch) proved wrong on a second, closer read before commit."

key-files:
  created:
    - .planning/phases/179-source-free-verification-mode/179-PRE-REGISTRATION.md
  modified: []

key-decisions:
  - "Staged reference game is `seven` (Claude's discretion per CONTEXT): 17 chunks, all with an existing CHUNK.md, none yet carrying a ## Verified Against block (confirmed by direct grep against the real tree) — a clean target for the first live durable-write proof."
  - "Direct read of ~/BoardSmithGames/seven/rulebook/INDEX.md and one-two-punch's own INDEX.md shows 179-CONTEXT.md's inherited claim ('both reference games are pre-provenance-project') is now STALE: both carry commits (seven ecc96a8, one-two-punch b843502) recording a full Source: + Source hash: line, dated after the CONTEXT snapshot. On the staged copy (rulebook/source/ and root rules.pdf both removed per decision 9), computeVerificationScope's precedence therefore fires source-missing, not pre-provenance-project — the pre-registration corrects both the CONTEXT and the plan's own Task 1 instruction text against this stale premise."
  - "CHECK-04 is explicitly excluded from Section 3's per-check minimum-findings bar, citing Phase 177/177.1's disposition (the byte-identical determinism gate was retired as miscalibrated) — recorded before the run so 179-06 does not retrofit a minimum onto a check this milestone already decided not to hold to one."

requirements-completed: [VERIFY-09]

duration: ~35min
completed: 2026-07-31
---

# Phase 179 Plan 05: Pre-Registration — the Source-Free Proof's Bar, Committed Alone Summary

**`179-PRE-REGISTRATION.md` (359 lines) audits all 7 of Phase 179's success criteria for satisfiability and vacuous passage, closes SC-1's own "a banner would pass this" hole by name with a restated bar bound to a per-check minimum-findings table, and — via direct reads that contradicted the phase's own inherited CONTEXT — corrects the expected `ScopeReason` from `pre-provenance-project` to `source-missing` before plan 06 ever stages anything.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 (write + commit-alone)
- **Files modified:** 1 (created)

## Accomplishments

- **Task 1 — the audited pre-registration.** Wrote `179-PRE-REGISTRATION.md`: Section 1 quotes ROADMAP SC-1/SC-2/SC-3 verbatim plus decision 11(a)-(d); Section 2 is a 7-row satisfiability/vacuity audit (3 ROADMAP SCs, 4 decision-11 sub-criteria) with an explicit disposition per row (3 REWRITTEN, 3 folded into their SC's restatement, 1 rewritten-and-bound); dedicated boxed restatements immediately follow the table for SC-1, SC-2, and SC-3 by name, per the plan's explicit instruction; Section 3 sets decision 11(d)'s per-check minimum (CHECK-03 ≥1, CHECK-05 ≥1, CHECK-06 ≥1 REAL live dispatch with downgraded quote provenance and an unrewritten verdict, CHECK-04 explicitly excluded from any minimum); Section 4 is the whole-tree staging protocol with `git status --short` named 4 times and an explicit statement that an enumerated-path baseline (178-PROOF.md §10's exact failure) is not acceptable; Section 5 names the expected `ScopeReason`, exit code, checks-run list, and the durable-record expectation including a self-correction found and fixed before commit.
- **Task 2 — committed alone.** Staged and committed only `179-PRE-REGISTRATION.md` — commit `272d40d4`, 1 file changed, 359 insertions, verified via `git show --stat --name-only --format= HEAD` before writing this summary.
- **A real correction to the phase's own inherited context, found by direct read.** 179-CONTEXT.md's `<measured_reality>` #2 states both reference games are `pre-provenance-project` "as of 2026-07-28." A direct read of the live `INDEX.md` files today shows both games now carry a full `Source:` + `Source hash:` line (git history: `seven@ecc96a8`, `one-two-punch@b843502`, both "docs(rulebook): record source provenance"). This flips the expected `ScopeReason` on the staged copy from `pre-provenance-project` to `source-missing` — the pre-registration records this correction explicitly rather than inheriting the stale premise silently, the same discipline 178-10's pre-registration modeled on its own corpus count.

## Task Commits

1. **Tasks 1+2 combined — write + commit alone** — `272d40d4` (docs)

Per the plan's own structure, Task 1 (write the file) and Task 2 (commit it by itself) are one indivisible action: the file's only value comes from being committed before any measurement, so there is no meaningful intermediate state between "written" and "committed alone" to split into two commits.

## Files Created/Modified

- `.planning/phases/179-source-free-verification-mode/179-PRE-REGISTRATION.md` — the pre-registered, audited bar. 359 lines. Sole file in commit `272d40d4`.

## Decisions Made

See `key-decisions` in frontmatter.

## Deviations from Plan

None affecting scope — one in-document self-correction, not a plan deviation: while drafting Section 5's expected `## Verified Against` body, a first-pass reading of `chunk-provenance.ts`'s `source-missing` branch incorrectly assumed `sourceHash` would be `undefined` (since the archived file is unreadable on that branch). A second, closer read of `chunk-provenance.ts:151-160` before commit showed the branch explicitly returns the `sourceHash` string parsed from `INDEX.md` regardless of whether the archived file itself could be read. The pre-registration's own text records this correction visibly (rather than silently editing it away) and the corrected expected value (`Rulebook source hash: 5138858e78...`) is what appears in the committed code block — no re-commit was needed since the correction was made before the single Task 1+2 commit landed.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**For plan 179-06 (the live proof):**
- **Pre-registration commit:** `272d40d4f13e86fd3ff325041974377e2d1d71f4` — the sole commit touching `.planning/phases/179-source-free-verification-mode/179-PRE-REGISTRATION.md`, and it precedes every commit plan 06 will make. `git log --oneline --all | grep 272d40d4` confirms it is on `main`.
- **SC-1's restated operational bar** (verbatim, to cite): completion means (1) the four source-free checks each ran to their own completion with a captured exit code (expected 0 for all four); (2) the session did not stop at `source-resolution.md`'s negative case — it dispatched into `source-free-mode.md`; (3) the Close executed including its durable write (`verify-close-record`'s `recorded[]` non-empty); (4) bound to Section 3's per-check minimum so "completed" can never be true while every check found nothing.
- **SC-2's restated bar:** exactly 5 `uncheckedDefectClasses` entries (Steps 2-6), each with a non-empty `defectClass` and `wouldHaveBeenCaughtBy`.
- **SC-3's restated bar:** the ON-DISK `## Verified Against` block, read back from a real `CHUNK.md` via `Read`/`cat` — never the CLI's live `--json` recomputation — containing `Scope: code-conformance-only` and `Reason: source-missing` inside the fences.
- **§3 minimum-findings bar:** CHECK-03 (`trace-check`) ≥1 real finding, CHECK-05 (`drift-check`) ≥1 real finding, CHECK-06 (`verify-example-replay`) ≥1 REAL LIVE dispatch with downgraded `QuoteVerifiedProvenance` and an unrewritten verdict. CHECK-04 (`verify-derive-check`) runs to completion but carries no minimum-findings bar — explicitly excluded, per 177/177.1's disposition.
- **Chosen `ScopeReason` and why:** `source-missing`, not `pre-provenance-project`. Both reference games' `INDEX.md` now carry a `Source hash:` line (post-178 provenance-recording commits, confirmed by direct read and `git log`), so `computeVerificationScope`'s precedence — checked top to bottom in `chunk-provenance.ts:30-55` — skips past `pre-provenance-project` (which requires NO `Source hash:` line) and fires `source-missing` (a `Source hash:` line is present, but the staged copy has removed the archived file it points to). Plan 06 must judge against `source-missing`; if the live run instead produces `pre-provenance-project`, that contradicts this document's own direct-read evidence and is itself a finding to report.
- **Staged game:** `seven` (17 chunks, all with `CHUNK.md`, none yet carrying `## Verified Against`). Expected touched-chunk read-back target: `chunks/best-seven-selection/CHUNK.md` (alphabetically first among `drift-check`'s classified set, IF all 17 classify — hedge stated explicitly in the pre-registration since the authoritative set is whatever `driftCheckCommand` actually returns).
- **Staging commands (Section 4):** `git status --short` on the original before AND after; `cp -R`; remove BOTH `rulebook/source/` AND root `rules.pdf` from the COPY ONLY; confirm both removals before dispatching anything.
- **Zero staging or dispatch occurred in this plan** — confirmed no `~/BoardSmithGames` path was created, modified, or copied (only read-only `grep`/`ls`/`find`/`git log` against files already on disk).

## Test Counts

- **Before (baseline, full suite, `npx vitest run`):** 4368 tests / 249 files, 0 failing.
- **After (full suite, `npx vitest run`):** 4368 tests / 249 files, 0 failing.
- **Delta:** 0 — this plan is documentation-only (a `.planning/` markdown file); no source, test, or skill-prose file was touched.

## Self-Check: PASSED

- FOUND: `.planning/phases/179-source-free-verification-mode/179-PRE-REGISTRATION.md` (359 lines)
- FOUND commit `272d40d4` in `git log --oneline --all`
- CONFIRMED: `git show --stat --name-only --format= HEAD` lists exactly one path, matching the file above
- CONFIRMED: working tree clean before this plan started and after the pre-registration commit (only the new file, now committed)

---
*Phase: 179-source-free-verification-mode*
*Completed: 2026-07-31*
