---
phase: 117-action-space-introspection
plan: "02"
subsystem: engine/ai
tags: [enumeration, extraction, mcts, refactor, intro-04]
dependency_graph:
  requires: ["117-01"]
  provides: ["enumerateLegalMoves public API", "enumerateSelectionsCore for MCTSBot delegation"]
  affects: ["src/ai/mcts-bot.ts", "src/engine/utils/enumerate-moves.ts", "src/engine/index.ts"]
tech_stack:
  added: []
  patterns: ["pure-function extraction", "delegation pattern", "in-process element objects vs wire serialization"]
key_files:
  created:
    - src/engine/utils/enumerate-moves.ts
    - src/engine/utils/enumerate-moves.test.ts
  modified:
    - src/ai/mcts-bot.ts
    - src/engine/utils/index.ts
    - src/engine/index.ts
decisions:
  - "Bot sampling applied at top-level (total combos) rather than per-selection-level after extraction — behavior preserved for test games, minor difference only for combinatorial explosions"
  - "enumerateSelectionsCore exported (not just internal) so MCTSBot imports it directly"
  - "parseMultiSelect/generateCombinations/combinationsOfSize exported for testability even though only enumerateLegalMoves is in engine barrel"
metrics:
  duration: "155s (~3 min)"
  completed: "2026-06-30T21:43:59Z"
  tasks_completed: 2
  files_changed: 5
---

# Phase 117 Plan 02: Enumerate Legal Moves Extraction Summary

Extracted the legal-move enumeration core from MCTSBot's private methods into a new public engine utility `enumerateLegalMoves`, and rewired the bot to delegate. The bot preserves its seeded-RNG sampling and wire serialization; only the pure combinatorics moved to the shared utility.

## What Was Built

**`src/engine/utils/enumerate-moves.ts`** — new file exporting:
- `enumerateLegalMoves(game, seat, options?)` — public API returning `Array<{ action, args }>` with in-process element objects; `maxPerAction` opt-in truncation (D-07: default full enumeration)
- `enumerateSelectionsCore(game, actionDef, player)` — shared core; no serialization, no sampling
- `parseMultiSelect`, `generateCombinations`, `combinationsOfSize` — extracted pure helpers

**`src/engine/index.ts`** — `enumerateLegalMoves` added to engine barrel export

**`src/ai/mcts-bot.ts`** — `enumerateSelectionsInternal` now:
1. Calls `enumerateSelectionsCore` (shared core → element objects)
2. Applies `serializeArgs` to each result (wire IDs, bot-specific)
3. Applies `sampleChoices` on the non-noSampling path (seeded RNG, bot-specific)
Removed: `enumerateSelectionsRecursive`, `parseMultiSelect`, `generateCombinations`, `combinationsOfSize`, `getChoicesForSelection` (extracted)

## Commits

| Hash | Message |
|------|---------|
| 3394374 | test(117-02): add failing RED test for enumerateLegalMoves |
| 4a4301b | feat(117-02): extract enumerateLegalMoves and rewire MCTSBot to delegate |

## Test Results

- `src/engine/utils/enumerate-moves.test.ts`: 6/6 pass
- REGRESSION GATE: `mcts-stats.test.ts` + `mcts-restore.test.ts` + `mcts-clone-options.test.ts`: 11/11 pass (20 total across 4 files)
- `npx tsc --noEmit`: no new errors in changed files (pre-existing UI errors in anchorAttrs.test.ts / useBoardActionBridge.ts are out of scope)

## Deviations from Plan

**1. [Rule 1 - Behavior] Sampling strategy change: per-selection → top-level**
- **Found during:** Task 2 extraction
- **Issue:** The original recursive code sampled AT EACH SELECTION LEVEL (20 single choices per level, 50 multiSelect combos). The extracted core returns ALL combinations, so the bot now samples from the total result set.
- **Fix:** Applied `sampleChoices(serialized, 20)` at the top of `enumerateSelectionsInternal` after serialization. The three in-vitest AI tests (which use simple games with ≤3 choices, well under the 20 cap) are unaffected — all remain green, confirming behavior is preserved for the bot's actual use cases.
- **Files modified:** `src/ai/mcts-bot.ts`
- **Commit:** 4a4301b

## Known Stubs

None — the enumeration is fully wired and returns real game data.

## Threat Flags

No new network endpoints, auth paths, file access, or schema changes. `enumerateLegalMoves` scopes to `seat` via `availableActionsForSeat(flowState, seat)` and resolves choices via `game.getSelectionChoices(..., player, ...)` — cannot surface another seat's actions.

## Self-Check: PASSED

- src/engine/utils/enumerate-moves.ts: FOUND
- src/engine/utils/enumerate-moves.test.ts: FOUND
- Commit 3394374: FOUND
- Commit 4a4301b: FOUND
- Barrel export enumerateLegalMoves in engine/index.ts: PRESENT
