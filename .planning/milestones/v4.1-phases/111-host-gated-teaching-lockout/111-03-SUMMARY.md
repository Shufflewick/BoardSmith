---
phase: 111
plan: "03"
subsystem: ui/client
tags: [teaching-lockout, client-gating, gameshell, controls-menu, tdd]
dependency_graph:
  requires: [111-01, 111-02]
  provides: [ControlsMenu.teachingDisabled, GameShell.teachingDisabledProp, client-side-lockout]
  affects:
    - src/ui/components/ControlsMenu.vue
    - src/ui/components/ControlsMenu.tutorial-toggle.test.ts
    - src/ui/components/GameShell.vue
    - src/ui/components/GameShell.tutorial.test.ts
tech_stack:
  added: []
  patterns: [broadcast-preferred computed with init fallback, explicit prop contract for lockout, harness-based cross-layer trace tests]
key_files:
  created: []
  modified:
    - src/ui/components/ControlsMenu.vue
    - src/ui/components/ControlsMenu.tutorial-toggle.test.ts
    - src/ui/components/GameShell.vue
    - src/ui/components/GameShell.tutorial.test.ts
decisions:
  - "Approach B chosen for ControlsMenu gating: explicit teachingDisabled? prop (not coerced showHint=undefined) — lockout is visible in component contract, not hidden"
  - "teachingDisabledProp prefers broadcast state.teachingDisabled, falls back to local init ref for first-render before first broadcast (T-111-08 mitigation)"
  - "Exit-tutorial affordance kept accessible when isTutorialRunning per D-06 — Teaching-group wrapper uses (!teachingDisabled || isTutorialRunning) to preserve the exit path"
metrics:
  duration: "7 minutes"
  completed: "2026-06-30"
  tasks_completed: 2
  files_modified: 4
---

# Phase 111 Plan 03: Host-Gated Teaching Lockout — Client Gating Layer Summary

**One-liner:** `teachingDisabled` prop wired from broadcast state (authoritative) with init-postMessage fallback through GameShell into ControlsMenu, gating four teaching affordances while preserving action help and exit-tutorial.

## What Was Built

### Task 1: ControlsMenu teachingDisabled prop gates Teaching + Tutorial groups (commit `4da451f`)

**`teachingDisabled?: boolean` prop** added to ControlsMenu's `defineProps` with `false` as the withDefaults default. Full JSDoc documents the host anti-cheat purpose and the D-06 exclusion (action help never gated).

**Three v-if gates AND-ed with `!teachingDisabled`:**
- **Teaching-group wrapper** (line 285): `v-if="(showHint !== undefined || hasTutorial) && (!teachingDisabled || isTutorialRunning)"` — the wrapper also passes through when `isTutorialRunning` so an already-running tutorial's Exit button remains accessible (D-06/phase context requirement).
- **AI-aids sub-group** (line 290): `v-if="showHint !== undefined && !teachingDisabled"` — explicit gate on Get-a-hint, Watch-AI-demo, Show-move-quality.
- **Tutorial button** (line 333): `v-if="hasTutorial && (!teachingDisabled || isTutorialRunning)"` — hides Start-tutorial when locked; keeps Exit-tutorial accessible if somehow running.

**Action help toggle** (line 207) untouched — it is in the Play group, separate from Teaching (D-06).

**4 new tests in `ControlsMenu.tutorial-toggle.test.ts`** (LOCK-01-A/B/C/D):
- A: teachingDisabled=true hides all four teaching affordances even with showHint=true and hasTutorial=true
- B: teachingDisabled=true + hasActionHelp=true still shows action help toggle (D-06)
- C: teachingDisabled=false leaves Teaching group unchanged
- D: teachingDisabled absent (default false) leaves Teaching group unchanged

### Task 2: GameShell consume init flag + broadcast-preferred computed + wire prop (commit `a8529e1`)

**`const teachingDisabled = ref(false)`** declared near `playerSeat` with a comment explaining its role as the first-render fallback before the first broadcast.

**Init handler** (`data.type === 'init'`): `teachingDisabled.value = data.teachingDisabled === true` added alongside `playerSeat.value = data.seat` — consumes `data.teachingDisabled` from the platform init postMessage (criterion 1 / D-02).

**`teachingDisabledProp` computed** (broadcast-preferred, D-03/criterion 4):
```typescript
const teachingDisabledProp = computed<boolean>(
  () => (state.value?.state as any)?.teachingDisabled ?? teachingDisabled.value
);
```
Reads broadcast `state.teachingDisabled` first (authoritative session value for reconnect + second windows); falls back to the local init ref only when state is not yet available.

