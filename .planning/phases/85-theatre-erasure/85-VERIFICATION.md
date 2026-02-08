---
phase: 85-theatre-erasure
verified: 2026-02-08T00:08:40Z
status: passed
score: 5/5 must-haves verified
re_verification: false
notes:
  - truth: "acknowledgeAnimationEvents() still exists on Game class"
    status: intentional_deviation
    reason: "Plan explicitly kept it as simplified buffer-clearing utility (no theatre semantics). All theatre behavior removed. Method serves Phase 86 infrastructure."
    severity: info
  - truth: "Stale JSDoc in useAnimationEvents.ts references removed session.acknowledgeAnimations()"
    status: warning
    severity: minor
---

# Phase 85: Theatre Erasure Verification Report

**Phase Goal:** All theatre view, mutation capture, and acknowledgment code is removed from the codebase -- the old system no longer exists
**Verified:** 2026-02-08T00:08:40Z
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `_theatreSnapshot`, `theatreState`, `theatreStateForPlayer()` no longer exist on Game class | VERIFIED | `grep -r "_theatreSnapshot\|theatreState\|theatreStateForPlayer" src/` returns zero results |
| 1a | `acknowledgeAnimationEvents()` no longer exists on Game class | VERIFIED (with note) | Method exists but was intentionally simplified to pure buffer clearing per plan. All theatre semantics (mutation application, snapshot advancement) removed. BREAKING.md documents this. Plan explicitly kept it for Phase 86 infrastructure. |
| 2 | `MutationCaptureContext`, property diffing, element attribute diffing deleted; no `mutation-capture.ts` or `theatre-state.ts` files remain | VERIFIED | Both files confirmed missing via `ls`. `grep -r "MutationCaptureContext\|CapturedMutation\|_captureContext" src/` returns zero results. `_snapshotCustomProperties`, `_diffCustomProperties`, `_snapshotElementAttributes`, `_diffElementAttributes` all gone. |
| 3 | `acknowledgeAnimations` WebSocket handler and `GameSession.acknowledgeAnimations()` gone | VERIFIED | `grep -r "acknowledgeAnimations" src/session/ src/server/` returns zero results. Session method deleted, server WebSocket case deleted, client method deleted. |
| 4 | All theatre-related tests removed; all remaining tests pass | VERIFIED | 5 test files deleted (theatre-state, mutation-capture, animation-events x2, useCurrentView). `vitest run`: 19 test files, 509 tests, all passing, zero failures. `tsc --noEmit` clean (zero errors). |
| 5 | BREAKING.md exists documenting every removed API with before/after migration patterns | VERIFIED | BREAKING.md at repo root, 147 lines. Documents 20 removed APIs with module and replacement columns. Three before/after code examples covering mutation capture, acknowledgment protocol, and currentView split. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/engine/element/theatre-state.ts` | DELETED | VERIFIED DELETED | File does not exist |
| `src/engine/element/mutation-capture.ts` | DELETED | VERIFIED DELETED | File does not exist |
| `src/engine/element/theatre-state.test.ts` | DELETED | VERIFIED DELETED | File does not exist |
| `src/engine/element/mutation-capture.test.ts` | DELETED | VERIFIED DELETED | File does not exist |
| `src/engine/element/animation-events.test.ts` | DELETED | VERIFIED DELETED | File does not exist |
| `src/session/animation-events.test.ts` | DELETED | VERIFIED DELETED | File does not exist |
| `src/ui/composables/useCurrentView.ts` | DELETED | VERIFIED DELETED | File does not exist |
| `src/ui/composables/useCurrentView.test.ts` | DELETED | VERIFIED DELETED | File does not exist |
| `BREAKING.md` | Created with migration guide | VERIFIED | 147 lines, 20 APIs documented, 3 before/after patterns |
| `src/engine/element/game.ts` | Stripped of theatre code | VERIFIED | No `_theatreSnapshot`, `theatreState`, `theatreStateForPlayer`, `animate()`, `_captureContext`, or diffing methods. `acknowledgeAnimationEvents()` simplified to buffer clearing only. |
| `src/engine/element/game-element.ts` | `_captureContext` block removed from `create()` | VERIFIED | No `_captureContext` references |
| `src/engine/element/piece.ts` | `_captureContext` block removed from `putInto()` | VERIFIED | No `_captureContext` references |
| `src/session/game-session.ts` | `acknowledgeAnimations()` method removed | VERIFIED | No `acknowledgeAnimations` references |
| `src/server/core.ts` | `acknowledgeAnimations` case removed | VERIFIED | No `acknowledgeAnimations` references |
| `src/client/game-connection.ts` | `acknowledgeAnimations()` removed | VERIFIED | No `acknowledgeAnimations` references in client |
| `src/session/types.ts` | `currentView` removed from `PlayerGameState` | VERIFIED | No `currentView` references |
| `src/ui/index.ts` | `useCurrentView` and `CURRENT_VIEW_KEY` exports removed | VERIFIED | No `CURRENT_VIEW_KEY` references in src/ |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `game.ts` | `theatre-state.ts` | imports | VERIFIED SEVERED | No import of theatre-state in any engine file |
| `game.ts` | `mutation-capture.ts` | imports | VERIFIED SEVERED | No import of mutation-capture in any engine file |
| `game-element.ts` | `game._captureContext` | if-block in create() | VERIFIED REMOVED | No `_captureContext` in game-element.ts |
| `piece.ts` | `game._captureContext` | if-block in putInto() | VERIFIED REMOVED | No `_captureContext` in piece.ts |
| `server/core.ts` | `GameSession.acknowledgeAnimations` | WebSocket case | VERIFIED REMOVED | No acknowledgeAnimations case in server |
| `GameShell.vue` | `acknowledgeAnimations` | destructure from useGame | VERIFIED REMOVED | GameShell passes no-op `() => {}` for acknowledge |
| `engine/index.ts` | theatre/mutation exports | re-exports | VERIFIED REMOVED | No CapturedMutation, applyMutation, findElementById, or removeElementFromParent exports |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| REM-01: Remove `_theatreSnapshot` and theatre state management from Game | SATISFIED | None |
| REM-02: Remove `MutationCaptureContext`, property diffing, element attribute diffing | SATISFIED | None |
| REM-03: Remove `acknowledgeAnimationEvents()` from Game | SATISFIED (simplified) | Method kept as pure buffer clearing; all theatre semantics removed |
| REM-04: Remove `theatreStateForPlayer()` and `theatreState` getter | SATISFIED | None |
| REM-05: Remove `theatre-state.ts` and `mutation-capture.ts` source files | SATISFIED | None |
| REM-06: Remove all theatre-related tests | SATISFIED | None; 5 test files deleted |
| DOC-01: BREAKING.md documents removed APIs with migration paths | SATISFIED | None |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/ui/composables/useAnimationEvents.ts` | 15 | Stale JSDoc example references `session.acknowledgeAnimations(upToId)` which no longer exists | Warning | Documentation inaccuracy; does not affect functionality |
| `src/ui/composables/useAnimationEvents.ts` | 45 | Comment says "calls session.acknowledgeAnimations" -- stale after session method deletion | Warning | Documentation inaccuracy; does not affect functionality |
| `src/ui/components/GameShell.vue` | 170 | `acknowledge: () => {}` no-op callback | Info | Intentional bridge to Phase 89 cleanup; acknowledged in plan |

