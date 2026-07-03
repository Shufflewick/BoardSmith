---
phase: 132-engine-element-builder-safety
verified: 2026-07-03T01:10:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
---

# Phase 132: Engine Element/Builder Safety Verification Report

**Phase Goal:** Element-tree mutation and action-builder APIs fail loudly on misuse instead of silently corrupting state or shipping a no-op.
**Verified:** 2026-07-03T01:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PROC-01: all four findings (F3/F12/F13/F28) have a recorded LEGITIMATE/REJECTED verdict written before any fix | ✓ VERIFIED | `132-FINDINGS-VERIFICATION.md` contains 4 `VERDICT: LEGITIMATE` sections, each with file:line evidence, predating fix commits (plan 02-05 depend_on 01) |
| 2 | ENG-01: `outer.putInto(inner)` where `inner` is a descendant of `outer` (or self) throws an actionable, dual-named error in ALL modes; legal moves unchanged | ✓ VERIFIED | `src/engine/element/piece.ts:81-104` — unconditional `destination === this` check + ancestor walk, both BEFORE the `isDevMode()` WR-03 block; throw names both elements. Tests: `game-element.test.ts:320` `describe('ENG-01 self/descendant containment')` — 68 tests green |
| 3 | ENG-05: `resolveArgs` second pass no longer coerces bare numbers into GameElements; only `{id, className}` resolves; first pass unchanged | ✓ VERIFIED | `src/engine/action/action.ts:239-263` — bare-number branch removed, second pass gates on `isSerializedElement` (id+className), plus post-review className-match validation (WR-03 fix, commit `98680790`). First pass (161-237) untouched. Tests: `action.test.ts:613` `describe('ENG-05 followUp arg resolution')` — 126 tests green |
| 4 | ENG-06: `forEach` over a mutated collection still visits every original item; snapshot-on-first-entry mirrors `executeEachPlayer`; GameElements stored as id, primitives as-is; non-primitive fails loud | ✓ VERIFIED | `src/engine/flow/engine.ts:1162-1229` `executeForEach` — snapshots via `frame.data?.forEachItems === undefined` guard, `{elementId}` / `{value}` tagged items, re-resolves via `getElementById`, throws on unsupported item type and on stale/deleted element id. Tests: `engine.test.ts` `ForEach Execution` describe incl. mutating-body case, restore-path test, deleted-element throw test, non-primitive throw test (added in WR-05 fix, commit `82f8a0c8`) — 86 tests green |
| 5 | ENG-08: an action chain ending in `.build()` without `.execute()` is flagged handler-less; `registerAction()` throws at registration time (not `startFlow()` time), naming the action and pointing to `.execute(fn)`; handler-ful actions unaffected | ✓ VERIFIED | `src/engine/action/types.ts:468` `handlerless?: boolean` field; `action-builder.ts:77-80` constructor seeds `handlerless: true`, `.execute()` (line 635) `delete`s the flag; `game.ts:919-925` `registerAction()` throws before `_actions.set` when `action.handlerless` is true, message names action + `.execute(`. `registerActions()` (954-958) funnels through `registerAction`, no bypass. Tests: `game.test.ts:348` `describe('ENG-08 handler-less registration')` — 12 tests green |
| 6 | PROC-02: every legitimate finding's fix has a regression test that fails on pre-fix code (red-first) | ✓ VERIFIED | Each plan (02-05) Task 1 is `tdd="true"` RED task with recorded RED output captured in the SUMMARY files (confirmed present for ENG-01/05/06/08 describe blocks; all now GREEN in current suite) |
| 7 | Fix-loop regression check: 5 post-hoc code-review Warnings (WR-01..WR-05) fixed without regressing any must_have | ✓ VERIFIED | Commits `c428ed93`, `ad487c80`, `98680790`, `7bd366f2`, `82f8a0c8` — doc rewrites (WR-01/02), className validation added to ENG-05 second pass (WR-03), `forEach<T>` generic constrained to `GameElement \| string \| number \| boolean \| null` (WR-04), 3 new restore/throw-path tests added for ENG-06 (WR-05). `132-REVIEW.md` frontmatter: `status: issues_resolved`, `warning: 0` (all 5 resolved) |
| 8 | Full regression suite stays green after all fixes and the review fix-loop | ✓ VERIFIED | `npm test` — 168/168 test files, 2148/2148 tests passed |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.planning/phases/132-engine-element-builder-safety/132-FINDINGS-VERIFICATION.md` | Per-finding verification verdicts | ✓ VERIFIED | 4 `VERDICT:` lines, F3/F12/F13/F28 all LEGITIMATE with file:line evidence |
| `src/engine/element/piece.ts` | `moveToInternal` self/descendant containment throw | ✓ VERIFIED | Lines 81-104; runs in all modes; WR-03 dev-only block intact below it |
| `src/engine/element/game-element.test.ts` | Red-first ENG-01 regression tests | ✓ VERIFIED | `describe('ENG-01 self/descendant containment')` at line 320 |
| `src/engine/action/action.ts` | `resolveArgs` second pass narrowed to `isSerializedElement` | ✓ VERIFIED | Lines 239-263; bare-number branch removed; className validated (WR-03 review fix) |
| `src/engine/action/action.test.ts` | Red-first ENG-05 regression tests | ✓ VERIFIED | `describe('ENG-05 followUp arg resolution')` at line 613, includes className-mismatch Test D |
| `src/engine/flow/engine.ts` | `executeForEach` snapshot-on-first-entry with id-based re-resolution | ✓ VERIFIED | Lines 1162-1229; `frame.data.forEachItems` JSON-plain snapshot |
| `src/engine/flow/engine.test.ts` | Red-first ENG-06 regression test + restore/throw-path coverage | ✓ VERIFIED | `ForEach Execution` describe (line 384) incl. mutating-body, restore, deleted-element, non-primitive cases |
| `src/engine/action/types.ts` | Handler-less marker on `ActionDefinition` | ✓ VERIFIED | Line 468 `handlerless?: boolean` |
| `src/engine/element/game.ts` | `registerAction` handler-less throw | ✓ VERIFIED | Lines 919-925 |
| `src/engine/element/game.test.ts` | Red-first ENG-08 regression test | ✓ VERIFIED | `describe('ENG-08 handler-less registration')` at line 348 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `piece.ts moveToInternal` | `destination._t.parent` ancestor chain | O(depth) walk vs `this` | ✓ WIRED | Confirmed lines 96-104; runs before mutation at line 130+ |
| `action.ts resolveArgs` second pass | `isSerializedElement` | shape gate on non-selection args | ✓ WIRED | Line 253 `if (this.isSerializedElement(value))`; `looksLikeSerializedElement` remains only in first pass (grep confirms) |
| `flow/engine.ts executeForEach` | `frame.data` snapshot list | evaluate once, re-resolve by id/value per iteration | ✓ WIRED | Guard at line 1174, re-resolution at 1210-1222 |
| `action-builder.ts build()` | `game.ts registerAction` | handler-less flag on `ActionDefinition` | ✓ WIRED | `handlerless: true` set in constructor, cleared in `.execute()`, checked in `registerAction()`; `registerActions()` funnels through it (no bypass) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| PROC-01 | 132-01 | Every finding has a recorded verdict before fix | ✓ SATISFIED | `132-FINDINGS-VERIFICATION.md`, all 4 LEGITIMATE |
| ENG-01 | 132-02 | putInto self/descendant throws | ✓ SATISFIED | `piece.ts:81-104` |
| PROC-02 | 132-02..05 | Regression test fails pre-fix | ✓ SATISFIED | Red-first TDD tasks per SUMMARY |
| ENG-05 | 132-03 | resolveArgs no bare-number coercion | ✓ SATISFIED | `action.ts:239-263` |
| ENG-06 | 132-04 | forEach snapshot semantics | ✓ SATISFIED | `engine.ts:1162-1229` |
| ENG-08 | 132-05 | handler-less action rejected at registration | ✓ SATISFIED | `game.ts:919-925`, `action-builder.ts:77-80,635` |

No orphaned requirements found — REQUIREMENTS.md maps exactly ENG-01, ENG-05, ENG-06, ENG-08 to Phase 132, all four appear in plan frontmatter and are satisfied. PROC-01/PROC-02 are process requirements verified via plan 01 and the red-first task structure in plans 02-05.

### Anti-Patterns Found

None. Scanned all 15 files touched across the phase (plans 01-05 + review fix-loop commits) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` — zero matches.

