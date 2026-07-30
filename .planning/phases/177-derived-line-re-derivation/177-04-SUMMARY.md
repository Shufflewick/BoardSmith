---
phase: 177-derived-line-re-derivation
plan: 04
subsystem: cli
tags: [verify-pipeline, check-04, derive-recheck, judgment-subagent, blind-independence, vitest]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation
    plan: "01"
    provides: "PRESENTATION_EXCLUSION_MARKERS widened to tolerate a parenthetical qualifier; classification-subagent.md and verify-classify.ts back in lockstep"
  - phase: 177-derived-line-re-derivation
    plan: "03"
    provides: "The real CLI surface (boardsmith verify-derive-recheck, --project/--json only) and DERIVE_VERDICTS/createDeriveVerdictRecord this plan's prose points at"
provides:
  - "src/cli/slash-command/bs/verify/derive-recheck.md — the BS-DERIVE-V1 blind-derivation contract: states the never-given list structurally, teaches not-rule-bearing/underivable via two real seven-fixture worked examples with no keyword list, returns rederivedValue+sourceQuotes with no verdict field"
  - "src/cli/slash-command/bs/verify/derive-compare.md — the BS-DERIVE-COMPARE-V1 comparison contract: judges two already-produced readings, passes underivable/not-rule-bearing through unchanged, requires byte-for-byte originalReading/rederivedReading for a disagrees verdict"
  - "Both contracts registered in install-claude-command.ts's SHARED_LEAF_PROBES — partial-install detection now covers both new leaves"
  - "verify.test.ts drift pins for both files: distinct-token assertion, never-given-list pin, RETURN-object-shape pin (fenced code block only, not explanatory prose), cross-file DERIVE_VERDICTS lexicon pin read from verify-derive-recheck.ts at test time, fixture-verbatim worked-example pins, scope-limit pins, and a real installer round-trip (install, delete one leaf, non-force reinstall repopulates it)"
