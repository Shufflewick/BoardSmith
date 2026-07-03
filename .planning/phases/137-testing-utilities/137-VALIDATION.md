---
phase: 137
slug: testing-utilities
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-03
---

# Phase 137 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/testing/` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~120 seconds (full suite, 2358+ tests baseline) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/testing/`
- **After every plan wave:** `npm run test` (full suite — the doAction throw flip may surface silently-failing setup moves anywhere in the repo; that's intended)
- **Before `/gsd:verify-work`:** full suite green
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | TST-01 | F36 | doAction throws with availability trace; tryAction returns result without throwing; examples fixed | unit | `npx vitest run src/testing/test-game.test.ts` (or nearest existing testing suite) | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | TST-02 | F37 | Two seedless TestGames produce identical shuffles; testGame.seed exposed; seed in failure messages | unit | `npx vitest run src/testing/` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | PROC-01 | all | Verdict per finding before fix | process | `137-FINDINGS-VERIFICATION.md` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PROC-02 | all | Red-then-green per fix | process | SUMMARY documentation | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `137-FINDINGS-VERIFICATION.md` — PROC-01 verdicts BEFORE fixes
- [ ] Confirm test home for TestGame behavior tests (existing src/testing test files)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROC-01 verdict quality | PROC-01 | Judgment call | Review `137-FINDINGS-VERIFICATION.md` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 150s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
