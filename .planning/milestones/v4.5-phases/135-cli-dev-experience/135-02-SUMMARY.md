---
phase: 135-cli-dev-experience
plan: 02
subsystem: cli
tags: [commander, cli, dev-experience, cleanup]

# Dependency graph
requires:
  - phase: 135-01
    provides: PROC-01 verification gate confirming F32/F33 (CLIX-04/CLIX-05) as LEGITIMATE with current file:line evidence
provides:
  - Removal of the dead -t/--template flag from `boardsmith init` (cli.ts registration + InitOptions type)
  - Corrected --host help text stating the true (upcoming) default of 127.0.0.1
  - New --lan boolean flag registered on `boardsmith dev` as a --host 0.0.0.0 shorthand
affects: [135-06 (dev.ts consumes --lan/--host to implement default-127.0.0.1 + loud banner)]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - src/cli/cli.ts
    - src/cli/commands/init.ts
    - src/cli/commands/init.test.ts

key-decisions:
  - "InitOptions interface removed entirely rather than emptied -- template was its only field, so the type itself became dead weight; initCommand's signature dropped the now-unused options parameter"
  - "--host help text corrected to describe the Plan 06 target behavior (127.0.0.1 default) even though dev.ts itself still binds 0.0.0.0 until Plan 06 lands -- this plan only owns the commander registration surface, not runtime behavior"
  - "PROC-02 regression tests read cli.ts/init.ts source text directly (not import+introspect Commander's parsed option list) since cli.ts calls program.parse() at module-load time and cannot be safely imported in a test process"

patterns-established:
  - "Source-text regression tests for CLI flag registration: when a CLI entrypoint executes program.parse() at import time, pin flag presence/absence via readFileSync text assertions scoped to the specific .command() block rather than importing the module"

requirements-completed: [CLIX-04, CLIX-05, PROC-02]

# Metrics
duration: 8min
completed: 2026-07-03
---

# Phase 135 Plan 02: CLI Option Surface Cleanup Summary

**Removed the silently-ignored `-t/--template` flag from `boardsmith init` and corrected `boardsmith dev --host`'s misleading help text while registering a new `--lan` shorthand flag.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-03T18:20:59Z
- **Completed:** 2026-07-03T18:21:55Z
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- `-t/--template` fully removed from both `cli.ts`'s init command registration and `InitOptions` (F33/CLIX-05) — a RED-proven PROC-02 regression pins the removal so it can't silently reappear
- `--host` help text no longer implies a 0.0.0.0 default; it now states the true target default (127.0.0.1) and names `--lan`/`--host 0.0.0.0` as the explicit LAN opt-in
- `--lan` boolean flag registered on `boardsmith dev`, following the existing `--lock-teaching` boolean style, with plain-language security framing ("serves to your whole network")

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove -t/--template from cli.ts and InitOptions (CLIX-05)** - `9593324c` (fix)
2. **Task 2: Correct --host help text and register --lan shorthand (CLIX-04 registration)** - `c50d5fbb` (fix)

**Plan metadata:** (pending — this commit)

_Note: Task 1 followed the RED-first PROC-02 discipline within a single commit — the regression test was run RED against pre-fix source, confirmed failing, then the fix was applied and the same test run GREEN, all before staging. See "RED Test Evidence" below._

## Files Created/Modified
- `src/cli/cli.ts` - Removed init's `-t/--template` option; corrected dev's `--host` help text; added `--lan` boolean flag
- `src/cli/commands/init.ts` - Removed the `InitOptions` interface (template was its only field) and the now-unused `options` parameter on `initCommand`
- `src/cli/commands/init.test.ts` - Added a `describe('init command — no -t/--template surface (CLIX-05 / F33)')` block with 3 PROC-02 regression tests

## RED Test Evidence (PROC-02)

Ran `npx vitest run src/cli/commands/init.test.ts` against pre-fix source (flag/field still present). Two of the three new tests failed as expected:

```
FAIL init command — no -t/--template surface (CLIX-05 / F33) > does not register -t/--template on the init command in cli.ts
  expect(initBlock).not.toContain('--template')
  + .option('-t, --template <template>', 'Template to use (default: card-game)', 'card-game')

FAIL init command — no -t/--template surface (CLIX-05 / F33) > InitOptions has no template field in init.ts
  expected 'interface InitOptions {\n  template: …' not to contain 'template'
```

`Tests 2 failed | 7 passed (9)` — confirming RED before any fix code was written. After applying the fix, the same file was re-run: `Tests 9 passed (9)`.

## Decisions Made
- `InitOptions` interface deleted outright rather than emptied, since `template` was its sole field and `initCommand` never needed an options parameter for anything else. `initCommand(name: string, options: InitOptions)` became `initCommand(name: string)`.
- `--host` help text describes the target behavior owned by Plan 06 (default 127.0.0.1) even though `dev.ts:283` still hardcodes `0.0.0.0 ?? options.host` today — this plan's scope is strictly the commander registration surface (help copy + flag presence) per the plan's stated boundary ("Do not implement resolution/banner behavior here — dev.ts (Plan 06) consumes options.lan/options.host").
- PROC-02 regression style: because `cli.ts` calls `program.parse()` at module top level (a real CLI entrypoint, not a pure export), the regression tests read the raw source text via `readFileSync` and scope assertions to specific `.command()`/`interface` blocks rather than importing and introspecting a live `Command` instance. This avoids accidentally invoking `program.parse()` inside the test process while still pinning the exact registration surface.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `<action>` and `<acceptance_criteria>` blocks; no Rule 1-4 triggers encountered.

## Issues Encountered

One test-design iteration during Task 1: the first version of the "InitOptions has no template field" test assumed the interface would remain (just without `template`), so it looked for `interface InitOptions` and failed once the interface was deleted entirely (the correct, more thorough fix per the plan's "InitOptions has no template field" must-have). Adjusted the test to assert absence of both `template` and `InitOptions` from the file entirely, which better matches the actual (correct) outcome. This was a same-task test-writing correction, not a deviation from plan scope.

## Next Phase Readiness

Plan 06 can now safely wire `options.lan`/`options.host` resolution logic in `dev.ts` against the registration surface this plan established — the `--lan` flag exists, and the `--host` help text already documents the target default (127.0.0.1) that Plan 06 will implement at runtime. No blockers.

---
*Phase: 135-cli-dev-experience*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: 9593324c (Task 1 commit)
- FOUND: c50d5fbb (Task 2 commit)
- FOUND: src/cli/cli.ts
- FOUND: .planning/phases/135-cli-dev-experience/135-02-SUMMARY.md
