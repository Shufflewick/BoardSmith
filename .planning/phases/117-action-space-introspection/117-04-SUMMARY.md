---
phase: 117-action-space-introspection
plan: "04"
subsystem: engine/session
tags: [introspection, action-space, circular-dep, security, hidden-info]
dependency_graph:
  requires: ["117-01", "117-03"]
  provides: ["getActionSpace", "getActionSchema", "ActionSpaceView", "ActionSchemaView", "ArgTemplate"]
  affects: ["src/engine/element/game.ts", "src/session/utils.ts", "src/engine/element/action-metadata.ts"]
tech_stack:
  added: []
  patterns:
    - "Engine-internal action metadata builder (no engine<->session runtime cycle)"
    - "D-01 argTemplate sentinel values (null=optional, {__required:true}=required)"
    - "Static metadata path never populates validElements (on-demand only)"
key_files:
  created:
    - src/engine/element/action-metadata.ts
    - src/engine/element/get-action-space.test.ts
  modified:
    - src/session/utils.ts
    - src/engine/element/game.ts
    - src/engine/element/index.ts
    - src/engine/index.ts
    - src/engine/element/image-leak.test.ts
decisions:
  - "Relocated buildActionMetadata+buildPickMetadata to engine to break the circular dependency"
  - "getActionSchema delegates to buildActionMetadata([actionName]) — does not check conditions"
  - "ArgTemplate uses null for optional, {__required:true} for required (D-01 as designed)"
  - "INTRO-05 sanctioned path documented in leak test: createPlayerView/runner.getPlayerView only"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-30T22:00:00Z"
  tasks_completed: 4
  files_changed: 7
---

# Phase 117 Plan 04: getActionSpace + getActionSchema + Hidden-Info Leak Guard Summary

**One-liner:** Engine-internal `getActionSpace(seat): ActionSpaceView` + `getActionSchema(name, seat): ActionMetadata | undefined` with D-01 argTemplate and [BLOCKING] hidden-element leak regression proof, cycle-free via engine-layer relocation.

## Tasks Completed

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| Task 0 | Relocate `buildActionMetadata`+`buildPickMetadata` into `src/engine/element/action-metadata.ts` | e10f2da | Done |
| Task 1 | Write RED integration test `get-action-space.test.ts` (9 tests, all failing) | 424b06f | Done |
| Task 2 | Implement `getActionSpace`/`getActionSchema` + export view types (9 tests GREEN) | f53da20 | Done |
| Task 3 | `[BLOCKING]` Hidden-info leak regression in `image-leak.test.ts` (GREEN) | 88e2a98 | Done |

## What Was Built

### Task 0: Engine module for action metadata (cycle-break)

Created `src/engine/element/action-metadata.ts` with the verbatim bodies of `buildActionMetadata` and `buildPickMetadata`. The types `ActionMetadata`/`PickMetadata` are imported via `import type` from session (erased at compile time — no runtime cycle). `src/session/utils.ts` now re-exports both functions from the engine module; all existing session consumers are unchanged.

**Verified:** `grep -n "from '../../session" src/engine/element/action-metadata.ts` → every match is `import type` (no runtime session import). `npx vitest run src/session/` — 29 files, 314 tests, all green.

### Task 1: RED integration test

`src/engine/element/get-action-space.test.ts` covers:
- Cross-seat scoping (seat 2 has no actions in a sequential step)
- D-01 argTemplate: `null` for optional selections, `{ __required: true }` for required
- Empty argTemplate `{}` for zero-selection actions
- ActionSchemaView shape (name, selections, optional flag)
- JSON round-trip stability of ActionSpaceView

All 9 tests confirmed RED before Task 2 implementation.

### Task 2: Implementation

Added to `src/engine/element/game.ts`:
- `ActionSpaceView`, `ActionSchemaView`, `ArgTemplate` interface/type definitions
- `getActionSpace(seat)`: locked order (availableActionsForSeat → getPlayer → buildActionMetadata → enrich with argTemplate)
- `getActionSchema(actionName, seat)`: delegates to `buildActionMetadata(this, player, [actionName])` — no condition filtering, mirrors `buildSingleActionMetadata` semantics

**Cycle-free verification:** `grep -n "from '.*session" src/engine/element/game.ts` → only `import type` from `../../session/types.js` (erased, no runtime cycle).

**No parallel validator:** `grep -n "evaluateCondition" src/engine/element/game.ts` → only in a comment, not called directly.

Exported `ActionSpaceView`/`ActionSchemaView`/`ArgTemplate` from `src/engine/element/index.ts` and `src/engine/index.ts` alongside `PlayerStateView`.

### Task 3: [BLOCKING] Hidden-info leak regression

Extended `src/engine/element/image-leak.test.ts` with:
1. `[BLOCKING]` test: hidden card IDs from seat 1's `contentsVisibleToOwner()` hand must NOT appear in seat 2's `getActionSpace` `validElements`
2. Companion test: static metadata path confirms `validElements` is `undefined` (choices on-demand only — no eager element population)

Both tests GREEN. The describe block includes a doc comment pointing to `createPlayerView(game, playerPosition)` and `runner.getPlayerView(playerPosition)` as the ONLY sanctioned perspective-aware path per INTRO-05.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All returned data is from real game state (no placeholder values).

## Threat Flags

None — the new surface was designed to be safe from the start (static metadata only, no element IDs in the template).

## Test Results

| Suite | Files | Tests | Status |
|-------|-------|-------|--------|
| `src/engine/` | 24 | 547 | All green |
| `src/session/` | 29 | 314 | All green |
| `src/ai/` | 3 | 14 | All green |

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `src/engine/element/action-metadata.ts` | FOUND |
| `src/engine/element/get-action-space.test.ts` | FOUND |
| Commit e10f2da (refactor — Task 0) | FOUND |
| Commit 424b06f (test RED — Task 1) | FOUND |
| Commit f53da20 (feat impl — Task 2) | FOUND |
| Commit 88e2a98 (test BLOCKING — Task 3) | FOUND |
| 547 engine tests green | PASSED |
| 314 session tests green | PASSED |
