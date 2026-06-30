---
phase: 116-verification-api-design
plan: "02"
subsystem: planning
tags: [api-design, devtools, pit-of-success, speculative-scope]
dependency_graph:
  requires: [116-01]
  provides: [DSGN-02-complete, DSGN-03-complete]
  affects: [117-intro, 119-dev, 120-pit]
tech_stack:
  added: []
  patterns: [documentation-only, no-src-changes]
key_files:
  created: []
  modified:
    - .planning/v4.3-API-DESIGN.md
decisions:
  - "DEV-01: align AutoUI to emit data-bs-el-id (anchorAttrs single source of truth); keep data-element-id as alias for FLIP"
  - "DEV-02: BoardsmithDevtools interface via iframe postMessage bridge; getState/getAvailableActions/getActionMetadata/getBoardInteractionState"
  - "DEV-03: boardsmith:action-resolved CustomEvent dispatched in useActionController at actionCompletedTick increment sites"
  - "PIT-01: loop() maxIterations omission is a construction-time throw (devWarn path removed entirely — breaking change)"
  - "PIT-03: bidirectional check — actionStep references unregistered action = throw; registered action unreachable from flow = devWarn"
  - "INTRO-F1: promoted to IN-scope (trivial expose-not-build); flagged for user sign-off at approval gate"
metrics:
  duration: "~20m"
  completed: "2026-06-30"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
---

# Phase 116 Plan 02: DEV/PIT API Spec and Speculative Scope Disposition Summary

Completed the v4.3 API design document: authored the DEV (dev-host devtools bridge) and PIT (authoring pit-of-success guards) API spec sections under Part 2, then replaced the informal Part 3 speculative-scope prose with a proper disposition table covering all six Future Requirements.

## What Was Built

### Task 1 — Part 2 DEV and PIT API Spec

Added `### DEV — Dev-Host Devtools Bridge` and `### PIT — Authoring Pit-of-Success Guards` subsections to `.planning/v4.3-API-DESIGN.md` under Part 2.

Each of the eight surface entries (DEV-01..04, PIT-01..04) specifies: exact name, full TypeScript signature or shape, event/message payload format, serialization, owning module, and expose-vs-build disposition.

Key design decisions locked:

**DEV-01:** Standardize on `data-bs-el-id` in AutoUI. Four AutoUI renderers (PieceRenderer, SpaceRenderer, DieRenderer, CardRenderer) gain `:data-bs-el-id="element.id"` alongside the existing `:data-element-id="element.id"`. The existing `data-element-id` is kept as an alias (FLIP animations at `useFLIP.ts:138` depend on it). `anchorAttrs()` at `useBoardInteraction.ts:408` remains the declared single source of truth.

**DEV-02:** `window.__BOARDSMITH_DEVTOOLS` interface specified (`getState`, `getAvailableActions`, `getActionMetadata`, `getBoardInteractionState`). Architecture: GameShell (sender) watches reactive state and posts `boardsmith:devtools-state-update` messages to `window.parent`; DevHost.vue (receiver) caches the snapshot and exposes the synchronous global. Dev-only guard: `__BOARDSMITH_DEV__` build-time flag.

**DEV-03:** `boardsmith:action-resolved` CustomEvent dispatched at the two `actionCompletedTick` increment sites in `useActionController.ts` (lines 1074 and 1505). Detail shape: `{ action, success, seat, error? }`. Listenable via `iframe.contentWindow.addEventListener(...)`.

**DEV-04:** Documented the full DISCOVER → SELECT → DRIVE → CONFIRM agent loop as a Phase 119 acceptance gate. No source to implement now; proof required in custom-UI and AutoUI games.

**PIT-01:** `loop()` without `maxIterations` throws at construction time — the entire `devWarn` path is replaced. Breaking change; no backward compat (per hard rule). Runtime iteration cap stays as secondary safety net.

**PIT-02:** `startFlow()` validates element classes encountered in the first traversal against `classRegistry`. Throws with actionable message naming the unregistered class. Known limitation: post-construction dynamic queries out of scope.

**PIT-03:** `startFlow()` traverses `actionStep` nodes and cross-checks each referenced action name against `game.getAction()`. Unregistered action = throw. Registered but unreachable action = `devWarn`.

**PIT-04:** Two new ESLint rules: `boardsmith/no-element-identity-comparison` (catches `===`/`!==`/`includes` on `GameElement` instances; auto-fixable) and `boardsmith/no-element-array-state` (catches `GameElement[]` class fields outside the element tree; not auto-fixable). Both registered in `src/eslint-plugin/index.ts`.

### Task 2 — Part 3 Speculative Scope Disposition

Replaced the informal PROMOTED/DEFERRED prose with a single `| Future Requirement | Status | Rationale |` table covering all six Future Requirements:

| Requirement | Disposition | Key rationale |
|-------------|-------------|---------------|
| INTRO-F1 (checkpoint/rewind) | **IN — PROMOTED** | Five methods already public on `GameSession`; only `UndoResult`/`ElementDiff` type exports missing |
| INTRO-F2 (AgentRunner) | DEFERRED | Non-trivial design; v4.3 primitives sufficient |
| TEST-F1 (leak assertion) | DEFERRED | Additive; existing image-leak test covers known path |
| DEV-F1 (seat-switch) | DEFERRED | Not needed for basic agent loop |
| DEV-F2 (deterministic AI seed) | DEFERRED | Needs MCTS seeding changes; separate milestone |
| PIT-F1 (boardRef/dependsOn inference) | DEFERRED | Requires AST-level analysis; separate milestone |

Added an Approval gate note: INTRO-F1's promotion is specifically flagged for user sign-off. No Phase 117 begins until the user confirms the doc (plan 116-03).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. This plan produces documentation only; no production code was written.

## Threat Flags

None. Documentation-only phase; no new network endpoints, auth paths, or schema changes.

## Self-Check

### Created files exist:
- `116-02-SUMMARY.md` — this file

### Commits exist:
- `498692c` — docs(116-02): author Part 2 DEV and PIT API spec sections
- `85bf406` — docs(116-02): author Part 3 speculative scope disposition table

### `git diff --stat src/`: empty (no production code modified)

## Self-Check: PASSED
