---
phase: 131-serialization-restore-fidelity
plan: 02
subsystem: engine
tags: [serialization, snapshot-restore, visibility, security, zone-visibility, undo, checkpoint]

# Dependency graph
requires:
  - phase: 131-01
    provides: PROC-01 independent re-verification confirming F1/F7 (zone visibility lost on restore) as LEGITIMATE, with file:line evidence
provides:
  - "Space.toJSON() override emitting `_zoneVisibility` when explicitly set"
  - "ElementJSON.zoneVisibility field (mirrors `visibility`)"
  - "Space._restoreZoneVisibility() internal cross-class restore accessor, called from GameElement.fromJSON"
  - "Single authoritative zone-visibility mechanism (removed the buildSpectatorView stopgap comment/reasoning — no separate redaction path)"
  - "Regression test proving byte-identity of toJSONForPlayer(opponent) across all five restore paths (fromSnapshot, undo, rewind, GameSession.restore, stateless-ops) plus a runtime visibility-change case"
affects: [132-engine-element-builder-safety, 133-engine-flow-action-validation, 134-ui-session-interaction-guardrails, 138-games-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zone-visibility serialization mirrors element-visibility serialization exactly: explicit-only emission in toJSON, restore via a special-cased hook in the base class's static fromJSON"
    - "Scoped cross-class internal accessor (_restoreZoneVisibility) instead of widening a private field to public — same convention as `_t`"

key-files:
  created:
    - src/engine/element/zone-visibility-restore.test.ts
  modified:
    - src/engine/element/space.ts
    - src/engine/element/game-element.ts
    - src/engine/element/types.ts
    - src/session/stateless-ops.ts
    - src/session/restore-snapshot-authoritative.test.ts

key-decisions:
  - "Test games use a plain Space (not Deck/Hand) for the hidden zone: Deck/Hand set their OWN zone-visibility default in their own constructors (F32 secure-by-default), and GameElement.fromJSON's restore path does `new ElementClass(ctx)` — which incidentally re-runs that constructor and re-applies the class default, masking the F1/F7 bug for the common case. A plain Space has no built-in default, so contentsHidden() genuinely diverges from a fresh instance and exercises the real bug."
  - "Removed '_zoneVisibility' from Space.unserializableAttributes per CONTEXT.md instruction, even though the underscore prefix already excluded it from the generic attribute loop — it was a no-op for serialization but the plan's coverage contract required the explicit round-trip via toJSON/_restoreZoneVisibility to be the sole mechanism, not a residual unserializableAttributes membership implying an intended-but-missing generic path."
  - "buildSpectatorView in stateless-ops.ts required no behavioral change — it already builds from the caller's current runner (fresh or restored) in every call site. Only the stale 'not serialized' comment was updated, since that reasoning no longer applies."

requirements-completed: [SEC-01, PROC-02]

# Metrics
duration: ~35min
completed: 2026-07-03
---

# Phase 131 Plan 02: Zone Visibility Restore Fidelity Summary

**Serialized `Space._zoneVisibility` via a `toJSON`/`_restoreZoneVisibility` round-trip mirroring the existing `_visibility` mechanism, closing the F1/F7 information-disclosure hole where hidden hands/decks silently became fully visible after any undo, rewind, cold restore, or dev-host broadcast.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-03T03:09:56Z
- **Tasks:** 2 (TDD: RED test commit, GREEN fix commit)
- **Files modified:** 6 (1 created)

## Accomplishments

- Proved the F1/F7 bug is real and specifically NOT masked by Deck/Hand's own secure-by-default constructors — the initial test draft using `Deck` passed even on unfixed code, so the test was redesigned around a plain `Space` (documented at length in both test files' headers/comments) to genuinely exercise the restore-discards-constructor-config defect.
- RED: 6 failing assertions reproduced F1/F7 exactly — after any restore, the opponent's view of a hidden zone leaked full suit values instead of `__hidden` placeholders.
- GREEN: `Space.toJSON()` now emits `zoneVisibility` when `_zoneVisibility.explicit` is set (same guard as `_visibility`); `GameElement.fromJSON` restores it via a duck-typed call to `Space._restoreZoneVisibility()` (avoids a circular import between `game-element.ts` and `space.ts`).
- Verified all five restore paths in the D-SEC-01 coverage contract with byte-identity assertions: `GameRunner.fromSnapshot`, undo via `StateHistory`, rewind via `getStateAtAction`, `GameSession.restore()` (companion test), and the stateless-ops path (`executeOp`).
- Full suite green after the fix: 162 files / 2099 tests, no regressions.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: Red-first regression test — zone visibility across all restore paths** - `78d40ab` (test)
2. **Task 2: Serialize/restore _zoneVisibility and unify the spectator-view workaround** - `78dd7a8` (feat)

