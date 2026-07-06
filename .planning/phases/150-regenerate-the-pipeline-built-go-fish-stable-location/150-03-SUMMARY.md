---
phase: 150-regenerate-the-pipeline-built-go-fish-stable-location
plan: 03
subsystem: testing
tags: [bs-build-chunk, go-fish, test-audit-repair, a11y-floor, hidden-info-leak, headless-session]

# Dependency graph
requires:
  - phase: 150-02
    provides: "Compiling chunk-1 core-event-loop rules code + custom UI (GameTable.vue) wired to the real actionController; the stale scaffold-template test handoff"
provides:
  - "Chunk-1's full automated bar green in the durable ~/BoardSmithGames/go-fish-dryrun/ project: tsc, boardsmith lint (7 sandbox rules), 38 tests (unit/integration + hidden-info leak + random-sim + full 5-item a11y floor), all passing"
  - "CHUNK.md Findings Ledger with 2 dispositioned findings (both fixed) from a scaled-fan-out audit (fidelity/visibility/undo/design lenses)"
  - "DESIGN.md authored (retroactive design-ask gap closure) -- Direction: Adopt"
  - "A real generated-code bug fixed: GameTable.vue's target-pick choice-shape mismatch, which made the ask action's opponent-hand selection completely non-functional in production"
affects: [151-human-playtest]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-wiring a11y/leak tests via boardsmith/session's createHeadlessSession -- an in-process, no-server, no-mock production session stack (SnapshotSessionHost + stateless-ops) used to drive useActionController and GameTable.vue end-to-end for both the keyboard-completion a11y test and the undo-lens test"
    - "vitest.config.ts + tests/setup.ts installing jsdom matchMedia/ResizeObserver polyfills globally (setupFiles), avoiding per-file inline shims across every @vitest-environment jsdom test"
    - "Real WCAG relative-luminance/contrast-ratio computation (no external lib) for the a11y floor's no-color-literal-grep + contrast test"

key-files:
  created:
    - "~/BoardSmithGames/go-fish-dryrun/DESIGN.md"
    - "~/BoardSmithGames/go-fish-dryrun/vitest.config.ts"
    - "~/BoardSmithGames/go-fish-dryrun/tests/setup.ts"
    - "~/BoardSmithGames/go-fish-dryrun/tests/random-simulation.test.ts"
    - "~/BoardSmithGames/go-fish-dryrun/tests/no-hidden-info-leak.test.ts"
    - "~/BoardSmithGames/go-fish-dryrun/tests/no-hidden-info-dom-leak.test.ts"
    - "~/BoardSmithGames/go-fish-dryrun/tests/a11y-keyboard-completion.test.ts"
    - "~/BoardSmithGames/go-fish-dryrun/tests/a11y-floor.test.ts"
    - "~/BoardSmithGames/go-fish-dryrun/tests/undo.test.ts"
  modified:
    - "~/BoardSmithGames/go-fish-dryrun/tests/game.test.ts (rewritten against the real chunk-1 rules, replacing the stale scaffold stub)"
    - "~/BoardSmithGames/go-fish-dryrun/src/ui/components/GameTable.vue (F2 fix: target-pick choice-shape comparison)"
    - "~/BoardSmithGames/go-fish-dryrun/chunks/core-event-loop/CHUNK.md (Step Checklist test/audit/repair checked; Findings Ledger populated)"
    - "~/BoardSmithGames/go-fish-dryrun/DECISIONS.md (Decisions 4-5)"

