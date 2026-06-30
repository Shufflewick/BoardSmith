---
phase: 114
slug: go-fish-action-help-host-lockout
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-30
---

# Phase 114 — Validation Strategy

> Cross-repo: changes land in `~/BoardSmithGames/go-fish` (symlinked boardsmith — no re-vendor); no BoardSmith `src/` changes expected.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (go-fish) + vitest (BoardSmith, regression only) |
| **Config file** | go-fish `vitest.config.ts` |
| **Quick run command** | `npm test -- help` / `npm test -- lock` (go-fish) |
| **Full suite command** | go-fish `npm test`; BoardSmith `npm test` |
| **Estimated runtime** | go-fish ~10–20s; BoardSmith ~60–90s |

---

## Sampling Rate

- **After every task commit:** go-fish targeted test.
- **After the wave:** go-fish full suite green; BoardSmith full suite stays green.
- **Before `/gsd:verify-work`:** both suites green; `--lock-teaching` browser checkpoint confirmed.
- **Max feedback latency:** ~90s.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 114-01-* | 01 | 1 | GFHELP-01 | `ask` action's ActionMetadata.help carries the authored string (propagates to both UIs) | integration | `npm test -- help` (go-fish) | ❌ W0 | ⬜ pending |
| 114-02-* | 02 | 1 | GFLOCK-01 | locked go-fish session: requestHint/startDemo/startTutorial throw fail-loud; action help unaffected | integration | `npm test -- lock` (go-fish) | ❌ W0 | ⬜ pending |
| 114-03-* | 03 | last | GFHELP-01, GFLOCK-01 | Browser `--lock-teaching`: Teaching group hidden, "Show action help" visible, ask help reveals; dev server killed | manual | see Manual-Only | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] go-fish: action-help test (assert `ask` metadata.help present).
- [ ] go-fish: lockout test (mirror checkers `teaching.test.ts` — ops throw + action-help kept).

*Existing vitest infra covers framework needs — no installs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ask help reveals in the custom action panel | GFHELP-01 | "?" affordance + popover is DOM/interaction | `cd ~/BoardSmithGames/go-fish && npx boardsmith dev`; ensure "Show action help" is ON; hover/tap the "?" on the ask action; confirm the help text appears. Kill server after. |
| Lockout hides teaching, keeps action help | GFLOCK-01 | Host flag + UI gating is visual | `cd ~/BoardSmithGames/go-fish && npx boardsmith dev --lock-teaching`; confirm the Teaching group (hint/demo/tutorial/heatmap) is hidden, "Show action help" is visible and works. Kill server after. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
