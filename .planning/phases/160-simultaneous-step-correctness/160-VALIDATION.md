---
phase: 160
slug: simultaneous-step-correctness
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-20
---

# Phase 160 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run <changed test files>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~160 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run the plan's quick command (the task's `<automated>` verify).
- **After every plan wave:** Run `npm test`.
- **Before `/gsd:verify-work`:** Full suite must be green.
- **Max feedback latency:** 160 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 160-01-01 | 01 | 1 | SIM-01, SIM-03, PROC-01 | T-160-01 / T-160-03 | RED: aliased checkpoint shows post-flip value; empty-awaiting resume throws | unit (RED) | `npx vitest run src/engine/flow/simultaneous-checkpoint-aliasing.test.ts src/engine/flow/simultaneous-alldone-empty.test.ts` | ❌ W0 (fixture + tests net-new) | ⬜ pending |
| 160-01-02 | 01 | 1 | SIM-01, SIM-03 | T-160-01 / T-160-03 | Checkpoint is a value (no retroactive rewrite); empty/allDone completes cleanly | unit (GREEN) | `npx vitest run src/engine/flow/simultaneous-checkpoint-aliasing.test.ts src/engine/flow/simultaneous-alldone-empty.test.ts` | ✅ (after 160-01-01) | ⬜ pending |
| 160-01-03 | 01 | 1 | SIM-01, SIM-03, PROC-01 | T-160-01 / T-160-03 | Multi-checkpoint immutability; variant-route empty-awaiting completes | unit (adversarial) | `npx vitest run src/engine/flow/simultaneous-checkpoint-aliasing.test.ts src/engine/flow/simultaneous-alldone-empty.test.ts && npm test` | ✅ (after 160-01-02) | ⬜ pending |
| 160-02-01 | 02 | 2 | SIM-02, PROC-01 | T-160-04 / T-160-05 | RED: seat-2 simultaneous undo refused by currentPlayer pin | unit (RED) | `npx vitest run src/session/testing/simultaneous-undo.test.ts` | ❌ W0 (test net-new) | ⬜ pending |
| 160-02-02 | 02 | 2 | SIM-02 | T-160-04 / T-160-05 | Any awaiting seat undoes its own action; co-deciders untouched; fences hold | unit (GREEN) | `npx vitest run src/session/testing/simultaneous-undo.test.ts` | ✅ (after 160-02-01) | ⬜ pending |
| 160-02-03 | 02 | 2 | SIM-02, PROC-01 | T-160-04 / T-160-05 / T-160-06 | Parity (both executors agree); seat-2 cannot cross into seat-1's action or past a fence | unit (parity + adversarial) | `npx vitest run src/session/testing/parity-contract.test.ts && npm test` | ✅ (extends existing) | ⬜ pending |
| 160-03-01 | 03 | 1 | SIM-04, PROC-01 | T-160-27 / T-160-28 | RED: own seat in waiting list; completed seat's execute fires | component (RED) | `npx vitest run src/ui/components/auto-ui/ActionPanel.simultaneous.test.ts` | ❌ W0 (test net-new) | ⬜ pending |
| 160-03-02 | 03 | 1 | SIM-04 | T-160-27 / T-160-28 | Self-filtered list; completed seat cannot execute; no currentPlayer turn identity | component (GREEN) | `npx vitest run src/ui/components/auto-ui/ActionPanel.simultaneous.test.ts` | ✅ (after 160-03-01) | ⬜ pending |
| 160-03-03 | 03 | 1 | SIM-04, PROC-01 | T-160-27 / T-160-28 | Repeat-submit emits zero executes; 3-seat self-filter; no contradiction | component (adversarial) | `npx vitest run src/ui/components/auto-ui/ActionPanel.simultaneous.test.ts src/ui/components/GameShell.test.ts && npm test` | ✅ (after 160-03-02) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/session/testing/fixtures/simultaneous-fixture.ts` — net-new reusable ≥2-seat `simultaneousActionStep` fixture (created by Plan 01, imported by Plan 02).
- [ ] `src/engine/flow/simultaneous-checkpoint-aliasing.test.ts` — net-new SIM-01 regression (checkpoint immutability + non-hanging undo).
- [ ] `src/engine/flow/simultaneous-alldone-empty.test.ts` — net-new SIM-03 regression (empty awaitingPlayers + allDone completes, no crash).
- [ ] `src/session/testing/simultaneous-undo.test.ts` — net-new SIM-02 regression (non-seat-1 undo, co-deciders untouched, fences hold).
- [ ] `src/ui/components/auto-ui/ActionPanel.simultaneous.test.ts` — net-new SIM-04 component regression (self-filtered waiting list + commit gate).

*Framework already present (vitest); no install needed. Existing `parity-contract.test.ts` is extended, not created.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All phase behaviors have automated verification. (Sibling-game re-verification — Seven, OTP, the two D3/D4 games — is deferred to Phase 169's de-workaround sweep, not gated here.)*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 160s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
