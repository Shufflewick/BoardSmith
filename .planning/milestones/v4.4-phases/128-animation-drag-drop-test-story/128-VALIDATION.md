---
phase: 128
slug: animation-drag-drop-test-story
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-02
finalized: 2026-07-02
---

# Phase 128 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (node default; jsdom per-file pragma for composable tests; WAAPI/matchMedia/RAF stubs per RESEARCH) |
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
| 01-T1 | 128-01 | 1 | ANIM-01 | T-128-01, T-128-02 | Vue-free trace module; recordTrace no-op when disabled (default OFF) | grep gate | `grep -c "from 'vue'" ... == 0` | ❌ new | ⬜ pending |
| 01-T2 | 128-01 | 1 | ANIM-01 | T-128-01 | Recorder tested; re-exported from ui + testing | unit | `npx vitest run src/ui/composables/useAnimationTestMode.test.ts` | ❌ new | ⬜ pending |
| 02-T1 | 128-02 | 1 | ANIM-03 | T-128-03 | anchorAttrs empty-result devWarn, once-per-type, prod no-op | unit (jsdom) | `npx vitest run src/ui/composables/anchorAttrs.test.ts` | ⚠️ extend | ⬜ pending |
| 02-T2 | 128-02 | 1 | ANIM-02 | T-128-04 | useDragDrop dual-level tests; graceful-degrade preserved | unit (jsdom) | `npx vitest run src/ui/composables/useDragDrop.test.ts` | ❌ new | ⬜ pending |
| 03-T1 | 128-03 | 2 | ANIM-01/03 | T-128-01/02/03 | test-mode branch above reduced-motion; throw dev-gated | grep + unit | `npx vitest run src/ui/composables/useFLIP.test.ts` | ❌ new | ⬜ pending |
| 03-T2 | 128-03 | 2 | ANIM-02 | T-128-03 | test-mode + mocked-WAAPI real path + throw | unit (jsdom) | `npx vitest run src/ui/composables/useFLIP.test.ts` | ❌ new | ⬜ pending |
| 04-T1 | 128-04 | 2 | ANIM-01/03 | T-128-01/02/03 | test-mode branch above reduced-motion; throw dev-gated; no API expansion | grep + unit | `npx vitest run src/ui/composables/useElementAnimation.test.ts` | ❌ new | ⬜ pending |
| 04-T2 | 128-04 | 2 | ANIM-02 | T-128-03 | test-mode + mocked-RAF real path + throw | unit (jsdom) | `npx vitest run src/ui/composables/useElementAnimation.test.ts` | ❌ new | ⬜ pending |
| 05-T1 | 128-05 | 2 | ANIM-01/03 | T-128-01/02/03 | autoWatch from/to = container names; first-resolution throw dev-gated | grep + unit | `npx vitest run src/ui/composables/useFlyingElements.test.ts` | ❌ new | ⬜ pending |
| 05-T2 | 128-05 | 2 | ANIM-02 | T-128-03 | flagship autoWatch trace + mocked-RAF real path + throw | unit (jsdom) | `npx vitest run src/ui/composables/useFlyingElements.test.ts` | ❌ new | ⬜ pending |
| 06-T1 | 128-06 | 2 | ANIM-01/03 | T-128-01/02/03 | trace from own selectors; both warn sites → dev-throw | grep + unit | `npx vitest run src/ui/composables/useActionAnimations.test.ts` | ❌ new | ⬜ pending |
| 06-T2 | 128-06 | 2 | ANIM-02 | T-128-03 | test-mode + setTimeout real path + throw | unit (jsdom) | `npx vitest run src/ui/composables/useActionAnimations.test.ts` | ❌ new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

No new deps. New test files (one per composable) + the trace-module test are all created within the plans that need them; the trace module itself (128-01) is the interface-first Wave 1 foundation every Wave 2 composable plan depends on. jsdom gaps handled with proven inline stubs (RESEARCH-verified via live probe):
- `matchMedia` + `ResizeObserver`: `vi.stubGlobal` placed FIRST, before composable imports (Pitfall 1 — module-load-time matchMedia read in useElementAnimation).
- `HTMLElement.prototype.animate` (WAAPI): per-test stub for useFLIP real-path.
- `Element.prototype.getBoundingClientRect` (always zero in jsdom): per-test distinct before/after rects for any real-path movement assertion (Pitfall 2).
- `requestAnimationFrame`: `vi.stubGlobal` with a manual tick queue for useElementAnimation/useFlyingElements RAF-chain real-path tests (fake timers do not auto-tick RAF).
- `DragEvent`/`DataTransfer` absent: useDragDrop event-level tests call handlers directly with a hand-built plain object (never `new DragEvent`).

Positional assertions use element/container IDENTITY, never pixels (jsdom rects are zero).

---

## Manual-Only Verifications

None required — trace-based assertions + existing browser-verified behavior cover the phase. (Optional confidence smoke in a game repo deferred to Phase 129 migration.)

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (trace module is the interface-first Wave 1 dependency)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-02
