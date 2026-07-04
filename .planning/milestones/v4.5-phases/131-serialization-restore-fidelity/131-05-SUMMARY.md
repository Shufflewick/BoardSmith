---
phase: 131-serialization-restore-fidelity
plan: 05
subsystem: engine
tags: [serialization, snapshot-restore, event-handlers, onEnter, onExit, security-docs, undo, checkpoint]

# Dependency graph
requires:
  - phase: 131-01
    provides: PROC-01 independent re-verification confirming F10 (onEnter/onExit restore amnesia) and F15 (registerDebug docs) as LEGITIMATE, with file:line evidence
  - phase: 131-02
    provides: "Space.toJSON()/_restoreZoneVisibility round-trip pattern (scoped cross-class internal accessor mirroring `_t`) — the template this plan's `_captureEventHandlers`/`_restoreEventHandlers` accessors follow"
  - phase: 131-04
    provides: filterElement chokepoint / visibleAttributes work (unrelated files, satisfies wave-3 dependency ordering only)
provides:
  - "Space._captureEventHandlers()/_restoreEventHandlers() scoped internal accessors"
  - "Game.loadSerializedState capture-before-discard + rebind-after-rebuild for Space onEnter/onExit handlers, keyed by class name + tree branch path"
  - "devWarn on any onEnter/onExit handler that cannot be re-matched after restore (no silent loss)"
  - "Corrected registerDebug JSDoc example (game.ts) and docs/common-pitfalls.md example — neither models dumping hidden/secret state into registerDebug; both note debugEnabled (SEC-04) gating"
