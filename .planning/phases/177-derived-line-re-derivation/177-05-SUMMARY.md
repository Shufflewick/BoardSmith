---
phase: 177-derived-line-re-derivation
plan: 05
subsystem: cli
tags: [verify-pipeline, check-04, derive-recheck, skill-text, stale-claim-sweep, context-economics]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation
    plan: "03"
    provides: "boardsmith verify-derive-recheck (--project/--json only, no --run-id), recordDeriveVerdicts/readDeriveVerdicts, buildBlindDerivePayload"
  - phase: 177-derived-line-re-derivation
    plan: "04"
    provides: "verify/derive-recheck.md (BS-DERIVE-V1), verify/derive-compare.md (BS-DERIVE-COMPARE-V1), both installed as SHARED_LEAF_PROBES"
provides:
  - "verify-game.md's Step 7 (Derived-Line Re-Check, CHECK-04) — routes into both judgment contracts, project-wide scope, findings-exit-0/never-gates-Close stated explicitly"
  - "Close renumbered Step 7 -> Step 8, every cross-reference updated in lockstep"
  - "The Context-Economics Hard Rule's explicit carve-out for CHECK-04's dispatch prompts, preserving the original observable sentence byte-identical"
  - "177-SWEEP.md — a durable, full-file stale-claim sweep record of verify-game.md, TRUE findings included"