affects: [177-05-derive-skill-wiring, 177-06-derive-proof-prediction, 177-07-derive-live-proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-dispatch judgment split with distinct handshake tokens: a blind-derivation contract whose payload is structurally incapable of carrying the line under test (built by buildBlindDerivePayload, 177-02), and a separate comparison contract dispatched only after the blind answer is already recorded — anchoring is prevented by construction (no shared token, no shared context block), not by an instruction telling the model to ignore something it was shown anyway."
    - "RETURN-shape drift pins scope their assertion to the fenced code block inside the '## RETURN a structured object only' section, not the whole file — so explanatory prose stating 'there is NO verdict field' (which necessarily contains the word 'verdict') does not self-invalidate a guard checking the object literal itself carries no verdict field."

key-files:
  created:
    - src/cli/slash-command/bs/verify/derive-recheck.md
    - src/cli/slash-command/bs/verify/derive-compare.md
  modified:
    - src/cli/commands/install-claude-command.ts
    - src/cli/slash-command/bs/verify.test.ts

key-decisions:
  - "derive-compare.md's token-distinctness prose avoids literally typing 'BS-DERIVE-V1' anywhere (even in a 'distinct from the blind-derivation contract's own token' clarification) so the file genuinely contains zero occurrences of the other contract's token — matching the plan's acceptance criterion literally, not just in spirit, and making the distinct-token test a real string-absence assertion rather than a substring exclusion that would need special-casing."
  - "The two worked examples in derive-recheck.md were selected from real, already-committed 174-FIXTURES/seven/live/ lines rather than invented text: the not-rule-bearing example is 02-solo-variant.md's unqualified page-layout Derived line (no diagram-description qualifier, page geometry only); the underivable example is 01-definitions-and-components.md's deck-math line, whose only supporting fact in the live slice is itself a different Derived line (a diagram description) that quoteLinesOnly strips from the payload — exactly the real gap 177-CONTEXT.md's Question 2 named."
  - "The RETURN-block drift-pin test slices out only the fenced code block (between the two consecutive triple-backtick fences) rather than the whole '## RETURN...' section, so the surrounding prose is free to explain the absence of a verdict field in ordinary English without breaking the automated guard."

patterns-established:
  - "Contract-scoped RETURN-shape pinning: extract the fenced object-literal block specifically when asserting a field is/isn't declared, keeping the assertion honest without forbidding the same word from appearing in surrounding human-readable explanation."

requirements-completed: []  # CHECK-04 stays open — this plan (4 of 7) writes both judgment contracts; skill-text wiring (177-05) and the live claude -p dispatch proof (177-06/07) remain.

# Metrics
duration: 45min
completed: 2026-07-30
---

# Phase 177 Plan 04: The Two CHECK-04 Judgment Contracts Summary

**Wrote `derive-recheck.md` (BS-DERIVE-V1, blind derivation) and `derive-compare.md` (BS-DERIVE-COMPARE-V1, comparison) as genuinely separate contracts with distinct tokens and non-overlapping inputs, so the "independent second opinion" CHECK-04 exists to produce is structural rather than an instruction a composed prompt could silently drop — plus installer leaf probes and drift pins proving both ship and stay in lockstep with `DERIVE_VERDICTS`.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-07-30T21:48:00Z (approx, from prior commit timestamp)
- **Completed:** 2026-07-30T22:33:00Z
- **Tasks:** 3 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `derive-recheck.md` opens with a `BS-DERIVE-V1` dispatch-token validation block (`ruling-recheck.md`'s shape), then states in one place that the subagent is NEVER given the `Derived` line under test, any other `Derived` line, or any `Visual` line — the crux of the whole phase, made structural because `buildBlindDerivePayload` (177-02) is incapable of emitting the target line's own text, not merely instructed to ignore it.
- Two non-value outcomes (`not-rule-bearing`, `underivable`) are each taught with ONE real worked example quoted byte-identical from the committed `174-FIXTURES/seven/live/` corpus — an unqualified page-layout line for `not-rule-bearing`, and a deck-math line whose only support is itself a stripped `Derived` diagram-description line for `underivable` — with zero keyword or trigger-phrase list for either, the same defect class the absence-of-source trap already forbids.
- The RETURN shape is `{ rederivedValue, sourceQuotes }` with explicitly no verdict field — deciding agreement is `derive-compare.md`'s separate job, dispatched only after this answer is already recorded.
- `derive-compare.md` opens with its own distinct `BS-DERIVE-COMPARE-V1` token (the file contains zero occurrences of `BS-DERIVE-V1`, confirmed by both a direct grep and a dedicated test), takes exactly two inputs (the original line verbatim, plus the blind subagent's already-recorded `rederivedValue`/`sourceQuotes`), states all four `DERIVE_VERDICTS` verdicts matching the code enum exactly, and states the never-collapse rule for `underivable`/`not-rule-bearing` explicitly (never folded into `agrees`/`disagrees`), citing the milestone's existing first-class-blindness precedent rather than re-arguing it.
- `derive-compare.md`'s RETURN requires `originalReading`/`rederivedReading` byte-for-byte verbatim for a `disagrees` verdict, mirroring `classification-subagent.md`'s `quotedPass1`/`quotedPass2` discipline, and carries the Context-Economics carve-out sentence citing `174-PROOF.md` §3's precedent for where a quoted line legitimately lives (the subagent dispatch/return, never the orchestrator's own transcript).
- `SHARED_LEAF_PROBES` gained both new files; a real installer run into a temp dir (not console-output trust) confirms both land under `.claude/skills/bs-shared/verify/`, and deleting one proves a non-force reinstall detects the partial tree and repopulates exactly the missing leaf.
- `verify.test.ts` gained a dedicated describe block: token/DISPATCH-REJECTED pins for both files, the distinct-token assertion, the never-given-list pin, a RETURN-object-shape pin scoped to the fenced code block only (so explanatory prose stating "NO verdict field" doesn't self-invalidate the guard), a cross-file `DERIVE_VERDICTS` lexicon pin read from `verify-derive-recheck.ts` at test time, fixture-verbatim worked-example pins (asserted against the real fixture files, not just the skill doc), the never-collapse-rule pin, and both scope-limit pins.

## Task Commits

1. **Task 1: derive-recheck.md — the blind-derivation contract (BS-DERIVE-V1)** - `8a8f86ad` (feat)
2. **Task 2: derive-compare.md — the comparison contract (BS-DERIVE-COMPARE-V1)** - `06a4fe44` (feat)
3. **Task 3: Installer leaf probes and the contract drift pins** - `483b2217` (test)

## Files Created/Modified

- `src/cli/slash-command/bs/verify/derive-recheck.md` - the BS-DERIVE-V1 blind-derivation judgment contract
- `src/cli/slash-command/bs/verify/derive-compare.md` - the BS-DERIVE-COMPARE-V1 comparison judgment contract
- `src/cli/commands/install-claude-command.ts` - `SHARED_LEAF_PROBES` gained both new files' paths
- `src/cli/slash-command/bs/verify.test.ts` - new describe block pinning both contracts' shape/lexicon/install; `ALL_VERIFY_FILES` gained both new files (both pass the existing SC-4 staleness-vocabulary and decision-16 apply/promote/cutover absence scans unchanged)

## Decisions Made

- Avoided literally typing `BS-DERIVE-V1` anywhere inside `derive-compare.md`, including in the token-distinctness explanation, so the "two tokens are distinct" acceptance criterion holds as a genuine string-absence fact rather than requiring the test to special-case a contrastive mention.
- Scoped the RETURN-shape drift pin to the fenced object-literal block specifically (between the two backtick fences), not the whole RETURN section, so `derive-recheck.md`'s own explanatory sentence ("There is NO verdict field here") — which necessarily contains the word "verdict" — doesn't defeat a blanket word-absence check. The object literal itself is what must never declare a verdict field.
- Chose the two worked examples from real, already-committed fixture lines (per `read_first` guidance) rather than any invented text, keeping the drift pin's fixture-verbatim assertions meaningful rather than trivially self-referential.

## Deviations from Plan

None - plan executed exactly as written. The one refinement (scoping the RETURN-shape pin to the fenced code block rather than the whole section) was a test-implementation detail discovered while writing the drift pin itself, not a change to any file's content or the plan's `<action>`/`<acceptance_criteria>` text — the acceptance criteria ("zero occurrences of a verdict word pair... presented as something this contract returns") already anticipated exactly this distinction between the RETURN object's own shape and surrounding prose.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Both CHECK-04 judgment contracts exist, are structurally independent (distinct tokens, non-overlapping inputs, no shared context block), install correctly, and stay in lockstep with the code-level `DERIVE_VERDICTS` enum via a cross-file lexicon pin. `npm test`: 3946/3946 green (baseline 3931 + 15 new tests, zero regressions); `npx tsc --noEmit` clean except the pre-existing permitted `docs/seed-to-state.test.ts` rootDir error. **CHECK-04 stays OPEN in `REQUIREMENTS.md`** — this plan is 4 of 7; `verify-game.md`'s skill-text wiring that actually dispatches these two contracts and calls `recordDeriveVerdicts` (177-05), the 22-line distribution prediction committed before measuring (177-06), and the live `claude -p` dispatch proof against both reference games (177-07) remain.

---
*Phase: 177-derived-line-re-derivation*
*Completed: 2026-07-30*
