---
phase: 177-derived-line-re-derivation
plan: "07"
subsystem: docs
tags: [verify-pipeline, check-04, derive-recheck, live-dispatch-proof, phase-closeout, honest-not-met]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation
    plan: "06"
    provides: "177-PREDICTION.md (committed-before-measurement 22-line distribution), 177-PROOF.md §1 (staged proof run)"
provides:
  - "177-PROOF.md §2 — blind-independence proven by real grep on all 16 dispatched prompts (zero Derived (p./Visual (p. leaks, plus a distinctive-substring grep)"
  - "177-PROOF.md §3 — full 16-real-candidate corpus dispatched (29 real claude -p calls), measured distribution compared per-verdict and per-line against the committed prediction"
  - "177-PROOF.md §4 — SC-1/SC-2/SC-3 assessed MET/NOT MET on the evidence; a real, unanticipated structural finding named (target-line identification gap)"
  - "REQUIREMENTS.md — CHECK-04 left OPEN/PARTIAL with section-and-number citations, not closed"
  - "ROADMAP.md — Phase 177 Result paragraph with measured numbers; phase NOT marked complete"
affects: [178-worked-example-tests, 179-source-free-verification-mode]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-dispatch driver script (tsx) importing buildBlindDerivePayload/enumerateDerivedLines/createDeriveVerdictRecord/recordDeriveVerdicts directly from the shipped module — never a reimplementation of the payload/recording logic under test."
    - "Lenient JS-object-literal response parser (brace-counting + multiline-string sanitization) needed because subagent structured returns are not always strict JSON — a real operational detail this proof surfaced, not anticipated in the plan."
    - "Interpretation rules committed in advance can all fail to fire, and the honest response is to name the real, unanticipated cause explicitly rather than force-fitting the result into one of the three pre-committed buckets."

key-files:
  created:
    - path: (scratch only, not committed) /private/tmp/.../scratchpad/177-07-proof/driver.ts — the real dispatch driver
  modified:
    - .planning/phases/177-derived-line-re-derivation/177-PROOF.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/phases/177-derived-line-re-derivation/177-VALIDATION.md
    - .planning/STATE.md

key-decisions:
  - "CHECK-04 is left OPEN/PARTIAL, not closed. SC-2 and SC-3 are MET on real evidence; SC-1 is NOT MET — real dispatch data (not assertion) shows buildBlindDerivePayload's Target-line identifier carries no information the blind subagent can use to distinguish which candidate fact is under test when a slice has more than one Derived line, which is true of every multi-candidate slice in the real 16-line corpus. This dominates the measured 56% (9/16) disagrees rate with targeting-collapse artifacts rather than genuine original-vs-rederivation content mismatches."
  - "None of the three interpretation rules 177-PREDICTION.md committed in advance (mass-underivable, uniform-distribution, zero-not-rule-bearing) fired as anticipated. Rather than forcing the result into one of them, this plan named the real, empirically-discovered structural cause explicitly and reported it as a fourth, unanticipated finding — honoring the plan's own 'if none applies, that is stated' acceptance criterion."
  - "The phase's own goal ('Rule-bearing inferences get an independent second opinion') is measured directly and reported NOT MET: the blind-independence STRUCTURAL guarantee (never sees the original) is proven, but a 'second opinion' that cannot reliably target which fact it is opining on is not the independent second opinion the goal promises."
  - "Dispatch mechanism unchanged from Phases 173-176: real claude -p OS subprocess (16 blind BS-DERIVE-V1 + 13 comparison BS-DERIVE-COMPARE-V1 = 29 total), never native Task/Agent-tool dispatch — this session exposes no such tool."
  - "Phase 177's plan-level bookkeeping (all 7 plans executed/committed) is marked complete in STATE.md's progress counters; this is distinct from CHECK-04's own requirement-closure disposition, which stays OPEN. The two are tracked separately, matching the milestone's established convention that plan completion and requirement closure are not the same claim."

patterns-established:
  - "A live-dispatch proof can disprove its own phase's own success criterion on real data, and the correct response is to report NOT MET plainly (per this milestone's honesty discipline, matching Phase 174's SC-2 90.9%-not-100% precedent) rather than close the requirement on a technicality (the narrower independence guarantee) that doesn't cover what the criterion's text actually promises."

requirements-completed: []  # CHECK-04 explicitly NOT closed — left OPEN/PARTIAL in REQUIREMENTS.md; SC-1 is NOT MET on real evidence.

# Metrics
duration: ~2h30m
completed: 2026-07-30
---

# Phase 177 Plan 07: Derived-Line Re-Derivation — Live Dispatch Proof and Phase Closeout Summary

