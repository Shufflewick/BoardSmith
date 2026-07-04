---
phase: 136
slug: client-sdk-protocol
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-03
---

# Phase 136 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/client/` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~120 seconds (full suite, 2285+ tests baseline) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/client/`
- **After every plan wave:** `npm run test` (full suite)
- **Before `/gsd:verify-work`:** full suite green + `npx tsc --noEmit` (type-level SDK-04/05 checks)
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | SDK-01 | F23 | `connect(); await conn.action(...)` awaits open then sends; rejects loudly on timeout/failure; MeepleClient exposes awaitable open | unit | `npx vitest run src/client/game-connection.test.ts src/client/client.test.ts` | ⚠️ extend + W0 new | ⬜ pending |
| TBD | TBD | TBD | SDK-02 | F24 | disconnect→connect restores auto-reconnect; useGame({autoConnect:false}) opens no socket | unit | `npx vitest run src/client/game-connection.test.ts src/client/vue.test.ts` | ⚠️ extend + W0 new | ⬜ pending |
| TBD | TBD | TBD | SDK-03 | F25 | All 18 MeepleClient methods throw with error/errorCode on !success and non-2xx | unit | `npx vitest run src/client/client.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SDK-04 | F26 | client/types.ts re-exports canonical types; playerIds reachable; discriminated WS unions | type | `npx tsc --noEmit` | N/A compile-time | ⬜ pending |
| TBD | TBD | TBD | SDK-05 | F35 | UpdateSlotPlayerOptionsMessage in WebSocketMessage union | type | `npx tsc --noEmit` (+ exhaustive-switch compile test) | N/A compile-time | ⬜ pending |
| TBD | TBD | TBD | SDK-06 | F38 | `new MeepleClient({baseUrl, playerId})` skips generation; error names a real field | unit | `npx vitest run src/client/client.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PROC-01 | all | Verdict per finding before fix | process | `136-FINDINGS-VERIFICATION.md` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PROC-02 | all | Red-then-green per fix | process | SUMMARY documentation | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/client/client.test.ts` — new (SDK-01/03/06; 18-method contract sweep with mocked fetch)
- [ ] `src/client/vue.test.ts` — new (SDK-02 useGame; composables currently untested directly)
- [ ] `136-FINDINGS-VERIFICATION.md` — PROC-01 verdicts BEFORE fixes

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROC-01 verdict quality | PROC-01 | Judgment call | Review `136-FINDINGS-VERIFICATION.md` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 150s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
