---
phase: 100-ia-responsive-wave-3
plan: "04"
subsystem: ui
tags: [gameshell, controls-menu, platform-mode, heartbeat, ia-01, slate, tdd]
dependency_graph:
  requires:
    - 100-01 (GameShell Slate keystone — .stage + .side-head placeholder)
  provides:
    - ControlsMenu.vue: ⋯ popover with Auto end turn, Undo, zoom magnifier, New game, Leave game
    - GameHeader gated by !platformMode (dev/standalone keeps it)
    - postMessage heartbeat receiver + connectionHealth corner dot (platform mode)
    - showUndo removal — undo follows canUndo unconditionally
  affects:
    - src/ui/components/GameShell.vue (Phase 103 regression surface — heartbeat + dot)
    - src/ui/components/GameHeader.vue (showUndo removed, connection-status path changes)
    - src/ui/components/auto-ui/ActionPanel.vue (showUndo prop removed)
tech_stack:
  added: []
  patterns:
    - ControlsMenu: click/Escape/outside-click popover (Phase 101 adds focus-trap)
    - postMessage heartbeat handler with shape validation (T-100-04-01/02 mitigated)
    - setTimeout/clearTimeout staleness timer for connectionHealth
key_files:
  created:
    - src/ui/components/ControlsMenu.vue
  modified:
    - src/ui/components/GameShell.vue
    - src/ui/components/GameHeader.vue
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/GameShell.ia.test.ts
decisions:
  - "ControlsMenu owns its .menubtn styles; dead .menubtn CSS removed from GameShell scoped block"
  - "Corner dot positioned inside .boardregion (absolute) so it cannot cover the actionbar (T-100-04-SC)"
  - "Heartbeat handler shape-validates source+type before acting; origin already guarded by isOriginAllowed"
  - "HeartbeatHarness TDD pattern: mirrors GameShell IA-01 additions; tested in isolation without full GameShell mount"
  - "showUndo deleted unconditionally; no compat shim per No Backward Compatibility rule"
metrics:
  duration_minutes: 25
  completed: "2026-06-23T03:34:00Z"
  tasks_completed: 3
  files_changed: 5
---

# Phase 100 Plan 04: Controls Menu, Header Gate, and Heartbeat Dot Summary

IA-01 delivered: no standing `<GameHeader>` in platform mode; a `⋯` `ControlsMenu` popover in the sidebar `.side-head` holds all relocated controls while preserving the `handleMenuItemClick` bridge; connection status is driven by a validated postMessage heartbeat and shown as a corner dot; the `showUndo` toggle is deleted across all three components.

## What Was Built

### Task 1 — ControlsMenu + GameHeader Gate

Created `src/ui/components/ControlsMenu.vue`:

- `.menubtn` trigger (`aria-haspopup="menu"`, `:aria-expanded`) opens/closes a `role="menu"` popover
- Five menu items per the mockup: Auto end turn (`menuitemcheckbox` + toggle pill), Undo last action (disabled when `!canUndo`), Fit board zoom magnifier (`<input type="range">`), New game, Leave game
- Props: `autoEndTurn: boolean`, `zoom: number`, `canUndo: boolean`
- Emits: `update:autoEndTurn`, `update:zoom`, `undo`, `menu-item-click`
- Close on Escape, outside-click (`document.addEventListener`), and after action items
- Focus-trap deferred to Phase 101
- All styles self-contained (`var(--bsg-*)` tokens only); `margin-left: auto` pushes component to right end of `.side-head`

Updated `GameShell.vue`:
- Added `ControlsMenu` import
- `<GameHeader>` gated: `v-if="!platformMode"` — dev/standalone keeps the header; platform mode skips it
- Removed `v-model:show-undo` from `<GameHeader>` (Task 3 prep)
- Replaced static `.menubtn` placeholder button with `<ControlsMenu v-model:auto-end-turn="autoEndTurn" v-model:zoom="zoomLevel" :can-undo="canUndo && !isViewingHistory" @undo="handleUndo" @menu-item-click="handleMenuItemClick" />`
- Dead `.menubtn` CSS block removed from GameShell scoped styles

