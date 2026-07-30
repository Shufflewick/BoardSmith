---
phase: 175-impact-map-repair-gating
plan: 01
subsystem: cli
tags: [bs-skills, verify, chunk-provenance, state-machine, fenced-region, markdown-templates]

requires:
  - phase: 174-verify-classifier
    provides: "RULE_DELTA_KINDS/RuleDelta enum and per-chunk attribution ladder this marker's Rule delta field records"
  - phase: 171-provenance-recording
    provides: "the machine-owned fenced-region pattern (## Verified Against) this marker copies, plus findHeadingIndex/atomicWriteFile"
provides:
  - "RULES_STALENESS_* constants, renderRulesStaleness/renderRulesStalenessSection, strict parseRulesStaleness (verify-impact.ts)"
  - "writeRulesStalenessMarker: CHUNK-first/SKETCH-second writer with no clear-path"
  - "the marker registered in state-machine.md's Rules Staleness Marker section + Consistency Check item 5"
  - "both templates scaffolded with the marker's fence/pointer"
affects: [176-repair-gating-close, verify-game-skill-text]

tech-stack:
  added: []
  patterns:
    - "Second machine-owned fenced section per chunk, its own distinct fence pair (never shared)"
    - "Line-anchored heading lookup via findHeadingIndex, never bare indexOf (f73153a3 defect class)"
    - "Structurally excluding a dangerous value from a writer's parameter type (Omit<T,'marker'>) instead of validating it at runtime"

key-files:
  created:
    - src/cli/commands/verify-impact.ts
    - src/cli/commands/verify-impact.test.ts
  modified:
    - src/cli/slash-command/bs/state-machine.md
    - src/cli/slash-command/bs/templates/CHUNK.template.md
    - src/cli/slash-command/bs/templates/SKETCH.template.md
    - src/cli/slash-command/bs/templates.test.ts

key-decisions:
  - "Rules-staleness is a second, independent axis from the Status enum, never a new enum value (175-CONTEXT.md decision 1) — enforced by a dedicated orthogonality-guard test suite, not just documentation"
  - "The writer's input type structurally omits `marker`, so there is no parameter/flag/code path to write RULES_STALENESS_CLEAR (decision 4) — an Omit<T,'marker'> type rather than a runtime check"
  - "RULES_STALENESS_LABELS orders Marker: last, matching state-machine.md's Write Order rule that the status-analogous field is written last"
  - "Registration (state-machine.md + both templates + templates.test.ts) shipped in the SAME change as the marker itself (decision 5) — never a two-plan split"

patterns-established:
  - "Machine-owned fenced region sibling to ## Verified Against, reusable for any future second CHUNK.md field"

requirements-completed: [VERIFY-05]

duration: 55min
completed: 2026-07-30
---

# Phase 175 Plan 01: Rules Staleness Marker Summary