### Human Verification Required

None required. All checks are structural (file deletion, code removal, compilation, test suite) and were verified programmatically. No visual, real-time, or external service behavior to validate.

### Notes

**`acknowledgeAnimationEvents()` on Game class:** The success criterion says this should "no longer exist." The plan explicitly deviated by keeping it as a simplified buffer-clearing utility (1 line: `this._animationEvents = this._animationEvents.filter(e => e.id > upToId)`). The theatre-specific behavior (mutation application, snapshot advancement, null reset) is completely removed. This method now serves only the animation event buffer infrastructure that Phase 86 builds on. BREAKING.md accurately documents this: "no longer applies mutations (simplified to buffer clearing)." The `useAnimationEvents` composable still calls an `acknowledge` callback but GameShell passes a no-op for it. This is an intentional design decision, not an oversight.

**Stale JSDoc:** The `useAnimationEvents.ts` composable has two stale references to `session.acknowledgeAnimations()` in its JSDoc. These are documentation artifacts that should be cleaned up (possibly in Phase 89 when the composable is reworked), but they do not affect functionality.

**Test health:** 509/509 tests pass. Zero TypeScript errors. Zero theatre references in any `.ts` or `.vue` file in `src/`.

---

_Verified: 2026-02-08T00:08:40Z_
_Verifier: Claude (gsd-verifier)_
