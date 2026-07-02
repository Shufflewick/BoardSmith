---
phase: 128-animation-drag-drop-test-story
plan: 02
subsystem: ui
tags: [vue3, vitest, jsdom, drag-drop, dev-warnings, anchor-attributes]

requires:
  - phase: 128-animation-drag-drop-test-story (plan 01)
    provides: animation test-mode + trace recorder infra (independent — no shared code path with this plan)
provides:
  - anchorAttrs() dev-only, once-per-type devWarn when a selectable/renderable element produces no data-bs-el-* anchor attributes
  - Direct unit tests for useDragDrop at both the BoardInteraction API level and the raw drag-event-handler level
affects: [128-03, 128-04, 128-05, 128-06, animation-helpers, custom-board-authoring-docs]

tech-stack:
  added: []
  patterns:
    - "Type-level devWarn dedup key (not per-instance/per-id) for anchor-registration warnings — mirrors triggerChoiceSelect's static-key pattern, not warnNoTargets' per-instance pattern"
    - "Vue provide()/inject() unit-testing pattern: provide and inject must live in different components (Parent provides, Child injects) — same-component provide+inject silently fails inject's parent-lookup"
    - "jsdom drag-event testing: hand-built plain objects shaped to the handler's read-subset (dataTransfer.setData/setDragImage/effectAllowed/dropEffect, preventDefault, currentTarget, relatedTarget) — never `new DragEvent(...)`, which jsdom does not implement"

key-files:
  created:
    - src/ui/composables/useDragDrop.test.ts
  modified:
    - src/ui/composables/useBoardInteraction.ts
    - src/ui/composables/anchorAttrs.test.ts

key-decisions:
  - "Dedup key derived from ref.name (not ref.className) — the plan's stub ElementRef interface included a className field that does not exist on the real ElementRef (id/notation/name only); since the warning only fires when ALL three fields are undefined, the key always resolves to a fixed 'unknown' bucket in practice, which still satisfies the type-level (not per-id) dedup requirement because a genuinely empty ref carries no per-instance differentiator by definition"
  - "useDragDrop tests use a Parent/Child component pair (not a single component) to get provide()+inject() to actually connect — Vue's inject() reads from the calling instance's PARENT provides, not its own, so provide-then-inject in one setup() silently returns undefined"

requirements-completed: [ANIM-02, ANIM-03]

duration: 25min
completed: 2026-07-02
---

# Phase 128 Plan 02: anchorAttrs Dev-Warning + useDragDrop Direct Tests Summary

**Closed the deferred v4.1 anchorAttrs dev-warning (fires once-per-type from the single source of truth, covering both useSelectable and useSelectableGrid) and gave useDragDrop its first direct unit tests at both the BoardInteraction API level and the raw drag-event-handler level, without touching useDragDrop.ts.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-02T16:14:00Z (approx, planning-state hand-off)
- **Completed:** 2026-07-02T16:39:47Z
- **Tasks:** 2/2 completed
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- `anchorAttrs()` now emits a dev-only, once-per-type `console.warn` (via `devWarn`) whenever a selectable/renderable element produces no `data-bs-el-*` attributes — the fix lives in the single source of truth, so both `useSelectable.attrs` and `useSelectableGrid.cellAttrs` are automatically covered without duplicating logic
- `useDragDrop.test.ts` created with 9 passing tests covering the shared `BoardInteraction` API contract (`startDrag`/`setDropTargets`/`triggerDrop`), the raw `dragProps`/`dropProps` event handlers driven with hand-built drag-event-shaped objects, and the no-provider degrade-gracefully path (warns once, never throws)
- `useDragDrop.ts` is verified byte-for-byte unchanged (`git diff --stat` shows no diff) — this was a test-only plan by design

## Task Commits

Each task was committed atomically:

1. **Task 1: Fire a once-per-type dev-warning from anchorAttrs() on empty anchor result** - `7a217db` (feat)
2. **Task 2: Direct unit tests for useDragDrop (API-level + jsdom drag-event-shaped object)** - `07aeca3` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `src/ui/composables/useBoardInteraction.ts` - `anchorAttrs()` now devWarns once-per-type when the produced attrs record is empty (all of `id`/`notation`/`name` undefined)
- `src/ui/composables/anchorAttrs.test.ts` - extended with a new `describe('anchorAttrs dev-warning', ...)` block: fires once, dedups on repeat calls, does not fire for a non-empty ref, and never fires more than the fixed-key bucket allows for repeated empty refs
- `src/ui/composables/useDragDrop.test.ts` - new file: API-level parity tests (shared `BoardInteraction` contract), event-level tests (hand-built drag-event-shaped plain objects for `dragProps`/`dropProps`), and no-provider degrade-gracefully tests

## Decisions Made

