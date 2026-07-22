---
phase: 167-skills-autonomy-rewrite
verified: 2026-07-21T00:00:00Z
status: passed
score: 6/6 must-haves verified (the 1 coherence defect was closed by fix(167-gap) — commit resolves floor-vs-harness precedence explicitly + drift assertion; full suite 3111/3111)
overrides_applied: 0
gaps:
  - truth: "Success Criterion 4 — 'The context threshold is ≥50% before winding down' (SKILLAUTO-06) does not contradict the 60% harness-warning ceiling"
    status: failed
    reason: >
      state-machine.md's "Context floor + ceiling" section states the floor unconditionally
      ("the session never winds down before at least 50% of the context window is consumed
      ... Stopping earlier ... is exactly the premature bail this floor forbids, regardless of
      how the work feels"), but the very next sentence in the same section defines the stop
      condition as "At or above ~60% used (or the moment the harness surfaces a context warning
      earlier than that, whichever comes first)". A real harness-emitted context warning is by
      definition not a "vague hunch" — it is the one signal the same paragraph elsewhere calls
      sanctioned ("reading the harness's own context-usage signal against the 50% floor and the
      60% ceiling"). If that genuine signal fires below 50% (e.g. at 35%), the prose gives no
      resolution: the floor sentence says never stop before 50% "regardless of how the work
      feels," while the ceiling sentence says stop at "the moment the harness surfaces a context
      warning earlier than [60%]" with no floor carve-out. The identical ambiguity is duplicated
      verbatim in build-chunk.md's mirror ("At/above ~60% used (or an earlier harness context
      warning, or a stuck automated step), it finishes ... then stops"). REQUIREMENTS.md's
      SKILLAUTO-06 text ("do not wind down before at least 50% context consumed") is also
      unconditional and contains no harness-warning exception, so this isn't a case of the
      requirement itself licensing the ambiguity — it's an unresolved contradiction introduced
      by the phase's own prose.
    artifacts:
      - path: "src/cli/slash-command/bs/state-machine.md"
        issue: "Lines ~296-311 ('Context floor + ceiling' section): the ≥50% floor sentence and the '(or the moment the harness surfaces a context warning earlier than that, whichever comes first)' clause are not reconciled — no text states which wins when a genuine harness warning fires below 50%."
      - path: "src/cli/slash-command/bs/build-chunk.md"
        issue: "Lines ~386-391 mirror the same unresolved ordering: 'At/above ~60% used (or an earlier harness context warning, or a stuck automated step)' with no floor carve-out, immediately after asserting '≥50% floor ... never stop early because a chunk feels big at 40%.'"
    missing:
      - "One sentence in state-machine.md's 'Context floor + ceiling' section (and its build-chunk.md mirror) resolving the precedence: e.g. either (a) 'a genuine harness-emitted context warning is obeyed immediately even below the 50% floor — the floor governs self-initiated wind-down only, not a real harness signal,' or (b) 'the harness warning clause only ever applies at/above the 50% floor; a warning received below 50% is logged and the session continues, re-checking at the next step boundary.' Either resolution is acceptable — the current text asserts both an absolute floor and an earlier-stop trigger with no ordering between them."
---

# Phase 167: Skills Autonomy Rewrite Verification Report

