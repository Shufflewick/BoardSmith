---
phase: 144-bs-build-chunk-build-test-ui-floor
plan: 02
subsystem: cli
tags: [scaffold, a11y, axe-core, vitest, tdd]

# Dependency graph
requires:
  - phase: 144-bs-build-chunk-build-test-ui-floor
    plan: 01
    provides: build-chunk.test.ts drift-pin scaffolding referencing UIQ-03
provides:
  - "axe-core ^4.12.1 devDependency in generated game package.json"
  - "@vue/test-utils ^2.4.11 devDependency in generated game package.json"
  - "generateA11yExampleTestTs() generator producing tests/a11y.example.test.ts"
  - "tests/a11y.example.test.ts entry wired into generateScaffoldFiles()"
affects: [144-03, 144-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "axe-core scan pattern (mount + axe.run(wrapper.element) + expect(violations).toEqual([])) as the copyable a11y-floor precedent for every future UI chunk (UIQ-03)"

key-files:
  created: []
  modified:
    - src/cli/lib/project-scaffold.ts
    - src/cli/lib/project-scaffold.test.ts

key-decisions:
  - "axe-core and @vue/test-utils added ONLY inside generatePackageJson()'s returned template-string literal — never installed into BoardSmith's own repo"
  - "generateA11yExampleTestTs() modeled directly on generateGameTableVue()'s doc-commented string-template generator shape"

requirements-completed: [UIQ-03]

# Metrics
duration: 8min
completed: 2026-07-04
---

# Phase 144 Plan 02: axe-core + @vue/test-utils Scaffold Devdeps + a11y Example Harness Summary

**Added `axe-core` + `@vue/test-utils` devDependencies and a new `generateA11yExampleTestTs()` generator (wired as `tests/a11y.example.test.ts`) to the `boardsmith init` scaffold template, giving every generated game a runnable, copyable a11y-floor precedent — the one real library change of Phase 144.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-04T22:37:00Z
- **Completed:** 2026-07-04T22:45:00Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments

- `generatePackageJson()` devDependencies now include `'axe-core': '^4.12.1'` and `'@vue/test-utils': '^2.4.11'`
- New `generateA11yExampleTestTs()` generator emits `tests/a11y.example.test.ts`: mounts the scaffold's own `GameTable.vue` with `@vue/test-utils`, runs `axe.run(wrapper.element)`, asserts `results.violations` is empty, under the `// @vitest-environment jsdom` pragma
- `generateScaffoldFiles()` wires in the new `{ path: 'tests/a11y.example.test.ts', content: generateA11yExampleTestTs() }` entry
- `project-scaffold.test.ts` extended with two new describe blocks (`generatePackageJson — axe-core scaffold devDependency`, `generateScaffoldFiles — a11y example test harness`) asserting the devDeps, the file entry, and its `axe.run(`/`axe-core` import content
- Full RED → GREEN TDD cycle: Task 1 committed the failing assertions, Task 2 landed the implementation and turned the suite green
- Hard gate verified: `git status --short package.json package-lock.json` is empty and `grep -c axe-core package.json` (BoardSmith's own repo root) is 0 — no install was ever run against BoardSmith's own manifests

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — assert axe-core devDep + a11y example harness in scaffold output** - `12f67cec` (test)
2. **Task 2: GREEN — add axe-core devDep, @vue/test-utils, and the a11y example generator** - `a57dcb63` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/cli/lib/project-scaffold.ts` - Added `axe-core`/`@vue/test-utils` devDeps to `generatePackageJson()`; added `generateA11yExampleTestTs()`; wired the new file into `generateScaffoldFiles()`
- `src/cli/lib/project-scaffold.test.ts` - Extended import block + two new describe blocks asserting the devDeps and the a11y example harness content

## Decisions Made

None beyond what's recorded in 144-PATTERNS.md — followed the plan's verbatim generator shape, devDep versions (already package-legitimacy-audited in 144-RESEARCH.md), and `GeneratedFile` entry placement (before `.gitignore`).

## Deviations from Plan

None - plan executed exactly as written.

## TDD Gate Compliance

- RED gate: `test(144-02): add failing test for axe-core devDep + a11y example harness` (`12f67cec`) — confirmed 3 failing assertions before implementation existed.
- GREEN gate: `feat(144-02): add axe-core + @vue/test-utils devDeps and a11y example harness` (`a57dcb63`) — confirmed all 20 tests in `project-scaffold.test.ts` pass afterward.
- No REFACTOR commit needed (clean implementation, no cleanup required).

## Issues Encountered

- `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` shows 16 pre-existing failures unrelated to this plan's scope (it references `build/build.md`, `build/test.md`, `build/design-ask.md` which are Plans 03/04's territory, not Plan 02's `files_modified`). Confirmed via `git show 157c3fde --stat` these failures predate this plan (introduced by Plan 01's drift-pin scaffolding, intentionally RED until Plans 03/04 land). Logged here per scope-boundary rule; not fixed.

## User Setup Required

None - no external service configuration required. Generated games' own `npm install` step (run by the game developer, not by BoardSmith's own tooling) will pick up the new `axe-core`/`@vue/test-utils` devDependencies.

## Next Phase Readiness

- Plans 03/04 (authoring `build/build.md`, `build/test.md`, `build/design-ask.md`, and the `build/ask.md` hook edit) can now cite this scaffold's `axe-core` scan pattern verbatim as the UIQ-03 a11y-floor precedent every UI chunk's test copies.
- No blockers.

---
*Phase: 144-bs-build-chunk-build-test-ui-floor*
*Completed: 2026-07-04*

## Self-Check: PASSED

- FOUND: src/cli/lib/project-scaffold.ts
- FOUND: src/cli/lib/project-scaffold.test.ts
- FOUND commit: 12f67cec
- FOUND commit: a57dcb63