Bridge preserved: `@menu-item-click="handleMenuItemClick"` routes Leave/New Game through the existing `handleMenuItemClick(id)` function, which calls `leaveGame()` locally and preserves the host postMessage contract.

Commit: `ced5b1a`

### Task 2 — Heartbeat Receiver + Corner Dot (TDD)

**RED** (`721bbc8`): Added Suite 3 to `GameShell.ia.test.ts` — `HeartbeatHarness` with empty template and no-op `handleHeartbeat`. 4 of 10 new tests fail as expected.

**GREEN** (`70ee782`):

Added to `GameShell.vue`:
- `connectionHealth = ref<'connecting'|'connected'|'stale'>('connecting')` + `heartbeatTimer`
- In `platformMessageHandler`: when `data.type === 'heartbeat'`, validate shape (`source === 'shufflewick' && type === 'heartbeat'`), then set `connectionHealth = 'connected'` and rearm a 10-second staleness timer. Malformed payloads (wrong source, wrong type, null, non-object) are ignored without touching `connectionHealth`.
- `clearTimeout(heartbeatTimer)` in `onUnmounted`
- `<span v-if="platformMode" class="conn-dot" :class="connectionHealth" />` inside `.boardregion` (absolute-positioned corner; `pointer-events: none`; cannot cover actionbar — T-100-04-SC)
- `.conn-dot` CSS: `connected → --bsg-ok`, `stale → --bsg-warn`, `connecting → --bsg-away`

`HeartbeatHarness` GREEN template filled in; all 22 tests pass.

### Task 3 — Delete showUndo Toggle

Removed across all three components (no backward-compat shim):

| File | Change |
|------|--------|
| `GameShell.vue` | Removed `showUndo = ref(true)` and `:show-undo="showUndo"` binding |
| `GameHeader.vue` | Removed `showUndo` prop, `update:showUndo` emit, and showUndo `<label>` toggle |
| `ActionPanel.vue` | Removed `showUndo` prop; changed undo button `v-if` from `canUndo && showUndo !== false` to `canUndo` |

`grep -rn "showUndo\|show-undo" src/ui/` returns nothing.

Commit: `f90f290`

## Test Results

```
src/ui/components/GameShell.ia.test.ts  22 tests passing (was 12; +10 for IA-01)
src/ui/components/GameShell.theme.test.ts  10 tests passing
Full suite: 1041 tests passing (77 test files)
npm run lint:css: exit 0
```

## Deviations from Plan

None — plan executed exactly as written.

## Phase 103 Regression Surface

- `GameShell.vue` now emits `connectionHealth` state on every heartbeat message; host-side validation test needed during cross-repo verification
- `<GameHeader>` is absent in platform mode; any test or smoke-test that mounted GameShell in platform mode and expected the header will need updating
- `ControlsMenu.vue` is a new component — no existing cross-repo references

## Known Stubs

- `.sw-btn` (Shufflewick host button) remains a visual-only placeholder with no click handler. Phase 100-05 or HOST-03 will wire it.
- The ControlsMenu Appearance and Debug panel items are absent (Phase 102 deferred).

## Threat Flags

None — no new network endpoints or auth paths beyond the validated heartbeat handler already accounted for in the plan's threat model.

## Self-Check: PASSED

Files created:
- `src/ui/components/ControlsMenu.vue` — FOUND

Files modified:
- `src/ui/components/GameShell.vue` — FOUND
- `src/ui/components/GameHeader.vue` — FOUND
- `src/ui/components/auto-ui/ActionPanel.vue` — FOUND
- `src/ui/components/GameShell.ia.test.ts` — FOUND

Commits:
- `ced5b1a` — feat: ControlsMenu + header gate (Task 1)
- `721bbc8` — test: RED heartbeat harness (Task 2 RED)
- `70ee782` — feat: heartbeat receiver + conn-dot (Task 2 GREEN)
- `f90f290` — feat: remove showUndo (Task 3)
