---
phase: 127
slug: scriptable-dev-host
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-02
---

# Phase 127 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~100 seconds (full suite, ~1999 tests) |

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
| (filled by planner) | — | — | DRIVE-01..03 | perspective + dev-only | getState only returns the requesting client's own seat view; control ops dev-host-only | unit + WS integration (in-process ws server) | `npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Zero new deps — `ws` is already a direct dependency (server side); Node 22 native WebSocket for the client side. Integration test wires `WebSocketServer({port:0})` to `MultiplayerHost` in-process (mirrors dev.ts).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Debug-panel toggle + UI switch visibly react in a real browser when driven over WS | DRIVE-03 | The page-side reaction is visual | Optional live smoke at executor discretion: `boardsmith dev` in go-fish, send ops from a Node script, observe; kill server after. The WS→page relay path is unit/integration tested either way. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