### Post-Execution Code Review Fix-Loop Regression Check

`132-REVIEW.md` recorded 5 Warnings (WR-01..WR-05) and 3 Info items (deferred, non-blocking) after standard-depth review of all 13 phase-touched files. All 5 Warnings were fixed same-day in dedicated commits:

- `c428ed93` — WR-01: stale doc paragraph in `common-pitfalls.md` §10 replaced
- `ad487c80` — WR-02: `common-pitfalls.md` §15 rewritten for ENG-05 contract
- `98680790` — WR-03: `action.ts` second pass now validates `className` match before resolving (verified present in current source, mirrors `relinkFlowVariables`)
- `7bd366f2` — WR-04: `forEach<T>`/`ForEachConfig<T>` generic constrained to match ENG-06 runtime contract
- `82f8a0c8` — WR-05: 3 new tests added for forEach checkpoint-restore, deleted-element throw, non-primitive throw paths

Re-verified: none of these fixes touched or weakened the ENG-01/05/06/08 must-haves — WR-03 and WR-04 are additive stricter checks that layer on top of the original implementations without changing their pass/fail behavior for the phase's original test cases. Full suite (168 files / 2148 tests) green post-fix-loop.

3 Info items (IN-01 cycle-guard on ancestor walk, IN-02 stale runner.ts comment, IN-03 replay-path error message wording) were left open by design (non-blocking, review depth "standard"); they do not affect any must-have and are not phase-blocking.

### Human Verification Required

None. All must-haves are verifiable via static code inspection and automated test execution; no UI/visual/real-time behavior is in scope for this engine-internals phase.

### Gaps Summary

None. All 8 observable truths verified, all artifacts exist/substantive/wired, all key links wired, full regression suite green, requirement coverage complete, no orphaned requirements, no anti-patterns, and the post-execution review fix-loop resolved all 5 warnings without regression.

---

_Verified: 2026-07-03T01:10:00Z_
_Verifier: Claude (gsd-verifier)_