**A new, orthogonal `## Rules Staleness` fenced marker in CHUNK.md — with its CHUNK-first/SKETCH-second writer and its `state-machine.md` Consistency Check registration — landed in one change, so no `bs-` skill can hard-fail a cold-resume parse on a project carrying one.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-07-30T00:53:00Z (approx, per read step)
- **Completed:** 2026-07-30T06:02:06Z
- **Tasks:** 3 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- Built the marker's constants, renderer, and strict line-anchored parser (`verify-impact.ts`), mirroring `chunk-provenance.ts`'s `## Verified Against` precedent exactly, with its own distinct fence pair
- Built `writeRulesStalenessMarker`: CHUNK.md written first (or repaired in place), SKETCH.md's derived pointer written/repaired second — never the reverse, never SKETCH.md alone — and structurally incapable of writing the `clear` value
- Registered the marker in `state-machine.md` (new "Rules Staleness Marker" section + a NEW Consistency Check item 5, leaving item 3's Status-enum wording byte-identical) and scaffolded it into both `CHUNK.template.md` and `SKETCH.template.md`
- Added a dedicated orthogonality-guard test suite proving the Status enum's five enumerating/pinning sites did not move

## Task Commits

Each task was committed atomically:

1. **Task 1: verify-impact.ts — the marker's constants, renderer, and strict parser** - `b4fa8aa9` (feat)
2. **Task 2: The CHUNK-first / SKETCH-second marker writer** - `9ac3d9ca` (feat)
3. **Task 3: Register the marker — state-machine.md, both templates, and the pins** - `8f3d5eac` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/cli/commands/verify-impact.ts` - marker constants, `renderRulesStaleness`/`renderRulesStalenessSection`, `parseRulesStaleness`, `writeRulesStalenessMarker`
- `src/cli/commands/verify-impact.test.ts` - 33 tests: render/parse/write-order/no-clear-path/structural guards
- `src/cli/slash-command/bs/state-machine.md` - "Rules Staleness Marker" section + Consistency Check item 5 + Cold-Resume Parse Contract cross-reference
- `src/cli/slash-command/bs/templates/CHUNK.template.md` - scaffolded `## Rules Staleness` fenced section (after `## Verified Against`), added to PARSE CONTRACT heading list
- `src/cli/slash-command/bs/templates/SKETCH.template.md` - sibling `- Rules Staleness (derived from ...)` pointer line + grammar comment
- `src/cli/slash-command/bs/templates.test.ts` - VERIFY-05 registration pins + decision-1 orthogonality guard, `EXPECTED_HEADINGS` entry for `CHUNK.template.md`

## Decisions Made
- Chose to order `RULES_STALENESS_LABELS` with `Marker:` last from the start (rather than reordering between Task 1 and Task 2 as the plan's prose implied), since nothing in Task 1's behavioral requirements pinned a specific order and this avoids churn. Documented inline in the constant's doc comment.
- The writer's `input` parameter type is `Omit<RulesStalenessRecord, 'marker'> & { slug: string }` — the function internally always sets `marker: RULES_STALE_MARKER`. This satisfies "no clear path" structurally (a type-level guarantee) rather than via a runtime guard, matching the plan's own acceptance criterion that the writer's body never mentions "clear".
- `renderRulesStaleness`'s "Attributed slices:" table uses a single `| slice |` column (not slice+hash, unlike `## Verified Against`'s `Cited slices:`) since `RulesStalenessRecord.attributedSlices` is a plain `string[]`, matching the plan's interface spec.

## Deviations from Plan

None - plan executed exactly as written. Task 1's render/parse code was written directly in its final (Task-2-compatible) label order rather than being reordered between Task 1 and Task 2 commits, which is a sequencing simplification, not a behavioral deviation — every acceptance criterion for both tasks passes.

## Issues Encountered
- Two test bugs surfaced and fixed while running Task 1's suite before it went green: (1) the label-order test initially iterated over `Prior reading:`/`Changed reading:` even for a record that omitted them (both fields are legitimately absent-and-omitted); fixed by supplying both fields in that specific test's fixture. (2) The `parseRulesStaleness` attributed-slices table parser initially captured the table's own header (`| slice |`) and separator (`|---|`) rows as data; fixed by filtering rows whose value is literally `slice` or all-dashes.
- A structural test asserting the module never contains the substring `VERIFIED_AGAINST_BEGIN` initially failed because the doc comment legitimately explains the analogy to that constant; fixed by scoping the assertion to non-comment code lines only (consistent with the file's other structural guards).
- A mock-implementation leak between two Task-2 write-order tests (`mockImplementation` set in the CHUNK-before-SKETCH-failure test persisted into the next test via `vi.clearAllMocks()`, which does not reset implementations) was fixed by resetting `atomicWriteFile`'s mock implementation to a plain call-through in `beforeEach`.

None of these were plan deviations under Rules 1-4 — all were test-authoring bugs caught and fixed before the suite went green, within the same task's scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The marker exists, is registered, and is proven not to conflict with the Status enum or the existing `stale — re-derive before build` marker.
- Phase 176 (repair gating close) can now call `writeRulesStalenessMarker` to set the marker when a chunk is flagged rules-stale, and will need its own new function (not built here, per decision 4) to clear it back to `clear` after a successful repair close — this plan deliberately does not build that clear path.
- No blockers identified for the remaining Phase 175 plans (02-08).

---
*Phase: 175-impact-map-repair-gating*
*Completed: 2026-07-30*

## Self-Check: PASSED

All 6 key files confirmed present on disk; all 3 task commit hashes (`b4fa8aa9`, `9ac3d9ca`, `8f3d5eac`) confirmed in `git log`. Full suite 3751/3751 green; `npx tsc --noEmit` clean (only the pre-existing, unrelated `docs/seed-to-state.test.ts` rootDir warning remains, confirmed present on `main` before this plan's changes via `git stash`).
