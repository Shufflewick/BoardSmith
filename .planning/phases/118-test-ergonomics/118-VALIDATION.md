---
phase: 118
slug: test-ergonomics
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-30
---

# Phase 118 — Validation Strategy

> Derived from 118-RESEARCH.md "## Validation Architecture". All work is in src/testing/, reusing Phase 117 engine primitives. Validation is automated vitest.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/testing/` |
| **Full suite command** | `npx vitest run` |
| **Type check** | `npx tsc --noEmit` |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/testing/`
- **After every plan wave:** `npx vitest run`
- **Before verify:** `npx vitest run` (full suite green) + `npx tsc --noEmit`

---

## Per-Requirement Verification Map

| Req | Behavior | Type | Command | File (W0=new) |
|-----|----------|------|---------|------|
| TEST-01 | `getPlayerView(seat)` typed PlayerStateView, hidden-info correct; `testGame.game` typed `G` | integration | `npx vitest run src/testing/test-game.test.ts` | ❌ W0 |
| TEST-02 | drives 2p sequential game to completion | integration | `npx vitest run src/testing/play-until-complete.test.ts` | ❌ W0 |
| TEST-02 | `strategy:'first'` deterministic; `rng` injectable | unit | same | ❌ W0 |
| TEST-02 | `GameStuckError` on dead-end AND on maxMoves exceeded | integration | same | ❌ W0 |
| TEST-02 | handles simultaneous-action turns (awaitingPlayers) — no infinite loop | integration | same | ❌ W0 |
| TEST-03 | failed `assertActionAvailable` includes `reason` + per-selection `note` from `debugActionAvailability` | unit | `npx vitest run src/testing/assertions.test.ts` | ❌ W0 |
| TEST-03 | passing assertion does NOT call debugActionAvailability (no perf regression) | unit | same | ❌ W0 |
| TEST-04 | `actionsMode:'exact'` fails on extra; `'contains'` passes with extra; default (none) = exact | unit | same | ❌ W0 |
| TEST-05 | `ActionBuilder.getChoices()` only enabled; dependent selection respects accumulated args; `execute()` descriptive error; `buildArgs()` accumulates; `testGame.action(name,seat)` factory | unit+integration | `npx vitest run src/testing/action-builder.test.ts` | ❌ W0 |

---

## Cross-Layer Boundary Integration Tests (CLAUDE.md)

| Boundary | Test Location | Covers |
|----------|---------------|--------|
| testing → engine (`enumerateLegalMoves`) | `play-until-complete.test.ts` | TEST-02 move enumeration drives game to completion |
| testing → engine (`debugActionAvailability`) | `assertions.test.ts` | TEST-03 trace flows engine→assertion message |
| testing → engine (`getSelectionChoices`) | `action-builder.test.ts` | TEST-05 in-process dependent-choice resolution |

---

## Wave 0 Requirements (new test files)

- [ ] `src/testing/play-until-complete.test.ts` — TEST-02 (playUntilComplete + GameStuckError, incl. simultaneous-turn + maxMoves)
- [ ] `src/testing/assertions.test.ts` — TEST-03 (trace wiring) + TEST-04 (actionsMode)
- [ ] `src/testing/action-builder.test.ts` — TEST-05 (ActionBuilder)
- [ ] `src/testing/test-game.test.ts` — TEST-01 (typed state access, getPlayerView return type)

Existing src/testing tests (random-simulation, simulate-tutorial, tutorial-ci-demo) must stay green.

---

## Manual-Only Verifications

None — all Phase 118 behavior is automatable via vitest.
