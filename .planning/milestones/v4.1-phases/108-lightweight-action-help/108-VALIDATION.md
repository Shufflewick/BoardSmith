---
phase: 108
slug: lightweight-action-help
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-26
---

# Phase 108 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run src/engine src/session src/ui` (scoped to changed dirs) |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~8 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run` scoped to the changed dir(s)
- **After every plan wave:** Run `npx vitest run` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 108-01-* | 01 | 1 | HELP-01 (help field + .help() builder + propagation) | — | N/A | unit/integration | `npx vitest run src/engine src/session` | ❌ W0 | ⬜ pending |
| 108-02-* | 02 | 2 | HELP-01 (ActionPanel "?" affordance + popover + disabledActions) | — | N/A | component | `npx vitest run src/ui` | ❌ W0 | ⬜ pending |
| 108-03-* | 03 | 2 | HELP-02 (global toggle + localStorage + parity) | — | N/A | component | `npx vitest run src/ui` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Exact plan/task IDs finalized by the planner; every HELP-0x requirement must have an automated verify. Plan boundaries (2 vs 3 plans) at planner discretion.*

---

## Wave 0 Requirements

- Existing vitest infrastructure covers all phase requirements — no framework install.
- New test files created during execution: engine builder `.help()` unit test, `buildActionMetadata` propagation test (session), `ActionHelpPopover`/ActionPanel component tests (parity, both UI paths), ControlsMenu toggle + localStorage test.
- localStorage in jsdom: vitest jsdom env provides a localStorage stub; tests must clear it between cases (pitfall flagged in RESEARCH).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hover (pointer) vs tap (touch) reveal + global toggle persistence across reloads observed in a real browser, in custom UI + AutoUI | HELP-01, HELP-02 | Pointer/touch input modes + cross-reload localStorage are browser-observable | Deferred to Phase 110 demo gate — `npx boardsmith dev` in checkers, hover/tap the "?" affordance, toggle help in ControlsMenu, reload to confirm persistence, in both UIs |

*Component-level reveal + toggle + parity IS automated via vitest; only the final pointer-vs-touch and cross-reload visual confirmation is deferred to Phase 110.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
