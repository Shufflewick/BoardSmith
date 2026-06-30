---
phase: 112
slug: go-fish-tutorial-content
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-29
---

# Phase 112 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. This phase spans TWO repos: BoardSmith (`src/engine/tutorial/gate.ts` matcher fix) and `~/BoardSmithGames/go-fish` (tutorial content + CI test).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (both repos) |
| **Config file** | BoardSmith: `vitest.config.ts`; go-fish: `vitest.config.ts` (auto-picks `tests/**/*.test.ts`) |
| **Quick run command** | BoardSmith: `npx vitest run src/engine/tutorial/gate.test.ts`; go-fish: `npm test -- tutorial` |
| **Full suite command** | BoardSmith: `npm test`; go-fish: `npm test` |
| **Estimated runtime** | BoardSmith full ~60–90s; go-fish full ~10–20s |

---

## Sampling Rate

- **After every task commit:** Run the touched repo's quick command.
- **After every plan wave:** Run the touched repo's full suite. After the BoardSmith matcher fix (Wave 1), BoardSmith full suite must stay green.
- **Before `/gsd:verify-work`:** Both repos' full suites green; go-fish `tutorial.test.ts` green AND proven red on the deliberate break.
- **Max feedback latency:** ~90 seconds (BoardSmith full suite).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 112-01-* | 01 | 1 | (substrate gap) | — | `selectionMatchesValue` matches primitive `{ value }` matcher; non-matching primitives still gated | unit | `npx vitest run src/engine/tutorial/gate.test.ts` | ❌ W0 (add cases) | ⬜ pending |
| 112-02-* | 02 | 2 | GFT-01, GFT-04 | — | Ask gated to held rank + legal opponent; turn continues on a hit | integration | `npm test -- tutorial` (go-fish) | ❌ W0 | ⬜ pending |
| 112-02-* | 02 | 2 | GFT-02, GFT-03 | — | Go-Fish draw tip fires on miss; book scored+removed advances step | integration | `npm test -- tutorial` (go-fish) | ❌ W0 | ⬜ pending |
| 112-02-* | 02 | 2 | GFT-05 | — | `tutorial:` on `gameDefinition` lights ControlsMenu entry (GameShell + dev host) | manual | see Manual-Only | n/a | ⬜ pending |
| 112-03-* | 03 | 3 | GFT-06 | — | `simulateTutorial`+`assertTutorialCompletes` green; red on `checkForBooks=()=>[]` break | integration | `npm test -- tutorial` (go-fish) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] BoardSmith: extend `src/engine/tutorial/gate.test.ts` (or sibling) with primitive-matcher cases (match `{ value:'7' }`, gate `{ value:'Q' }` when value is `'7'`).
- [ ] go-fish: create `tests/tutorial.test.ts` — `simulateTutorial(testGame, GO_FISH_TUTORIAL, { seat, scenario, seed })` walkthrough + green→red proof.

*Existing vitest infrastructure covers framework needs in both repos — no installs required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tutorial launchable in GameShell + `boardsmith dev` host | GFT-05 | Launch surface is a UI control wired by v4.1 substrate; rendering parity is visual | `cd ~/BoardSmithGames/go-fish && npx boardsmith dev`; open the game, confirm ControlsMenu shows "Start tutorial", start it, confirm overlay anchors to a named card in hand (not a board cell). Kill the dev server after. |
| Overlay anchors to card/hand element | GFT-01 | `data-bs-el-id` resolution from AutoUI is a render-time DOM concern | During the dev-host run, confirm the first ask-step annotation visibly anchors to the learner's held card(s). |

*Deferred to Phase 114 DEMO-style live confirmation if not done here; the CI test covers logical completion.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
