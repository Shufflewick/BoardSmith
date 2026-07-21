---
phase: 159
slug: mcts-soundness-dynamic-multiselect
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-20
---

# Phase 159 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run <changed test file(s)>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | full suite ~90-120s; per-file quick run <15s |

---

## Sampling Rate

- **After every task commit:** Run the plan's quick command (the specific `npx vitest run <file>` in its verify).
- **After every plan wave:** Run `npm test`.
- **Before `/gsd:verify-work`:** Full suite must be green.
- **Max feedback latency:** < 120s (full suite).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 159-01-01 | 01 | 1 | AI-01, PROC-01 | T-159-01/02 | Function-valued multiSelect skipped pre-fix (RED: no/zero moves or swallowed throw) | unit | `npx vitest run src/ai/mcts-multiselect.test.ts src/engine/utils/enumerate-moves.test.ts` | ❌ W0 (net-new) | ⬜ pending |
| 159-01-02 | 01 | 1 | AI-01 | T-159-01/02 | Concrete config enumerates combos; undefined→single; throw→fail loud | unit | `npx vitest run src/ai/mcts-multiselect.test.ts src/engine/utils/enumerate-moves.test.ts` | ✅ (Task 1) | ⬜ pending |
| 159-01-03 | 01 | 1 | AI-01, PROC-01 | T-159-02/03 | Throwing resolver fails loud, message leaks no internals; variable-range enumerates | unit | `npx vitest run src/ai/mcts-multiselect.test.ts && npm test` | ✅ (Task 1) | ⬜ pending |
| 159-02-01 | 02 | 2 | AI-01, PROC-01 | T-159-04 | buildPickMetadata omits function-form multiSelect pre-fix (RED) | unit | `npx vitest run src/engine/element/action-metadata.test.ts` | ❌ W0 (net-new) | ⬜ pending |
| 159-02-02 | 02 | 2 | AI-01 | T-159-04 | Both metadata sites emit resolved {min,max}; undefined omits; static unregressed | unit | `npx vitest run src/engine/element/action-metadata.test.ts` | ✅ (Task 1) | ⬜ pending |
| 159-02-03 | 02 | 2 | AI-01, PROC-01 | T-159-05 | Panel receives concrete config (C.2); enumeration/panel parity | integration | `npx vitest run src/engine/element/action-metadata.test.ts && npm test` | ✅ (Task 1) | ⬜ pending |
| 159-03-01 | 03 | 1 | AI-02, PROC-01 | T-159-06/07/09 | Clone exposes hidden attr / exploitable move / co-decider leak pre-fix (RED); restorability guard | unit | `npx vitest run src/ai/mcts-redaction.test.ts` | ❌ W0 (net-new) | ⬜ pending |
| 159-03-02 | 03 | 1 | AI-02 | T-159-06/07/09 | Redacted clone (forSeat), simultaneous loop fixed, redacted snapshot restores | unit | `npx vitest run src/ai/mcts-redaction.test.ts src/ai/mcts-restore.test.ts` | ✅ (Task 1) | ⬜ pending |
| 159-03-03 | 03 | 1 | AI-02, PROC-01 | T-159-08 | Non-bot createSnapshot stays full-truth; exploitability non-repro across seeds/seats | unit | `npx vitest run src/ai/mcts-redaction.test.ts && npm test` | ✅ (Task 1) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/ai/mcts-multiselect.test.ts` — net-new, AI-01 enumeration RED (Plan 01 Task 1)
- [ ] `src/engine/utils/enumerate-moves.test.ts` — EXISTS; extend with function-form multiSelect cases (Plan 01 Task 1)
- [ ] `src/engine/element/action-metadata.test.ts` — net-new, AI-01/C.2 metadata RED (Plan 02 Task 1)
- [ ] `src/ai/mcts-redaction.test.ts` — net-new, AI-02 redaction/exploitability/simultaneous/restorability RED (Plan 03 Task 1)

*Framework already installed (vitest); no infra install needed. All net-new test files are created inside their plan's RED (Task 1) — no separate Wave 0 plan required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All phase behaviors have automated verification. (The panel-completion C.2 behavior is validated at the controller/metadata seam in 159-02-03 rather than via a live browser click, per RESEARCH "no panel change needed once metadata carries the resolved config".)*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (4 net-new/extended test files, each created in its plan's RED task)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-20
