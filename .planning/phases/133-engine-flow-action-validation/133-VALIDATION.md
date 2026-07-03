---
phase: 133
slug: engine-flow-action-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-03
---

# Phase 133 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (repo-wide, `vitest.config.ts`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/engine/flow/engine.test.ts src/engine/action/action.test.ts` |
| **Full suite command** | `npm test` (→ `vitest run`) |
| **Estimated runtime** | ~120 seconds (full suite, 2148+ tests) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/engine/flow/engine.test.ts src/engine/action/action.test.ts` (targeted)
- **After every plan wave:** `npm test` (full suite; keep 168 files / 2148+ tests green)
- **Before `/gsd:verify-work`:** Full suite green
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | ENG-02 | F4 | `eachPlayer` with non-zero `startingPlayer` visits ALL players (wrapped order) | unit | `npx vitest run src/engine/flow/engine.test.ts -t "EachPlayer"` | ✅ insert at describe('EachPlayer Execution') ~303 | ⬜ pending |
| TBD | TBD | TBD | ENG-03 | F5 | Failed simultaneous action sets `actionError`; not recorded in `actionHistory`; client gets failure | unit + integration | `npx vitest run src/engine/flow/engine.test.ts -t "simultaneous"` (+ runner-level assertion) | ✅ sim-step coverage ~1997 | ⬜ pending |
| TBD | TBD | TBD | ENG-04 | F6 | Choice-branch multiSelect count + array-type enforced server-side | unit | `npx vitest run src/engine/action/action.test.ts -t "validateSelection"` | ✅ describe('validateSelection') ~254 | ⬜ pending |
| TBD | TBD | TBD | ENG-07 | F27 | `switchOn` unmatched value + no default throws actionable error | unit | `npx vitest run src/engine/flow/engine.test.ts -t "switch"` | ✅ Conditionals ~617 | ⬜ pending |
| TBD | TBD | TBD | PROC-01 | all | Verdict per finding before fix | process | N/A — `133-FINDINGS-VERIFICATION.md` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PROC-02 | all | Red-then-green regression test per fix | process | SUMMARY documentation | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `133-FINDINGS-VERIFICATION.md` — PROC-01 verdicts written BEFORE fixes

No new test files or fixtures needed — all four requirements have existing insertion points.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROC-01 verdict quality | PROC-01 | Judgment call on trace sufficiency | Review `133-FINDINGS-VERIFICATION.md` per finding |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 150s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
