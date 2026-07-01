---
phase: 119-dev-host-devtools-bridge
plan: "03"
subsystem: ui/cli
tags: [devtools, postMessage, bridge, global, dev-only, tdd]
dependency_graph:
  requires: [119-02]
  provides: [window.__BOARDSMITH_DEVTOOLS, boardsmith:devtools-state-update bridge]
  affects: [src/ui/components/GameShell.vue, src/cli/dev-host/DevHost.vue, src/ui/global.d.ts]
tech_stack:
  added: []
  patterns: [postMessage iframe→outer, reactive ref snapshot, dev-only guard, extracted helper for testability]
key_files:
  created:
    - src/ui/components/GameShell.devtools.ts
    - src/ui/components/GameShell.devtools.test.ts
  modified:
    - src/ui/global.d.ts
    - src/ui/components/GameShell.vue
    - src/cli/dev-host/DevHost.vue
decisions:
  - "Extracted buildDevtoolsPayload + maybePostDevtoolsUpdate into GameShell.devtools.ts helper for unit-testability without mounting full GameShell component"
  - "Fixed boardInteraction field access: fields are directly on BoardInteraction (BoardInteractionState & BoardInteractionActions), not on a .state sub-property"
  - "Added /// <reference types='vite/client' /> to DevHost.vue to resolve import.meta.env type without altering shared tsconfig"
metrics:
  duration: "~7 minutes"
  completed: "2026-07-01"
  tasks_completed: 2
  files_changed: 5
---

# Phase 119 Plan 03: DEV-02 iframe→outer postMessage Bridge Summary

**One-liner:** Dev-only postMessage bridge exposes `window.__BOARDSMITH_DEVTOOLS` on the `boardsmith dev` host with synchronous read methods for game state, available actions, and board-interaction state.

## What Was Built

### GameShell.devtools.ts (new helper)
- `buildDevtoolsPayload(params)`: pure function building the `DevtoolsStateMessage` — maps `validElements` to id-only `number[]`, excluding disabled entries
- `maybePostDevtoolsUpdate(guard, params, postMessage?)`: guard wrapper that calls `window.parent.postMessage` only when both `isDevBuild` and `platformMode` are true; postMessage param is injectable for tests

### global.d.ts (additive)
- `BoardsmithDevtools` interface with four synchronous read methods: `getState`, `getAvailableActions`, `getActionMetadata`, `getBoardInteractionState`
- `Window.__BOARDSMITH_DEVTOOLS?: BoardsmithDevtools` augmentation

### GameShell.vue (watcher added)
- `if (isDevBuild)` block registering a `watch` over `[availableActions, actionMetadata, playerSeat, boardInteraction.currentAction, boardInteraction.currentPickIndex, boardInteraction.validElements.length, state]`
- On change, calls `maybePostDevtoolsUpdate` with the current reactive state
- `state.value?.state` used as-is (Phase 117 perspective-aware broadcast, no re-filtering)
- Entire `watch` registration dead-code-eliminated by Vite in production (`if (isDevBuild)`)

### DevHost.vue (receiver + global)
- `devtoolsSnapshot = ref<Record<string, unknown> | null>(null)` at top of script setup
- Case in `onWindowMessage` (inside `data.source !== 'shufflewick-game'` guard): caches `boardsmith:devtools-state-update` messages
- `window.__BOARDSMITH_DEVTOOLS` assigned in `onMounted` inside `if (import.meta.env.DEV)`, with four read methods closing over `devtoolsSnapshot`

### GameShell.devtools.test.ts (8 tests)
- Test 1: `maybePostDevtoolsUpdate` calls postMessage with correct `source` + `type` when dev+platform
- Test 2: `buildDevtoolsPayload` includes all required payload keys; `validElements` is a number array
- Test 3: `buildDevtoolsPayload` filters out disabled entries from `validElements`
- Test 4: handles empty `validElements` array
- Test 5–7: `maybePostDevtoolsUpdate` guard — no call when `isDevBuild=false`, `platformMode=false`, or both

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed boardInteraction field access path**
- **Found during:** Task 1 implementation / vue-tsc check
- **Issue:** Research code examples used `boardInteraction.state.currentAction` etc., but `BoardInteraction = BoardInteractionState & BoardInteractionActions` — fields are directly on the object, no `.state` sub-property. Introduced TS2339 errors on lines 708-724.
- **Fix:** Changed to `boardInteraction.currentAction`, `boardInteraction.currentPickIndex`, `boardInteraction.validElements` throughout the watcher
- **Files modified:** `src/ui/components/GameShell.vue`
- **Commit:** 9b2dfa1

**2. [Rule 1 - Bug] Added vite/client reference to DevHost.vue**
- **Found during:** Task 2 / vue-tsc check
- **Issue:** `import.meta.env.DEV` in DevHost.vue caused new TS2339 error since DevHost.vue had no vite type reference. GameShell.vue had the same pre-existing error at line 175, but introducing a new occurrence in a previously-clean file was unacceptable.
- **Fix:** Added `/// <reference types="vite/client" />` at top of `<script setup>` in DevHost.vue
- **Files modified:** `src/cli/dev-host/DevHost.vue`
- **Commit:** 18ab3ad

## TDD Gate Compliance

| Gate | Commit | Message |
|------|--------|---------|
| RED (test) | 8a05209 | `test(119-03): add failing tests for GameShell devtools bridge helper` |
| GREEN (impl) | 9b2dfa1 | `feat(119-03): add GameShell devtools bridge sender + BoardsmithDevtools type` |

Both gates present. REFACTOR gate not needed — code was clean after GREEN.

## Threat Surface Scan

Threat model from plan fully mitigated:
- **T-119-04** (production leak): `window.__BOARDSMITH_DEVTOOLS` assignment gated by `if (import.meta.env.DEV)` in DevHost.vue + entire watcher in GameShell.vue gated by `if (isDevBuild)`. Dead-code-eliminated in production.
- **T-119-05** (malicious postMessage): New receiver case sits inside the `data.source !== 'shufflewick-game'` early-return guard.
- **T-119-06** (perspective leak): Not introduced — `state.value?.state` is the already-filtered perspective-aware broadcast.

No new threat surface beyond the plan's threat register.

## Self-Check

Checking files exist and commits are present...

---

## Self-Check: PASSED

Files created/modified:
- FOUND: src/ui/components/GameShell.devtools.ts
- FOUND: src/ui/components/GameShell.devtools.test.ts
- FOUND: src/ui/global.d.ts (modified)
- FOUND: src/ui/components/GameShell.vue (modified)
- FOUND: src/cli/dev-host/DevHost.vue (modified)

Commits:
- 8a05209: test(119-03) RED gate
- 9b2dfa1: feat(119-03) GameShell sender + types
- 18ab3ad: feat(119-03) DevHost receiver + global
