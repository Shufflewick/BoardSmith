---
phase: 178-worked-example-tests
plan: 07
subsystem: testing
tags: [worked-example, check-06, test-01, subagent-contract, dispatch-token]

requires:
  - phase: 178-worked-example-tests plan 02
    provides: "example-derivation.ts — WorkedExampleSpec, createWorkedExampleSpec, buildExampleExtractionPayload/EXAMPLE_EXTRACTION_TOKEN, buildExampleTranslationPayload/EXAMPLE_TRANSLATION_TOKEN, collectGameApiSurface"
  - phase: 178-worked-example-tests plan 05
    provides: "verifyExampleTranslateCommand — the wave that first designed the example-inconsistent extraction-entry shape this plan confirms"
  - phase: 178-worked-example-tests plan 06
    provides: "example-test-emit.ts — GENERATED_TEST_SANDBOX_RULES, RawExampleEmitEntry — the wave that first designed the translated-code CLI wire shape this plan confirms"
provides:
  - "src/cli/slash-command/bs/verify/extract-example.md — BS-EXAMPLE-EXTRACT-V1, the identification/extraction judgment contract"
  - "src/cli/slash-command/bs/verify/translate-example.md — BS-EXAMPLE-TRANSLATE-V1, the spec-to-runnable-test judgment contract"
  - "Both installed (SHARED_LEAF_PROBES) and pinned (verify.test.ts drift tests, cross-file lexicon pins, real-install leaf probe)"
affects: [178-08-build-test-md-wiring, 178-09-verify-game-md-step-8, 178-11-sc3-proof]

tech-stack:
  added: []
  patterns:
    - "Handshake tokens sourced from the already-exported code constants, not invented prose: BS-EXAMPLE-EXTRACT-V1 / BS-EXAMPLE-TRANSLATE-V1 are EXAMPLE_EXTRACTION_TOKEN / EXAMPLE_TRANSLATION_TOKEN, already embedded as the literal first line of buildExampleExtractionPayload/buildExampleTranslationPayload's real dispatch text (example-derivation.ts, plan 02) — the plan's own must_haves table names a different placeholder spelling (BS-EXTRACT-EXAMPLE-V1/BS-TRANSLATE-EXAMPLE-V1), which the CONTEXT's Claude's-Discretion carve-out for token naming permits overriding, and which the cross-file lexicon pin pattern (ENUMERATE_TOKEN, verify.test.ts:563-568) exists specifically to catch a mismatch like this before it reaches a live dispatch."
    - "Two-layer wire shape for the second dispatch's return: the MODEL-facing contract return is the narrow {testCode, imports[], verdictHint, unexecutableReason} (no identity fields — the model never assigns its own id); the CLI-facing --translated wire shape (RawExampleEmitEntry, example-test-emit.ts) is the orchestrator's wrapping of that narrow return around the spec identity (slicePath/lineNumber/pageCitation/sourceText) it already knows from having dispatched that spec in the first place. Both shapes are correct at their own layer; neither supersedes the other."
    - "example-inconsistent carries its evidence in supportingQuoteLines, not in dedicated contradiction fields: the extraction contract's example-inconsistent entries include BOTH contradicting excerpts verbatim in supportingQuoteLines (already a general-purpose field on the shape wave 5 designed) plus a free-prose reason naming which two lines conflict and how — no new field needed, no change to verify-example-replay.ts's RawExampleTranslateExtractionEntry required."

key-files:
  created:
    - src/cli/slash-command/bs/verify/extract-example.md
    - src/cli/slash-command/bs/verify/translate-example.md
  modified:
    - src/cli/commands/install-claude-command.ts
    - src/cli/slash-command/bs/verify.test.ts

key-decisions:
  - "Open question 1 (wave 5's example-inconsistent extraction-return shape) — CONFIRMED with a refinement, not superseded. kind: 'example-inconsistent' + required reason, everything else optional, stands as designed. Refinement (prose-only, no code/type change): the extraction contract instructs that supportingQuoteLines for an example-inconsistent entry must contain BOTH contradicting excerpts verbatim (the quoted example text AND the contradicting Visual/other line), satisfying decision 4's 'both contradicting excerpts' requirement through the field wave 5 already defined rather than adding a new one."
  - "Open question 2 (wave 6's RawExampleEmitEntry translated-code shape) — CONFIRMED as the CLI-level wire shape, at a different layer than the contract's own dispatch return. translate-example.md's subagent RETURN is {testCode, imports[], verdictHint, unexecutableReason} — deliberately identity-free, matching every other CHECK-0x contract's never-let-the-model-assign-identity discipline. RawExampleEmitEntry ({slicePath, lineNumber, pageCitation, sourceText, code}) is the shape an ORCHESTRATOR (not yet built — 178-08/09's job) produces by wrapping the model's testCode/imports around the WorkedExampleSpec identity fields it already knows from having dispatched that spec. Neither shape needed to change; they answer different questions (what the model returns vs. what the CLI ingests)."
  - "Handshake tokens deviate from the plan's literal must_haves spelling (BS-EXTRACT-EXAMPLE-V1/BS-TRANSLATE-EXAMPLE-V1) to match the real exported constants (BS-EXAMPLE-EXTRACT-V1/BS-EXAMPLE-TRANSLATE-V1, example-derivation.ts). This is not optional stylistic drift: buildExampleExtractionPayload/buildExampleTranslationPayload already emit these exact token strings as the literal first line of the dispatch text a real orchestrator will send, so a contract checking for the plan's stated (different) string would reject every real dispatch. 178-CONTEXT.md's Claude's-Discretion section explicitly reserves 'the exact subagent contract filenames/handshake tokens' as an open choice — this is that choice, made to agree with code that already exists rather than with a plan-time placeholder."