Ran the full 16-real-candidate corpus through 29 real `claude -p` dispatches (16 blind derivations +
13 comparisons), proved the blind-independence structural guarantee by grepping real saved dispatch
prompts, and closed the phase honestly: CHECK-04's SC-1 is **NOT MET** on real evidence — a genuine,
unanticipated finding (a target-line identification gap in the dispatch payload) dominates the
measured distribution, not the mass-`underivable`/uniform-result/zero-`not-rule-bearing` failure modes
`177-PREDICTION.md` anticipated in advance.

## Performance

- **Duration:** ~2h30m
- **Tasks:** 4 completed
- **Files modified:** 5 (`177-PROOF.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `177-VALIDATION.md`, `STATE.md`)
- **Real dispatches:** 29 (`claude -p` OS subprocess, 16 blind + 13 comparison)

## Accomplishments

- **§2 — blind-independence proven by real grep, not assertion.** All 16 real dispatched blind
  prompts grepped for `Derived (p.`/`Visual (p.` — zero matches across every one. A distinctive
  worked example (`seven` line 21, the "112 numbered cards" arithmetic line) grepped additionally for
  its own distinctive substrings (`"112 numbered cards"`, `"therefore 7 numbers x 4 colors x 4
  copies"`) — zero. The corresponding comparison prompt grepped separately, non-zero as expected,
  accounted for by the Context-Economics carve-out.
- **§3 — full corpus dispatched and measured, no sampling.** 16 blind dispatches (10 `seven` + 6
  `one-two-punch`) + 13 comparison dispatches (3 blind stages resolved `underivable`/`not-rule-bearing`
  directly, per the pass-through rule). Measured distribution: `agrees` 4, `disagrees` 9, `underivable`
  1, `not-rule-bearing` 2 — compared per-verdict and per-line against `177-PREDICTION.md` (commit
  `913bfe7d`, confirmed to predate this work): 5 hits, 11 misses.
- **The central finding: none of the three pre-committed interpretation rules fired.** Instead, real
  data revealed that `buildBlindDerivePayload`'s `Target line` identifier carries no locatable meaning
  inside the quote-only payload the blind subagent actually receives, so a slice with multiple
  candidate `Derived` lines gets the SAME collapsed derivation dispatched under every target's name —
  demonstrated directly: `seven`'s 5-candidate slice (`01-definitions-and-components.md`) produced
  near-identical "112/119 cards" derivations for all 5 lines regardless of which line was nominally
  under test, agreeing only with the 2 lines that happen to actually be about that fact (19, 21) and
  disagreeing with the 3 that are not (8, 14, 33). This pattern repeats in every multi-candidate slice
  in the corpus.
- **§4 — SC-1/SC-2/SC-3 assessed plainly.** SC-1 NOT MET (the narrower "never sees the original"
  independence claim is proven; the per-line targeting judgment SC-1's own text promises is not). SC-2
  MET (citing-both-derivations mechanism enforced unconditionally by `createDeriveVerdictRecord`, 9/9
  real `disagrees` records carry both fields). SC-3 MET, same constructed-input-only disposition Phase
  176 used for its own real-corpus gap (zero real `Visual (p.` lines in either game).
- **Phase closeout (Task 4):** `REQUIREMENTS.md`'s CHECK-04 row and coverage-table row updated to
  PARTIAL/OPEN with `177-PROOF.md` section-and-number citations, not `[x]` closed. `ROADMAP.md`'s
  Phase 177 section gained a `**Result:**` paragraph with the measured numbers; the phase list
  checkbox stays unchecked (goal not met). `177-VALIDATION.md` set `status: closed-partial` /
  `nyquist_compliant: true` (true for how this plan's own sampling was conducted, not a claim CHECK-04
  is complete). `STATE.md` hand-edited (never via `gsd-sdk state.update-progress`, which is known to
  corrupt this project's frontmatter): `completed_phases` 7→8, `completed_plans` 53→54 (all 7 plans of
  Phase 177 executed/committed — plan-level completion, distinct from CHECK-04's own open disposition).

## Task Commits

Each task was committed atomically:

1. **Task 1: §2 — the grepped blind-independence observable** - `bffc72e5` (docs)
2. **Task 2: §3 — the full 22-line corpus run and the measured distribution** - `903ad61d` (docs)
3. **Task 3: §4 — closure, limitations, and originals re-verification** - `12b9556d` (docs)
4. **Task 4: Phase closeout — CHECK-04 disposition, ROADMAP Result, VALIDATION sign-off** - (this
   commit, immediately following this SUMMARY per the sequential-execution protocol)

**Plan metadata:** (final commit, immediately following)

## Files Created/Modified

- `.planning/phases/177-derived-line-re-derivation/177-PROOF.md` — added §2 (grepped independence
  observable), §3 (full corpus run and measured distribution), §4 (closure, limitations, both
  originals re-verified byte-identical)
- `.planning/REQUIREMENTS.md` — CHECK-04's checklist row and coverage-table row set to PARTIAL/OPEN
  with `177-PROOF.md` section-and-number citations
- `.planning/ROADMAP.md` — Phase 177's `**Result:**` paragraph added with measured numbers; plan
  177-07 marked `[x]` with a "Goal NOT MET" note; the phase list checkbox stays unchecked
- `.planning/phases/177-derived-line-re-derivation/177-VALIDATION.md` — `status: closed-partial`,
  `nyquist_compliant: true`, sign-off checklist ticked truthfully, closure note added
- `.planning/STATE.md` — hand-edited (`completed_phases` 7→8, `completed_plans` 53→54, `percent`
  98→100, `stopped_at` narrative updated)

## Deviations from Plan

**None of the plan's own tasks were skipped or altered in scope.** Two implementation-level
deviations, both Rule 1 (auto-fix bugs) in the throwaway driver script only — no shipped/production
code was touched:

**1. [Rule 1 - Bug] Missing `BS-DERIVE-COMPARE-V1` token in the first driver script draft.** The
comparison-dispatch prompt builder omitted the literal token string, causing the very first comparison
dispatch to be correctly REJECTED by `derive-compare.md`'s own token-validation gate (the contract
working exactly as designed — proof the gate is load-bearing). Fixed by adding the token as the
prompt's first line; verified by re-dispatching and observing acceptance. No evidence file from the
rejected dispatch was used in the final proof.

**2. [Rule 1 - Bug] Strict `JSON.parse` failed on subagent structured returns.** Real subagent replies
sometimes use JS-object-literal syntax (unquoted keys, single-quoted strings) with prose reasoning
fields that wrap across literal newlines — invalid for both strict JSON and a JS string literal. Fixed
by adding a string-aware multiline-string sanitizer (escapes literal newlines found inside
single/double-quoted string values before parsing) ahead of a `JSON.parse` → `Function`-literal-eval
fallback chain. Verified against the actual failing saved response file before re-running the full
corpus.

**Not a deviation, but worth naming: the driver script accidentally executed twice** during
development (a standalone parser-test script imported the driver module, which runs `main()` at
import time as a side effect) — the FIRST full run failed partway through (compare token bug above);
the accidental second run completed successfully with both fixes in place and is the one this proof
cites. No corrupted or partial ledger state resulted — `recordDeriveVerdicts` only wrote once per game,
at the end of each game's full candidate loop, from the successful run.

## Known Stubs

None — no UI or data-rendering code was touched by this plan; it is proof/bookkeeping only.

## Threat Flags

None — this plan's real threat-model items (T-177-21 through T-177-24) are exactly the ones §2/§4
prove/re-verify; no new network endpoint, auth path, or trust-boundary surface was introduced.

## Verification

- `grep -c "Derived (p\." evidence/blind__*.txt` → 0 for all 16 files (real, pasted in `177-PROOF.md` §2)
- `boardsmith verify-derive-recheck --project <scratch>/seven --json` /
  `--project <scratch>/one-two-punch --json` → real verdict counts pasted in `177-PROOF.md` §3,
  summing to 16 (real candidates) / 22 (full corpus incl. mechanical exclusions)
- `git log --oneline -1 -- 177-PREDICTION.md` → `913bfe7d`, confirmed to predate this plan's commits
- Both `~/BoardSmithGames/{seven,one-two-punch}` whole-tree sha256 manifests diffed empty before/after
  all 29 real dispatches
- `npm test` → 241 test files, 3954 tests, all passed (run after Task 2's real dispatches and again
  before Task 4's closeout edits)

## Self-Check

```
FOUND: .planning/phases/177-derived-line-re-derivation/177-PROOF.md (§2/§3/§4 present)
FOUND commit: bffc72e5
FOUND commit: 903ad61d
FOUND commit: 12b9556d
FOUND: .planning/REQUIREMENTS.md CHECK-04 row updated (PARTIAL/OPEN)
FOUND: .planning/ROADMAP.md Phase 177 Result paragraph
FOUND: .planning/phases/177-derived-line-re-derivation/177-VALIDATION.md status: closed-partial
FOUND: .planning/STATE.md completed_phases: 8, completed_plans: 54
```

## Self-Check: PASSED
