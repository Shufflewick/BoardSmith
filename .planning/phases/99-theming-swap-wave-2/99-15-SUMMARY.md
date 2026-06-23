---
phase: 99-theming-swap-wave-2
plan: 15
subsystem: ui
tags: [stylelint, css, theming, slate, color-no-hex, tokens]

requires:
  - phase: 99-theming-swap-wave-2
    provides: All Wave 2 sweep plans (99-02 through 99-14) migrating neon hex literals to --bsg-* tokens

provides:
  - ".stylelintrc.cjs with ignoreFiles: [] — zero exclusions, color-no-hex fully blocking"
  - "Proof: npm run lint:css green across all src/ui/**/*.vue with no suppressions"
  - "Proof: residual-neon grep (src/ui + src/cli/dev-host) returns zero matches"
  - "Full test suite green at 993 passing tests"

affects: [phase-100, phase-101, phase-102, phase-103]

tech-stack:
  added: []
  patterns:
    - "color-no-hex enforced with zero ignoreFiles — token discipline locked in permanently"

key-files:
  created: []
  modified:
    - ".stylelintrc.cjs"

key-decisions:
  - "ignoreFiles ends empty — no backward-compatibility exceptions; all files must use --bsg-* tokens"
  - "TEMPORARY ignore list header comment removed; replaced with a completion note"

patterns-established:
  - "Phase 99 completion gate: ignoreFiles must be [] before phase is considered done"

requirements-completed: [THEME-01, THEME-02, THEME-03, THEME-04, THEME-05, THEME-06, THEME-07, THEME-08]

duration: 5min
completed: 2026-06-23
---

# Phase 99 Plan 15: Completion Gate — Empty ignoreFiles and Lock color-no-hex Summary

**`color-no-hex` now enforced with zero stylelint exclusions across all `src/ui/**/*.vue`; the Slate token sweep is locked in permanently**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-23T02:00:00Z
- **Completed:** 2026-06-23T02:05:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Removed all 11 temporary `ignoreFiles` entries from `.stylelintrc.cjs`, reducing the list from 11 entries to `[]`
- Removed the obsolete "TEMPORARY ignore list" header comment; replaced with a completion note
- `npm run lint:css` exits 0 with `color-no-hex: true` active — zero violations across all `src/ui/**/*.vue`
- Residual-neon grep over `src/ui` and `src/cli/dev-host` for `#00d9ff`, `#00ff88`, and `rgba(46,204,113...)` returned zero matches
- Full test suite: 993 tests passing (up from 969 baseline), all green

## Task Commits

1. **Task 1: Empty ignoreFiles and prove lint:css is green** - `74161cb` (chore)
2. **Task 2: Residual-neon grep + full suite green** — verification-only, no source edits needed

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `.stylelintrc.cjs` — Removed 11 `ignoreFiles` entries, removed obsolete TEMPORARY header comment, added completion note

## Decisions Made

- No new decisions — the plan mandate is clear: ignoreFiles must end empty, and it does.

## Deviations from Plan

None — plan executed exactly as written. No file required fixing; all sweep plans (99-02 through 99-14) had already migrated every hex literal to `--bsg-*` tokens before this gate ran.

## Issues Encountered

None. lint:css passed on the first attempt after emptying ignoreFiles, and the residual-neon grep returned zero matches.

## Known Stubs

None.

## Threat Flags

None — this plan only modified the stylelint config, introducing no new network endpoints, auth paths, file access patterns, or schema changes.

## Next Phase Readiness

- Phase 99 (Theming Swap Wave 2) is complete. The Slate token swap is locked in.
- `color-no-hex` lint guard permanently prevents raw hex literals from re-entering any `.vue` file.
- Phases 100+ can proceed with full confidence that the token discipline holds.

## Self-Check: PASSED

- `.stylelintrc.cjs` exists and has `ignoreFiles: []` — verified via `node -e` validation
- `npm run lint:css` exits 0 — confirmed
- Residual-neon grep returns nothing — confirmed
- 993/993 tests pass — confirmed
- Commit `74161cb` exists in git log — confirmed

---
*Phase: 99-theming-swap-wave-2*
*Completed: 2026-06-23*
