---
phase: 113-go-fish-ai-teaching
reviewed: 2026-06-30T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - /Users/jtsmith/BoardSmithGames/go-fish/src/rules/ai.ts
  - /Users/jtsmith/BoardSmithGames/go-fish/src/rules/index.ts
  - /Users/jtsmith/BoardSmithGames/go-fish/src/ui/components/GameTable.vue
  - /Users/jtsmith/BoardSmithGames/go-fish/tests/hint-target.test.ts
  - /Users/jtsmith/BoardSmithGames/go-fish/tests/demo.test.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 113: Code Review Report

**Reviewed:** 2026-06-30
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed all five phase-113 files. The primary deliverable — `getGoFishHintTarget` returning `{ name: rank }` for ask moves and `undefined` otherwise, wired into `gameDefinition.ai.hintTargetFromMove` alongside the existing `objectives` — is correct, minimal, and type-safe. The `anchorAttrs({ name: rank })` binding on the rank-group div in GameTable.vue is additive and does not clobber the per-card `anchorAttrs({ id, name: rank+suit })` binding. The demo test is honest: narration precedes execution, narrated args equal executed args, `aiSuggest` is stubbed without stubbing `'action'`, and timer-count assertions are enforced after both natural termination and `demoStop`. No critical issues found.

Two warnings require cleanup before shipping.

## Warnings

### WR-01: Four AI hooks are exported from ai.ts but dead — not re-exported from index.ts and not wired into gameDefinition

**File:** `/Users/jtsmith/BoardSmithGames/go-fish/src/rules/ai.ts:256,312,406,490`

**Issue:** `getGoFishThreatResponseMoves`, `getGoFishPlayoutPolicy`, `getGoFishMoveOrdering`, and `getGoFishUctConstant` are all marked `export` inside ai.ts, but index.ts re-exports only `getGoFishObjectives` and `getGoFishHintTarget` (line 6). None of the four functions appear in `gameDefinition.ai`. A search of all go-fish `src/` confirms they are never referenced. The MCTS bot therefore runs with no threat response, no playout policy, no move ordering, and no custom UCT constant despite substantial implementation code existing for all four. Per the project hard rule "No Backward Compatibility — remove the bad thing and add the good thing," dead code should be removed rather than left to accumulate.

**Fix:** Either wire the hooks into `gameDefinition.ai` (if they are intended to improve bot quality) or delete the functions. If the intent is to wire them:

```typescript
// index.ts — extend the ai config block
import {
  getGoFishObjectives,
  getGoFishHintTarget,
  getGoFishThreatResponseMoves,
  getGoFishPlayoutPolicy,
  getGoFishMoveOrdering,
  getGoFishUctConstant,
} from './ai.js';

ai: {
  objectives: getGoFishObjectives,
  hintTargetFromMove: getGoFishHintTarget,
  threatResponse: getGoFishThreatResponseMoves,
  playoutPolicy: getGoFishPlayoutPolicy,
  moveOrdering: getGoFishMoveOrdering,
  uctConstant: getGoFishUctConstant,
},
```

If they are genuinely not needed, delete `getGoFishThreatResponseMoves`, `getGoFishPlayoutPolicy`, `getGoFishMoveOrdering`, and `getGoFishUctConstant` from ai.ts entirely.

---

### WR-02: `gap: -20px` is invalid CSS — silently ignored by all browsers

**File:** `/Users/jtsmith/BoardSmithGames/go-fish/src/ui/components/GameTable.vue:781`

**Issue:** The `gap` property (flexbox/grid) does not accept negative values per the CSS specification. `gap: -20px` is invalid and is silently discarded by every conformant browser, leaving the computed gap at `normal` (0). The intended card-overlap effect is actually achieved by `.card-group .card { margin-right: -30px; }` (line 804), so the visual result is correct — but the invalid declaration is dead CSS that misleads maintainers about how the overlap works.

**Fix:** Remove the invalid declaration:

```css
.card-group {
  display: flex;
  /* gap: -20px;  ← remove; overlap is handled by margin-right: -30px on .card-group .card */
  position: relative;
  transition: all 0.2s ease;
  border-radius: 8px;
  padding: 4px;
  margin: -4px;
}
```

---

## Info

### IN-01: Test name "returns undefined for a non-ask action" is misleading — function gates on rank presence, not action type

**File:** `/Users/jtsmith/BoardSmithGames/go-fish/tests/hint-target.test.ts:29`

**Issue:** `getGoFishHintTarget` contains no check on `move.action`. The test passes because the fixture `{ action: 'someOtherAction', args: {} }` has no `rank` arg — the function returns `undefined` due to missing rank, not due to the action name. The test name implies action-type gating that does not exist. If a future non-ask action ever includes a `rank` arg (unlikely but possible), the function would return a hint target for it with no test catching the regression.

**Fix:** Rename the test to describe what actually determines the return value:

```typescript
it('returns undefined when rank is absent from args (regardless of action)', () => {
  const move = { action: 'someOtherAction', args: {} };
  expect(getGoFishHintTarget(move)).toBeUndefined();
});
```

---

_Reviewed: 2026-06-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Resolution (2026-06-30)

- **WR-02 (invalid `gap: -20px`)** — FIXED: removed the dead declaration from `.card-group` in GameTable.vue (overlap is provided by `.card { margin-right: -30px }`). go-fish 63/63 green.
- **IN-01 (misleading test name)** — FIXED: renamed to "returns undefined when args carry no rank (gating is on the rank arg, not the action name)" to reflect that `getGoFishHintTarget` gates on the rank arg, not `move.action`.
- **WR-01 (four unwired MCTS bot hooks: getGoFishThreatResponseMoves / getGoFishPlayoutPolicy / getGoFishMoveOrdering / getGoFishUctConstant)** — NOTED, not changed here. This is a PRE-EXISTING go-fish issue (the bot runs with only `objectives`; these hooks were authored but never wired into `gameDefinition.ai`). It affects the bot's *playing strength*, not the GFAI-01/02 teaching features this phase delivers. Wiring them changes AI behavior (and needs bot re-validation), and deleting substantial AI work is a deliberate call — neither belongs in a teaching phase as a side effect. Surfaced to the user / flagged for the milestone audit as a candidate go-fish AI cleanup task.