**Phase Goal:** The `bs-skills` build as autonomously as possible while every human interruption stays meaningful — playtest-gate policy, question discipline, batched questions, run-while-away, auto-advance, a ≥50% context threshold with sub-agent offload, and loud completion — WITHOUT eroding any Part D discipline that kept provenance clean.
**Verified:** 2026-07-21
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Human playtest gates are exactly B.1's three milestones + always-stop-for-rules-adjudication; no per-chunk unconditional stop (SKILLAUTO-01) | ✓ VERIFIED | `SKETCH.template.md` carries an explicit `Milestone:` field (`none\|core-loop\|scoring\|final-acceptance`) set at sketch-derivation time (`ingest/sketch-derivation.md`); `state-machine.md`'s human-gate list and `build/playtest.md`'s "Milestone/UI Gate (SKILLAUTO-01)" gate the human client-playtest stop on `Milestone: non-none AND ui: touches/major`; a UI-less chunk is never routed regardless of milestone; a rules-adjudication/open-question escalation is a standalone always-stop bullet independent of milestone status. Non-milestone chunks retain `test`/`audit`/self-playtest/sim internal steps unchanged (`build/playtest.md` lines 22-30). |
| 2 | Ask triple-gate + record-assumption; batched question queue; auto-advance; resume command reframed as crash-fallback (SKILLAUTO-02..05) | ✓ VERIFIED | `build/ask.md` "Ask Triple-Gate (SKILLAUTO-02)" states undetermined AND load-bearing AND no-reasonable-default, else proceed + record in DECISIONS.md; never-re-ask and never-UI-less-playtest rules present. `state-machine.md`'s "Batched-question queue (SKILLAUTO-03)" distinguishes non-blocking (queues, surfaces at next gate) from blocking (still gates `ask` directly) questions. "Cross-chunk continuation ... run-while-away + auto-advance (SKILLAUTO-04/05)" names the generate-AI → final-acceptance progression and states auto-advance is bounded by the milestone gates, rules escalation, and context/stuck-state conditions. `build/close.md` and `build-chunk.md` reframe the printed `/bs-build-chunk` command as a crash/cold-resume fallback, never the default end-of-close signal — this is real behavioral prose (explicit stop-vs-continue conditions), not doc-only commentary. |
| 3 | ≥50% floor AND 60% ceiling both present and non-contradictory; sub-agent offload; loud banner + summary card (SKILLAUTO-06/07) | ⚠️ PARTIAL — floor present, offload present, loud completion present; floor/ceiling ARE contradictory (see gap below) | `state-machine.md` "Context floor + ceiling (SKILLAUTO-06)" states both the ≥50% floor and the unchanged 60% ceiling; sub-agent offload of research/audits/large-reads/repairs is named as the lever, citing the Context-Economics Hard Rule verbatim-preserved. `build/final-acceptance.md` has a "Game-Complete Banner + Summary Card (SKILLAUTO-07)" (Shipped/Test count/Deferred, 3 fields) and `build/close.md` has a lighter, explicitly non-blocking "Chunk-Complete Line." **However**, the floor and ceiling sentences are not reconciled for the case where a genuine harness context-warning fires below 50% — see Gap 1. |
| 4 | Close-time ledger reconciliation present; Phase-166 terminal lock-release still last close step; RULINGS re-touch; fail-loud sim-exercised assertion (SKILLAUTO-08) | ✓ VERIFIED | `build/close.md`'s Bookkeeping Sequence: item 4 "Reconcile the paperwork ledgers (SKILLAUTO-08)" (`grep -n "^[0-9]\. \*\*"` confirms item 5 "Release the lock" is still the final numbered item — reconciliation inserted before, not after, the release). `state-machine.md`'s "Rulings Outrank Rulebook" gained "Close-time re-touch (SKILLAUTO-08)." `build/test.md` item 5 adds a required fail-loud "sim must have EXERCISED this chunk's new actions" assertion beyond the four pre-existing zero-checks, instrumented via the new action's own `execute()` callback (no fabricated `SimulationResults` field), with an explicit zero-new-action exemption. |
| 5 | PROC-02: explicit "autonomy=how-not-what" statement exists; all 6 Part D disciplines' text still present | ✓ VERIFIED | `state-machine.md` has a top-level "## Autonomy Scope: How, Never What (PROC-02)" section stating autonomy governs HOW never WHAT, ties to the Cold-Resume Parse Contract's "it never guesses the intended state" and Redteam Escalation's "Disputes go to the human, never to more agents." `build-chunk.md` mirrors with a citing paragraph. Direct reads of `build/build.md`, `build/test.md`, `build/redteam.md`, `build/playtest.md`, `state-machine.md` confirm no debt markers, no removed Part D anchor text (escalate-don't-hack, reuse-not-rebuild, honest-derived labeling, surface-don't-fabricate, in-process redteam, build-literally are all intact and cited by the SUMMARY's regression describe block, independently spot-checked here). |
| 6 | COHERENCE: rules-adjudication still stops immediately alongside batching; auto-advance does not skip the 3 milestone gates; ≥50% floor does not contradict "obey the harness warning immediately"; UI-less-never-playtest does not collide with milestone gates | ✗ FAILED (one sub-check) | Rules-adjudication-always-stops: VERIFIED — the always-stop bullet is independent of milestone/batching and no prose routes a genuine rules ambiguity into the batch queue (the queue text explicitly scopes to non-rules, non-blocking items; a blocking question "still gates that chunk's `ask` directly"). Auto-advance-respects-milestones: VERIFIED — "Cross-chunk continuation" explicitly bounds auto-advance "only by the milestone gates (SKILLAUTO-01's three milestone chunks), a genuine rules adjudication ... and the context/stuck-state conditions." UI-less-never-playtest vs milestone gates: VERIFIED — `build/playtest.md`'s Milestone/UI Gate requires BOTH conditions; a milestone chunk with `ui: none` is explicitly never routed to a human playtest, with no collision (internal verification substitutes). **≥50% floor vs "obey the harness warning immediately": FAILED — see Gap 1 below, a genuine unresolved contradiction.** |

