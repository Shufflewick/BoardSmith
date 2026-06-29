---
phase: 109
slug: checkers-tutorial-content
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-27
---

# Phase 109 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. CROSS-REPO: BoardSmith substrate + checkers content.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (both repos) |
| **Config file** | BoardSmith `vitest.config.ts`; checkers `~/BoardSmithGames/checkers/vitest.config.ts` |
| **Quick run (substrate)** | `npx vitest run src/engine src/session src/ui` (in BoardSmith) |
| **Quick run (content)** | `cd ~/BoardSmithGames/checkers && npx vitest run` |
| **Full suite (substrate)** | `npx vitest run` (in BoardSmith) |
| **Estimated runtime** | ~8s BoardSmith; ~2s checkers |

---

## Sampling Rate

- **After every substrate task commit (BoardSmith):** Run `npx vitest run` scoped to the changed dir(s).
- **After every content task commit (checkers):** Run `cd ~/BoardSmithGames/checkers && npx vitest run`.
- **After the substrate waves land:** Run the BoardSmith full suite; then confirm checkers still imports `boardsmith`/`boardsmith/testing` via the symlink (no rebuild needed) by running the checkers suite.
- **Before `/gsd:verify-work`:** BoardSmith full suite green AND checkers suite green (incl. the new tutorial CI test).
- **Max feedback latency:** ~15 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Repo | Test Type | Automated Command | Status |
|---------|------|------|-------------|------|-----------|-------------------|--------|
| 109-01-* | 01 | 1 | CHK-01 (LR-02 per-selection gate) | BoardSmith | unit | `npx vitest run src/engine` | ⬜ pending |
| 109-02-* | 02 | 1 | CHK-04 (start-tutorial op + ControlsMenu launch) | BoardSmith | unit/integration | `npx vitest run src/session src/ui` | ⬜ pending |
| 109-03-* | 03 | 2 | CHK-01/02/03 (checkers tutorial def + preset + registration) | checkers | content+unit | `cd ~/BoardSmithGames/checkers && npx vitest run` | ⬜ pending |
| 109-04-* | 04 | 3 | TUT-04 (CI-verifiable tutorial.test.ts green→red) | checkers | integration | `cd ~/BoardSmithGames/checkers && npx vitest run tests/tutorial.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Exact plan/task IDs + wave boundaries finalized by the planner. Substrate (LR-02 gate, launch op) lands first so checkers content can consume it via the symlink. Every CHK-0x requirement has an automated verify.*

---

## Wave 0 Requirements

- Existing vitest infrastructure covers all requirements in BOTH repos — no framework install.
- New test files: BoardSmith — gate per-selection unit test (`src/engine/tutorial/gate.test.ts` or sibling), start-tutorial op + ControlsMenu launch tests. Checkers — `tests/tutorial.test.ts` (the CI-verifiable walkthrough + green→red proof).
- Cross-repo resolution: confirmed live via the `node_modules/boardsmith` symlink + all-`src/` exports — new BoardSmith exports are importable from checkers vitest with NO rebuild/re-vendor (RESEARCH finding; supersedes the CONTEXT.md rebuild caution).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The checkers tutorial runs end-to-end in the browser (GameShell + `boardsmith dev` host): launch via the ControlsMenu item, two-step move gating + annotations render, mandatory-capture tip fires, multi-jump walkthrough completes | CHK-01..04 | Full interactive tutorial + overlay rendering + launch control are browser-observable | Deferred to Phase 110 (DEMO-01) — `cd ~/BoardSmithGames/checkers && npx boardsmith dev`, start the tutorial, walk all beats, in both custom UI + AutoUI |

*The CI-verifiable test (TUT-04) automates the full step-transition walkthrough headlessly; only the visual/launch confirmation is deferred to Phase 110.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] Checkers CI test proves green→red on a deliberate rules break
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
