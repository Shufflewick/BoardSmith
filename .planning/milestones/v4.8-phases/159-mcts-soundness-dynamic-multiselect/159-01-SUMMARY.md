---
requirements-completed: [AI-01, PROC-01]
---

# Plan 159-01 Summary — Shared resolveMultiSelect helper closes the enumeration half of AI-01

**Plan:** 159-01 (execute — dynamic `multiSelect` resolution in MCTS enumeration)
**Completed:** 2026-07-20
**Result:** PASS — one shared `resolveMultiSelect(selection, ctx)` in
`src/engine/utils/resolve-multiselect.ts`, wired into `enumerate-moves.ts`'s `_enumerateRecursive`;
PROC-01's RED-before-GREEN and adversarial fail-loud gates both satisfied.

## What was done

1. **Task 1 (RED):** Added `src/ai/mcts-multiselect.test.ts` (4 in-file `Game` subclasses per
   `mcts-restore.test.ts` — `ConcretePairGame` (`multiSelect: () => ({min:2,max:2})`),
   `VariableRangeGame` (`() => ({min:1,max:3})`), `UndefinedResolutionGame` (`() => undefined`),
   `ThrowingResolutionGame` (`() => { throw new Error('cannot resolve here') }`)) and extended
   `src/engine/utils/enumerate-moves.test.ts` with a matching `enumerateLegalMoves`-level case. Ran
   both files against CURRENT, unfixed source and captured the real failure verbatim (see below). No
   production source touched in this commit.
2. **Task 2 (GREEN):** Added `src/engine/utils/resolve-multiselect.ts` exporting
   `resolveMultiSelect(selection, ctx)` and rewired `enumerate-moves.ts`'s `_enumerateRecursive` to
   call it instead of the old `typeof multiSelect === 'function'` devWarn+skip block (which never
   invoked the function at all — that was the actual root cause). Removed the unused `devWarn`
   import. All 13 tests pass.
3. **Task 3 (adversarial + full suite):** The adversarial fail-loud/leak-free-message assertion and
   the variable-range (`{min:1,max:3}`) union-of-combos assertion were already written into Task 1's
   test file (both proven RED there and GREEN after Task 2 — see verbatim RED output below, cases
   4/5/6). No further test or production changes were needed for Task 3; ran `npm test` to confirm no
   collateral regression. **No separate commit** — Task 3's coverage lives in the Task 1/Task 2
   commits; this section documents that its gates were exercised and are green.

## resolveMultiSelect signature (for Plan 02 to consume unchanged)

```ts
// src/engine/utils/resolve-multiselect.ts
import type { ActionContext, Selection } from '../index.js';

export function resolveMultiSelect(
  selection: Selection,
  ctx: ActionContext,          // { game, player, args } — same ctx as function-valued choices
): { min: number; max: number } | undefined;
```

- Concrete `{min,max}` (static value, or function resolving to one) → returned, normalized through
  the existing `parseMultiSelect`.
- `undefined` (no `multiSelect`, or the function legitimately returns `undefined`) → `undefined`,
  NOT an error — caller falls through to single-select.
- Function **throws** → propagates unchanged (no try/catch around the call) — fail loud, never a
  silent skip.

Plan 02's `buildPickMetadata` (`action-metadata.ts:148-158` choice, `:202-212` elements) can call
this with the identical ctx shape it already builds for function-valued choices.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 ❯ src/engine/utils/enumerate-moves.test.ts (7 tests | 1 failed)
   × enumerateLegalMoves: function-valued multiSelect > routes a function multiSelect resolving to
     a concrete config into generateCombinations (C(3,2) = 3 combos)
     → expected [] to have a length of 3 but got +0