**ControlsMenu binding**: `:teaching-disabled="teachingDisabledProp"` added to the single ControlsMenu instance in GameShell (confirmed: only one binding). `showHintProp`, `hasTutorialProp`, and `hasActionHelp` are not modified — teachingDisabled is an independent AND handled inside ControlsMenu.

**6 TD-* tests in `GameShell.tutorial.test.ts`** tracing the broadcast → prop data-flow:
- TD-01: default false
- TD-02: init ref covers first-render (init true before any broadcast)
- TD-03: broadcast true overrides init false (broadcast is authoritative)
- TD-04: broadcast false overrides init true (nullish coalescing passes false through)
- TD-05: broadcast null/absent → init ref fallback
- TD-06: parity documentation — single shared ControlsMenu covers both AutoUI and custom UI

## Verification

```
npm test -- ControlsMenu.tutorial-toggle.test.ts ControlsMenu.action-help.test.ts GameShell.tutorial.test.ts GameShell.action-help.test.ts
# 49 tests, all pass (8+10+8+23)

npm test -- src/ui/
# 722 tests, all pass across 54 test files (Phases 107–110 suites all green)
```

## Deviations from Plan

### Auto-adjusted Issues

**1. [Rule 2 - Missing critical functionality] Exit-tutorial affordance preserved in Teaching-group wrapper**
- **Found during:** Task 1 implementation
- **Issue:** The plan task said to AND `!teachingDisabled` literally into the wrapper v-if at line 285, which would hide the entire Teaching group (including Exit-tutorial button) when `teachingDisabled=true`.  The phase context explicitly states "exit-tutorial affordance: when a tutorial is somehow already running, exiting must remain possible".
- **Fix:** Changed wrapper from `v-if="(showHint !== undefined || hasTutorial) && !teachingDisabled"` to `v-if="(showHint !== undefined || hasTutorial) && (!teachingDisabled || isTutorialRunning)"`. Same change applied to the Tutorial button v-if. All four acceptance-criteria affordances (Get-a-hint, Watch-AI-demo, Show-move-quality, Start-tutorial) are still hidden when `teachingDisabled=true && !isTutorialRunning`. The edge case where `isTutorialRunning=true && teachingDisabled=true` is theoretically impossible (server guards in Plan 111-01 reject `startTutorial` when locked), but the defensive approach matches D-06.
- **Files modified:** `src/ui/components/ControlsMenu.vue`
- **Commits:** `4da451f`

**2. [Rule 1 - Bug] Harness expose pattern: ref/computed unwrapping via getter method**
- **Found during:** Task 2 test writing
- **Issue:** Initial test harness exposed `teachingDisabledProp` as a `ComputedRef` and tests accessed it via `(vm.prop as unknown as { value: boolean }).value`. Vue's component proxy auto-unwraps the computed to the boolean value, making `.value` return `undefined` on the primitive.
- **Fix:** Changed harness to expose `getTeachingDisabled()` method that returns `teachingDisabledProp.value` explicitly. Tests call `vm.getTeachingDisabled()` — no ref-unwrapping ambiguity. Pattern matches existing `GameShell.action-help.test.ts` harness style.
- **Files modified:** `src/ui/components/GameShell.tutorial.test.ts`
- **Commits:** `a8529e1`

## Known Stubs

None — all teaching affordance gating is fully wired to authoritative broadcast state.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. The changes implement the mitigations for:
- **T-111-08** (Tampering — local init ref trusted over broadcast): mitigated by `teachingDisabledProp` preferring `state.teachingDisabled` from broadcast with init ref as fallback only (TD-03/TD-04 prove broadcast wins).
- **T-111-09** (Denial of Service — over-hiding action help): mitigated by the action-help v-if (line 207) being explicitly excluded from the gate (LOCK-01-B proves this).

## Self-Check: PASSED

- `src/ui/components/ControlsMenu.vue` — modified (contains `teachingDisabled` in prop + 3 v-ifs)
- `src/ui/components/ControlsMenu.tutorial-toggle.test.ts` — modified (4 new LOCK-01-* tests)
- `src/ui/components/GameShell.vue` — modified (contains `teachingDisabled` ref, `teachingDisabledProp` computed, init handler consumption, ControlsMenu binding)
- `src/ui/components/GameShell.tutorial.test.ts` — modified (6 new TD-* tests)
- Commits: `4da451f` (Task 1), `a8529e1` (Task 2) — both confirmed in git log
