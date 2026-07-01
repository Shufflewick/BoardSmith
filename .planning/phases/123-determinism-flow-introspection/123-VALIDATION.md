---
phase: 123
slug: determinism-flow-introspection
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-01
---

# Phase 123 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~90 seconds (full suite, ~1873 tests) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test files>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-T1 | 123-01 | 1 | FLOW-01 | T-123-01 | Flow position is public game structure (no seat filtering needed) | unit | `npx vitest run src/engine/flow/describe-flow-position.test.ts --silent` | ❌ new (Wave 0) | ⬜ pending |
| 01-T2 | 123-01 | 1 | FLOW-01 | T-123-01 | Graceful no-active-flow branch, no throw | unit | `npx vitest run src/engine/flow --silent` | ✅ | ⬜ pending |
| 02-T1 | 123-02 | 1 | FLOW-04 | T-123-02 | Shuffle fails loud (throw / required rng) instead of silent Math.random | unit | `npx vitest run src/engine/element/space.test.ts src/engine/element/element-collection.test.ts --silent` | ❌ new (Wave 0) | ⬜ pending |
| 02-T2 | 123-02 | 1 | FLOW-04 | T-123-03 | Deterministic seeded default; seed retrievable/replayable | unit/integration | `npx vitest run src/testing/play-until-complete.test.ts --silent` | ✅ (new cases) | ⬜ pending |
| 03-T1 | 123-03 | 2 | FLOW-03 | T-123-05 | getPendingAction returns immutable copy; out-of-range seat -> undefined | unit | `npx vitest run src/testing/test-game.test.ts -t "getPendingAction" --silent` | ✅ (new cases) | ⬜ pending |
| 03-T2 | 123-03 | 2 | FLOW-02 | T-123-06 | Introspection surfaces disabled choices; gameplay path still rejects submission | unit | `npx vitest run src/testing/test-game.test.ts -t "disabled" --silent && npx vitest run src/session/pick-handler.test.ts --silent` | ✅ | ⬜ pending |
| 03-T3 | 123-03 | 2 | FLOW-01 | — | Error messages embed readable flow position | unit | `npx vitest run src/testing/assertions.test.ts -t "assertActionAvailable" --silent` | ✅ (new cases) | ⬜ pending |
| 04-T1 | 123-04 | 2 | FLOW-01, FLOW-03 | T-123-07 | pendingAction perspective-isolated (seat N never sees seat M) | unit | `npx vitest run src/session/game-session.test.ts -t "pendingAction" --silent` | ✅ (new cases) | ⬜ pending |
| 04-T2 | 123-04 | 2 | FLOW-01, FLOW-03 | T-123-09 | Devtools getters stay inside DEV guard (production dead-code-eliminated) | typecheck | `npx tsc --noEmit -p tsconfig.json` | ✅ | ⬜ pending |
| 04-T3 | 123-04 | 2 | FLOW-01, FLOW-03 | T-123-07 | Browser parity: getFlowDebugInfo()/getPendingAction() return correct values | manual (browser) | see Manual-Only Verifications | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — vitest is installed and 1873 tests run green. New tests are colocated `*.test.ts` files alongside the modified modules (engine/flow, session, testing).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Devtools-bridge parity for flow/pending-action introspection | FLOW-01, FLOW-03 | Browser-only surface (`__BOARDSMITH_DEVTOOLS`) | Run `boardsmith dev` in a game, evaluate `window.__BOARDSMITH_DEVTOOLS` getters in the iframe console; kill the server after |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