key-decisions:
  - "The isFinished()='pond empty' depth-cut (claim 6/7) was already applied by Plan 02's build step -- no reactive fix was needed this round (unlike the 149 dry-run, which discovered it reactively via a timedOut simulateRandomGames run); this plan's own random-sim run confirms it is correctly reachable (0 timedOut across 50 games x [2,3,4] players)"
  - "F1: DESIGN.md did not exist despite this chunk being tagged ui: major -- build/design-ask.md's visual-identity sub-gate was skipped during Plan 02's headless/auto-approved ask step. Authored retroactively as a repair (Direction: Adopt, matching the existing zero-override token usage and rulebook/00-visual-survey.md's evidence), not deferred, since it was discovered in audit round 1 (round-3 user triage's 'deferred' disposition does not apply here)"
  - "F2: GameTable.vue's target-pick selectability checks compared a nested (choice.value as any)?.value === seat, but game.playerChoices()'s {value,display} raw choices get FLATTENED on the wire by pick-handler.ts (not re-wrapped) -- so no opponent hand was EVER selectable in production, by keyboard or pointer, before this fix. Found by the real-wiring keyboard-completion a11y test (a real headless session, not a mock), which is exactly the class of defect that real-wiring testing is designed to catch and a mocked controller would have missed"
  - "Full 6-shot 3-tier x 2-theme design-review screenshot capture was reduced to a curl-based serve-verify-kill check (HTTP 200 + real Vite SPA shell) -- no Playwright browser binary was installed locally and no interactive browser tool was available this session; the full visual capture is deferred to Phase 151's live human playtest, which exercises this exact board in a real browser regardless"
  - "Undo lens: this chunk adds no chunk-specific undo/invertible-command logic; verified via a real headless-session test that the engine's generic turn-checkpoint restore round-trips this game's concrete hand/pond counts and turn-owner cleanly, rather than assuming engine-level correctness unverified"

requirements-completed: [GEN-01]

# Metrics
duration: ~70min
completed: 2026-07-06
---

# Phase 150 Plan 03: Test, audit, and repair the regenerated Go Fish chunk-1 Summary

