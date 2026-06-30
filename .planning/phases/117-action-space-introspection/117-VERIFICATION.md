---
phase: 117-action-space-introspection
verified: 2026-06-30T17:17:30Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 117: Action-Space Introspection — Verification Report

**Phase Goal:** Ship the keystone introspection primitive + per-action schema + validated arg-building + full legal-move enumeration + perspective-aware view + expose checkpoint/rewind (INTRO-F1).
**Verified:** 2026-06-30T17:17:30Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | INTRO-01: `game.getActionSpace(seat)` returns legal actions with selections/dependsOn/arg-templates in one serializable structure | ✓ VERIFIED | `src/engine/element/game.ts:1011` — `getActionSpace(seat: number): ActionSpaceView`; D-01 argTemplate sentinel values (`null`=optional, `{__required:true}`=required); `ActionSpaceView`/`ActionSchemaView`/`ArgTemplate` exported from engine barrel |
| 2 | INTRO-02: `game.getActionSchema(name, seat)` returns schema even for condition-false actions | ✓ VERIFIED | `src/engine/element/game.ts:1057` — calls `buildPickMetadata` directly, intentionally bypasses `buildActionMetadata` (which evaluates conditions); CR-01 fix is present; `ActionMetadata` exported from session barrel at `src/session/index.ts:80` |
| 3 | INTRO-03: `buildActionArgs` builds validated wire-correct args from plain values, in-process default + wire opt-in | ✓ VERIFIED | `src/engine/utils/arg-builder.ts` — validates action name, all supplied keys, AND required selections (WR-01 fix at lines 84-93); `seat` validated (WR-02 fix — `_seat` renamed + guard at lines 53-59); wire format via `serializeValue`; exported from engine barrel |
| 4 | INTRO-04: `enumerateLegalMoves` enumerates all concrete legal moves, reusing bot logic; 3 in-vitest MCTS tests green | ✓ VERIFIED | `src/engine/utils/enumerate-moves.ts` — delegates to `enumerateSelectionsCore` (shared with MCTSBot); bot calls `enumerateSelectionsCore` then wraps with `serializeArgs` + `sampleChoices`; 14/14 MCTS tests pass |
| 5 | INTRO-05: perspective-aware view with hidden info excluded; `createPlayerView`/`getPlayerView` exposed; `[BLOCKING]` leak regression test proves `getActionSpace` does not leak hidden elements | ✓ VERIFIED | `createPlayerView` exported from engine barrel at `src/engine/index.ts:217`; `[BLOCKING]` test at `src/engine/element/image-leak.test.ts:587` — 11/11 tests pass including the blocking assertion |
| 6 | INTRO-F1: `ElementDiff` + `ActionMetadata` exported from session barrel; 5 `GameSession` checkpoint/rewind methods public | ✓ VERIFIED | `src/session/index.ts:117` (`type ElementDiff`), `:80` (`ActionMetadata`); `GameSession` public methods: `getStateAtAction` (897), `getStateDiff` (905), `getActionTraces` (917), `undoToTurnStart` (1712), `rewindToAction` (1726) |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/engine/element/game.ts` | `getActionSpace` + `getActionSchema` methods | ✓ VERIFIED | Lines 1011 and 1057; `ActionSpaceView`/`ActionSchemaView`/`ArgTemplate` defined at lines 30-55 |
| `src/engine/element/action-metadata.ts` | `buildActionMetadata` + `buildPickMetadata` in engine layer (no runtime session cycle) | ✓ VERIFIED | File exists; `import type` from session at line 18; condition errors re-thrown (WR-04 fix at lines 54-59) |
| `src/engine/utils/enumerate-moves.ts` | `enumerateLegalMoves` + `enumerateSelectionsCore` | ✓ VERIFIED | File exists; dynamic multiSelect handled with `devWarn` + skip-or-block (WR-03 fix at lines 190-206) |
| `src/engine/utils/arg-builder.ts` | `buildActionArgs` with required-selection validation | ✓ VERIFIED | File exists; validation of required selections at lines 84-93; seat validated at 53-59 |
| `src/engine/element/image-leak.test.ts` | `[BLOCKING]` INTRO-05 hidden-info leak test | ✓ VERIFIED | Test describe block at line 532; `[BLOCKING]` test at line 587 — passes |
| `src/session/index.ts` | `ElementDiff` + `ActionMetadata` exports | ✓ VERIFIED | `type ElementDiff` at line 117; `ActionMetadata` at line 80 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `game.ts:getActionSchema` | skip condition check | calls `buildPickMetadata` directly | ✓ WIRED | CR-01 fix: does NOT call `buildActionMetadata`; `buildPickMetadata` called per selection at line 1066 |
| `game.ts:getActionSpace` | `buildActionMetadata` | `action-metadata.ts` | ✓ WIRED | Line 1018; no parallel evaluateCondition call |
| `mcts-bot.ts` | `enumerateSelectionsCore` | `enumerate-moves.ts` | ✓ WIRED | Bot delegates to shared core; WR-05 fix: both `element` and `elements` use `.id` (public getter) at lines 958-963 |
| `arg-builder.ts` | `serializeValue` | `serializer.ts` | ✓ WIRED | Wire format delegates at line 106 |
| `action-metadata.ts` | session types | `import type` only | ✓ NO CYCLE | `grep "from '.*session"` → only `import type` at line 18; no runtime cycle |
| `session/index.ts` | `ElementDiff` | re-exported from `game-session.js` block | ✓ WIRED | Line 117 in session barrel |

---

### REVIEW.md Findings — All Fixed

| Finding | Severity | Fix Status | Evidence |
|---------|----------|------------|----------|
| CR-01: `getActionSchema` returned `undefined` for condition-false actions | Critical | ✓ FIXED | `game.ts:1057` uses `buildPickMetadata` directly, not `buildActionMetadata` |
| WR-01: `buildActionArgs` silently ignored required selections | Warning | ✓ FIXED | `arg-builder.ts:84-93` — required selection loop with actionable error |
| WR-02: `_seat` parameter silently discarded | Warning | ✓ FIXED | Renamed to `seat`; validated at lines 53-59 |
| WR-03: Function-based `multiSelect` silently produced 2^N combos | Warning | ✓ FIXED | `enumerate-moves.ts:194-206` — `devWarn` + optional-skip/required-block |
| WR-04: Condition errors swallowed in `buildActionMetadata` | Warning | ✓ FIXED | `action-metadata.ts:54-59` — error re-thrown with actionable message |
| WR-05: `serializeChoice` used `._t.id` for `element` type | Warning | ✓ FIXED | `mcts-bot.ts:958-963` — both types use `.id` (public getter) |
| IN-01: `console.warn`/`console.error` on hot path | Info | N/A — info only | `devWarn` (deduplicated by key) used at line 195; acceptable |
| IN-02: Player guard runs after `availableActionsForSeat` | Info | N/A — info only | Cosmetic ordering issue; no behavioral impact |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 3 in-vitest MCTS regression tests | `npx vitest run src/ai/mcts-stats.test.ts src/ai/mcts-restore.test.ts src/ai/mcts-clone-options.test.ts` | 14/14 pass | ✓ PASS |
| Hidden-info leak regression ([BLOCKING]) | `npx vitest run src/engine/element/image-leak.test.ts` | 11/11 pass | ✓ PASS |
| Full suite | `npx vitest run` | 1745/1745 pass | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|------------|--------|----------|
| INTRO-01 | 117-04 | ✓ SATISFIED | `getActionSpace` at `game.ts:1011`; `get-action-space.test.ts` covers cross-seat scoping, D-01 argTemplate, JSON round-trip |
| INTRO-02 | 117-01, 117-04 | ✓ SATISFIED | `getActionSchema` at `game.ts:1057`; condition-skip confirmed by implementation; `ActionMetadata` in session barrel |
| INTRO-03 | 117-03 | ✓ SATISFIED | `buildActionArgs` in `arg-builder.ts`; 12 tests in `arg-builder.test.ts` |
| INTRO-04 | 117-02 | ✓ SATISFIED | `enumerateLegalMoves` in `enumerate-moves.ts`; `enumerateLegalMoves.test.ts` 6 tests; bot delegation confirmed |
| INTRO-05 | 117-04 | ✓ SATISFIED | `createPlayerView` exported from engine; `[BLOCKING]` leak test at `image-leak.test.ts:587` green |
| INTRO-F1 | 117-01, 117-04 | ✓ SATISFIED | `ElementDiff` at session barrel line 117; `ActionMetadata` at line 80; 5 public GameSession methods confirmed |

---

### Anti-Patterns Found

No blockers. No TBD/FIXME/XXX markers found in modified files. `devWarn` (deduplicated by key) is used appropriately in hot paths instead of bare `console.warn`.

---

### Human Verification Required

None — all Phase 117 behavior is automatable via vitest. The validation strategy document (`117-VALIDATION.md`) listed no manual-only verifications.

---

## Gaps Summary

No gaps. All 6 success criteria are verified in code with passing tests. All 6 REVIEW.md findings (1 critical + 5 warnings) were fixed before this verification ran. Full suite green at 1745 tests.

---

_Verified: 2026-06-30T17:17:30Z_
_Verifier: Claude (gsd-verifier)_