requirements-completed: []

duration: ~55min
completed: 2026-07-31
---

# Phase 178 Plan 07: extract-example.md / translate-example.md — CHECK-06/TEST-01's Two Dispatch Contracts Summary

**Wrote the two subagent contracts CHECK-06/TEST-01 actually dispatches — `extract-example.md` (`BS-EXAMPLE-EXTRACT-V1`) identifies worked examples and never resolves a contradiction; `translate-example.md` (`BS-EXAMPLE-TRANSLATE-V1`) turns one validated spec into runnable code, kind-branching a predicate to a direct exported-symbol call rather than forcing `game.doAction` — both installed, both pinned by cross-file lexicon tests against the already-exported token constants, both confirmed against the two open wire-shape questions prior waves deliberately left for this plan.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3 completed (contracts as one commit; installer probes folded into the same commit due to shared test-file edits — see Deviations)
- **Files modified:** 4 (2 new contract files, 2 extended: `install-claude-command.ts`, `verify.test.ts`)

## Accomplishments

- **Task 1 — `extract-example.md`.** The `BS-EXAMPLE-EXTRACT-V1` handshake + `DISPATCH REJECTED` block, copied in shape from `enumerate-facts.md`. States the three real worked-example shapes (transition, predicate, image-derived) with no shared keyword across them — grounded directly in the measured corpus (`seven`'s `"example: 5, 6, 7"`, `one-two-punch`'s Punch Examples, `doom-machine`'s `Worked example content (`). Never-sees list names game source code, existing tests, and `Derived (p.N):` lines by name. Forbids inventing an `id` explicitly (the caller assigns it from the payload's own `lineNumber`). The `example-inconsistent` rule is stated as a hard rule using `seven`'s Run example (quoted text "5, 6, 7" vs. `Visual (p.1):` line naming "1, 2, 3") as the worked illustration, with an explicit instruction that `supportingQuoteLines` must carry BOTH contradicting excerpts verbatim. States a zero-examples return is legitimate and expected.
- **Task 2 — `translate-example.md`.** The `BS-EXAMPLE-TRANSLATE-V1` handshake + rejection block. Branches explicitly on `kind`: `transition` targets `game.doAction(...)`/the project's action-execution entry point; `predicate` targets a DIRECT exported symbol, concretely naming `seven`'s real shape (`ScoringPattern.check` on `RUN_OF_SEVEN_PATTERN`/`COMBO_SETS_AND_RUNS_PATTERN`/`SET_5_PLUS_SET_2_PATTERN`, taking constructed `SevenCard`-shaped card elements, never raw numbers) — verified live against `~/BoardSmithGames/seven/src/rules/scoring.ts` and `seven/tests/scoring.test.ts`'s own `num()`-helper idiom (still current; the pattern set is unchanged from what 178-02 measured). Enumerates three named `unexecutable` reasons (`no-matching-symbol`, `unmodeled-component-state`, `image-derived-indeterminate`) and states guessing at an absent API is forbidden and the single most likely failure mode. Names `GENERATED_TEST_SANDBOX_RULES`' five rules explicitly (`no-network`, `no-timers`, `no-eval`, `no-element-identity-comparison`, `no-element-array-state`) so a violation is caught at generation time. States plainly that the recorded verdict comes from RUNNING the emitted test, never from the contract's own `verdictHint`.
- **Task 3 — installer + pins.** `extract-example.md`/`translate-example.md` added to `SHARED_LEAF_PROBES`. `verify.test.ts` gained three new describe blocks (17 tests): per-contract drift pins (token + rejection block, cross-file lexicon pin against the real exported constant, RETURN-shape vocabulary, never-sees list, scope-limit sentence — 7 and 8 assertions respectively, both above the plan's 6/7 floor), a cross-contract distinctness test (neither file contains the other's token), and a real-install leaf-probe test (installs into a temp dir, asserts both files land under `.claude/skills/bs-shared/verify/` with their tokens intact — mirroring the 177-15 pattern exactly, not a weaker existence check).
- Full suite green: **4263/247 baseline → 4280/247** (17 new tests, 0 subtracted, 0 failing).

