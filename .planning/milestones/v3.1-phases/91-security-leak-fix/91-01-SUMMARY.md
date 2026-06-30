---
phase: 91-security-leak-fix
plan: "01"
subsystem: engine/element
tags: [security, test, red, SEC-01, SEC-02, image-leak, toJSONForPlayer]
dependency_graph:
  requires: []
  provides: [SEC-01-proof, SEC-02-proof, image-leak-regression-guard]
  affects: [src/engine/element/game.ts]
tech_stack:
  added: []
  patterns: [vitest-red-green, prove-before-fix]
key_files:
  created:
    - src/engine/element/image-leak.test.ts
  modified: []
decisions:
  - "Three leaking surfaces confirmed: contentsHidden() deck children (game.ts:2244-2258), contentsVisibleToOwner() hand non-owner children (game.ts:2265-2287), contentsCountOnly() zone children (same anonymous loop at game.ts:2236)"
  - "back key in $images must survive redaction so renderer can draw face-down cards (Pitfall 2 guard embedded in test)"
  - "collectAllHiddenAttrs recursive walker added as a regression guard to catch any future hidden-surface leaks in a single sweep"
  - "Tasks 1 and 2 committed together (single test file) because all assertions co-evolve: the SEC-02 allowlist/fail-safe tests reinforce the same fixture and complement the SEC-01 face-leak assertions"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-21T04:17:15Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 0
---

# Phase 91 Plan 01: SEC-01/SEC-02 Image Leak Proof Tests (RED) Summary

**One-liner:** Failing vitest proof of `$images.face` leak in `toJSONForPlayer` across all three hidden-element branches, plus SEC-02 unknown-`$`-key and `$image` fail-safe assertions and a recursive regression guard.

## What Was Built

Created `src/engine/element/image-leak.test.ts` — a focused unit test file that proves the information leak documented in SEC-01 and SEC-02. The file is intentionally committed in a **RED (failing)** state; it documents the bug before Plan 02 applies the fix.

### Test coverage

| Surface | Code path | Assertion |
|---------|-----------|-----------|
| `contentsHidden()` deck child | `game.ts:2244-2258` anonymous loop | `$images.face` absent, `$images.back` present |
| `contentsVisibleToOwner()` hand child — non-owner viewer | `game.ts:2265-2287` anonymous loop | `$images.face` absent, `$images.back` present |
| `contentsCountOnly()` zone child (Pitfall 1) | `game.ts:2236` same anonymous loop | `$images.face` absent, `$images.back` present |
| Owner sees face (sanity check) | normal path | `$images.face` present, `__hidden` absent |
| SEC-02: `$image` single-sided drop | any hidden branch | `$image` absent |
| SEC-02: unknown `$secretValue` fail-safe | any hidden branch | `$secretValue` absent |
| SEC-02: safe layout keys survive | any hidden branch | `$type` and `$direction` present |
| Regression guard (`collectAllHiddenAttrs`) | full player-2 tree | no `$images.face` or `$image` on any `__hidden` attrs object |

### Red state confirmed

```
Test Files  1 failed | 7 passed (8)
Tests       5 failed | 143 passed (148)
```

All 5 failing assertions fail on **surviving `$images.face` or `$image`** on `__hidden` elements — exactly the leak being proven. No failures are fixture/compile errors.

The 7 existing test files (143 tests) remain **green** — the new file is the only red one.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. This plan creates only test code; no stubs or fallbacks.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check

- [x] `src/engine/element/image-leak.test.ts` exists at the expected path
- [x] Commit `6744b01` verified in git log
- [x] `npx vitest run src/engine/element/image-leak.test.ts` exits non-zero (5 failures, all leak assertions)
- [x] `npx vitest run src/engine/element/` — 7 other files still green (143 passing tests)
- [x] No `eslint-disable` directives added
- [x] No external game packages imported — engine-only imports only

## Self-Check: PASSED
