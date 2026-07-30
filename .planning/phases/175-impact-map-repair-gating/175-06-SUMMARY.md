---
phase: 175-impact-map-repair-gating
plan: 06
subsystem: cli
tags: [bs-skills, check-status, verify-impact, rules-staleness, repair-gate, skill-text]

# Dependency graph
requires:
  - phase: 175-impact-map-repair-gating (plan 04)
    provides: "`verify-impact-status --json` (staleFraction/staleSlugs/dispositionCounts/contradictionsPending) and the REPAIR_GATE_DISPOSITIONS/RULES_STALE_MARKER exported constants"
  - phase: 175-impact-map-repair-gating (plan 05)
    provides: "the format-never-compute skill-text convention just established for verify-game.md"
provides:
  - "/bs-check-status item 9 — rules staleness and the repair gate, formatting `verify-impact-status --json`"
  - "the nine-item synthesis contract (was eight) with no surviving eight-item self-contradiction anywhere in check-status.md"
  - "pins in status-tools.test.ts against exported constants (RULES_STALE_MARKER, REPAIR_GATE_DISPOSITIONS) rather than re-typed strings"
affects: [176-repair-execution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "format-never-compute skill item: run a read-only CLI command's --json, format its own severity/summary fields, never re-derive them (item 8's pattern, now item 9's too)"
    - "full-file multi-spelling sweep for a count-phrase family (title-case heading, spaced plural, hyphenated singular, mid-sentence plural) verified with one combined grep -ciE rather than four separate greps"

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/check-status.md
    - src/cli/slash-command/bs/status-tools.test.ts

key-decisions:
  - "Item 9's marker-distinction sentence was rewritten onto one unbroken physical line so RULES_STALE_MARKER's exact string (with its em-dash) is present intact — an earlier draft wrapped it across two lines, which would have made a string-containment pin fail silently against real file content."
  - "The marker-distinction sentence and the pre-existing STALE_MARKER citation were split onto separate lines/sentences after a first draft accidentally put both marker strings on the same line — violating the plan's own negative pin (\"the two markers are never described as the same thing\")."

requirements-completed: [VERIFY-05, VERIFY-06]

# Metrics
duration: 25min
completed: 2026-07-30
---

# Phase 175 Plan 06: check-status.md item 9 — Rules Staleness and the Repair Gate Summary

**`/bs-check-status` gains item 9, formatting `verify-impact-status --json` to surface the uncapped rules-stale fraction, every stale slug, and each chunk's repair-gate disposition — closing Phase 174's "revisit there, not here" carry-forward.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-30T14:29:00Z (approx)
- **Completed:** 2026-07-30T14:54:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `**9. Rules staleness and the repair gate.**` to `check-status.md`, following item 8's format-never-compute shape sentence-for-sentence: runs `boardsmith verify-impact-status --json`, reports `staleFraction` as `"N of M chunks rules-stale"`, lists every `staleSlugs` entry uncapped, groups by `gate.disposition` consuming `dispositionCounts`, surfaces `contradictionsPending` under its own heading naming `/bs-verify-game`'s adjudication gate, and states plainly (never a fabricated zero) when no verify run exists yet.
- Full-file sweep of the eight-item count family: all FOUR occurrences across THREE spellings (`## Body: Read, Then Synthesize the Eight Items`, `following eight items`, the hyphenated singular `this eight-item synthesis`, and `Present all eight items together`) moved to `nine`. Verified with a single combined `grep -ciE "eight[ -]items?"` returning 0 — the hyphenated-singular trap the plan called out cannot survive a future partial sweep either, because the combined regex catches every spelling in the family at once.
- Pinned item 9 in `status-tools.test.ts` against the real exported constants `RULES_STALE_MARKER` and `REPAIR_GATE_DISPOSITIONS` (imported from `verify-impact.ts`), never a re-typed string or list — a future disposition rename or marker-string change fails this pin loudly instead of silently desyncing the skill text.
- Added `## Rules Staleness Marker` to the existing `REFERENCED_SECTIONS` cited-heading guard, so item 9's citation into `state-machine.md` cannot dangle.
- Verified the regression empirically: reverting `nine items` back to `eight items` in `check-status.md` makes the renamed pin fail with `AssertionError: expected '...' not to match /eight items/i`; reverted back, all 58 tests in the file pass again.

## Task Commits

Each task was committed atomically:

1. **Task 1: `check-status.md` item 9 — rules-staleness reporting, format-never-compute** - `9f4e68eb` (feat)
2. **Task 2: Pin item 9 and the new count in `status-tools.test.ts`** - `b20852fb` (test)

**Plan metadata:** (pending — final commit below)

## Files Created/Modified
- `src/cli/slash-command/bs/check-status.md` - item 9 added; nine-item synthesis contract; Read-Only Posture and Reference Files sections updated to name `verify-impact-status --json`
- `src/cli/slash-command/bs/status-tools.test.ts` - `decision 19` describe block; count pin renamed to "nine items"; `## Rules Staleness Marker` added to the cited-heading guard

## Decisions Made
- Kept item 9's structure a direct mirror of item 8 (format-never-compute, consume the command's own severity fields, close with the same read-only carve-out sentence) per the plan's explicit instruction to copy item 8's shape sentence-for-sentence.
- Split the marker-distinction prose across two sentences/lines (rather than one combined clause) after discovering a first draft put both `RULES_STALE_MARKER` and the pre-existing `STALE_MARKER` string on the same physical line, which would have violated the plan's own negative pin that the two markers are never described as the same thing on one line.
- Kept the `RULES_STALE_MARKER` string unwrapped on a single physical line (no markdown line-wrap mid-string) — a wrapped copy would embed a real newline inside the marker text and silently break `toContain(RULES_STALE_MARKER)`.

## Deviations from Plan

None — plan executed as written. Two in-flight self-corrections (documented above under Decisions Made) were made during Task 1/Task 2 authoring, before either task's commit landed, to satisfy the plan's own stated pins (RULES_STALE_MARKER exact-string containment; the never-same-line negative). Neither is a deviation from the plan's intent — both are the plan's own acceptance criteria being honored precisely.

## Issues Encountered

None beyond the two self-corrections above, caught by running the test suite before committing rather than after.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 176 (repair execution) can consume `verify-impact-status --json`'s impact map, and designers running `/bs-check-status` now see the same rules-stale fraction, slugs, and dispositions on the surface they actually read — decision 19 is closed, decision 15's stale fraction has its permanent reporting home.
- `npm test` full suite: 3825/3825 green (up from the 3817/3817 baseline — 8 new tests added by this plan's `describe('decision 19 — item 9 reports rules staleness')` block, net of the renamed count pin).
- No blockers for Phase 176.

---
*Phase: 175-impact-map-repair-gating*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/check-status.md
- FOUND: src/cli/slash-command/bs/status-tools.test.ts
- FOUND: .planning/phases/175-impact-map-repair-gating/175-06-SUMMARY.md
- FOUND commit: 9f4e68eb
- FOUND commit: b20852fb
- FOUND commit: 818742c7