stderr | mcts-multiselect.test.ts
[BoardSmith] enumerateLegalMoves: selection "items" on action "pick" uses a function-based
multiSelect which cannot be statically enumerated. This selection will be skipped during
enumeration. Consider using a static multiSelect config, or handle this action via the
/selection-choices endpoint.

 ❯ src/ai/mcts-multiselect.test.ts (6 tests | 6 failed)
   × concrete-config -> enumerateLegalMoves: expected [] to have a length of 3 but got +0
   × concrete-config -> MCTSBot.play(): Error: No available moves
   × undefined-resolution -> single-select: expected [] to have a length of 3 but got +0
   × throwing function -> fails loud: expected throw 'cannot resolve here' but got
     'No available moves' (swallowed by the unconditional skip, not the real thrown message —
     the function was never even invoked)
   × throwing function -> leak-free message: expected 'No available moves' to contain
     'cannot resolve here'
   × variable-range {min:1,max:3} -> union of combos: expected [] to have a length of 7 but got +0

 Test Files  2 failed (2)
      Tests  7 failed | 6 passed (13)
```
The pre-fix skip triggers on the mere `typeof multiSelect === 'function'` check — it never calls the
function at all, so even the throwing-function case surfaces as the generic "No available moves"
rather than the real error. This is the PROC-01-required "silently skipped, not a mechanical error"
failure mode.

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
 ✓ src/engine/utils/enumerate-moves.test.ts (7 tests) 7ms
 ✓ src/ai/mcts-multiselect.test.ts (6 tests) 12ms

 Test Files  2 passed (2)
      Tests  13 passed (13)
```

## Adversarial verification (Task 3)

- Throwing function multiSelect: `bot.play()` rejects with the real message `'cannot resolve here'`
  (not the generic `'No available moves'`), proving the throw propagates instead of being swallowed.
- Leak-free message: asserted the surfaced error contains no `/` path segment, no `:line:col`
  reference, and no `at ...(` stack frame.
- Variable-range: `{min:1,max:3}` over 3 elements resolves the full union `C(3,1)+C(3,2)+C(3,3) = 7`
  combinations via `enumerateLegalMoves`, and `bot.play()` returns a move whose `items` array size is
  in `[1,3]` — proving it is NOT falling back to single-select.

## Verification

- `npx vitest run src/ai/mcts-multiselect.test.ts src/engine/utils/enumerate-moves.test.ts` — 13/13
  pass.
- `npm test` — **196 files / 2824 tests pass**, above the pre-phase baseline (195/2817). The delta is
  exactly this plan's net-new coverage (+1 file, +7 tests: 6 in `mcts-multiselect.test.ts` + 1 in
  `enumerate-moves.test.ts`); nothing regressed.
- `npx tsc --noEmit` — no new type errors in the touched files.
- Grep gate: `grep -v '^\s*\*' src/engine/utils/enumerate-moves.ts | grep -c 'resolveMultiSelect'` →
  2 (≥1 required).
- Grep gate: `grep -c 'cannot be statically enumerated' src/engine/utils/enumerate-moves.ts` → 0.
- Grep gate: `grep -c 'devWarn' src/engine/utils/enumerate-moves.ts` → 0.

## Deviations from Plan

None — plan executed exactly as written. Task 3's adversarial and variable-range assertions were
folded into Task 1's initial RED test file (since they're part of the same net-new test suite and
needed to be proven RED alongside the rest); Task 2's fix made all of them GREEN simultaneously, so
Task 3 required no additional code changes — only the full-suite confirmation described above.

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigation specified in its own threat model (T-159-01/T-159-02/
T-159-03); no new, unlisted security-relevant surface was introduced. `buildPickMetadata`,
`mcts-bot.ts`, and `snapshot.ts` (Plan 02/03's territory) were not touched.

## Self-Check: PASSED

- `src/engine/utils/resolve-multiselect.ts` — FOUND
- `src/engine/utils/enumerate-moves.ts` (rewired) — FOUND
- `src/ai/mcts-multiselect.test.ts` — FOUND
- `src/engine/utils/enumerate-moves.test.ts` (extended) — FOUND
- Commit `4a9ff646` (RED) — FOUND in `git log`
- Commit `4c29476c` (GREEN) — FOUND in `git log`