**Plan metadata:** (this commit, docs)

## Files Created/Modified

- `src/engine/element/zone-visibility-restore.test.ts` - New regression suite: 7 tests covering the pre-restore baseline, fromSnapshot, undo, rewind, a documented companion-placement placeholder for GameSession.restore(), stateless-ops, and a runtime re-hide case.
- `src/session/restore-snapshot-authoritative.test.ts` - Added the GameSession.restore() companion assertion (case d of the coverage contract).
- `src/engine/element/space.ts` - `toJSON()` override; `_restoreZoneVisibility()` internal accessor; removed `'_zoneVisibility'` from `unserializableAttributes` with an explanatory comment.
- `src/engine/element/game-element.ts` - `fromJSON` restores `zoneVisibility` via duck-typed accessor call.
- `src/engine/element/types.ts` - `ElementJSON.zoneVisibility?: VisibilityState` field.
- `src/session/stateless-ops.ts` - Updated `buildSpectatorView`'s comment (no behavior change — it already used the caller's current runner in every case).

## Decisions Made

See `key-decisions` in frontmatter. The most consequential one: the initial test draft (using `Deck`/`contentsHidden()`) passed on unmodified code because `Deck`'s own constructor sets `contentsHidden()` as its class default, and `GameElement.fromJSON`'s `new ElementClass(ctx)` restore path re-runs that constructor — accidentally reproducing the hidden state without exercising the actual serialization gap. This was caught by manually diffing before/after JSON with `tsx` before trusting the initial green run, per "Prove Before Fix." The test was redesigned around a plain `Space` (no built-in zone-visibility default) to genuinely reproduce F1/F7, and RED was re-confirmed (6 failing assertions) before writing the fix.

## Deviations from Plan

**1. [Rule 1 - Bug in test design, caught before commit] Deck-based RED test did not actually reproduce F1/F7**
- **Found during:** Task 1 (writing the red-first regression test)
- **Issue:** First draft used `Deck` (`contentsHidden()`) for the hidden zone. `Deck.contentsHidden()` matches `Deck`'s own constructor-set default, so `GameElement.fromJSON`'s `new ElementClass(ctx)` restore path incidentally re-applied the same default when reconstructing the `Deck` instance — masking the bug. Running the initial test suite reported all green even on unmodified code, which is a false-negative RED (a test that can never fail is not a regression test).
- **Fix:** Verified the discrepancy directly with `tsx` (dumped before/after JSON side by side), diagnosed the root cause (class-default re-application on restore), and rewrote both test files to use a plain `Space` subclass with no built-in zone-visibility default, so `contentsHidden()` genuinely diverges from what a freshly-constructed instance would produce.
- **Files modified:** `src/engine/element/zone-visibility-restore.test.ts`, `src/session/restore-snapshot-authoritative.test.ts` (both rewritten before the RED commit — no separate commit for this correction, since it happened before Task 1 was committed).
- **Verification:** Re-ran the suite; confirmed 6 failing assertions (genuine RED) before proceeding to Task 2.
- **Committed in:** `78d40ab` (Task 1 commit — the corrected version is what was committed; the masked version was never committed)

---

**Total deviations:** 1 (test-design correction, caught and fixed before any commit — no scope creep, no impact on the plan's fix code)
**Impact on plan:** None on the delivered fix. The correction was necessary for the regression test to be trustworthy — an important instance of this project's "Prove Before Fix" rule applied reflexively to test-writing itself.

## Issues Encountered

None beyond the test-design deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SEC-01/F1/F7 fully closed: zone visibility now round-trips through every documented restore path with a single authoritative mechanism (no divergent redaction paths).
- The `Space.toJSON()`/`_restoreZoneVisibility()` pattern established here is the template for the remaining F1/F7-adjacent findings (F10 `onEnter`/`onExit` restore amnesia, F16 `teachingDisabled`/`displayName` restore amnesia) planned for later plans in this phase — same root cause (constructor-applied config discarded by `loadSerializedState`), same fix shape (explicit toJSON emission + fromJSON restore hook).
- Full suite green (162 files / 2099 tests); no blockers for the next plan in phase 131.

## Self-Check: PASSED

All created/modified files confirmed present on disk; both task commits (`78d40ab`, `78dd7a8`) confirmed present in git log.
