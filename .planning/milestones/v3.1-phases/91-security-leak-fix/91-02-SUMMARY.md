---
phase: 91-security-leak-fix
plan: "02"
subsystem: engine/element
tags: [security, fix, SEC-01, SEC-02, image-leak, toJSONForPlayer, redactHiddenElementAttrs]
dependency_graph:
  requires: [SEC-01-proof, SEC-02-proof]
  provides: [SEC-01-fix, SEC-02-fix, image-leak-closed]
  affects: [src/engine/element/game.ts]
tech_stack:
  added: []
  patterns: [allowlist-redaction, module-private-helper, secure-by-default]
key_files:
  created: []
  modified:
    - src/engine/element/game.ts
decisions:
  - "SAFE_LAYOUT_KEYS and redactHiddenElementAttrs placed at module level (not class methods, not exported) for pure function semantics and co-location near Game class"
  - "redactHiddenElementAttrs is REDACT-ONLY: does not inject __hidden or childCount — each branch seeds its own shape contract"
  - "Branch 1 (count-only container): keeps childCount, no __hidden — shape unchanged beyond $-redaction"
  - "Branches 2 and 3 (zone children): seed { __hidden: true } at call site and spread redacted attrs — exactly as before except identity-bearing keys removed"
  - "Fully-hidden placeholder branch ({ __hidden: true } only) left byte-for-byte unchanged per plan"
  - "Pre-existing useActionController test failure confirmed as out-of-scope (already failing before this change)"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-21T04:26:12Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 1
---

# Phase 91 Plan 02: Close $images.face/$image Leak in toJSONForPlayer Summary

**One-liner:** Module-private `redactHiddenElementAttrs` helper with 18-key `SAFE_LAYOUT_KEYS` allowlist replaces three blanket `key.startsWith('$')` loops in `toJSONForPlayer`, ensuring hidden elements ship only `$images.back` (no `face`), never `$image`, and no unknown `$`-keys.

## What Was Built

### Helper: `redactHiddenElementAttrs` (module-private, `src/engine/element/game.ts:260`)

A pure module-level function (not exported, not a class method) that implements the redaction rule for hidden-element serialization:

| Input key | Output |
|-----------|--------|
| `$image` | dropped unconditionally (single-sided — always identity-bearing) |
| `$images` | `{ back }` only if `back` key present; omit entirely otherwise |
| Any key in `SAFE_LAYOUT_KEYS` | copied through |
| Unknown `$`-keys | dropped (fail-safe) |
| Non-`$` keys | dropped (callers seed `__hidden`/`childCount` themselves) |

### Constant: `SAFE_LAYOUT_KEYS` (module-private, `src/engine/element/game.ts:238`)

Explicit set of 18 verified-safe layout descriptor `$`-keys: `$type`, `$layout`, `$direction`, `$gap`, `$overlap`, `$fan`, `$fanAngle`, `$align`, `$rowLabels`, `$columnLabels`, `$rowCoord`, `$colCoord`, `$hexOrientation`, `$coordSystem`, `$qCoord`, `$rCoord`, `$sCoord`, `$hexSize`.

### Three patched branches in `toJSONForPlayer`

| Branch | Location | Before | After |
|--------|----------|--------|-------|
| 1: count-only container | ~2266 | manual `key.startsWith('$')` loop | `redactHiddenElementAttrs(json.attributes ?? {})` |
| 2: zone hidden/count-only children | ~2302 | manual loop | `{ __hidden: true, ...redactHiddenElementAttrs(childJson.attributes ?? {}) }` |
| 3: owner-only zone non-owner children | ~2322 | manual loop | `{ __hidden: true, ...redactHiddenElementAttrs(childJson.attributes ?? {}) }` |

The fully-hidden placeholder branch (~2277: `{ __hidden: true }` only) is byte-for-byte unchanged.

## Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `image-leak.test.ts` (SEC-01/SEC-02 proof) | 6 | All green (was 5 RED) |
| `deck-hand-visibility.test.ts` (F32 regression) | 3 | Green |
| `game-element.test.ts` (serialization regression) | 65 | Green |
| Full element suite (`src/engine/element/`) | 148 | Green |
| Full vitest suite | 817 passing, 1 pre-existing failure | Green (pre-existing failure unrelated) |

The one full-suite failure (`src/ui/composables/useActionController.test.ts` — `followUp + skip + auto-execute`) was confirmed pre-existing before this change (verified by stashing game.ts and re-running). Out of scope.

## Acceptance Criteria Verification

- `grep -n "redactHiddenElementAttrs" src/engine/element/game.ts` — 1 definition + 3 call sites (+ 1 JSDoc comment reference) = 5 grep hits, 4 functional occurrences
- `grep -c "key.startsWith('$')" src/engine/element/game.ts` — returns **0** (all blanket loops removed)
- `npx vitest run src/engine/element/image-leak.test.ts` — **6/6 PASS** (Plan 01 red test is now green)
- Helper is file-private (no `export`), not a class method (module-level function)
- Helper body contains no `__hidden`, `childCount`, `isVisibleTo`, or `faceUp`
- Branch 1 still returns `childCount` and does NOT introduce `__hidden`
- Branches 2 and 3 still seed `__hidden: true` at the call site
- Fully-hidden placeholder branch (`{ __hidden: true }` only) is unchanged

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Production code only; no stubs or fallbacks.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The only change is within the existing `toJSONForPlayer` serialization filter.

## Self-Check

- [x] `src/engine/element/game.ts` modified at the expected locations
- [x] Commit `e5b651b` verified in git log
- [x] `npx vitest run src/engine/element/image-leak.test.ts` exits 0 (6/6 green)
- [x] `npx vitest run src/engine/element/` — 148 tests all green
- [x] `grep -c "key.startsWith('\$')"` returns 0
- [x] Helper is not exported, not a class method
- [x] Pre-existing useActionController failure confirmed unrelated

## Self-Check: PASSED
