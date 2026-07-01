---
phase: 119-dev-host-devtools-bridge
plan: "02"
subsystem: ui
tags: [devtools, instrumentation, customEvent, useActionController, testing]
dependency_graph:
  requires: []
  provides: [DEV-03-custom-event]
  affects: [src/ui/composables/useActionController.ts, src/ui/global.d.ts]
tech_stack:
  added: []
  patterns: [CustomEvent dispatch gated by import.meta.env.DEV, capture-before-null pattern]
key_files:
  created:
    - src/ui/composables/useActionController.devtools.test.ts
  modified:
    - src/ui/composables/useActionController.ts
    - src/ui/global.d.ts
decisions:
  - Use typeof window !== 'undefined' guard alongside isDevBuild so existing node-environment tests are unaffected
  - Use addEventListener in tests (// @vitest-environment jsdom) rather than vi.spyOn(window.dispatchEvent) — the node env has no window
metrics:
  duration: "3m 8s"
  completed: "2026-07-01"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 2
---

# Phase 119 Plan 02: boardsmith:action-resolved CustomEvent Summary

One-liner: `boardsmith:action-resolved` CustomEvent dispatched at all three action-resolution paths (execute no-metadata, execute with-metadata, selection-step completion), dev-gated by `import.meta.env.DEV`, with capture-before-null for the selection-step path.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Dispatch boardsmith:action-resolved at all resolution paths (dev-gated) + type + tests | 8ca5813 | useActionController.ts, global.d.ts, useActionController.devtools.test.ts |

## What Was Built

### `src/ui/global.d.ts`
Added `BoardsmithActionResolvedDetail` interface:
```typescript
interface BoardsmithActionResolvedDetail {
  action: string;
  success: boolean;
  seat: number;
  error?: string;
}
```

### `src/ui/composables/useActionController.ts`
Three changes:

1. **`isDevBuild` constant** added near the top of the composable function (mirrors GameShell.vue:174 pattern):
   ```typescript
   const isDevBuild = import.meta.env.DEV;
   ```

2. **execute() dispatch** — added after `sendAction()` resolves on BOTH execute paths (no-metadata ~line 1005 and metadata ~line 1069), plus each corresponding `catch` block. Guard: `if (isDevBuild && typeof window !== 'undefined')`. Detail shape: `{ action: actionName, success: result.success, seat: playerSeat?.value ?? 0, ...(success ? {} : { error }) }`.

3. **Selection-step dispatch** — in `handleOnSelectFill()` inside `if (result.actionComplete)`, added `const completedActionName = currentAction.value` BEFORE `currentAction.value = null`, then dispatch alongside `actionCompletedTick.value++` with `{ action: completedActionName ?? '', success: true, seat: player }`.

### `src/ui/composables/useActionController.devtools.test.ts`
New test file (jsdom environment, 4 tests):
- Test 1: execute() success path (metadata branch) fires event with `success:true` and no `error` key
- Test 2: execute() failure path (no-metadata branch) fires event with `success:false` and `error`
- Test 3: selection-step completion fires with pre-clear action name (non-empty, proves capture-before-null)
- Test 4: `import.meta.env.DEV` is `true` under vitest — confirms dev-gate is active in tests

## Verification Results

```
✓ src/ui/composables/useActionController.devtools.test.ts (4 tests)
✓ src/ui/composables/useActionController.test.ts (93 tests)
✓ src/ui/composables/useActionController.picks.test.ts (33 tests)
All 12 test files in src/ui/composables/ → 254 tests passed
```

No `__BOARDSMITH_DEV__` references added (grep returns empty).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added `typeof window !== 'undefined'` guard**
- **Found during:** Task 1 implementation
- **Issue:** The vitest config uses `environment: 'node'` (not jsdom) for existing tests. Adding `window.dispatchEvent(...)` without a `typeof window !== 'undefined'` guard would have thrown a `ReferenceError` in existing tests that run in node environment.
- **Fix:** Added `typeof window !== 'undefined'` alongside the `isDevBuild` check. This is safe because: in a browser (game iframe), `window` always exists; in jsdom tests (the new devtools test), `window` exists; in node tests, the guard short-circuits cleanly.
- **Files modified:** `src/ui/composables/useActionController.ts`
- **Commit:** 8ca5813

**2. [Rule 2 - Missing Critical Functionality] Used `// @vitest-environment jsdom` in test file**
- **Found during:** Task 1 RED phase
- **Issue:** `vi.spyOn(window, 'dispatchEvent')` failed (window undefined in node env). The established project pattern for tests requiring `window` is `// @vitest-environment jsdom` (confirmed in `anchorAttrs.test.ts`, `useSelectable.test.ts`, etc.).
- **Fix:** Added `// @vitest-environment jsdom` docblock and switched from `vi.spyOn(window.dispatchEvent)` to `window.addEventListener('boardsmith:action-resolved', ...)` for event capture — more idiomatic and closer to production usage.
- **Files modified:** `src/ui/composables/useActionController.devtools.test.ts`
- **Commit:** 8ca5813

## Known Stubs

None — all dispatch paths are fully wired with real event emission.

## Threat Flags

No new threat surface beyond what was identified in the plan's threat model. The `boardsmith:action-resolved` event is dispatched only when `import.meta.env.DEV && typeof window !== 'undefined'`, ensuring dead-code elimination in production Vite builds.

## Self-Check: PASSED

- `src/ui/composables/useActionController.devtools.test.ts` — FOUND
- `src/ui/global.d.ts` contains `BoardsmithActionResolvedDetail` — FOUND
- `src/ui/composables/useActionController.ts` contains `boardsmith:action-resolved` — FOUND
- Commit 8ca5813 — FOUND (`git log --oneline -1`)