**Score:** 5/6 truths verified; 1 truth (context floor/ceiling coherence) fails on a real prose contradiction.

### Gap 1 — Floor/ceiling harness-warning contradiction (BLOCKER)

`state-machine.md` "Context floor + ceiling (SKILLAUTO-06)" asserts, in sequence:

1. "the session never winds down before at least 50% of the context window is consumed. Stopping earlier ... is exactly the premature bail this floor forbids, regardless of how the work 'feels.'" (unconditional floor)
2. "At or above ~60% used (**or the moment the harness surfaces a context warning earlier than that, whichever comes first**), the session finishes the step it is on ... and then stops" (stop trigger with no floor exception)
3. "The one thing that IS a real capability here is reading the harness's own context-usage signal against the 50% floor and the 60% ceiling" (the harness signal is explicitly sanctioned, not a "vague hunch")

`build-chunk.md` duplicates the same unresolved pair verbatim in its own mirror ("≥50% floor ... never stop early because a chunk 'feels big' at 40%" immediately followed by "At/above ~60% used (**or an earlier harness context warning**, or a stuck automated step), it finishes ... then stops").

Neither file states what happens if the harness itself emits a genuine, real context-warning signal below 50% (e.g. 35%). Statement 1 says the session must not wind down; statement 2 says an earlier harness warning is itself sufficient to trigger the stop, with no floor carve-out. This is a live behavioral ambiguity an executing agent will hit on any run where the harness's own warning threshold happens to be below 50% of that particular context window — not a hypothetical edge case, since "the harness surfaces a context warning" is presented as an independent, sanctioned trigger, not merely a restatement of the 60% ceiling.

REQUIREMENTS.md's own SKILLAUTO-06 text ("do not wind down before at least 50% context consumed") contains no exception for a harness signal, so this is not a case where the roadmap/requirement itself licenses the ambiguity — it is a defect introduced by the phase's prose that a downstream agent-instruction file (twice) leaves unresolved.

