---
phase: 131
slug: serialization-restore-fidelity
status: draft
nyquist_compliant: false
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
| TBD | TBD | TBD | SEC-01 | F1/F7 | `_zoneVisibility` survives all restore paths; `toJSONForPlayer(opponent)` byte-identical before/after | unit | `npx vitest run src/engine/element/zone-visibility-restore.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-02 | F2 | `visibleAttributes` filters non-listed attrs from non-owners; owner sees own | unit | `npx vitest run src/engine/element/visible-attributes.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-03 | F8 | `state.players` filtered per-viewer, matches view's Player nodes | unit | `npx vitest run src/session/player-state-visibility.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-04 | F15 | `includeDebugData` defaults false at all 10 call sites; `debugEnabled` opt-in works | unit | `npx vitest run src/session/debug-data-gating.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RST-01 | F10 | `onEnter`/`onExit` handlers fire after restore | unit | `npx vitest run src/engine/element/handler-restore.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RST-02 | F16 | `teachingDisabled`/`displayName` persist across `GameSession.restore()` | unit | `npx vitest run src/session/teaching-disabled-persistence.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PROC-01 | all | Verdict per finding recorded before fix | process | N/A — `131-FINDINGS-VERIFICATION.md` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PROC-02 | all | Red-then-green regression test per fix | process | Verified via SUMMARY documentation | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/engine/element/zone-visibility-restore.test.ts` — SEC-01, all restore paths
- [ ] `src/engine/element/visible-attributes.test.ts` — SEC-02 incl. owner-self-visibility
- [ ] `src/session/player-state-visibility.test.ts` — SEC-03
- [ ] `src/session/debug-data-gating.test.ts` — SEC-04, all 10 call sites
- [ ] `src/engine/element/handler-restore.test.ts` — RST-01
- [ ] `src/session/teaching-disabled-persistence.test.ts` — RST-02
- [ ] `131-FINDINGS-VERIFICATION.md` — PROC-01 verdicts written BEFORE fixes

No framework installation needed — Vitest fully configured; only new test files required.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROC-01 verdict quality | PROC-01 | Judgment call on repro/trace sufficiency | Review `131-FINDINGS-VERIFICATION.md` — each finding has LEGITIMATE (with evidence) or REJECTED (with reasoning) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 150s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