**Ran the real `bs/build/test.md` -> `bs/build/audit.md` -> `bs/build/repair.md` verification legs against Plan 02's generated chunk-1 code, reproducing the 149 dry-run's clean automated bar in the durable `go-fish-dryrun` project and catching+fixing a real production bug (the `ask` action's opponent-hand selection was completely non-functional) that only a real-wiring test could surface.**

## Performance

- **Duration:** ~70 min
- **Completed:** 2026-07-06
- **Tasks:** 2/2 completed
- **Files modified:** 13 in `go-fish-dryrun`'s own repo (9 created, 4 modified), plus this SUMMARY.md + STATE.md/ROADMAP.md/REQUIREMENTS.md in the BoardSmith repo

## Accomplishments

- **Task 1 (test step):** Rewrote the stale scaffold-template `tests/game.test.ts` (17 tests) against the real generated rules, and added `tests/random-simulation.test.ts` (`simulateRandomGames` 50x[2,3,4], all four terminal-state fields zero), `tests/no-hidden-info-leak.test.ts` (broadcast-log leak guard), `tests/no-hidden-info-dom-leak.test.ts` (`diffPlayerViews` zero attributeDiffs + `assertNoHiddenInfoLeak` both seats, two non-vacuous positive controls), and the full 5-item a11y floor as executable tests (`tests/a11y-keyboard-completion.test.ts`, `tests/a11y-floor.test.ts`) -- the keyboard-completion test drives a REAL `useActionController` wired to a REAL headless game session (`boardsmith/session`'s `createHeadlessSession`), never a mock. `tsc --noEmit` clean, `boardsmith lint` 0 errors, all 38 tests pass, no dev server left running.
- **Task 2 (audit + repair):** Ran a scaled-fan-out audit (fidelity/visibility/undo/design lenses, one real self-executed pass per lens, fresh reads of the raw rulebook slices + `RULINGS.md` + code -- never `## Interpretation`). Found and fixed 2 issues: **F1** -- `DESIGN.md` was missing despite the `ui: major` tag (Plan 02's `ask` step skipped the design-ask sub-gate); authored it retroactively (Direction: Adopt). **F2** -- a real, previously-shipped production bug: the keyboard-completion a11y test (real headless session, not mocked) revealed that `GameTable.vue`'s opponent-hand selectability check compared the wrong choice shape, so **no opponent hand was ever clickable/keyboard-selectable in production** -- the `ask` action's `target` pick could never be completed through the board at all. Fixed at all three call sites in `GameTable.vue`, re-verified end-to-end. Both findings dispositioned as `fixed` (0 deferred, 0 refuted); `npx tsc --noEmit && npx vitest run` re-confirmed green after the repair.

## Task Commits

Committed atomically inside `~/BoardSmithGames/go-fish-dryrun`'s own git repo (`sub_repos` is empty in `.planning/config.json`):

1. **Task 1: test step** -- `2118c0b` (test)
2. **Task 2: audit + repair** -- `e8ca113` (fix)

**Plan metadata (this repo):** committed with this SUMMARY.md, STATE.md, ROADMAP.md, REQUIREMENTS.md

## Files Created/Modified

- `~/BoardSmithGames/go-fish-dryrun/tests/game.test.ts` -- rewritten against real chunk-1 rules (17 tests)
- `~/BoardSmithGames/go-fish-dryrun/tests/random-simulation.test.ts` -- `simulateRandomGames` terminal-state proof
- `~/BoardSmithGames/go-fish-dryrun/tests/no-hidden-info-leak.test.ts` -- broadcast-log leak guard
- `~/BoardSmithGames/go-fish-dryrun/tests/no-hidden-info-dom-leak.test.ts` -- DOM-level leak proof + positive controls
- `~/BoardSmithGames/go-fish-dryrun/tests/a11y-keyboard-completion.test.ts` -- real-wiring keyboard-only ask completion
- `~/BoardSmithGames/go-fish-dryrun/tests/a11y-floor.test.ts` -- axe-core, color/contrast, aria-label, focus/reduced-motion
- `~/BoardSmithGames/go-fish-dryrun/tests/undo.test.ts` -- undo-lens real evidence
- `~/BoardSmithGames/go-fish-dryrun/tests/setup.ts`, `vitest.config.ts` -- jsdom polyfills (project had none)
- `~/BoardSmithGames/go-fish-dryrun/tests/a11y.example.test.ts` -- deleted (stale scaffold stub)
- `~/BoardSmithGames/go-fish-dryrun/src/ui/components/GameTable.vue` -- F2 fix (target-pick choice-shape)
- `~/BoardSmithGames/go-fish-dryrun/DESIGN.md` -- F1 fix (authored, Direction: Adopt)
- `~/BoardSmithGames/go-fish-dryrun/chunks/core-event-loop/CHUNK.md` -- Step Checklist + Findings Ledger
- `~/BoardSmithGames/go-fish-dryrun/DECISIONS.md` -- Decisions 4-5

## Decisions Made

See `key-decisions` in frontmatter above (5 decisions), plus the full Findings Ledger in `chunks/core-event-loop/CHUNK.md` and Decisions 4-5 in `DECISIONS.md`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed GameTable.vue's target-pick choice-shape mismatch (F2)**
- **Found during:** Task 1 (the a11y floor's keyboard-completion test, driven against a real headless session)
- **Issue:** `isOpponentSelectable`/`selectOpponent`/the `selected` class binding compared `(choice.value as any)?.value === seat`, assuming a nested `{ value: { value, display }, display }` wire shape. The real wire shape for a `game.playerChoices()`-sourced pick is flat (`pick-handler.ts` recognizes the already-`{value,display}`-shaped raw choice and does not re-wrap it), so the comparison always evaluated `undefined === seat` -- no opponent hand was ever selectable in production.
- **Fix:** Changed all three call sites to compare the choice value directly (`c.value === seat`).
- **Files modified:** `~/BoardSmithGames/go-fish-dryrun/src/ui/components/GameTable.vue`
- **Verification:** `tests/a11y-keyboard-completion.test.ts` now completes the full `ask` action (target pick + rank pick + real server round-trip) with zero pointer events; full suite re-run green.
- **Committed in:** `e8ca113`

**2. [Rule 2 - Missing critical functionality] Authored DESIGN.md (F1)**
- **Found during:** Task 2 (design-review lens)
- **Issue:** This chunk is tagged `ui: major`, which requires a settled `DESIGN.md` visual-identity contract (`build/design-ask.md`'s sub-gate) before/during its `ask` step -- Plan 02's headless/auto-approved `ask` step skipped it, leaving no visual-identity authority for this or any future UI chunk to read.
- **Fix:** Authored `DESIGN.md` with Direction: Adopt (Slate defaults, zero `--bsg-*` overrides), matching `rulebook/00-visual-survey.md`'s evidence and `GameTable.vue`'s existing token-conforming code (no re-styling required, so no Restyle/Cutover Rule flip).
- **Files modified:** `~/BoardSmithGames/go-fish-dryrun/DESIGN.md` (created)
- **Verification:** `tests/a11y-floor.test.ts`'s color-literal grep confirms `GameTable.vue` already conforms to the now-settled Theme Block (zero overrides, 4 reviewed card-content literals, all contrast-passing).
- **Committed in:** `e8ca113`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical functionality)
**Impact on plan:** Both fixes are correctness-critical -- F2 in particular means the generated game was UNPLAYABLE through its custom board before this plan; no scope creep beyond the plan's own audit+repair mandate.

## Issues Encountered

- No Playwright browser binary was installed locally (`~/BoardSmithGames/go-fish-dryrun` has no browser-automation devDependency of its own, and BoardSmith's own installed Playwright had no downloaded browser binary) and no interactive browser tool was available this session, so the design-review lens's full 6-shot 3-tier x 2-theme screenshot capture was reduced to a `curl`-based serve/verify/kill check (confirmed `HTTP 200` + the real Vite SPA shell, then killed the dev server). This is recorded as a reduced-fidelity pass in the Findings Ledger, not a silently-skipped one -- Phase 151's live human playtest exercises this exact board in a real browser regardless, closing the gap.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- `~/BoardSmithGames/go-fish-dryrun/` now passes its full automated bar: `tsc --noEmit` clean, `boardsmith lint` 0 errors, 38 tests green (unit/integration, hidden-info leak x2, random-sim, full 5-item a11y floor, undo), no dev server left running.
- `CHUNK.md` Step Checklist: `investigate`/`redteam`/`ask`/`build`/`test`/`audit`/`repair` all checked; `playtest`/`revise`/`close` remain -- exactly Phase 151's scope (the human playtest gate).
- A real, previously-undetected production bug (F2 -- the `ask` action's board-driven `target` pick was completely non-functional) is now fixed, so Phase 151's human playtest will exercise a genuinely playable board rather than one that silently could not complete its core action.
- `DESIGN.md` is now settled for this game, ready for the game-end-scoring chunk (or any other future UI-touching chunk) to read.
- `~/BoardSmithGames/go-fish/` (hand-built reference) was never written to.

## Self-Check: PASSED

Confirmed present on disk (inside `go-fish-dryrun`): all 9 new/rewritten test files, `DESIGN.md`, `vitest.config.ts`, `tests/setup.ts`, and this SUMMARY.md in the BoardSmith repo. Confirmed both task commit hashes (`2118c0b`, `e8ca113`) present via `git log --oneline` inside `go-fish-dryrun`'s own repo. Re-ran `npx tsc --noEmit && npx boardsmith lint && npx vitest run` at write time: all green (38/38 tests), and `pgrep -fl "boardsmith dev"` confirmed empty.

---
*Phase: 150-regenerate-the-pipeline-built-go-fish-stable-location*
*Completed: 2026-07-06*
