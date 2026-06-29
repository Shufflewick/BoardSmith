---
phase: 110
slug: demonstration-refinement
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-29
---

# Phase 110 — Validation Strategy

> Per-phase validation contract. Wires the dev-host teaching ops (hint/heatmap/demo) + un-hides controls; then a user-driven browser demonstration (DEMO-01). CROSS-REPO (small checkers `hintTargetFromMove` addition).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (both repos) |
| **Config file** | BoardSmith `vitest.config.ts`; checkers `vitest.config.ts` |
| **Quick run** | `npx vitest run src/session src/ui` (BoardSmith) |
| **Full suite** | `npx vitest run` (BoardSmith); `cd ~/BoardSmithGames/checkers && npx vitest run` |
| **Demo-loop tests** | use `delay: 0` + fake/advanced timers for determinism |
| **Estimated runtime** | ~9s BoardSmith; ~2s checkers |

---

## Sampling Rate

- **After every task commit:** scoped `npx vitest run` on the changed dir(s).
- **After the wiring waves:** BoardSmith full suite + checkers suite green.
- **Before the demonstration handoff:** both suites green AND `cd ~/BoardSmithGames/checkers && npx boardsmith dev` launches cleanly with no console errors on startup.
- **Max feedback latency:** ~15 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Repo | Test Type | Automated Command | Status |
|---------|------|------|-------------|------|-----------|-------------------|--------|
| 110-01-* | 01 | 1 | DEMO-01 (transient-state injection + hasAIPlayers + showHint un-hide) | BoardSmith | unit/integration | `npx vitest run src/session src/ui` | ⬜ pending |
| 110-02-* | 02 | 2 | DEMO-01 (hint + heatmap ops through bridge/stateless-ops) | BoardSmith | unit/integration | `npx vitest run src/session` | ⬜ pending |
| 110-03-* | 03 | 2/3 | DEMO-01 (demo-start/stop loop + narration, cancellable, no leaked timer) | BoardSmith | integration (fake timers) | `npx vitest run src/session` | ⬜ pending |
| 110-04-* | 04 | 3 | DEMO-01 (checkers hintTargetFromMove for hint highlight) | checkers | unit | `cd ~/BoardSmithGames/checkers && npx vitest run` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Exact plan/task IDs + waves finalized by the planner. Plan boundaries at discretion; transient-injection foundation (01) lands before the ops that depend on it (02/03).*

---

## Wave 0 Requirements

- Existing vitest infra covers all requirements in both repos — no install.
- Demo-loop determinism: the loop uses `setTimeout`; tests MUST use `delay: 0` and/or vitest fake timers (`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`) and MUST assert the loop stops cleanly (no pending timer) on `demo-stop` and on game-over — this is a CLAUDE.md hard rule (never leave timers running).
- New tests: stateless-ops hint/heatmap handler tests; SnapshotSessionHost transient-merge + demo-loop lifecycle tests; GameShell `showHintProp` platform-mode test; checkers `hintTargetFromMove` test.

---

## Manual-Only Verifications (THE DEMO-01 GATE — user-driven)

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full teaching demonstration in the browser, both custom UI + AutoUI | DEMO-01 | This phase IS the hands-on user refinement checkpoint — interactive, visual, and the whole point of the phase | `cd ~/BoardSmithGames/checkers && npx boardsmith dev`: (1) checkers tutorial start→finish (4 beats, overlays, gating, capture tip, multi-jump); (2) AI move hint highlights the suggested target; (3) AI-vs-AI narrated demo announces each move before it plays, at a readable pace, and stops cleanly; (4) evaluation heatmap toggles on/off with per-cell intensity+badge; (5) action-help hover/tap reveal + global toggle persists. Capture friction + refinement requests. |

*All wiring is automated-tested headlessly; the live demonstration + refinement capture is the irreducible human gate (success criterion #4).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Demo loop tests assert NO leaked timer on stop + game-over
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] Both suites green + `boardsmith dev` launches clean before handoff
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
