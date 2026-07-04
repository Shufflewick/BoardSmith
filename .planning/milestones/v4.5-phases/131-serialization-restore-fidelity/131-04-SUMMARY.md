---
phase: 131-serialization-restore-fidelity
plan: 04
subsystem: security
tags: [visibility, serialization, session, engine, audit-fix]

# Dependency graph
requires:
  - phase: 131-01
    provides: PROC-01 verify-first findings verification confirming F2 and F8 LEGITIMATE with file:line evidence
provides:
  - "static visibleAttributes enforcement in Game.toJSONForPlayer's filterElement chokepoint"
  - "state.players derived from the same per-viewer-filtered truthView that backs state.view"
  - "Player-owns-itself owner-check special case (Pitfall 4) for attribute-level visibility"
affects: [132-eng-element-builder-safety, 138-games-cross-repo-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single per-viewer redaction chokepoint (filterElement) enforces both element/zone visibility AND attribute-level visibility -- no parallel filter mechanisms"
    - "Player-owns-itself owner check (element instanceof Player ? element.seat === visibilityPosition : element.getEffectiveOwner()?.seat === visibilityPosition) needed anywhere a top-level Player's own ownership must be tested"
    - "Broadcast-shape projections (state.players) derived from an already-filtered ElementJSON tree via id lookup, never a second raw pass over live game objects"

key-files:
  created:
    - src/engine/element/visible-attributes.test.ts
    - src/session/player-state-visibility.test.ts
  modified:
    - src/engine/element/game.ts
    - src/session/utils.ts

key-decisions:
  - "visibleAttributes filtering lives inside filterElement's existing unfiltered fallthrough branch, not a new parallel filter function -- keeps one chokepoint for all per-viewer redaction (verified via audit:duplication: zero new clones)"
  - "_isCurrent always survives visibleAttributes filtering (framework metadata, not a developer-declared attribute) so a filtered opponent still sees whose turn it is"
  - "state.players falls back to minimal {name, seat} only when the Player node is entirely absent from truthView (individually hidden), never re-reads the raw player object"

patterns-established:
  - "Pattern: attribute-level visibility filtering happens in filterElement immediately before children are recursed, using the SAME json/ownJson swap technique as the existing zone-visibility branches"
  - "Pattern: any future broadcast-shape projection that needs 'the player's own data' should walk truthView by id (findElementJSONById) rather than adding another raw pass over game.players"

requirements-completed: [SEC-02, SEC-03, PROC-02]

# Metrics
duration: 12min
completed: 2026-07-02
---

# Phase 131 Plan 04: visibleAttributes Enforcement + state.players Redaction Summary

**Implemented the dead `static visibleAttributes` security control and eliminated the unfiltered `state.players` broadcast channel by routing both through `Game.toJSONForPlayer`'s single `filterElement` chokepoint.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-02T22:24:00-05:00
- **Completed:** 2026-07-02T22:27:04-05:00
- **Tasks:** 2 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- SEC-02 (F2): `filterElement` now consults `static visibleAttributes` before its final unfiltered return, redacting non-whitelisted attributes from non-owner viewers while preserving public-by-default (undefined = all visible) and owner-self-visibility for `Player` (Pitfall 4 special case).
- SEC-03 (F8): `buildPlayerState`'s `state.players` is now derived from the already-filtered `truthView` tree (via a new `findElementJSONById` walk) instead of a raw, unfiltered `player.toJSON()` second pass -- eliminating the parallel unfiltered broadcast channel identified by the audit.
- Both regression suites proven RED before the fix, then GREEN after -- captured below per PROC-02.

## Task Commits

Each task was committed atomically:

1. **Task 1: Red-first regression tests** - `e215f8d` (test)
2. **Task 2: Implement visibleAttributes filtering and derive state.players from truthView** - `a8a07ef` (feat)

**Plan metadata:** (this commit) - docs

_Both tasks were TDD-flagged; Task 1 produced the RED commit, Task 2 produced the GREEN commit. No separate refactor commit was needed._

## RED-then-GREEN Evidence (PROC-02)

**RED (commit `e215f8d`, before any fix code):**

```
src/engine/element/visible-attributes.test.ts: 3 failed | 2 passed (5)
  FAIL redacts non-whitelisted attributes from a non-owner view
    expected 'owner-only-secret' to be undefined
  FAIL shows spectators the most restrictive (non-owner) view
    expected 'owner-only-secret' to be undefined
  FAIL Player owns itself (Pitfall 4): the OWNING seat sees a restricted
       Player attribute, all others do not
    expected 'spy' to be undefined
  (passed trivially, no filtering existed yet: owner-view test,
   public-by-default test)

src/session/player-state-visibility.test.ts: 2 failed | 1 passed (3)
  FAIL hides a restricted Player attribute from an opponent's state.players
    expected 'spy' to be undefined
  FAIL state.players agrees with the filtered view for a given viewer
    expected 'spy' to be undefined
  (passed trivially: owner's own state.players test -- it was always
   unfiltered so the owner already saw their own data)
```

**GREEN (commit `a8a07ef`, after the fix):**

```
src/engine/element/visible-attributes.test.ts: 5 passed (5)
src/session/player-state-visibility.test.ts: 3 passed (3)
```

**Full suite + audits after the fix:**
```
npm run test        -> 166 test files, 2113 tests passed
npx tsc --noEmit     -> no new errors (introduced-then-fixed one: utils.ts
                        flattened.name type narrowing, resolved in the same
                        commit, not a separate deviation)
npm run audit:duplication -> 117 pre-existing clones (unchanged), none in
                              game.ts or utils.ts -- single chokepoint
                              confirmed, no copy-paste filter logic
```

## Files Created/Modified
- `src/engine/element/visible-attributes.test.ts` - SEC-02 regression suite: non-owner redaction, owner-self-visibility, spectator most-restrictive view, public-by-default, Player-owns-itself (Pitfall 4)
- `src/session/player-state-visibility.test.ts` - SEC-03 regression suite: opponent redaction, owner's own visibility, state.players/view agreement
- `src/engine/element/game.ts` - `filterElement`'s final fallthrough branch now filters `json.attributes` down to `static visibleAttributes` for non-owners, with the `instanceof Player` owner-self-visibility special case; `_isCurrent` always preserved
- `src/session/utils.ts` - new `findElementJSONById` helper; `buildPlayerState`'s `fullPlayerData` now walks `truthView` by player id instead of calling `player.toJSON()` directly on live game objects

## Decisions Made
- Filtering lives inside the existing `filterElement` unfiltered fallthrough rather than a new function, to keep exactly one per-viewer redaction chokepoint (matches the plan's explicit "do NOT build a parallel filter" instruction, verified via `audit:duplication` showing no new clones).
- `_isCurrent` is exempted from the whitelist check since it is framework-added metadata (`Player.toJSON()`), not a developer-declared game attribute -- omitting it would silently break "whose turn is it" for any game defining `visibleAttributes` on a Player subclass.
- When a Player node is entirely missing from a viewer's `truthView` (fully hidden, a currently-unused but architecturally possible case since `Player` has no `hideFromAll()` today), `state.players` falls back to `{name, seat}` only rather than re-reading the raw player object -- keeps the "never re-read unfiltered data" invariant airtight even for edge cases the current API surface doesn't expose.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a TypeScript type error introduced by the SEC-03 fix**
- **Found during:** Task 2 (`npx tsc --noEmit` verification pass)
- **Issue:** The flattened `state.players` entry type requires `name: string`, but the `ElementJSON` node's `name` field is `string | undefined` -- `tsc` flagged `src/session/utils.ts(267,13)`.
- **Fix:** Added an explicit fallback (`node.name ?? player.name ?? \`Player ${player.seat}\``) before spreading `node.attributes`, matching the existing fallback pattern used elsewhere in the same function.
- **Files modified:** `src/session/utils.ts`
- **Verification:** `npx tsc --noEmit` shows zero errors in `src/session/utils.ts`; confirmed no other `tsc` errors were introduced (all remaining `tsc --noEmit` output is pre-existing test-file looseness documented in `CLAUDE.md`/`PROJECT.md`, unrelated to this plan's files).
- **Committed in:** `a8a07ef` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix, Rule 1)
**Impact on plan:** Necessary for correctness (type safety); no scope creep, no behavior change beyond the fallback already used elsewhere in the file.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SEC-02 and SEC-03 (F2, F8) are closed; the `visibleAttributes` control is now live and `state.players` is a projection of the same filtered tree as `state.view`, not a parallel unfiltered channel.
- The `instanceof Player` owner-self-visibility pattern and `findElementJSONById` helper are available for any future work that needs to test Player ownership or derive a broadcast-shape projection from an already-filtered tree (e.g. Phase 132's element/builder safety work, or Phase 138's cross-repo games migration if any game adopts `visibleAttributes`).
- No games currently declare `visibleAttributes` on any class, so this fix is purely additive (dormant control activated) -- no migration required for Phase 138. Verified no consumer in `~/BoardSmithGames/` or MERC references `visibleAttributes` (repo-local grep only, not re-verified cross-repo in this plan since the field was previously a no-op and therefore never adopted).

---
*Phase: 131-serialization-restore-fidelity*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created/modified files verified present; both task commits (`e215f8d`, `a8a07ef`) confirmed in git log.
