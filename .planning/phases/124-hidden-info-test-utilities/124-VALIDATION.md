---
phase: 124
slug: hidden-info-test-utilities
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 124 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (node default; DOM tests add `@vitest-environment jsdom` pragma) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~90 seconds (full suite, ~1910 tests) |

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
| (filled by planner) | — | — | VIS-01..03 | hidden-info leakage | Visibility APIs never widen what a seat can see; DOM-leak matcher derives forbidden markers from unfiltered attrs | unit/component | `npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — vitest + @vue/test-utils + jsdom installed; component-test pattern proven in `src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts`. New tests colocate with the modules they cover.

---

## Manual-Only Verifications

None — all phase behaviors have automated verification (testing-layer only phase, no browser surface).

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
