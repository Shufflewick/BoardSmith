---
phase: 158
slug: auto-zoom-re-fit
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-20
---

# Phase 158 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom env for this composable) |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run src/ui/composables/useAutoZoom.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick ~3s · full suite ~2–3 min |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/ui/composables/useAutoZoom.test.ts`
- **After the plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** < 10s for the quick run

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 158-01-01 | 01 | 1 | ZOOM-01, PROC-01 | — | RED: post-settle dock/region change leaves zoom stale (proven failing pre-fix) | unit (RED) | `npx vitest run src/ui/composables/useAutoZoom.test.ts` | ✅ (harness upgraded in-task) | ⬜ pending |
| 158-01-02 | 01 | 1 | ZOOM-01 | T-158-01 | rAF-coalesced re-fit on available-space change only; epsilon guard terminates the loop (no re-fit DoS) | unit (GREEN) | `npx vitest run src/ui/composables/useAutoZoom.test.ts` | ✅ | ⬜ pending |
| 158-01-03 | 01 | 1 | ZOOM-01, PROC-01 | T-158-01 | manual zoom survives layout change; Fit re-arms; board content-growth excluded | unit (adversarial) | `npx vitest run src/ui/composables/useAutoZoom.test.ts && npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/ui/composables/useAutoZoom.test.ts` — mutable `fakeRegion` (getter-backed client dims +
  `setSize`), a controllable/faked `requestAnimationFrame`, and a mutable `dockHeight` ref, so a
  post-startup available-space change can be driven deterministically in jsdom. Built inside Task 1
  (RED) before the new re-fit assertions.

*The vitest framework and jsdom env already exist; the only Wave 0 work is the harness mutability
upgrade, which Task 1 owns.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All phase behaviors have automated verification. The deterministic FakeResizeObserver + faked-rAF +
mutable region/dock harness reproduces the D12 stale-fit symptom without a real browser, so no
manual-only step is required for close. (Cross-game de-workaround browser confirmation is Phase 169,
out of scope here.)*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (harness mutability in Task 1)
- [x] No watch-mode flags
- [x] Feedback latency < 10s (quick run)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-20
