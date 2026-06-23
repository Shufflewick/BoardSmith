---
phase: 102-material-dev-debug-wave-5
plan: "04"
subsystem: ui
tags: [dev-debug, game-history, debug-panel, bugfix, tdd]
dependency_graph:
  requires: ["102-01"]
  provides: ["DEV-06"]
  affects: ["GameHistory.vue", "DebugPanel.vue", "GameShell.vue"]
tech_stack:
  added: []
  patterns: ["defineExpose", "lastProcessedSourceIndex watcher guard", "cross-sibling ref mediation"]
key_files:
  created:
    - src/ui/components/GameHistory.test.ts
  modified:
    - src/ui/components/GameHistory.vue
    - src/ui/components/DebugPanel.vue
    - src/ui/components/GameShell.vue
decisions:
  - "lastProcessedSourceIndex guards against re-adding cleared messages; never resets on clear"
  - "messageCounter stays monotonic after clear (ids remain unique)"
  - "GameShell mediates Copy/Clear with a single historyPanel ref on both mutually-exclusive GameHistory instances"
  - "DebugPanel emits copy-history/clear-history; GameShell drives the ref — no message state duplication"
metrics:
  duration: "15 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
  files_created: 1
---

# Phase 102 Plan 04: GameHistory Read-Only + Un-Clear Fix + DebugPanel Copy/Clear Summary

Read-only GameHistory with lastProcessedSourceIndex-based watcher fix; Copy/Clear relocated to DebugPanel Controls tab via GameShell mediator ref.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | GameHistory read-only + un-clear fix + expose methods | e1d9c72 | GameHistory.vue, GameHistory.test.ts |
| 2 | Move Copy/Clear into DebugPanel Controls tab via GameShell | 5b8307d | DebugPanel.vue, GameShell.vue |

## What Was Built

**Task 1 — GameHistory.vue refactor (DEV-06)**

- Introduced `let lastProcessedSourceIndex = 0` to track the source array index already processed. The watcher now iterates from `lastProcessedSourceIndex` to `newMessages.length` and updates the index after processing. Previously it started from `processedMessages.value.length`, which reset to 0 after `clearHistory()` and caused all pre-clear messages to re-appear on the next state update (the silent un-clear bug).
- `clearHistory()` no longer resets `messageCounter` (ids stay unique) and never touches `lastProcessedSourceIndex`.
- Removed the sidebar `header-buttons` block (Copy/Clear buttons) and its dead CSS — GameHistory is now a read-only player surface.
- Added `const hasMessages = computed(() => processedMessages.value.length > 0)` and `defineExpose({ clearHistory, copyHistory, hasMessages })` so the parent (GameShell, on behalf of DebugPanel) can drive the controls.

**Task 2 — DebugPanel.vue + GameShell.vue wiring**

- Added `'copy-history': []` and `'clear-history': []` to `DebugPanel.defineEmits`.
- Added a "Game history" control group inside the Controls tab with Copy and Clear buttons (using existing `debug-btn small` / `debug-btn small danger` styling — no new hex, lint:css green).
- Added `const historyPanel = ref<InstanceType<typeof GameHistory> | null>(null)` in GameShell.
- Added `ref="historyPanel"` to both GameHistory instances (sidebar + sheet) — they are mutually exclusive by breakpoint so the ref always resolves to the mounted one.
- Wired `@copy-history="() => historyPanel?.copyHistory()"` and `@clear-history="() => historyPanel?.clearHistory()"` on the DebugPanel element.

## Decisions Made

- **lastProcessedSourceIndex over `processedMessages.length`**: The latter resets to 0 on clear, enabling the re-add bug. The former tracks the source index independently of the display buffer.
- **messageCounter stays monotonic**: Resetting the counter would produce duplicate IDs if old messages shared an ID with newly-added ones. Keeping it monotonic avoids this.
- **Single historyPanel ref on both conditional instances**: Because `v-if="showHistory && !sidebarRail"` and `v-if="showHistory && sidebarRail"` are mutually exclusive, assigning `ref="historyPanel"` to both is safe — only one instance mounts at a time.
- **DebugPanel emits rather than calling methods directly**: Keeps DebugPanel decoupled from GameShell internals; GameShell is the natural mediator for two sibling subtrees.

## Verification

- `npx vitest run src/ui/components/GameHistory.test.ts` — 3/3 passed (un-clear, read-only, copy).
- `npx vitest run src/ui/components/GameShell.ia.test.ts` — 36/36 passed (no regressions).
- `npm run lint:css` — exits 0.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes introduced.

## Self-Check: PASSED

- `src/ui/components/GameHistory.test.ts` exists: FOUND
- `src/ui/components/GameHistory.vue` contains `lastProcessedSourceIndex`: FOUND
- `src/ui/components/GameHistory.vue` has no `header-buttons`: CONFIRMED ABSENT
- `src/ui/components/GameHistory.vue` has `defineExpose`: FOUND
- `src/ui/components/DebugPanel.vue` has `copy-history` and `clear-history`: FOUND
- `src/ui/components/GameShell.vue` has `historyPanel` ref + wired handlers: FOUND
- Commits e1d9c72 and 5b8307d: CONFIRMED