**This looks like an oversight, not an intentional deviation** — no plan or SUMMARY discusses this ordering, and 167-03-SUMMARY's own framing ("two independent thresholds coexist rather than one number being replaced by another") describes the intended design without addressing what happens when they conflict. Recommend either (a) "a genuine harness-emitted warning is obeyed immediately regardless of the 50% floor — the floor governs only self-initiated stops on a vague 'feels long' hunch, never a real harness signal" or (b) "the harness-warning trigger only applies at/above the 50% floor; a warning received below 50% is logged and the session continues to the next checkpoint before re-evaluating." A one-sentence resolution in both files closes this gap.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/slash-command/bs/templates/SKETCH.template.md` | `Milestone:` field on chunk entries + Mandated Chunks anchors | ✓ VERIFIED | Field present on detailed + tail entries; Mandated Chunks section names the 3 anchors 1:1 with the flag values |
| `src/cli/slash-command/bs/ingest/sketch-derivation.md` | instructs setting milestone flag at derivation time | ✓ VERIFIED | Confirmed cited by SKETCH.template.md comment |
| `src/cli/slash-command/bs/state-machine.md` | milestone-gated human-gate list, batched queue, run-while-away/auto-advance, floor+ceiling, PROC-02 statement, RULINGS re-touch | ✓ VERIFIED (with Gap 1 coherence defect inside) | All required sections present and substantive |
| `src/cli/slash-command/bs/build/playtest.md` | Milestone/UI Gate | ✓ VERIFIED | Gate requires both milestone AND UI conditions; UI-less always exempt |
| `src/cli/slash-command/bs/build/ask.md` | triple-gate | ✓ VERIFIED | Explicit 3-condition test + record-assumption + never-re-ask + never-UI-less-playtest |
| `src/cli/slash-command/bs/build/close.md` | ledger reconciliation as item 4, lock release still terminal item 5; chunk-complete line | ✓ VERIFIED | `grep` confirms numbered-item ordering |
| `src/cli/slash-command/bs/build/test.md` | fail-loud sim-exercised assertion | ✓ VERIFIED | Instrumented via execute() counter, not a fabricated field |
| `src/cli/slash-command/bs/build/final-acceptance.md` | game-complete banner + 3-field summary card | ✓ VERIFIED | Present |
| `src/cli/slash-command/bs/build-chunk.md` | Step Group 4 dispatch, Context-Economics Hard Rule preserved, PROC-02 mirror | ✓ VERIFIED (Gap 1 duplicated here too) | |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| SKILLAUTO-01 | Milestone playtest gates | ✓ SATISFIED | See Truth 1 |
| SKILLAUTO-02 | Ask triple-gate | ✓ SATISFIED | See Truth 2 |
| SKILLAUTO-03 | Batched questions | ✓ SATISFIED | See Truth 2 |
| SKILLAUTO-04 | Run-while-away | ✓ SATISFIED | See Truth 2 |
| SKILLAUTO-05 | Auto-advance | ✓ SATISFIED | See Truth 2, Truth 6 |
| SKILLAUTO-06 | ≥50% floor + offload | ⚠️ PARTIAL | Floor + offload text present but internally contradictory with the ceiling's harness-warning clause — see Gap 1 |
| SKILLAUTO-07 | Loud completion | ✓ SATISFIED | See Truth 3 |
| SKILLAUTO-08 | 3 process gaps closed | ✓ SATISFIED | See Truth 4 |
| PROC-02 | Part D preservation | ✓ SATISFIED | See Truth 5 |
| PROC-01 | Tests | ✓ SATISFIED | See Behavioral Spot-Checks below |

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers in any of the 11 phase-edited skill files scanned.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| bs skills suite green (SUMMARY claims 317/317) | `npx vitest run src/cli/slash-command/bs` | 4 test files, 317/317 tests passed (templates.test.ts 52, status-tools.test.ts 44, ingest.test.ts 44, build-chunk.test.ts 177) | ✓ PASS |
| Full project suite green (SUMMARY claims 3110/3110) | `npm run test` | 214 test files, 3110/3110 tests passed | ✓ PASS |
| Bookkeeping Sequence ordering (lock release still terminal) | `grep -n "^[0-9]\. \*\*" src/cli/slash-command/bs/build/close.md` | item 4 = "Reconcile the paperwork ledgers", item 5 (last) = "Release the lock" | ✓ PASS |
| Fail-loud sim assertion present, not a fabricated field | `grep -n "EXERCISED\|SimulationResults" src/cli/slash-command/bs/build/test.md` | Confirms instrumentation via action's own `execute()` callback, citing `src/testing/random-simulation.ts`'s real field set | ✓ PASS |

### Human Verification Required

None. All checks in this phase are prose-coherence and static-analysis verifiable; no UI/runtime behavior was introduced (this phase edits agent-instruction markdown only).

### Gaps Summary

Phase 167 substantively achieves 5 of 6 roadmap success criteria with strong evidence — the milestone-gated playtest stop, ask triple-gate/batching/auto-advance, sub-agent offload, loud completion, close-time ledger reconciliation with the terminal lock-release correctly preserved, and the PROC-02 how-not-what statement with all 6 Part D disciplines intact are all real, substantive prose (not doc-only claims), and both the bs-skills suite (317/317) and full project suite (3110/3110) are independently confirmed green by this verification.

However, the coherence pass this verification was specifically asked to run surfaces one real, unresolved contradiction: `state-machine.md`'s "Context floor + ceiling" section (duplicated in `build-chunk.md`) asserts an unconditional ≥50% wind-down floor in one sentence, then names "the moment the harness surfaces a context warning earlier than that" as an independent, sanctioned stop trigger two sentences later — with no ordering given for the case where that genuine signal fires below 50%. This is exactly the kind of "wrong path made hard" failure the project's Pit-of-Success mandate exists to catch: an executing agent following this prose literally has no way to resolve which instruction wins. This is a small, single-sentence fix in two files, not a structural rework, but it is a genuine BLOCKER per this verification's adversarial mandate — it should not silently ride into Phase 168/169 unresolved.

---

_Verified: 2026-07-21_
_Verifier: Claude (gsd-verifier)_
