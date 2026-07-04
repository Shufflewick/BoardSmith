---
phase: 132
slug: engine-element-builder-safety
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-03
---

# Phase 132 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2.1.0 (`vitest.config.ts`, pre-existing) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <targeted test file>` |
| **Full suite command** | `npm test` (→ `vitest run`) |
| **Estimated runtime** | ~120 seconds (full suite, 2135+ tests) |

---

## Sampling Rate

- **After every task commit:** Run the specific test file(s) touched by that task
- **After every plan wave:** `npm test` (full suite; must stay green at 168+ files / 2135+ tests)
- **Before `/gsd:verify-work`:** Full suite green
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | ENG-01 | F3 | `putInto()` onto self/descendant throws actionable error | unit | `npx vitest run <piece-move test>` | ❌ W0 — new file or element-collection.test.ts | ⬜ pending |
| TBD | TBD | TBD | ENG-05 | F12 | `resolveArgs` never coerces bare numbers into elements | unit | `npx vitest run src/engine/action/action.test.ts` | ✅ add case | ⬜ pending |
| TBD | TBD | TBD | ENG-06 | F13 | `forEach` over a mutated collection visits all items | unit | `npx vitest run src/engine/flow/engine.test.ts` | ✅ add case (describe 'ForEach Execution', ~line 384) | ⬜ pending |
| TBD | TBD | TBD | ENG-08 | F28 | `registerAction()` throws on handler-less definitions | unit | `npx vitest run <action-builder test>` | ❌ W0 — locate builder tests or create file | ⬜ pending |
| TBD | TBD | TBD | PROC-01 | all | Verdict per finding before fix | process | N/A — `132-FINDINGS-VERIFICATION.md` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PROC-02 | all | Red-then-green regression test per fix | process | SUMMARY documentation | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Locate/create test home for ENG-01 (new `piece-move.test.ts` or extend `element-collection.test.ts`)
- [ ] Locate/create test home for ENG-08 (builder-chain tests may live in `action.test.ts`/`action-typed-args.test.ts`)
- [ ] `132-FINDINGS-VERIFICATION.md` — PROC-01 verdicts written BEFORE fixes

No framework installation needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROC-01 verdict quality | PROC-01 | Judgment call on trace sufficiency | Review `132-FINDINGS-VERIFICATION.md` per finding |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 150s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
