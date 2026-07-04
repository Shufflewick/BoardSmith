---
phase: 135-cli-dev-experience
plan: 05
subsystem: cli
tags: [validate, config-schema, boardsmith.json, levenshtein, bundle-size, json-schema]

# Dependency graph
requires:
  - phase: 135-01
    provides: PROC-01 verification gate confirming F9/F21/F22 as LEGITIMATE findings with current-HEAD file:line evidence
provides:
  - "src/cli/lib/boardsmith.schema.json — single-source JSON Schema listing every legitimate top-level boardsmith.json key"
  - "src/cli/lib/config-schema.ts — ALLOWED_TOP_LEVEL_KEYS/suggestKey/findUnknownKeys, consumed by validate.ts (this plan) and dev.ts (Plan 06)"
  - "src/cli/lib/bundle-limits.ts — MAX_BUNDLE_SIZE = 50MB shared constant"
  - "validate.ts rejects unknown top-level keys (did-you-mean) and a leftover playerCount key (migration message)"
  - "validate.ts bundle-size check now matches the real 50MB server gate instead of a stale 200MB"
affects: [135-06 (dev.ts startup warning consumes config-schema.findUnknownKeys; also collapses the minPlayers/maxPlayers fallback chain)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure exported check functions (checkMetadataIssues, mirroring build.ts's deriveManifest) for direct unit-testing without touching the filesystem or process.exit"
    - "Hand-rolled classic-DP levenshitein + allowed-key-set derived from a shipped JSON Schema file, single source of truth (no new dependency)"

key-files:
  created:
    - src/cli/lib/boardsmith.schema.json
    - src/cli/lib/config-schema.ts
    - src/cli/lib/bundle-limits.ts
    - src/cli/commands/validate.test.ts
  modified:
    - src/cli/commands/validate.ts

key-decisions:
  - "Allowed-key set enumerated from actual file:line read sites across validate.ts, build.ts, dev.ts, and publish.ts (not just validate.ts/build.ts) — gameOptions/playerOptions/colorPalette/paths/gameId/version are all legitimately read by dev.ts or publish.ts today and would false-positive as unknown keys if omitted"
  - "minPlayers/maxPlayers are NOT in the allowed-key set — CLIX-01's locked decision is gameDefinition as the SOLE source of truth for player count, and Plan 06 collapses dev.ts's config.playerCount/config.minPlayers/config.maxPlayers fallback chain to a single gameDefinition read"
  - "Dropped the dead $schema URL entirely (RESEARCH.md Open Question 2, discretion) rather than shipping an editor-resolvable path — the hand-rolled validator is the sole enforcement mechanism per CONTEXT.md's sanctioned approach"
  - "Extracted checkMetadataIssues as an exported pure function (parsed-config in, issues-array out) so unknown-key/playerCount-migration/required-field behavior is unit-testable without a real boardsmith.json on disk, mirroring build.ts's existing deriveManifest pattern"
  - "levenshtein kept internal (not exported) after npm run audit:dead-code flagged it as an unused export — only ALLOWED_TOP_LEVEL_KEYS/suggestKey/findUnknownKeys are the Plan 06 interface contract"

requirements-completed: [CLIX-01, CLIX-02, CLIX-03, PROC-02]

# Metrics
duration: 20min
completed: 2026-07-03
---

# Phase 135 Plan 05: Config Validation Hardening Summary

**`boardsmith validate` now rejects unknown/misspelled top-level `boardsmith.json` keys with a hand-rolled did-you-mean suggestion, rejects a leftover `playerCount` key with a migration message, and enforces the real 50MB bundle-size limit instead of a stale 200MB — all sourced from one shipped schema file and one shared constant.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- Shipped `boardsmith.schema.json` as the single source of legitimate top-level `boardsmith.json` keys (draft-07, `additionalProperties: false`), enumerated from real file:line read sites across `validate.ts`, `build.ts`, `dev.ts`, and `publish.ts` — `playerCount` deliberately excluded.
- Built `config-schema.ts` with a hand-rolled classic-DP levenshtein, `suggestKey`, and `findUnknownKeys` — no new dependency, derived from the schema so the two files can never drift.
- Wired unknown-key rejection (with did-you-mean) and a pointed `playerCount` migration message into `validate.ts`'s metadata check, removing the now-dead `playerCount` required-field and min/max shape checks.
- Fixed the bundle-size validator's 200MB constant (4x too permissive, disagreed with its own 50MB comment) via a new shared `bundle-limits.ts` module that also documents the authoritative external gate it mirrors.
- Added `validate.test.ts` (zero prior coverage) with 12 RED-first regressions covering all three fixes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Ship boardsmith.schema.json + hand-rolled config-schema.ts** - `ed30453e` (feat)
2. **Task 2: Wire unknown-key rejection + playerCount migration into validate.ts** - `654c4a8f` (feat)
3. **Task 3: Single 50MB bundle-size constant** - `48bda2f9` (fix)
4. Dead-code hygiene follow-up (un-export `levenshtein`) - `b18fe7a4` (fix)

**Plan metadata:** (this commit)

_Note: TDD RED evidence recorded per task below (PROC-02); no separate test→feat commit split was used because each task's test additions and implementation were verified RED before being made GREEN and committed together, consistent with the plan's `tdd="true"` task-level (not micro-commit-level) granularity._

## Files Created/Modified
- `src/cli/lib/boardsmith.schema.json` - Shipped JSON Schema; single source of the allowed top-level key set
- `src/cli/lib/config-schema.ts` - `ALLOWED_TOP_LEVEL_KEYS`, `suggestKey`, `findUnknownKeys` (internal `levenshtein` helper)
- `src/cli/lib/bundle-limits.ts` - `MAX_BUNDLE_SIZE = 50 * 1024 * 1024`, the single source mirroring the games-worker gate
- `src/cli/commands/validate.ts` - New `checkMetadataIssues` export wired with unknown-key + playerCount-migration checks; bundle-size check now imports `MAX_BUNDLE_SIZE`
- `src/cli/commands/validate.test.ts` - New file, 12 tests covering config-schema, checkMetadataIssues, and bundle-limits

## RED Evidence (PROC-02)

- **Task 1:** Before `boardsmith.schema.json`/`config-schema.ts` existed, `validate.test.ts` importing `ALLOWED_TOP_LEVEL_KEYS`/`suggestKey`/`findUnknownKeys` failed to load (`Failed to load url ../lib/config-schema.js`). Confirmed RED, then created the modules and the file loaded/passed GREEN (6/6 tests).
- **Task 2:** Before `checkMetadataIssues` was exported from `validate.ts`, the new `checkMetadataIssues`-based tests failed with `TypeError: checkMetadataIssues is not a function` (5 failing tests, including the explicit "pre-fix validate silently PASSES a config carrying an unknown key / playerCount" PROC-02 regression). Confirmed RED, then wired the check and all 11 tests passed GREEN.
- **Task 3:** Before `bundle-limits.ts` existed, the whole test file failed to load (`Failed to load url ../lib/bundle-limits.js`). Confirmed RED, then created the module and imported it into `validate.ts`; all 12 tests passed GREEN.

## Decisions Made

See frontmatter `key-decisions`. Most consequential: the allowed-key set had to be enumerated from ALL real read sites (validate.ts + build.ts + dev.ts + publish.ts), not just validate.ts/build.ts as the plan's `<read_first>` narrowly suggested — omitting `gameOptions`/`playerOptions`/`colorPalette`/`paths`/`gameId`/`version` would have made `boardsmith validate` reject every real project using those (already-shipped, already-consumed) features as soon as Plan 06 wires the same schema into `dev.ts`'s startup warning. Verified each key's legitimacy via direct `grep`/read of the actual consuming code before adding it to the schema.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Un-exported `levenshtein` after dead-code audit**
- **Found during:** Post-Task-3 `npm run audit:dead-code` (CLAUDE.md-mandated check after significant refactors)
- **Issue:** `levenshtein` was exported from `config-schema.ts` but has no consumers outside the module (only `suggestKey` uses it internally); `npx fallow` flagged it as an unused export
- **Fix:** Changed `export function levenshtein` to `function levenshtein` (module-internal)
- **Files modified:** `src/cli/lib/config-schema.ts`
- **Verification:** `npx tsc --noEmit` clean, `validate.test.ts` still 12/12 green
- **Committed in:** `b18fe7a4`

---

**Total deviations:** 1 auto-fixed (1 dead-code hygiene)
**Impact on plan:** No scope creep — the plan's stated public interface (`ALLOWED_TOP_LEVEL_KEYS`, `suggestKey`, `findUnknownKeys`) is unaffected; only an incidental over-export was tightened.

## Issues Encountered

None beyond the allowed-key-set enumeration decision documented above.

## Verification

- `npx vitest run src/cli/commands/validate.test.ts --reporter=dot` — 12/12 passed
- `npx vitest run src/cli/ --reporter=dot` — 15 files / 143 tests passed (no regressions in the CLI subsystem)
- `npx vitest run --reporter=dot` (full repo) — 171 files / 2252 tests passed
- `npx tsc --noEmit` — no new errors (pre-existing unrelated `src/ui/*` errors untouched by this plan confirmed present before this plan's changes)
- `grep -n "200 \* 1024" src/cli/commands/validate.ts` — no matches (acceptance criterion met)
- `grep -n "playerCount" src/cli/commands/validate.ts` — only appears in the new migration-message string/comments, no required-list entry or min/max checks (acceptance criterion met)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 06 (`dev.ts` hardening) can now import `findUnknownKeys` from `src/cli/lib/config-schema.ts` for its startup unknown-key warning, and collapse `dev.ts`'s three-way `minPlayers`/`maxPlayers` fallback chain to a single `gameDefinition` read — `config.playerCount`/`config.minPlayers`/`config.maxPlayers` are no longer part of the allowed-key set this plan shipped, so that collapse will not introduce a new unknown-key false-positive. No blockers.

## Self-Check: PASSED

All created/modified files verified present on disk; all 4 task commit hashes (ed30453e, 654c4a8f, 48bda2f9, b18fe7a4) verified present in git log.

---
*Phase: 135-cli-dev-experience*
*Completed: 2026-07-03*
