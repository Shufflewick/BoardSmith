---
phase: 162
slug: test-tooling-ergonomics
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-21
---

# Phase 162 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run <changed test file(s)>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~120s full suite; per-file quick runs < 15s |

---

## Sampling Rate

- **After every task commit:** Run the task's `npx vitest run <file>` quick command
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 162-01-01 | 01 | 1 | TOOL-01, TOOL-02, PROC-01 | T-162-02 / — | RED: commented `<img` false-FAILs + `boardsmith/testing` export unresolvable | unit (RED) | `npx vitest run src/cli/lib/asset-scan.test.ts src/testing/scan-asset-export.test.ts` | ❌ W0 (net-new) | ⬜ pending |
| 162-01-02 | 01 | 1 | TOOL-01, TOOL-02 | T-162-01, T-162-02 | Comment-scoped strip; live `<img` still flagged; additive export | unit (GREEN) | `npx vitest run src/cli/lib/asset-scan.test.ts src/testing/scan-asset-export.test.ts` | ✅ | ⬜ pending |
| 162-01-03 | 01 | 1 | TOOL-01, PROC-01 | T-162-01 | Over-strip cannot swallow live `<img`/string literals | unit (adversarial) | `npx vitest run src/cli/lib/asset-scan.test.ts && npm test` | ✅ | ⬜ pending |
| 162-02-01 | 02 | 1 | TOOL-03, TOOL-04, PROC-01 | T-162-04, T-162-05 | RED: barrel import throws under jsdom; symmetric-deck assertion mis-fires | unit (RED) | `npx vitest run src/ui/composables/ui-barrel-import.test.ts src/testing/dom-leak.test.ts` | ❌ W0 (net-new) | ⬜ pending |
| 162-02-02 | 02 | 1 | TOOL-03, TOOL-04 | T-162-05, T-162-06 | Side-effect-free import; elementId-keyed leak detection | unit (GREEN) | `npx vitest run src/ui/composables/ui-barrel-import.test.ts src/testing/dom-leak.test.ts` | ✅ | ⬜ pending |
| 162-02-03 | 02 | 1 | TOOL-04, PROC-01 | T-162-04, T-162-06 | Real leak still caught (own id + un-attributed surface); stubbed UI suites unbroken | unit (adversarial) | `npx vitest run src/testing/dom-leak.test.ts src/ui/composables/useElementAnimation.test.ts src/ui/composables/useFLIP.test.ts && npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All net-new (RESEARCH.md "Wave 0 gaps") — created RED-first inside each plan's Task 1:

- [ ] `src/cli/lib/__fixtures__/asset-scan/commented-img/src/ui/CommentedImg.vue` — commented-`<img>` false-FAIL fixture (all three styles + multi-line block) — TOOL-01
- [ ] `src/testing/scan-asset-export.test.ts` — `boardsmith/testing` export-surface import test — TOOL-02
- [ ] `src/ui/composables/ui-barrel-import.test.ts` — no-stub `boardsmith/ui` barrel-import under jsdom — TOOL-03
- [ ] symmetric-deck case added to `src/testing/dom-leak.test.ts` (two same-named cards, one hidden/one visible) — TOOL-04

Framework already installed (vitest) — no install task.

---

## Manual-Only Verifications

*None. All phase behaviors have automated verification (static scan, module import, DOM-leak assertion — all runnable headlessly under vitest/jsdom).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (4 net-new artifacts above)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
