---
phase: 140
slug: library-prerequisite-useannouncer
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 140 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (already configured) |
| **Config file** | `vitest.config.ts` (default `environment: 'node'`; per-file `// @vitest-environment jsdom` override) |
| **Quick run command** | `npx vitest run src/ui/composables/useAnnouncer.test.ts src/ui/components/GameShell.announcer.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/ui/composables/useAnnouncer.test.ts src/ui/components/GameShell.announcer.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 140-01-* | 01 | 1 | LIB-01 | — | N/A | unit | `npx vitest run src/ui/composables/useAnnouncer.test.ts` | ❌ W0 | ⬜ pending |
| 140-01-* | 01 | 1 | LIB-01 | — | N/A | component (jsdom) | `npx vitest run src/ui/components/GameShell.announcer.test.ts` | ❌ W0 | ⬜ pending |

Behaviors covered: importable from `boardsmith/ui` returning `{ announce }`; writes to GameShell's existing refs with no new DOM nodes; clear-then-set duplicate re-announce; no-provider no-op + one-time dev warning; custom-UI/AutoUI parity via shared inject; `boardsmith-a11y` postMessage relay fired per announce.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/ui/composables/useAnnouncer.ts` — the composable (does not exist yet)
- [ ] `src/ui/composables/useAnnouncer.test.ts` — unit tests (node env, no-mount style mirroring `useAnimationEvents.test.ts`)
- [ ] `src/ui/components/GameShell.announcer.test.ts` — jsdom component test with minimal test-host component (mount + provide), proving parity and relay
- [ ] No framework install needed — vitest and `@vue/test-utils` already present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Screen reader actually voices announcements | LIB-01 | jsdom cannot drive real AT (VoiceOver) | Run a game via `npx boardsmith dev`, enable VoiceOver, trigger an announce, confirm it is voiced |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-04
