---
phase: 124
slug: hidden-info-test-utilities
status: planned
nyquist_compliant: true
wave_0_complete: true
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
| 124-01-T1 | 01 | 1 | VIS-01 | T-124-01 | Visibility wrapper delegates to isVisibleTo only; cannot widen a seat's view | unit | `npx vitest run src/testing/visibility.test.ts` | ✅ | ⬜ pending |
| 124-01-T2 | 01 | 1 | VIS-01 | T-124-01 | assertHidden/assertVisible fail with the leaked attribute keys embedded | unit | `npx vitest run src/testing/assertions.test.ts` | ✅ | ⬜ pending |
| 124-02-T1 | 02 | 2 | VIS-02 | T-124-03/04 | diff surfaces only presence + shared-attr disagreement; no anonymized-id noise, no redacted attrs | unit | `npx vitest run src/testing/view-diff.test.ts` | ✅ | ⬜ pending |
| 124-02-T2 | 02 | 2 | VIS-02 | T-124-03 | barrel export, no suite regression | unit | `npm test` | ✅ | ⬜ pending |
| 124-03-T1 | 03 | 3 | VIS-03 | T-124-05/06/07 | markers auto-derived from unfiltered toJSON; scoped scan; predicate allowlist | component (jsdom) | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 124-03-T2 | 03 | 3 | VIS-03 | T-124-05/06 | positive control (injected leak fails) + negative (redacted passes) + allowlist case | component (jsdom) | `npx vitest run src/testing/dom-leak.test.ts` | ✅ | ⬜ pending |

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