affects: [132-engine-element-builder-safety, 138-games-migration, 139-docx-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Handler re-binding mirrors the SEC-01/F1/F7 zone-visibility pattern exactly: capture live/unserializable state from the constructor-built tree BEFORE `this._t.children = []` discards it, then re-attach to the rebuilt tree via a scoped cross-class internal accessor (never widening a private field to public)."
    - "Stable cross-restore identity key for tree-position-based re-matching: `${element.constructor.name}:${element.branch()}` — works because the JSON tree is a direct serialization of the same constructor tree (same child order/shape), so `branch()`'s index-path is identical before and after the round-trip."
    - "Loud-not-silent failure for identity-match misses: devWarn (deduped by key, dev-mode only) rather than throwing — matches the existing `unreachable-action` devWarn convention in the same file."

key-files:
  created:
    - src/engine/element/handler-restore.test.ts
  modified:
    - src/engine/element/space.ts
    - src/engine/element/game.ts
    - docs/common-pitfalls.md

key-decisions:
  - "Identity key = class name + branch() (tree index path), not a manually-assigned element id/name. Chosen because it requires zero developer-facing changes (the plan's constraint) and is provably stable: `GameElement.fromJSON` rebuilds children in the exact same order the constructor tree was serialized in, so branch() computed on the live tree before discard matches branch() computed on the rebuilt tree after fromJSON, for any Space whose position in the tree didn't change between save and restore."
  - "devWarn key includes the identity string itself (`unbound-event-handlers:${key}`) so a distinct tree-shape-drift case (e.g. a specific Space that started being conditionally created) gets its own de-duplication bucket rather than colliding with an unrelated one."
  - "registerDebug JSDoc example changed from `stash: s.stash.map(e => e.name)` (dumps zone contents — could be hidden state depending on the game) to `itemCount: s.stash.length` (a count, never secret) plus an explicit debugEnabled/SEC-04 cross-reference, closing the DOCX-04 same-phase doc loop opened by Plan 03's SEC-04 code fix."

requirements-completed: [RST-01, SEC-04, PROC-02]

# Metrics
duration: ~5min
completed: 2026-07-03
---

# Phase 131 Plan 05: Event Handler Restore Fidelity + registerDebug Docs Summary

**Re-bound `Space.onEnter`/`onExit` handlers across every snapshot-restore path (capture-before-discard, re-attach-after-rebuild, loud devWarn on any unmatched handler) and corrected the `registerDebug` JSDoc/docs examples so neither models dumping hidden state into a dev-only debug channel.**

## Performance

- **Duration:** ~5 min
- **Completed:** 2026-07-03T03:34:26Z
- **Tasks:** 2 (TDD: RED test commit, GREEN fix commit)
- **Files modified:** 4 (1 created)

## Accomplishments

- RST-01/F10 fixed: `onEnter`/`onExit` handlers registered in a game's constructor now survive every restore path that goes through `Game.loadSerializedState` (`GameRunner.fromSnapshot`, `GameSession.restore()`, `StateHistory` undo/rewind, the stateless `SnapshotSessionHost` ops path — same shared discard point traced for F1/F7 in Plan 01/02).
- RED: `handler-restore.test.ts` proved the bug directly — an `onEnter`/`onExit` handler fired correctly on a live game, then silently stopped firing after `GameRunner.fromSnapshot` (2 of 4 assertions failed on unmodified code).
- GREEN: `Game.loadSerializedState` now walks the live constructor tree via `this.all(Space)` immediately before `this._t.children = []`, captures any `Space` with non-empty `_eventHandlers` (via the new scoped `_captureEventHandlers()` accessor) keyed by `${className}:${branch()}`, then after the `fromJSON` rebuild loop walks the new tree and re-attaches matching handlers via `_restoreEventHandlers()`. Any captured handler with no match in the rebuilt tree triggers a loud `devWarn` (reusing the existing `devWarn` import/pattern already used for the `unreachable-action` warning in the same file) — never a silent drop.
- `Space._eventHandlers` stays `private`; the two new accessor methods (`_captureEventHandlers`/`_restoreEventHandlers`) are the scoped cross-class-internal convention already established for `_restoreZoneVisibility` in Plan 02 — not a public API widening.
- SEC-04 doc loop closed (DOCX-04 same-phase rule): the `registerDebug` JSDoc example in `game.ts` (~1172, now ~1181) no longer models dumping zone contents (`stash: s.stash.map(e => e.name)` → `itemCount: s.stash.length`), and both the JSDoc and `docs/common-pitfalls.md`'s example now explicitly note that debug payloads are dev-only and gated behind `GameSessionOptions.debugEnabled` (the SEC-04 code fix landed in Plan 03).
- Full suite green after the fix: 167 files / 2117 tests, no regressions. `npm run audit:dead-code` and `npm run audit:duplication` show no new issues in any file touched by this plan (verified by diffing against a `git stash` baseline for the one pre-existing `game.ts` clone finding, which only shifted line numbers).

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: Red-first regression test — onEnter/onExit fire after restore** - `de4c411` (test)
2. **Task 2: Re-bind onEnter/onExit across restore + correct registerDebug docs** - `ef0b3c6` (feat)

## RED Output (Task 1, captured before Task 2)

```
 ❯ src/engine/element/handler-restore.test.ts (4 tests | 2 failed) 9ms
   × onEnter STILL fires after GameRunner.fromSnapshot
     → expected +0 to be 1 // Object.is equality
   × onExit STILL fires after GameRunner.fromSnapshot
     → expected +0 to be 1 // Object.is equality

 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
```

The two baseline assertions ("onEnter/onExit fires on the live, never-restored game") passed as
expected — confirming the handlers work correctly before any restore is involved, isolating the
failure to the restore path specifically, matching the audit's F10 framing exactly.

## GREEN Output (Task 2)

```
 ✓ src/engine/element/handler-restore.test.ts (4 tests) 6ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Full suite: `Test Files 167 passed (167)`, `Tests 2117 passed (2117)`.

## Files Created/Modified

- `src/engine/element/handler-restore.test.ts` - New regression suite: 4 tests (2 baseline live-game assertions, 2 restore-survival assertions for onEnter/onExit) built around a two-Space test game (`Source`/`Dest`) with a `Token` piece moved between them via `moveIn`/`moveOut` actions, so the restored-game assertions trigger a REAL enter/exit rather than inspecting internal `_eventHandlers` state.
- `src/engine/element/space.ts` - Added `_captureEventHandlers()` (returns the live `_eventHandlers` object) and `_restoreEventHandlers(handlers)` (assigns it) as scoped cross-class-internal accessors, mirroring the `_restoreZoneVisibility` convention from Plan 02. `_eventHandlers` remains `private`.
- `src/engine/element/game.ts` - `loadSerializedState`: capture-before-discard walk (`this.all(Space)` before `this._t.children = []`), re-attach-after-rebuild walk (`this.all(Space)` after the `fromJSON` loop), devWarn on any unmatched captured handler. Also imports `type ElementEventHandler` from `space.js`. Corrected the `registerDebug` JSDoc example and added a debugEnabled/SEC-04 cross-reference note.
- `docs/common-pitfalls.md` - Added a note after the existing (already non-secret) `registerDebug('Element Tree', ...)` example clarifying `debugEnabled` gating and warning against registering hidden/secret game state this way (DOCX-04).

## Decisions Made

See `key-decisions` in frontmatter. The most consequential one: choosing `${className}:${branch()}` as the stable cross-restore identity key. This required no game-code changes (a plan constraint) because it derives purely from tree structure, which `GameElement.fromJSON`'s rebuild loop reproduces exactly (same child array order as `toJSON()` serialized). The one documented limitation (surfaced via the devWarn message itself, not silently): if a game's constructor CONDITIONALLY creates elements such that a `Space`'s position in the tree differs across restores, its handlers will not re-match and a loud warning fires — this is inherent to any tree-position-based identity scheme and was flagged explicitly in the devWarn text so a developer hitting it gets an actionable explanation, not a mystery.

## Deviations from Plan

None - plan executed exactly as written. Both the handler re-bind mechanism and the docs correction matched the plan's `<action>` instructions precisely; no Rule 1-4 deviations were needed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Threat Flags

None - both STRIDE threats in this plan's `<threat_model>` (T-131-07 handler-drop-on-restore, T-131-08 docs-teaching-insecure-pattern) were the exact threats mitigated by this plan's two tasks; no new, unlisted security-relevant surface was introduced.

## Next Phase Readiness

- RST-01/F10 and SEC-04's documentation half are fully closed. This plan was the phase-terminal editor of `game.ts` and `space.ts` — no further changes to these files are expected within Phase 131.
- Full suite green (167 files / 2117 tests); `npm run audit:dead-code`/`audit:duplication` show no new issues attributable to this plan's files.
- Phase 131 (Serialization & Restore Fidelity) is now complete: all 5 plans (01-05) executed, all 7 in-scope audit findings (F1, F2, F7, F8, F10, F15, F16) fixed with regression tests, and the SEC-04 doc loop closed per DOCX-04.

## Self-Check: PASSED

All created/modified files confirmed present on disk; both task commits (`de4c411`, `ef0b3c6`) confirmed present in git log.
