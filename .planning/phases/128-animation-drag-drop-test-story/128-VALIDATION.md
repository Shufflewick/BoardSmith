---
phase: 128
slug: animation-drag-drop-test-story
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-02
---

# Phase 128 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (node default; jsdom per-file pragma for composable/component tests; WAAPI/matchMedia stubs per RESEARCH) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~100 seconds (full suite, ~2018 tests) |

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
| (filled by planner) | — | — | ANIM-01..03 | fail-loud correctness | Test mode never active by default in prod; dev-throw actionable; trace never captures user data | unit (jsdom) | `npm test` | mixed (new test files per composable) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

No new deps. New test files expected: one per composable (useFLIP.test.ts, useFlyingElements.test.ts, useElementAnimation.test.ts, useActionAnimations.test.ts, useDragDrop.test.ts) + animation test-mode/trace module test. WAAPI (`element.animate`) and `matchMedia` need per-file stubs (proven `vi.stubGlobal` pattern in 10+ existing tests); `getBoundingClientRect` zero-rect means positional assertions use identities, not pixels.

---

## Manual-Only Verifications

None required — trace-based assertions + existing browser-verified behavior cover the phase. (Optional confidence smoke in a game repo deferred to Phase 129 migration.)

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
