---
phase: 131
slug: serialization-restore-fidelity
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-02
---

# Phase 131 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (configured via `vitest.config.ts`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <targeted test file>` |
| **Full suite command** | `npm run test` (→ `vitest run`) |
| **Estimated runtime** | ~120 seconds (full suite, ~2081 tests) |

---

## Sampling Rate

- **After every task commit:** Run targeted `npx vitest run <file>` for touched files
- **After every plan wave:** Run `npm run test` (full suite) — core engine serialization is touched; regression risk HIGH
- **Before `/gsd:verify-work`:** Full suite must be green, plus `npm run audit` (near-identical filtering paths are duplication-prone)
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 131-02-T1 | 131-02 | 2 | SEC-01 | F1/F7 | `_zoneVisibility` survives all 5 restore paths; `toJSONForPlayer(opponent)` byte-identical before/after | unit | `npx vitest run src/engine/element/zone-visibility-restore.test.ts src/session/restore-snapshot-authoritative.test.ts` | ❌ W0 | ⬜ pending |
| 131-04-T1 | 131-04 | 2 | SEC-02 | F2 | `visibleAttributes` filters non-listed attrs from non-owners; owner sees own | unit | `npx vitest run src/engine/element/visible-attributes.test.ts` | ❌ W0 | ⬜ pending |
| 131-04-T1 | 131-04 | 2 | SEC-03 | F8 | `state.players` filtered per-viewer, matches view's Player nodes | unit | `npx vitest run src/session/player-state-visibility.test.ts` | ❌ W0 | ⬜ pending |
| 131-03-T1 | 131-03 | 2 | SEC-04 | F15 | `includeDebugData` defaults false at all 10 call sites; `debugEnabled` opt-in works | unit | `npx vitest run src/session/debug-data-gating.test.ts` | ❌ W0 | ⬜ pending |
| 131-05-T1 | 131-05 | 3 | RST-01 | F10 | `onEnter`/`onExit` handlers fire after restore | unit | `npx vitest run src/engine/element/handler-restore.test.ts` | ❌ W0 | ⬜ pending |
| 131-03-T1 | 131-03 | 2 | RST-02 | F16 | `teachingDisabled`/`displayName` persist across `GameSession.restore()` | unit | `npx vitest run src/session/teaching-disabled-persistence.test.ts` | ❌ W0 | ⬜ pending |
| 131-01-T1, 131-01-T2 | 131-01 | 1 | PROC-01 | all | Verdict per finding recorded before fix | process | N/A — `131-FINDINGS-VERIFICATION.md` | ❌ W0 | ⬜ pending |
| all fix tasks (131-02..05 T1) | 131-02..05 | 2–3 | PROC-02 | all | Red-then-green regression test per fix | process | Verified via SUMMARY documentation | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Wave 0 note: each red-first test file is created as Task 1 of its owning plan (131-02..05); the PROC-01 verdict file is created by 131-01 (Wave 1) and gates all fix work.*

---

## Wave 0 Requirements

- [x] `src/engine/element/zone-visibility-restore.test.ts` — SEC-01, all restore paths (created as 131-02 Task 1; GameSession.restore case may live in `src/session/restore-snapshot-authoritative.test.ts` companion)
- [x] `src/engine/element/visible-attributes.test.ts` — SEC-02 incl. owner-self-visibility (created as 131-04 Task 1)
- [x] `src/session/player-state-visibility.test.ts` — SEC-03 (created as 131-04 Task 1)
- [x] `src/session/debug-data-gating.test.ts` — SEC-04, all 10 call sites (created as 131-03 Task 1)
- [x] `src/engine/element/handler-restore.test.ts` — RST-01 (created as 131-05 Task 1)
- [x] `src/session/teaching-disabled-persistence.test.ts` — RST-02 (created as 131-03 Task 1)
- [x] `131-FINDINGS-VERIFICATION.md` — PROC-01 verdicts written BEFORE fixes (created as 131-01 Tasks 1–2, Wave 1)

No framework installation needed — Vitest fully configured; only new test files required. Each Wave 0 test file is authored red-first as the owning plan's Task 1, before its fix task runs.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROC-01 verdict quality | PROC-01 | Judgment call on repro/trace sufficiency | Review `131-FINDINGS-VERIFICATION.md` — each finding has LEGITIMATE (with evidence) or REJECTED (with reasoning) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 150s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
</content>
