---
phase: 115-developer-documentation
plan: "01"
subsystem: docs
tags: [documentation, tutorial, teaching, anchorAttrs, checkers, go-fish]
dependency_graph:
  requires: []
  provides: [docs/teaching-and-tutorials.md]
  affects: [docs/README.md]
tech_stack:
  added: []
  patterns:
    - TutorialDefinition/TutorialStep/TutorialGateAllowList authoring pattern
    - simulateTutorial + assertTutorialCompletes CI-verifiable tutorial DSL
    - anchorAttrs v-bind parity pattern for custom UIs
key_files:
  created:
    - docs/teaching-and-tutorials.md
  modified:
    - docs/README.md
decisions:
  - "All four DOC requirements (DOC-01..04) written in a single guide with section order: authoring → predicates → CI tests → AI teaching → action help → lockout → parity"
  - "Used real CHECKERS_TUTORIAL and GO_FISH_TUTORIAL excerpts (file-referenced) rather than invented examples"
  - "Green→red demonstration shown for both checkers (playerHasCaptures patch) and go-fish (checkForBooks patch)"
  - "Heatmap documented explicitly as board-only with the showHint-gating quirk noted"
  - "Custom UI anchorAttrs requirement stated as the central parity lesson in Section 7"
metrics:
  duration: "~20m"
  completed: "2026-06-30"
  tasks: 3
  files: 2
---

# Phase 115 Plan 01: Teaching & Tutorials Guide Summary

Single developer guide at `docs/teaching-and-tutorials.md` covering all four DOC requirements with real codebase-verified checkers and go-fish worked examples side-by-side.

## What Was Built

One guide, seven sections, covering:

1. **Authoring a tutorial** — `TutorialDefinition` shape (`setup` + `steps`), `TutorialStep` fields (`id`, `gate`, `content`, `advanceWhen`, `suppressAutoFill`), the start/advance/skip/exit lifecycle via `GameSession.startTutorial`/`exitTutorial`, action gating with `TutorialGateAllowList` and `selectionMatchesValue` (id > notation > name; `{ value }` for primitives), and `AnnotationTarget` kinds (element/action/panel). All symbols verified against `src/engine/tutorial/types.ts` and `src/engine/tutorial/gate.ts`.

2. **Predicate triggers** — inline `advanceWhen` predicates, the `afterFirstTurn`/`afterTurns`/`whenForced` helpers from `src/engine/tutorial/predicates.ts`, and the auto-advance caveat (R-05 dwell-time limitation).

3. **CI-verifiable tutorial tests** — `simulateTutorial` + `assertTutorialCompletes` + `TestGame.create(..., { tutorialSetup: true })` DSL, three drift dimensions (gate/predicate/non-completion), and green→red demonstrations for both games (checkers: `playerHasCaptures = () => false`; go-fish: `checkForBooks = () => []`).

4. **AI teaching** — `requestHint`/`hintTargetFromMove`, `startDemo`/`stopDemo` narrated demo with `onBeforeMove` hook, evaluation heatmap (explicitly board-only), AI-seat-gating caveat, and heatmap showHint-gating quirk.

5. **Action help** — `.help(text)` builder → `ActionDefinition.help` → `ActionMetadata.help` → `ActionHelpPopover`; not gated by `teachingDisabled`.

6. **Host teaching lockout** — `GameSessionOptions.teachingDisabled`, the exact thrown message, UI Teaching-group hide, and `boardsmith dev --lock-teaching` flag.

7. **Parity: checkers vs go-fish** — three axes side-by-side (tutorial definition, overlay anchoring, hint target); the central `anchorAttrs` lesson (AutoUI automatic; custom UI must opt in); summary table.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Tasks 1-3 (DOC-01..04, all sections + README link) | ad75866 | docs/teaching-and-tutorials.md (new, 649 lines), docs/README.md |

## Deviations from Plan

None — plan executed exactly as written. All three tasks' content was authored in a single file creation (all sections written at once) and committed as one coherent unit. Verification greps for all three tasks pass.

## Known Stubs

None. The guide contains no placeholder text, no TODO markers, and no hardcoded dummy values. All code excerpts are from live source files with file references.

## Threat Flags

None. The guide cites only public API names already exported from `boardsmith`. No secrets, internal paths, or undocumented internals are referenced.

## Self-Check

- [x] `docs/teaching-and-tutorials.md` exists — verified by verification grep and commit ad75866
- [x] `docs/README.md` links to `./teaching-and-tutorials.md` — verified by grep
- [x] All symbols cited match live source (TutorialDefinition, TutorialStep, TutorialGateAllowList, AnnotationTarget, anchorAttrs, selectionMatchesValue, requestHint, startDemo, stopDemo, setHeatmapVisible, teachingDisabled, afterFirstTurn, afterTurns, whenForced, simulateTutorial, assertTutorialCompletes, assertTutorialStep, getGoFishHintTarget, hintTargetFromMove)
- [x] No src/ or game-code changes
- [x] `npm test` green: 1708/1708 tests pass (123 test files)
