---
phase: 97
slug: quick-wins-wave-0
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-22
---

# Phase 97 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.x |
| **Config file** | vitest.config.ts (existing) |
| **Quick run command** | `npx vitest run src/ui` |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | ~60-120 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/ui`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-----------|--------|
| 97-01-01 | 01 | 1 | QUICK-01 | — | Rejected action surfaces toast.error(result.error); panel re-enables | unit + source-assert | `npx vitest run src/ui` | ❌ W0 | ⬜ pending |
| 97-02-01 | 01 | 1 | QUICK-02 | — | Icon-only buttons expose aria-label; hamburger has aria-expanded/aria-controls; glyphs aria-hidden | unit + source-assert | `npx vitest run src/ui` | ❌ W0 | ⬜ pending |
| 97-03-01 | 01 | 1 | QUICK-03 | — | No-op Settings/Help + dividers + BS chip + "BoardSmith Dev Mode" absent from chrome | source-assert | `grep` assertions | ✅ | ⬜ pending |
| 97-04-01 | 01 | 1 | QUICK-04 | — | 100dvh present with 100vh fallback line immediately preceding | source-assert | `grep` assertions | ✅ | ⬜ pending |
| 97-05-01 | 01 | 1 | QUICK-05 | — | env(safe-area-inset-*) on sticky/topmost edges; viewport-fit=cover in engine HTML | source-assert | `grep` assertions | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/ui/__tests__/quick-wins-a11y.test.ts` (or co-located) — component tests asserting aria-label presence on hamburger/close buttons and aria-expanded binding
- [ ] `src/ui/__tests__/quick-wins-toast.test.ts` (or co-located) — assert `toast.error` is invoked with `result.error` when an action/selection is rejected, and panel re-enables

*CSS-only requirements (QUICK-04/05) and deletion (QUICK-03) are verified by source assertions (grep), not runtime tests — they are not behaviorally observable in jsdom.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| dvh / safe-area visual correctness on a real mobile browser | QUICK-04, QUICK-05 | jsdom/CI cannot render mobile viewport insets | Not required for this phase per orchestrator (non-visual fixes); optional spot-check on device |

*All testable behaviors (toast, aria) have automated verification; CSS insets are source-asserted.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
