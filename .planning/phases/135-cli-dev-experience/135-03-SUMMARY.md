---
phase: 135-cli-dev-experience
plan: 03
subsystem: cli
tags: [scaffold, boardsmith.json, playerCount, schema, tdd]

# Dependency graph
requires:
  - phase: 135-cli-dev-experience
    provides: "135-01 PROC-01 verification gate — F9/CLIX-01 confirmed LEGITIMATE with file:line trace"
provides:
  - "generateBoardsmithJson no longer emits playerCount or the dead $schema URL"
  - "generateRulesIndexTs confirmed as the sole legitimate write site for minPlayers/maxPlayers"
  - "PROC-02 regression test asserting the emitted-JSON shape"
  - "docs/getting-started.md boardsmith.json example kept in sync with actual scaffold output"
affects: [135-04, 135-05]

# Tech tracking
tech-stack:
  added: []
  patterns: ["single-source-of-truth player count (gameDefinition only, no JSON duplication)"]

key-files:
  created: []
  modified:
    - src/cli/lib/project-scaffold.ts
    - src/cli/lib/project-scaffold.test.ts
    - docs/getting-started.md

key-decisions:
  - "Also removed the dead $schema line from docs/getting-started.md's boardsmith.json example (not explicitly named in the plan's grep-0 criterion, which only covers playerCount) — the doc would otherwise still teach a key that no longer exists in generator output, violating CLIX-02's intent."

patterns-established:
  - "Scaffold-time config fields (ProjectConfig.playerCount) may remain internal generation parameters without being mirrored into emitted project files; only the single legitimate consumer (generateRulesIndexTs) writes the value."

requirements-completed: [CLIX-01, CLIX-02, PROC-02]

# Metrics
duration: 8min
completed: 2026-07-03
---

# Phase 135 Plan 03: Drop dual-authored playerCount + dead $schema from scaffold Summary

**Removed the duplicate `playerCount` JSON write and dead `$schema` URL from `generateBoardsmithJson`, leaving `generateRulesIndexTs`'s hardcoded `minPlayers`/`maxPlayers` as the sole player-count write site, with a RED-then-GREEN PROC-02 regression proving it.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-03T18:25:00Z
- **Completed:** 2026-07-03T18:25:53Z
- **Tasks:** 1 (TDD: RED -> GREEN)
- **Files modified:** 3

## Accomplishments
- `generateBoardsmithJson` no longer emits `playerCount` (dual-authorship removed — F9/CLIX-01 root cause) or the dead `https://boardsmith.io/schemas/game.json` `$schema` URL (CLIX-02)
- `generateRulesIndexTs` verified unchanged and confirmed the sole legitimate write site for `minPlayers`/`maxPlayers`
- PROC-02 regression added to `project-scaffold.test.ts`, proven RED against pre-fix code before the fix landed
- `docs/getting-started.md`'s `boardsmith.json` example brought back into sync with actual generator output (both `playerCount` — already absent per plan note — and `$schema`, found still present and removed as a same-scope deviation)

## Task Commits

Each task was committed atomically (TDD RED -> GREEN, plus a docs fix):

1. **Task 1 RED: add failing PROC-02 regression** - `d742481a` (test)
2. **Task 1 GREEN: drop playerCount/$schema from generateBoardsmithJson** - `198f0233` (feat)
3. **Task 1 docs sync: remove dead $schema line from getting-started.md** - `462e1cdd` (docs)

**Plan metadata:** (final commit follows this summary)

## Files Created/Modified
- `src/cli/lib/project-scaffold.ts` - Removed `$schema` and `playerCount` lines from `generateBoardsmithJson`'s emitted object literal; `generateRulesIndexTs` untouched
- `src/cli/lib/project-scaffold.test.ts` - Added PROC-02 regression: no `playerCount`/`$schema` keys in emitted JSON, `generateRulesIndexTs` still emits `minPlayers`/`maxPlayers`
- `docs/getting-started.md` - Removed the `"$schema": "https://boardsmith.io/schemas/game.json"` line from the `boardsmith.json` example (the `playerCount` key was already absent per the plan's pre-revision note)

## Decisions Made
- Removed the dead `$schema` reference from `docs/getting-started.md` even though the plan's acceptance criteria only specified a `grep -c playerCount` check. The doc example must match actual scaffold output (CLIX-02 intent); leaving a dead-URL `$schema` line in the doc after removing it from the generator would re-introduce the exact "teaches something that isn't real" problem this plan closes. Treated as a Rule 1 (bug — doc drifted out of sync with code) auto-fix, not an architectural change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed dead $schema line from docs/getting-started.md**
- **Found during:** Task 1 (post-implementation doc verification pass)
- **Issue:** The plan's `read_first` section for docs/getting-started.md noted the `playerCount` line was "already removed during plan revision," but did not check the `$schema` line, which was still present in the doc's `boardsmith.json` example and pointed to a URL that resolves to nothing.
- **Fix:** Removed the `"$schema": "https://boardsmith.io/schemas/game.json"` line from the example JSON block, matching the generator's actual output post-fix.
- **Files modified:** docs/getting-started.md
- **Verification:** `grep -c "boardsmith.io/schemas" docs/getting-started.md` returns 0
- **Committed in:** `462e1cdd`

---

**Total deviations:** 1 auto-fixed (1 bug — doc/code drift)
**Impact on plan:** Necessary for CLIX-02 correctness (doc no longer teaches a dead $schema reference). No scope creep — same file, same concern already in the plan's read_first list.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 04 (derive `playerCount` at build time via `loadGameDefinition` in `build.ts`'s manifest) and Plan 05 (reject leftover `playerCount` key in `validate.ts`) are unblocked — this plan's "delete the duplicate" half of CLIX-01 is complete.
- No blockers.

---
*Phase: 135-cli-dev-experience*
*Completed: 2026-07-03*

## Self-Check: PASSED
