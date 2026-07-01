---
phase: 122-documentation
subsystem: docs
tags: [documentation, agent-control, testing, browser-testing, pitfalls]
requirements: [DOC-01, DOC-02, DOC-03, DOC-04]
completed: "2026-07-01"
---

# Phase 122: Documentation — Summary

**One-liner:** Brought `docs/` in line with the shipped v4.3 surface via 4 parallel doc-writers, each verified against `src/` (not memory) — new agent-control + browser-testing guides, updated testing + pitfalls docs, plus incidental corrections of stale examples.

## Deliverables

| Req | File(s) | Change |
|-----|---------|--------|
| DOC-01 | `docs/agent-control.md` (new) + `docs/README.md` link | Headless loop (create→inspect→enumerate→submit→assert); `getActionSpace`/`getActionSchema`/`buildActionArgs`/`enumerateLegalMoves`/`getPlayerView`; undo/checkpoint/replay via `GameSession` (`getStateAtAction`, `rewindToAction`, `undoToTurnStart`, traces) + `TestGame.getSnapshot`; determinism/seeding via `SeededRandom`/`getRandomState`. Go-fish worked example. |
| DOC-02 | `docs/api/testing.md` (update) | Phase 118 ergonomics: `getPlayerView` typed observable state, `playUntilComplete`/`GameStuckError` (from `simulate-action.ts`), assertion auto-trace, `actionsMode` exact/contains, `ActionBuilder`. Removed stale APIs (`ScenarioBuilder`, `quickGame`, `assertPlayerHas`, `visualizeFlow`, …), fixed `traceAction` signature, corrected seats to 1-indexed. |
| DOC-03 | `docs/browser-testing.md` (new) | `data-bs-el-id` (+ `data-element-id` FLIP binding) in custom UI + AutoUI; `window.__BOARDSMITH_DEVTOOLS` (4 sync reads, dev-only); `boardsmith:action-resolved` `{action,success,seat,error?}`; DISCOVER→SELECT→DRIVE→CONFIRM console harness; honest `success:false` finding; kill-dev-server rule. |
| DOC-04 | `docs/common-pitfalls.md`, `docs/core-concepts.md`, `docs/actions-and-flow.md` (update) | PIT-01 loop() construction throw (+ removed silent-devWarn footgun); PIT-02 registration guard w/ built-in exemption + override; PIT-03 reachability (throw vs devWarn + function-`actions` blind spot); PIT-04 lint rules with exact messages. Grounded in polyhedral-potions. Fixed a stale `loop()` example missing `maxIterations` that would now throw. |

## Accuracy discipline

Every writer verified signatures/messages against `src/` before writing. Confirmed post-hoc: all referenced symbols (`getActionSpace`, `getActionSchema`, `buildActionArgs`, `enumerateLegalMoves`, `getStateAtAction`, `rewindToAction`, `playUntilComplete`, `GameStuckError`) exist with matching signatures. The doc pass incidentally removed several stale/non-existent API references and fixed two latent broken examples.

## Follow-up (out of scope, non-blocking)

- `src/session/index.ts` docstring example (~lines 26-31) uses 0-indexed `performAction('move', 0, ...)`, contradicting the 1-indexed convention elsewhere in the same file. Flagged by the DOC-01 writer; a src-comment fix for a future pass.
</content>
