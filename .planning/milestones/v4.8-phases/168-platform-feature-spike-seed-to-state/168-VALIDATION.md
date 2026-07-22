---
phase: 168
slug: platform-feature-spike-seed-to-state
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-21
---

# Phase 168 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Quick run** | `npx vitest run <seed test file>` |
| **Full suite** | `npm run test` |
| **Runtime** | ~60–120s full (~3111 baseline after Phase 167) |

## Sampling Rate
- After the PoC task: run the seed-load test file.
- Phase gate: full suite green.

## Validation Architecture (Nyquist — spike)

FEAT-01 is a spike; its primary deliverable is a design/feasibility doc (a claim, not runtime behavior). The PoC provides the empirical proof:

- **Design doc:** a reviewer confirms the doc scopes the mechanism (seed = serialized `GameStateSnapshot`), the load path (`GameRunner.fromSnapshot` via the dev-host `SnapshotSessionHost`), the authoring surface (record-from-play `TestGame.getSnapshot()`), the pipeline request API (named seed file), and a cost/shape recommendation. Non-code; verified by inspection.
- **PoC (PROC-01 spirit):** an integration test that (1) drives go-fish via TestGame to a distinct mid-game state, (2) captures `getSnapshot()` to a seed fixture, (3) loads it through the `--seed` dev-host start path, and (4) asserts the loaded game deterministically reflects the exact seeded state (same element tree / flowState / current player as the source) and can take the next legal action. The test FAILS without the `--seed` wiring (fresh start ≠ seeded state) and PASSES with it.
- **Determinism check:** loading the same seed twice yields identical state (RNG `randomState` pinned).

**Sampling justification:** One end-to-end record→seed→load→assert test is exact coverage for the deterministic-load claim; the design doc is verified by inspection. Full suite guards regressions from the `--seed` CLI/host change.