affects: [177-06-derive-proof-prediction, 177-07-derive-live-proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Step-insertion renumbering sweep: inserting a new step between an existing pair requires a FULL numeric renumber of every step after the insertion point plus every prose cross-reference naming a step by number, not just the heading itself — the same maneuver 176-04 performed, now proven to recur (Step 0's 'clean close (Step N)' sentence has now drifted twice across two separate phases)."
    - "Carve-out over contradiction: when a new feature's payload legitimately violates an existing hard-rule observable, add an explicit, pinned carve-out distinguishing the two scopes (orchestrator transcript vs. subagent dispatch) rather than weakening or deleting the true sentence — 174-PROOF.md §3's quotedPass1/quotedPass2 precedent, now cited a second time by name."
    - "Sweep record documents STILL TRUE findings, not just fixes — a record listing only broken claims is indistinguishable from not having swept (176-04's precedent, applied a second time to the same file)."

key-files:
  created:
    - .planning/phases/177-derived-line-re-derivation/177-SWEEP.md
  modified:
    - src/cli/slash-command/bs/verify-game.md
    - src/cli/slash-command/bs/verify.test.ts

key-decisions:
  - "Close's condition stays exactly the two pre-existing gates (verify-run-status + verify-classify-status complete) — CHECK-04's own completion was explicitly NOT added as a third gate, per decision 15 (\"CHECK-04 REPORTS; it does not gate Close\"). This was the sweep's single most consequential negative result: the research doc flagged this as an open design question that could have gone either way, and the sweep record states explicitly why it did not."
  - "The Context-Economics carve-out cites `buildBlindDerivePayload` (`verify-derive-recheck.ts`) as the payload-builder for the blind-derivation dispatch, not the `boardsmith verify-derive-recheck` CLI command — the CLI command registered in 177-03 is a read-only REPORT command (`verifyDeriveRecheckCommand`) that never composes a dispatch payload; attributing payload construction to it would have been a fresh stale claim introduced by this very plan. Corrected during drafting before it ever landed in the file."
  - "Two new tests assert the original Context-Economics observable sentence is preserved byte-identical (not just 'contains similar words') — a direct multi-line string match against the exact pre-existing prose, so a future edit that silently weakens the true sentence while adding the carve-out fails loudly."

patterns-established:
  - "A single sentence ('A clean close (Step N, below)...') has now drifted TWICE across two separate phases that both inserted steps before Close (176-04: Step 5 -> Step 7; 177-05: Step 7 -> Step 8) — strong empirical evidence the full-file sweep discipline (not a targeted fix of only the named claims) is load-bearing for this specific file, not a one-off caution."

requirements-completed: []  # CHECK-04 stays open — this plan (5 of 7) wires the skill text; the 22-line distribution prediction (177-06) and the live claude -p dispatch proof (177-07) remain before REQUIREMENTS.md closes CHECK-04.

# Metrics
duration: ~55min
completed: 2026-07-30
---

# Phase 177 Plan 05: CHECK-04 Skill-Text Wiring + Full Stale-Claim Sweep Summary

**Wired CHECK-04 into `/bs-verify-game` as Step 7 (renumbering Close to Step 8), added an explicit
pinned carve-out reconciling the Context-Economics Hard Rule with CHECK-04's dispatch payloads, and
swept the whole router end to end for stale cross-file claims — finding and fixing a second
occurrence of the exact defect 176-04 already found once in this same file (a stale
"clean close (Step N)" cross-reference), plus five other claims, while confirming six others still
hold and recording all twelve.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3 completed
- **Files modified:** 2 (`verify-game.md`, `verify.test.ts`), 1 created (`177-SWEEP.md`)

## Accomplishments

- Added Step 7 (Derived-Line Re-Check, CHECK-04) between Step 6 (Repair Dispatch) and Close,
  stating in Step 5's compressed "In short:" style: the check is independent of staleness/repair
  and does not consume Step 4's staleness verdicts; every `Derived` line surviving
  `isPresentationLine` exclusion is enumerated PROJECT-WIDE, never scoped to stale chunks; each
  survivor is dispatched BLIND carrying `BS-DERIVE-V1` and that slice's quote lines only, with the
  payload built by `buildBlindDerivePayload` (`verify-derive-recheck.ts`), never composed by the
  orchestrator; a SEPARATE dispatch carrying `BS-DERIVE-COMPARE-V1` returns one of the four
  `DERIVE_VERDICTS`; both readings are recorded through `recordDeriveVerdicts`'s one atomic write,
  then reported by formatting `boardsmith verify-derive-recheck --json`'s output — formatted, never
  computed, the same discipline Close already holds; findings citing both derivations verbatim
  exit 0 and never gate Close.
- Close renumbered Step 7 → Step 8 with a full numeric renumber (never a splice): Step 0's "clean
  close (Step N, below)" cross-reference updated, the intro paragraph's dispatch-target list
  extended to name both new delegate files, and Reference Files gained two new bullets in the
  existing one-line style.
- Added an explicit, pinned Context-Economics carve-out directly below the original hard-rule
  sentence (preserved byte-identical, confirmed via `git diff`): the orchestrator's own transcript
  still shows zero quote-rule/`Derived (p.`/`Visual (p.` lines (unchanged, still enforced); the
  exception belongs to the SUBAGENT dispatch prompts and returns — `BS-DERIVE-V1`'s blind prompt
  legitimately carries quote lines (its entire payload) and `BS-DERIVE-COMPARE-V1`'s prompt/return
  legitimately carries a `Derived (p.` line (decision 8's citing-both-derivations requirement).
  States the two observables a reviewer checks SEPARATELY, never as one blanket grep: the blind
  prompt must contain ZERO `Derived (p.`/`Visual (p.` (stronger than the base rule, no exception),
  while the comparison prompt/return is EXPECTED to contain a `Derived (p.` line. Cites
  `174-PROOF.md` §3's `quotedPass1`/`quotedPass2` precedent by name rather than re-arguing it.
- Swept `verify-game.md` end to end (post Task 1/2 state) and wrote `177-SWEEP.md`: 12 claims
  total (6 named in advance by `177-PATTERNS.md`/`177-RESEARCH.md`, 6 found by a first-principles
  pass), disposed as 6 `STILL TRUE (re-verified)`, 5 `REVISED`, 1 `CARVE-OUT ADDED`, 0
  `UNRESOLVED`. The most consequential finding: Step 0's "clean close (Step N, below)"
  cross-reference had drifted a SECOND time — the identical defect class 176-04 already found once
  in this exact sentence, now recurring across a second phase that inserted a step before Close.
  Confirms Close's condition is deliberately unchanged (decision 15) with the reasoning recorded.
  Pastes a real grep for spelled-out (`four` through `ten`) and digit step/reference-file counts —
  all empty, extending coverage beyond the existing `verify.test.ts` guard's `five`-through-`nine`
  regex.
- `verify.test.ts`: moved the "naming Close" pin to Step 8 (with a note documenting the two-phase
  renumbering history), updated the pre-existing structural step-count test from 8 to 9 steps and
  `CHECK-0[1-2]` to `CHECK-0[1-4]` (a deliberate structural pin per its own comment, not a
  free-floating count), and added two new describe blocks: one pinning the CHECK-04 step heading,
  both handshake tokens, the `verify-derive-recheck` report command name, the project-wide/
  never-gates-Close prose, and the Reference Files bullets; another pinning the
  Context-Economics carve-out — the verbatim original sentence, both separately-named observables,
  and the `quotedPass1`/`quotedPass2`/`174-PROOF.md` citation.

## Task Commits

Each task was committed atomically:

1. **Task 1: Insert the CHECK-04 step, renumber Close, add Reference Files bullets** - `3253f705` (feat)
2. **Task 2: The Context-Economics carve-out, with a pin** - `68d7e575` (feat)
3. **Task 3: Full stale-claim sweep of verify-game.md, recording TRUE findings too** - `052fbc79` (docs)

## Files Created/Modified

- `src/cli/slash-command/bs/verify-game.md` - Step 7 (CHECK-04) added, Close renumbered to Step 8,
  Context-Economics carve-out added, Reference Files gained two bullets, intro dispatch list
  extended
- `src/cli/slash-command/bs/verify.test.ts` - naming-Close pin moved to Step 8, structural step-count
  test updated to 9/CHECK-0[1-4], two new describe blocks (CHECK-04 routing, Context-Economics
  carve-out)
- `.planning/phases/177-derived-line-re-derivation/177-SWEEP.md` - new: the full 12-claim sweep
  record

## Decisions Made

See key-decisions above for: Close's condition staying unchanged (decision 15, the sweep's most
consequential negative result), the payload-builder attribution correction
(`buildBlindDerivePayload`/`verify-derive-recheck.ts`, not the `boardsmith verify-derive-recheck`
report CLI), and the verbatim-preservation pin for the original Context-Economics sentence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the plan's own payload-builder attribution before it landed in the file**
- **Found during:** Task 1 drafting
- **Issue:** The plan's `<action>` text described the blind-dispatch payload as "built by
  `boardsmith verify-derive-recheck`". Cross-checking 177-03's actual CLI surface
  (`verifyDeriveRecheckCommand`, registered with `--project`/`--json` only) shows that command is a
  read-only REPORT command — it never composes a dispatch payload. `derive-recheck.md`'s own text
  (177-04) already states the real attribution: "built by a function (`buildBlindDerivePayload`,
  `verify-derive-recheck.ts`)".
- **Fix:** Wrote Step 7's prose citing `buildBlindDerivePayload` (`verify-derive-recheck.ts`) as
  the payload builder, matching `derive-recheck.md`'s own accurate self-description, rather than
  the CLI report command — avoiding introducing a fresh stale claim in the very plan whose Task 3
  exists to sweep for exactly that defect class.
- **Files modified:** `src/cli/slash-command/bs/verify-game.md`
- **Commit:** `3253f705`

**2. [Rule 1 - Bug] Updated a pre-existing structural test (`has exactly eight numbered steps`) not named in the plan's task list**
- **Found during:** Task 1's `npx vitest run` acceptance check
- **Issue:** An EXISTING test (176-04's own precedent test) hardcoded `expect(stepHeadings.length).toBe(8)` and `CHECK-0[1-2]` — both now stale the moment Step 7 (CHECK-04) was inserted. The test's own comment explicitly frames this as an intentional structural pin ("Pinning the exact number is intentional here... a NEW step is a structural addition this test exists to catch"), so the fix was to bump the count and requirement-ID range, not to drop the pin.
- **Fix:** Updated to `toBe(9)` and `CHECK-0[1-4]`, with the comment extended to document both renumbering events (176-04's six→eight, 177-05's eight→nine).
- **Files modified:** `src/cli/slash-command/bs/verify.test.ts`
- **Commit:** `3253f705`

### Deferred Issues

None — all three tasks completed within the fix-attempt limit with zero blocking issues.

## Known Stubs

None. Step 7's dispatch prose is complete and points at real, already-shipped contract files
(177-04) and a real, already-registered CLI report command (177-03) — nothing here is a
placeholder awaiting a later plan.

## Threat Flags

None. This plan's `<threat_model>` (T-177-14 through T-177-17) covers exactly the surface touched:
the Context-Economics carve-out (T-177-14), step renumbering (T-177-15), the stale-claim sweep
(T-177-16), and Close's gate boundary (T-177-17) — all four mitigations are implemented and
verified above. No new security-relevant surface (network endpoint, auth path, file-access
pattern, or schema change at a trust boundary) was introduced; this plan only edits skill-text
prose and its drift-protection tests.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## Verification

- `npx vitest run src/cli/slash-command/bs/verify.test.ts` — 90/90 passed (87 pre-existing + 3 new
  net across both tasks: the CHECK-04 routing block, the Context-Economics carve-out block, and the
  moved/updated step-count pins).
- `npm test` — 3954/3954 green (baseline 3951 + 3 new assertions net, zero regressions).
- Real grep for spelled-out (`four` through `ten`) and digit step/reference-file counts across
  `verify-game.md` — all three empty, pasted into `177-SWEEP.md`.
- `git diff` confirmed the original Context-Economics observable sentence (lines 40-47) is
  byte-identical before and after Task 2 — only new lines were appended below it.

## Next Steps

- 177-06 commits the 22-line distribution prediction (`agrees`/`disagrees`/`underivable`/
  `not-rule-bearing` counts across both reference games) BEFORE measuring, per decision 10's git-
  ordering discipline.
- 177-07 runs the real `claude -p` dispatch proof against both reference games (`~/BoardSmithGames/
  seven` and `~/BoardSmithGames/one-two-punch`), measures against the committed prediction, and
  closes CHECK-04 in `REQUIREMENTS.md`.
- `verify-game.md` is now a fully-swept nine-step router (Step 0 through Step 8) with CHECK-04
  wired, its Context-Economics rule reconciled by an explicit pinned carve-out, and every
  falsifiable claim this phase could break accounted for in `177-SWEEP.md`.

## Self-Check: PASSED

- `src/cli/slash-command/bs/verify-game.md` — FOUND
- `src/cli/slash-command/bs/verify.test.ts` — FOUND
- `.planning/phases/177-derived-line-re-derivation/177-SWEEP.md` — FOUND
- Commit `3253f705` (Task 1) — FOUND in `git log --oneline --all`
- Commit `68d7e575` (Task 2) — FOUND in `git log --oneline --all`
- Commit `052fbc79` (Task 3) — FOUND in `git log --oneline --all`
