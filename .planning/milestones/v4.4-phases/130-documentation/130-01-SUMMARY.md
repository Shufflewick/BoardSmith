---
phase: 130-documentation
plan: 01
subsystem: docs
tags: [documentation, testing, agent-control, migration, determinism]

# Dependency graph
requires: [123-determinism-flow-introspection, 124-hidden-info-test-utilities, 125-headless-simulation, 126-structured-error-surfacing, 127-scriptable-dev-host, 128-animation-drag-drop-test-story, 129-migration-games-merc]
provides:
  - "docs/api/testing.md: VIS/ANIM/SIM/FLOW sections with worked examples"
  - "docs/browser-testing.md: cross-links to headless alternatives + dev-host debug:flow-state"
  - "docs/agent-control.md: Scriptable Dev Host (WS) + Structured Errors (ERR) sections"
  - "docs/custom-ui-guide.md: Anchor Requirements & Fail-Loud Animation section"
  - "docs/migration-guide.md: ## v4.4 breaking-changes section (6 changes, before->after)"
  - "docs/llm-overview.md: determinism guarantee + Agent Ergonomics (v4.4) subsection"
  - "docs/README.md: updated index + quick links"
affects: [130-02]

tech-stack:
  added: []
  patterns:
    - "Every symbol/command claim grep-verified against src/ before writing (per plan constraint); no invented APIs"

key-files:
  modified:
    - docs/api/testing.md
    - docs/browser-testing.md
    - docs/agent-control.md
    - docs/custom-ui-guide.md
    - docs/migration-guide.md
    - docs/llm-overview.md
    - docs/README.md

key-decisions:
  - "createHeadlessSession examples use the real (def, gameOptions, aiSeats) signature and Op shape ({ type: 'action', actionName, player, args }) after an initial draft used an invented (GameClass, options) signature — caught and fixed by grepping src/session/headless-session.ts and src/session/stateless-ops.ts before finalizing"
  - "errorCode branching example uses the real ErrorCode enum (ACTION_NOT_AVAILABLE, from boardsmith/session) after an initial draft invented non-existent codes (INVALID_SELECTION/STALE_SELECTION) — caught by grepping src/types/protocol.ts's actual ErrorCode enum"
  - "isDevThrowEnabled is described as internal composable behavior, not a public import — it is not exported from boardsmith/utils's index.ts (only isDevMode/devWarn/_clearShownWarnings are), so no import path is claimed for it in custom-ui-guide.md"
  - "headless-harness migration entry frames the 'before' as an internal relative-path import (src/session/testing/headless-harness.ts was test-internal, never a public subpath export), not a fabricated public 'boardsmith/session/testing/headless-harness' path"
  - "ElementCollection.shuffle(rng) documented as a separate, lower-level break from Space/Deck.shuffle() (no-arg) — the latter already threads game.random internally and is unaffected, avoiding a misleading blanket 'shuffle() now needs an argument' claim"

requirements-completed: [DOC-05, DOC-06]

duration: ~65min
completed: 2026-07-02
---

# Phase 130 Plan 01: Documentation Summary

**Documented the entire shipped, migrated v4.4 agent-ergonomics surface (FLOW, VIS, SIM, ERR, DRIVE, ANIM) plus the determinism guarantee and all six breaking changes, editing seven existing `docs/` guides in place with every claimed symbol/command grep-verified against `src/` before writing.**

## Performance

- **Duration:** ~65 min
- **Tasks:** 3/3 completed
- **Files modified:** 7 (all edited in place, no new files)

## Accomplishments

