---
phase: 126
slug: structured-error-surfacing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 126 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~95 seconds (full suite, ~1956 tests) |

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
| (filled by planner) | — | — | ERR-01..04 | error-info leakage | Warnings/logs never include stack traces or internal paths in player-facing surfaces; codes stable | unit | `npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — no new deps. Tests colocate with modified modules (pick-handler, runner, game-session, snapshot-session-host, stateless-ops, bridge).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `debug:logs` op live in dev host (agent polls captured errors) | ERR-04 | Browser/WS path | Optional live smoke: `boardsmith dev` in go-fish, trigger a warning, poll debug:logs via devtools/DebugPanel; kill server after. Unit tests on host lifecycle may make this unnecessary — planner decides. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
