---
phase: 114-go-fish-action-help-host-lockout
plan: "01"
subsystem: go-fish/authoring
tags: [action-help, go-fish, cross-repo, substrate-reuse]
dependency_graph:
  requires: [v4.1-phase-108-action-help-substrate]
  provides: [GFHELP-01]
  affects: [go-fish ask action, ActionMetadata.help propagation]
tech_stack:
  added: []
  patterns: [".help() builder on ActionDefinition (Phase 108 substrate reuse)"]
key_files:
  created:
    - ~/BoardSmithGames/go-fish/tests/action-help.test.ts
  modified:
    - ~/BoardSmithGames/go-fish/src/rules/actions.ts
key_decisions:
  - "ask is go-fish's only player action; draw is automatic inside execute(), so the auto-draw consequence is covered within ask help text — no draw action invented"
  - "help text placed immediately after .prompt() mirroring checkers' authoring pattern"
  - "TDD RED committed before GREEN to prove test is non-vacuous"
metrics:
  duration: "~3 minutes"
  completed: "2026-06-30"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  tests_added: 2
---

# Phase 114 Plan 01: GFHELP-01 — Ask Action Help Summary

One-liner: Added `.help()` to go-fish's `ask` action propagating the ask-and-draw consequence through `buildActionMetadata` to `ActionMetadata.help` for both AutoUI and the custom GameTable panel.

## What Was Built

Added one `.help(text)` call to `createAskAction` in `go-fish/src/rules/actions.ts`, placed immediately after `.prompt()`, mirroring the checkers authoring pattern. The help string covers both the ask and its automatic Go-Fish draw consequence in a single actionable sentence — no separate draw action exists or was invented. Verified propagation through an integration test that calls `buildActionMetadata` and asserts `metadata['ask'].help` equals the exact authored string.

**Help text authored:**
> Ask an opponent for a rank you already hold. If they have it they give you all of them and you go again; if not, you draw from the pond (Go Fish!).

## Tasks

### Task 2 RED (TDD): Integration test — failing state
Created `tests/action-help.test.ts` before adding `.help()` to confirm the test is non-vacuous. Both assertions failed with `expected undefined to be '...'` — proving the test genuinely detects the absence of `.help()`.

**Commit:** `000d026` (go-fish repo)

### Task 1 / Task 2 GREEN: Add .help() to ask action + test passes
Added single `.help()` call to `createAskAction`. Full go-fish suite: 65 tests pass (was 63; +2 new). BoardSmith suite: 1708 tests pass (no src/ changes).

**Commit:** `44d7d25` (go-fish repo)

## Verification

```
cd ~/BoardSmithGames/go-fish && grep -n '.help(' src/rules/actions.ts
35:    .help('Ask an opponent for a rank you already hold. If they have it they give you all of them and you go again; if not, you draw from the pond (Go Fish!).')

cd ~/BoardSmithGames/go-fish && npm test
Test Files  7 passed (7)
Tests  65 passed (65)

cd ~/BoardSmith && npm test
Test Files  123 passed (123)
Tests  1708 passed (1708)
```

## Deviations from Plan

None — plan executed exactly as written. TDD RED/GREEN cycle applied for Task 2 by writing the test before adding `.help()`, then committing GREEN after the implementation.

## TDD Gate Compliance

- `test(114-01)` commit (`000d026`) — RED gate: failing test committed before implementation
- `feat(114-01)` commit (`44d7d25`) — GREEN gate: implementation makes test pass

## Known Stubs

None.

## Threat Flags

None. Help text is static author-supplied UX copy with no secrets, PII, or implementation details (T-114-01 accepted per plan).

## Self-Check: PASSED

- [x] `go-fish/tests/action-help.test.ts` exists and passes
- [x] `go-fish/src/rules/actions.ts` contains `.help(` (line 35)
- [x] go-fish commit `000d026` (RED) exists in go-fish repo
- [x] go-fish commit `44d7d25` (GREEN) exists in go-fish repo
- [x] BoardSmith suite green (no src/ changes)