- `docs/api/testing.md` gained four new Examples sub-sections: **Asserting Hidden Information (VIS)** (`isElementVisible`/`getVisibleElements`/`assertHidden`/`assertVisible`/`diffPlayerViews`/`renderAsSeat`/`assertNoHiddenInfoLeak`, with a positive-control note and a go-fish-style DOM-leak recipe), **Animation Traces (ANIM test mode)** (`enableAnimationTestMode`/`getAnimationTrace`/`clearAnimationTrace`, the `{kind,element,from,to,meta}` trace shape), **Headless Simulation (SIM)** (`createHeadlessSession` with the real `(def, gameOptions, aiSeats)` signature, plus the `boardsmith simulate` CLI flags/exit-codes/replay-hint), and **Flow-Position Debugging (FLOW)** (`getFlowDebugInfo`/`describeFlowPosition`, `TestGame.getPendingAction`, `getActionSpaceWithChoices` for disabled-choice reasons).
- `docs/browser-testing.md` gained a "Headless alternatives (no browser needed)" section cross-linking each new testing-guide section and the dev-host `debug:flow-state` WS op.
- `docs/agent-control.md` gained **Scriptable Dev Host (WS)** (the `getState`/`getLobby`/`debugToggle`/`uiSwitch`/`debug:logs`/`debug:flow-state` op table, a `createDevHostClient` recipe, and the `wsImplementation ?? globalThis.WebSocket` Node >=22.4 note) and **Structured Errors (ERR)** (`OpResult.warnings`/`errorCode` with a real `ErrorCode.ACTION_NOT_AVAILABLE` branch-on-errorCode recipe, plus `onPersistenceError`/`lastPersistenceError`/`persistenceHealthy`).
- `docs/custom-ui-guide.md` gained an "Anchor Requirements & Fail-Loud Animation" section: `anchorAttrs(ref, type)` usage, the once-per-type dev-warning dedup behavior, and the dev-throw/production-console.error split for animation composables missing an anchor.
- `docs/migration-guide.md` gained a `## v4.4: Agent-Ergonomics` section (mirroring the existing `## v3.0` What Changed/Steps/Checklist structure) covering all six removed/changed APIs: headless-harness module move, `ElementCollection.shuffle()` now requiring an explicit RNG, `playUntilComplete()`'s new deterministic-by-default literal seed, animation fail-loud dev throws, `onPersistenceError`'s 3-arg signature, and `anchorAttrs()`'s new `type` parameter.
- `docs/llm-overview.md` gained a "Determinism Guarantee" section and an "Agent Ergonomics (v4.4)" subsection (near CLI Commands) making the new testing/dev-host/error-surfacing capabilities discoverable from the agent entry point, each linking to `agent-control.md`/`api/testing.md`.
- `docs/README.md`'s index table and Quick Links now list the migration guide, `boardsmith simulate`, and `boardsmith/client`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Testing guide — visibility, animation traces, headless sim, flow introspection** - `e88c4e0` (docs)
2. **Task 2: Dev-host protocol + error surfacing + custom-UI anchor requirements** - `e6228fe` (docs)
3. **Task 3: v4.4 breaking-changes section, determinism guarantee, llm-overview discoverability, README index** - `2a92f67` (docs)

## Files Modified

- `docs/api/testing.md` - VIS/ANIM/SIM/FLOW example sections
- `docs/browser-testing.md` - headless-alternatives cross-link section
- `docs/agent-control.md` - Scriptable Dev Host (WS) + Structured Errors (ERR) sections
- `docs/custom-ui-guide.md` - Anchor Requirements & Fail-Loud Animation section
- `docs/migration-guide.md` - `## v4.4: Agent-Ergonomics` breaking-changes section
- `docs/llm-overview.md` - Determinism Guarantee + Agent Ergonomics (v4.4) subsections
- `docs/README.md` - index table + Quick Links

## Decisions Made

See key-decisions in frontmatter. Most consequential: every symbol/API shape in this plan was drafted from the phase SUMMARYs first, then **grep-verified against live `src/` before finalizing** — this caught three would-be invented-symbol mistakes during writing (a wrong `createHeadlessSession` call signature, a wrong `Op` shape for `session.send`, and two non-existent `ErrorCode` values), all fixed before commit rather than left in the docs for the wave-2 doc-verifier to catch.

## Deviations from Plan

None — plan executed as written. The self-correction of invented-symbol drafts (caught via the plan's own "grep before writing" constraint, before any commit) is expected discipline per the plan's `<constraints>`, not a deviation.

## Issues Encountered

None — no blockers, no auto-fixes required in the `docs/` tree itself.

## User Setup Required

None - documentation-only change, no external service configuration required.

## Next Phase Readiness

- All three tasks' grep verification gates pass (confirmed independently, not just via each task's own `<verify>` block).
- No new files created outside the seven listed docs; no root `BREAKING.md` created (confirmed it does not exist and the locked decision — v4.4 breaking changes live in `docs/migration-guide.md`'s `## v4.4` section — was followed).
- Ready for Plan 130-02 (doc-verifier, wave 2) to run a full sweep confirming zero unverifiable symbol/command claims across all seven edited files.

## Self-Check: PASSED

- FOUND: docs/api/testing.md (contains assertNoHiddenInfoLeak, getAnimationTrace, createHeadlessSession, boardsmith simulate, getFlowDebugInfo)
- FOUND: docs/browser-testing.md (headless-alternatives section)
- FOUND: docs/agent-control.md (contains createDevHostClient, getState/getLobby, debug:logs, errorCode, onPersistenceError)
- FOUND: docs/custom-ui-guide.md (contains anchorAttrs)
- FOUND: docs/migration-guide.md (contains ## v4.4, createHeadlessSession, shuffle)
- FOUND: docs/llm-overview.md (contains "Determinism Guarantee")
- FOUND: docs/README.md (contains agent-control, simulate)
- FOUND commit e88c4e0 (Task 1)
- FOUND commit e6228fe (Task 2)
- FOUND commit 2a92f67 (Task 3)

---
*Phase: 130-documentation*
*Completed: 2026-07-02*
