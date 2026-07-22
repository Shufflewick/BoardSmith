---
phase: 161
slug: dev-host-tooling
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-21
---

# Phase 161 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (repo root) |
| **Quick run command** | `npx vitest run <changed test file(s)>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~120 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <the task's test file(s)>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 161 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 161-01-01 | 01 | 1 | DEVHOST-02, DEVHOST-04, PROC-01 | T-161-01 / T-161-02 | Out-of-range `--players` still errors; malformed palette entry fails at type level | unit (RED) | `npx vitest run src/cli/commands/dev.test.ts src/cli/dev-host/multiplayer-host.palette.test.ts` | ❌ W0 (dev.test.ts exists; palette.test.ts net-new) | ⬜ pending |
| 161-01-02 | 01 | 1 | DEVHOST-02, PROC-01 | T-161-02 | Solo default = minPlayers; explicit range-check retained | unit | `npx vitest run src/cli/commands/dev.test.ts` | ✅ dev.test.ts | ⬜ pending |
| 161-01-03 | 01 | 1 | DEVHOST-04, PROC-01 | T-161-01 | Declared palette reaches per-seat color (no engine default substitution) | unit + host | `npx vitest run src/cli/commands/dev.test.ts src/cli/dev-host/multiplayer-host.palette.test.ts && npm test` | ❌ W0 palette.test.ts | ⬜ pending |
| 161-02-01 | 02 | 2 | DEVHOST-01, PROC-01 | T-161-02 / T-161-03 | Undeclared option key rejected; malformed flag fails loud | unit + host (RED) | `npx vitest run src/cli/commands/dev.test.ts src/cli/dev-host/multiplayer-host.gameoptions.test.ts` | ❌ W0 gameoptions.test.ts | ⬜ pending |
| 161-02-02 | 02 | 2 | DEVHOST-01, PROC-01 | T-161-02 / T-161-03 | Selection validated against declared options before reaching start op | unit + host | `npx vitest run src/cli/commands/dev.test.ts src/cli/dev-host/multiplayer-host.gameoptions.test.ts` | ✅ (created 02-01) | ⬜ pending |
| 161-02-03 | 02 | 2 | DEVHOST-01, PROC-01 | T-161-05 | Preset bundle + restart persistence; merge precedence | host + unit (adversarial) | `npx vitest run src/cli/dev-host/multiplayer-host.gameoptions.test.ts src/cli/commands/dev.test.ts && npm test` | ✅ | ⬜ pending |
| 161-03-01 | 03 | 3 | DEVHOST-01, PROC-01 | T-161-02 | Selector offers only declared options; host is authoritative gate | component (RED) | `npx vitest run src/cli/dev-host/DevHost.gameoptions.test.ts` | ❌ W0 DevHost.gameoptions.test.ts | ⬜ pending |
| 161-03-02 | 03 | 3 | DEVHOST-01, PROC-01 | T-161-02 / T-161-06 | Selection emitted to authoritative host; no secrets in markup | component | `npx vitest run src/cli/dev-host/DevHost.gameoptions.test.ts && npm test` | ✅ (created 03-01) | ⬜ pending |
| 161-04-01 | 04 | 3 | DEVHOST-03, PROC-01 | T-161-07 | Orphaned seat stalls loop (pre-fix) — deterministic interleave | host (RED) | `npx vitest run src/cli/dev-host/multiplayer-host.startrace.test.ts` | ❌ W0 multiplayer-host.startrace.test.ts | ⬜ pending |
| 161-04-02 | 04 | 3 | DEVHOST-03, PROC-01 | T-161-07 | Post-await reconciliation AI-covers the seat; loop proceeds | host | `npx vitest run src/cli/dev-host/multiplayer-host.startrace.test.ts` | ✅ (created 04-01) | ⬜ pending |
| 161-04-03 | 04 | 3 | DEVHOST-03, PROC-01 | T-161-04 / T-161-08 | Seat reclaimable on reconnect (not permanently AI); DEF-C unregressed | host (adversarial) | `npx vitest run src/cli/dev-host/multiplayer-host.startrace.test.ts src/cli/dev-host/multiplayer-host.test.ts && npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Net-new test files (created by each plan's RED task before its fix):
- [ ] `src/cli/dev-host/multiplayer-host.palette.test.ts` — DEVHOST-04 palette-per-seat (Plan 01)
- [ ] `src/cli/dev-host/multiplayer-host.gameoptions.test.ts` — DEVHOST-01 selected option/preset in start op (Plan 02)
- [ ] `src/cli/dev-host/DevHost.gameoptions.test.ts` — DEVHOST-01 lobby selector (Plan 03)
- [ ] `src/cli/dev-host/multiplayer-host.startrace.test.ts` — DEVHOST-03 disconnect-mid-start interleave (Plan 04)

Existing infrastructure covers the rest:
- `src/cli/commands/dev.test.ts` — existing home for pure dev.ts helper unit tests (DEVHOST-02/04/01 helpers)
- vitest is already configured; no framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Lobby selector visual styling matches the claim area | DEVHOST-01 | Visual `--bsg-*` token parity is not asserted by the component test | Run `npx boardsmith dev` in a game declaring gameOptions/presets; confirm the selector renders in the lobby claim area using the existing color-row styling. Kill the dev server when done. |

*All functional behaviors have automated verification; only the visual-parity check above is manual.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all net-new test files
- [x] No watch-mode flags
- [x] Feedback latency < 161s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
