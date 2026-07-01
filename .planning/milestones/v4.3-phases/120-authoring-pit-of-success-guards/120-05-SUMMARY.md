---
phase: 120-authoring-pit-of-success-guards
plan: 05
subsystem: eslint-plugin
tags: [eslint, static-analysis, game-authoring, gameelement, syntactic-heuristic]

# Dependency graph
requires:
  - phase: 120-authoring-pit-of-success-guards
    provides: "plan 120-04's RuleTester harness convention (plain eslint RuleTester + @typescript-eslint/parser, no new dependency) and index.ts registration pattern"
provides:
  - "boardsmith/no-element-array-state ESLint rule: flags GameElement[]-typed class fields on non-GameElement classes, and this.<prop> = <recv>.all()/.first()/.firstN()/.last()/.lastN() persisted onto class properties"
  - "RuleTester valid/invalid fixtures for the new rule, including a documented false-negative bound"
  - "Second PIT-04 rule registered in plugin.rules + boardsmith/recommended, alongside plan 120-04's no-element-identity-comparison"
affects: [121-example-game-verification, eslint-plugin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Syntactic-only ESLint rules with documented false-positive/negative bounds in JSDoc (no type info, parserOptions.project: false)"
    - "Same-file class-hierarchy resolution via transitive fixed-point walk over ClassDeclaration superClass names"

key-files:
  created:
    - src/eslint-plugin/rules/no-element-array-state.ts
    - src/eslint-plugin/rules/no-element-array-state.test.ts
  modified:
    - src/eslint-plugin/index.ts

key-decisions:
  - "No fixer provided: correct rewrite (query-at-point-of-use vs. store-IDs) is intent-dependent and requires a human decision, per plan interface spec"
  - "Reused plan 120-04's RuleTester harness verbatim (plain eslint RuleTester + @typescript-eslint/parser) — no @typescript-eslint/rule-tester dependency added"
  - "index.ts edit made additive (single import line + single map/config entry each) to avoid disturbing plan 120-04's no-element-identity-comparison registration"

patterns-established:
  - "Two-rule PIT-04 pair now both live under boardsmith/recommended with matching syntactic-heuristic documentation style"

requirements-completed: [PIT-04]

# Metrics
duration: 12min
completed: 2026-07-01
---

# Phase 120 Plan 05: no-element-array-state ESLint rule Summary

**Syntactic ESLint rule flagging GameElement[]-as-class-state and persisted game.all()/first() query results, registered under boardsmith/recommended alongside no-element-identity-comparison**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-01T04:27:56Z
- **Completed:** 2026-07-01T04:40:00Z (approx)
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- Added `boardsmith/no-element-array-state`, a syntactic-only ESLint rule catching two footgun shapes: (1) `GameElement[]`-typed class fields on classes that are not themselves GameElement subclasses, and (2) `this.<prop> = <recv>.all()/.first()/.firstN()/.last()/.lastN()` — persisting a query result onto a class property.
- Rule intentionally does NOT flag point-of-use locals (a collection call assigned to a local variable and used/discarded within a method).
- No auto-fixer: the correct rewrite depends on author intent (re-query vs. store IDs), so the rule reports only.
- Registered the rule in `src/eslint-plugin/index.ts` additively — both `no-element-identity-comparison` (plan 120-04) and `no-element-array-state` (this plan) are present in `plugin.rules` and `plugin.configs.recommended.rules`.

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1: no-element-array-state RuleTester fixtures (RED)** - `256ddf5` (test)
2. **Task 2: Implement no-element-array-state + register in index.ts (GREEN)** - `3c6f014` (feat)

_No refactor commit needed — implementation passed on first attempt with no cleanup required._

## Files Created/Modified
- `src/eslint-plugin/rules/no-element-array-state.ts` - The rule implementation (syntactic, no fixer), with JSDoc documenting the heuristic and accepted false-pos/neg bounds
- `src/eslint-plugin/rules/no-element-array-state.test.ts` - RuleTester valid/invalid fixtures reusing the plan-04 harness convention
- `src/eslint-plugin/index.ts` - Added import, `plugin.rules` entry, and `plugin.configs.recommended.rules` entry for the new rule (additive edit; plan-04's entry untouched)

## Decisions Made
- Reused the exact RuleTester setup from plan 120-04 (`eslint`'s built-in `RuleTester` + `@typescript-eslint/parser` via `languageOptions.parser`) — confirmed no new dependency was introduced (`grep -n "rule-tester" package.json` returns empty).
- Rule reports on the shape of `.all()`/`.first()`/`.firstN()`/`.last()`/`.lastN()` calls assigned to `this.<prop>` regardless of receiver's declared type — this doesn't require type info and catches the assignment pattern broadly, while still respecting the point-of-use exemption (locals are never matched since the AssignmentExpression/PropertyDefinition target must resolve to `this.*` or be a class field itself).
- Field-type detection (`GameElement[]`-typed field) reuses the same same-file transitive class-hierarchy walk as plan 120-04's rule, for consistency and to avoid duplicating divergent heuristics.

## Deviations from Plan

None - plan executed exactly as written. Both tasks completed as specified: RED fixtures first (confirmed failing because the rule module did not yet exist), then GREEN implementation + registration.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both PIT-04 rules (`no-element-identity-comparison`, `no-element-array-state`) are live under `boardsmith/recommended`, tested (14 tests total across both rule test files), and registered without disturbing each other's entries.
- `npx vitest run src/eslint-plugin` green (2 test files, 14 tests).
- `npm test` full suite green (138 files, 1865 tests).
- No new dependency added; `@typescript-eslint/rule-tester` remains absent from package.json.
- Ready for Phase 121 (example-game verification) to exercise both rules against real game source.

## Self-Check: PASSED
- FOUND: src/eslint-plugin/rules/no-element-array-state.ts
- FOUND: src/eslint-plugin/rules/no-element-array-state.test.ts
- FOUND: .planning/phases/120-authoring-pit-of-success-guards/120-05-SUMMARY.md
- FOUND: commit 256ddf5 (test)
- FOUND: commit 3c6f014 (feat)

---
*Phase: 120-authoring-pit-of-success-guards*
*Completed: 2026-07-01*