## Task Commits

1. Tasks 1-3 (single commit — see Deviations for why) — `ee341da8` (feat: `extract-example.md` / `translate-example.md` — CHECK-06/TEST-01's two dispatch contracts)

## Files Modified

- `src/cli/slash-command/bs/verify/extract-example.md` — new; `BS-EXAMPLE-EXTRACT-V1` extraction contract
- `src/cli/slash-command/bs/verify/translate-example.md` — new; `BS-EXAMPLE-TRANSLATE-V1` translation contract
- `src/cli/commands/install-claude-command.ts` — added both new files to `SHARED_LEAF_PROBES`
- `src/cli/slash-command/bs/verify.test.ts` — `ALL_VERIFY_FILES` extended with both new paths; three new describe blocks (17 tests)

## The Two Open Wire-Shape Questions — Settled

**Question 1 (wave 5, `example-inconsistent` extraction-return shape) — CONFIRMED, with a refinement.** `RawExampleTranslateExtractionEntry`'s shape (`kind: 'example-inconsistent'` + required `reason`, everything else optional) stands as wave 5 designed it — no code change needed. `extract-example.md` instructs the model to satisfy decision 4's "both contradicting excerpts" requirement through the `supportingQuoteLines` field that shape already carries (general-purpose, not new), rather than adding dedicated `contradictionA`/`contradictionB` fields to the extraction entry. Those two fields already exist, but one layer downstream — on `RawExampleTranslationEntry`/`ExampleReplayRecord`, populated at record time, not at extraction time. No supersession; `verify-example-replay.ts` is untouched by this plan.

**Question 2 (wave 6, `RawExampleEmitEntry` translated-code shape) — CONFIRMED, as a different layer than the plan's own stated contract RETURN.** The plan's Task 2 action names `{testCode, imports[], verdictHint, unexecutableReason}` as `translate-example.md`'s RETURN — and that IS the contract's authoritative RETURN, written exactly that way, deliberately identity-free (matching every other CHECK-0x contract's discipline: the model never assigns its own id). `RawExampleEmitEntry` (`{slicePath, lineNumber, pageCitation, sourceText, code}`) is a DIFFERENT, CLI-facing shape — the `--translated` wire format an orchestrator (not yet built; 178-08/09's job) produces by wrapping the model's `testCode`/`imports` around the `WorkedExampleSpec` identity fields it already knows, having dispatched that exact spec to get this response. Both shapes are correct, at their own layer; `example-test-emit.ts` is untouched by this plan.

## Token Names

- `BS-EXAMPLE-EXTRACT-V1` (`EXAMPLE_EXTRACTION_TOKEN`, `example-derivation.ts`)
- `BS-EXAMPLE-TRANSLATE-V1` (`EXAMPLE_TRANSLATION_TOKEN`, `example-derivation.ts`)

Both already existed as exported constants before this plan (built in 178-02) and are already embedded as the literal first line of the real dispatch payload text `buildExampleExtractionPayload`/`buildExampleTranslationPayload` produce. The contract files use these exact strings, not the plan's own `must_haves` placeholder spelling (`BS-EXTRACT-EXAMPLE-V1`/`BS-TRANSLATE-EXAMPLE-V1`) — see Deviations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's stated handshake tokens do not match the real exported token constants — using the plan's literal spelling would break every future dispatch's handshake**
- **Found during:** Task 1, before writing the extraction contract.
- **Issue:** The plan's `must_haves.artifacts` table names `BS-EXTRACT-EXAMPLE-V1`/`BS-TRANSLATE-EXAMPLE-V1` as the two tokens. `example-derivation.ts` (built in plan 178-02, before this plan ran) already exports `EXAMPLE_EXTRACTION_TOKEN = 'BS-EXAMPLE-EXTRACT-V1'` and `EXAMPLE_TRANSLATION_TOKEN = 'BS-EXAMPLE-TRANSLATE-V1'` — different strings (word order swapped) — and both are already embedded as the literal first line of the real dispatch payload text `buildExampleExtractionPayload`/`buildExampleTranslationPayload` produce. A contract file checking for the plan's stated (different) token would reject every real dispatch this pipeline ever sends, because the actual prompt text a live orchestrator sends carries the code's token, not the plan's.
- **Fix:** Wrote both contract files using the real exported constants' values. Confirmed this is within scope: 178-CONTEXT.md's "Claude's Discretion" section explicitly reserves "the exact subagent contract filenames/handshake tokens (following the `BS-*-V1` convention)" as an open choice for the executing plan — this is that choice, made to agree with already-existing code rather than a plan-time placeholder string. Pinned with a cross-file lexicon test (`verify.test.ts`, mirroring the `ENUMERATE_TOKEN` pattern at `verify.test.ts:563-568`) importing the real constant and asserting the contract text contains it — this is the mechanism that would have caught the mismatch had it gone unnoticed.
- **Files modified:** `src/cli/slash-command/bs/verify/extract-example.md`, `src/cli/slash-command/bs/verify/translate-example.md`, `src/cli/slash-command/bs/verify.test.ts`.
- **Commit:** `ee341da8` (part of Task 1/2's commit — caught before any commit was made, not a separate fix commit).

### Commit-granularity note (not a defect)

The plan's three tasks were committed as ONE commit rather than three, because Task 3's `verify.test.ts` edits (the leaf-probe describe block) were composed into the same describe-block insertion as Tasks 1/2's drift-pin tests, in a single edit to a single file, to avoid a second pass reopening and re-diffing the same test file region. `install-claude-command.ts`'s `SHARED_LEAF_PROBES` addition (Task 3's other half) is a two-line, self-contained change that rode along in the same commit. All acceptance criteria for all three tasks are independently verifiable against this one commit's diff.

---

**Total deviations:** 1 auto-fixed (Rule 1 — token mismatch caught before any commit), 1 commit-granularity note (non-substantive).

## Issues Encountered

None beyond the token-mismatch finding above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 178-08 (`build/test.md` wiring) should know:

- **Both contracts are real, installed, and pinned.** Cite `${CLAUDE_SKILL_DIR}/../bs-shared/verify/extract-example.md` and `${CLAUDE_SKILL_DIR}/../bs-shared/verify/translate-example.md` by reference — never restate their content in `build/test.md`'s own prose (the same pointer-not-restatement discipline `verify-game.md` already holds for `enumerate-facts.md`/`reconcile-facts.md`).
- **The tokens are `BS-EXAMPLE-EXTRACT-V1` and `BS-EXAMPLE-TRANSLATE-V1`** — NOT the strings this phase's earlier plan text used as placeholders. Both are the real `example-derivation.ts` exports; a dispatch block naming a different string will be rejected by the contract itself.
- **An orchestrator step is still needed to bridge the two dispatch layers.** `translate-example.md`'s raw model return (`{testCode, imports[], verdictHint, unexecutableReason}`) is NOT directly usable as a `--translated` entry for `verify-example-emit` — the orchestrator (178-08's `build/test.md` step, or 178-09's verify-game.md Step 8) must wrap it with the `WorkedExampleSpec`'s own `slicePath`/`lineNumber`/`pageCitation`/`sourceText` (all already known from having dispatched that spec) to produce `RawExampleEmitEntry`. Likewise, the recorded `agrees`/`disagrees` verdict for `verify-example-record --translation` must come from actually RUNNING the emitted test and observing pass/fail — never from `verdictHint` directly, per what_must_be_right item 5 and the contract's own explicit statement.
- **A real gap for 178-08/09 to be aware of, not fixed here (out of this plan's file scope):** `verifyExampleRecordCommand`'s `RawExampleExtractionEntry` (`verify-example-replay.ts`, plan 178-04) does NOT currently accept `kind: 'example-inconsistent'` in its `--extraction` array — every entry is fed straight to `createWorkedExampleSpec`, which throws for any `kind` outside `transition`/`predicate`. If an orchestrator passes an extractor's raw return (which legitimately CAN contain `example-inconsistent` entries, per this plan's contract) directly as `--extraction` to `verify-example-record`, it will throw on any inconsistent example rather than recording it with `verdict: 'example-inconsistent'`. Wave 5's `verifyExampleTranslateCommand` already handles this correctly (routes to `notTranslated[]`); `verifyExampleRecordCommand` does not yet have the equivalent branch. This is a real, unaddressed seam between plans 04 and 05/07 — whichever of 178-08/09 wires the full extract→translate→record→emit chain end-to-end will hit it on the first `example-inconsistent` fixture (`seven`'s Run example) and needs to either filter `example-inconsistent` entries out of `--extraction` before calling `verify-example-record` and record them separately, or extend `RawExampleExtractionEntry`/`verifyExampleRecordCommand` to handle the kind directly.
- No blockers. Full suite green (4280/247).

---
*Phase: 178-worked-example-tests*
*Completed: 2026-07-31*

## Self-Check: PASSED

`src/cli/slash-command/bs/verify/extract-example.md`, `src/cli/slash-command/bs/verify/translate-example.md`,
`src/cli/commands/install-claude-command.ts`, `src/cli/slash-command/bs/verify.test.ts` confirmed
present/modified on disk; commit `ee341da8` confirmed present in `git log`.