- **Dedup key uses `ref.name`, not `ref.className`** — the plan's embedded interface stub (`ElementRef { id?; notation?; name?; className?: string }`) does not match the actual `ElementRef` in `useBoardInteraction.ts` (`{ id?: number; name?: string; notation?: string }` — no `className`). Since the warning only fires when `id`, `notation`, AND `name` are all undefined simultaneously, there is no per-instance information available to differentiate keys in that branch regardless of which field the plan intended to use — the key always resolves to the fixed string `unknown`. This still satisfies the "type-level, not per-id" dedup requirement from RESEARCH Pitfall 5: a 50-element board missing anchors warns exactly once (verified by a dedicated test), never 50 times.
- **Parent/Child component pairing for useDragDrop tests** — Vue's `inject()` reads from the calling component instance's *parent's* `provides` object, not its own instance's `provides` (even after that same instance called `provide()`). A single-component `provide()` + `useDragDrop()` (which calls `inject()` internally) in one `setup()` silently fails to connect, so tests mount a Parent (provides `BoardInteraction`) wrapping a Child (calls `useDragDrop()`), mirroring the existing `mountCard()` pattern in `drag-keyboard-parity.test.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Plan's ElementRef interface stub does not match the actual interface**
- **Found during:** Task 1
- **Issue:** The plan's `<interfaces>` block and RESEARCH/PATTERNS docs all specify a dedup key of `` `anchorattrs-missing-${ref.className ?? ref.name ?? 'unknown'}` ``, but the real `ElementRef` interface (`useBoardInteraction.ts:19-23`) has no `className` field — only `id?`, `name?`, `notation?`. Using `ref.className` would fail to compile.
- **Fix:** Used `ref.name ?? 'unknown'` as the dedup key instead. Functionally equivalent for the actual empty-anchor branch (see Decisions Made above for why this doesn't weaken the type-level dedup guarantee).
- **Files modified:** `src/ui/composables/useBoardInteraction.ts`
- **Verification:** `npx vitest run src/ui/composables/anchorAttrs.test.ts` — all 19 tests pass, including a dedicated test proving repeated empty-ref calls warn exactly once.
- **Committed in:** `7a217db` (part of Task 1 commit)

**2. [Rule 3 - Blocking issue] provide()/inject() same-component pattern doesn't connect in Vue**
- **Found during:** Task 2
- **Issue:** Initial test draft called `provideBoardInteraction(bi)` then `useDragDrop()` (which internally calls `tryUseBoardInteraction()` → `inject()`) inside the SAME component `setup()`. All API-level and event-level tests failed with "no <GameShell> board-interaction provider" even though `bi` was provided, because Vue's `inject()` implementation looks up the calling instance's *parent's* `provides`, not its own.
- **Fix:** Restructured the mount helper to use a Parent/Child component pair — Parent calls `provideBoardInteraction(bi)`, Child calls `useDragDrop()` and exposes the API via a captured closure variable.
- **Files modified:** `src/ui/composables/useDragDrop.test.ts`
- **Verification:** `npx vitest run src/ui/composables/useDragDrop.test.ts` — all 9 tests pass.
- **Committed in:** `07aeca3` (part of Task 2 commit; this was resolved before the final commit, not as a follow-up fix)

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data introduced by this plan.

## Threat Flags

None — this plan's changes stay within the threat model's registered dispositions (T-128-03 mitigate via devWarn dev-only gate; T-128-04 accept, verified unchanged by test). No new network endpoints, auth paths, or schema changes were introduced.

## Verification

- `npx vitest run src/ui/composables/anchorAttrs.test.ts src/ui/composables/useDragDrop.test.ts` — 28/28 tests green
- `npx vitest run` (full suite) — 154 files, 2037/2037 tests green
- `git diff --stat src/ui/composables/useDragDrop.ts` — empty (no changes), confirming the test-only constraint
- `grep -q "anchorattrs-missing" src/ui/composables/useBoardInteraction.ts` — succeeds
- `npx tsc --noEmit -p .` — no new type errors introduced by this plan; pre-existing `anchorAttrs.test.ts` errors (lines shifted by the insertion) are documented "tsc test-file looseness" backlog items unrelated to this plan's new code (confirmed: they occur in the untouched `useSelectable.attrs`/`useSelectableGrid` describe blocks, not the new `anchorAttrs dev-warning` block)

## TDD Gate Compliance

Not applicable — plan frontmatter has no `tdd="true"` tasks; both tasks are `type="auto"`.

## Self-Check: PASSED

- FOUND: src/ui/composables/useDragDrop.test.ts
- FOUND: src/ui/composables/useBoardInteraction.ts (anchorattrs-missing string present)
- FOUND: src/ui/composables/anchorAttrs.test.ts (dev-warning describe block present)
- FOUND commit 7a217db in git log
- FOUND commit 07aeca3 in git log
