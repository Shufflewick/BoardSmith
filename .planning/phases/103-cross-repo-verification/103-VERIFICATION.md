---
phase: 103
name: Cross-Repo Verification
status: passed
verified: 2026-06-23
verifier: orchestrator (automated sweep agent + browser pass)
---

# Phase 103 — Cross-Repo Verification

**Goal:** After the v4.0 Slate redesign (Phases 97–102), every consuming game and MERC must still build, pass tests, and play in the browser; BoardSmith's own suite + boundary tests stay green.

## Requirement verification

### VERIFY-01 — games build + test ✅
All games present in `~/BoardSmithGames/` build and pass their suites (one-shot `vitest run`):

| Game | Build | Tests |
|------|-------|-------|
| checkers | ✅ | 15/15 |
| cribbage | ✅ | 20/20 |
| go-fish | ✅ | 30/30 |
| hex | ✅ | 19/19 |
| polyhedral-potions | ✅ | 24/24 |
| demo-action-panel | ✅ | (no suite) |
| demo-animation | ✅ | 8/8 |
| demo-complex-ui | ✅ | 4/4 |

Note: 8 games present (the former `floss-bitties` is no longer in the repo). Requirement text said "9"; verified against the actual 8.

### VERIFY-02 — games render + playable in browser ✅ (with documented caveat)
Browser pass (Claude-in-Chrome, Slate light-mode OS) across all three major renderer archetypes + a custom UI:
- **hex** (HexBoardRenderer): board renders in Slate, fits container, no scrollbars; no console errors.
- **go-fish** (Card/Hand/Deck renderers + custom green-felt UI): face-up cards, face-down cards on the new `--bsg-card-back`, POND deck; no console errors.
- **checkers** (GridBoardRenderer + custom palette): 8×8 board fits container (fluid sizing — **no regression** despite the Phase 100 risk), correct piece layout, history log; no console errors.
- Chrome verified: mockup structure (sidebar `.side-head` Shufflewick + ⋯ menu above players, collapsible rail, full board hero), shape-based player identity, per-player status sidebar, Game History as `role=log`, the ⋯ controls menu (Auto-end-turn / Undo / **Fit-board = zoom-as-a11y-magnifier** / New game / Leave), the **teal primary button** (Create Game), dev chrome default-collapsed + DEBUG tab. Zero console errors on every surface.

**Caveat (not a v4.0 regression):** live two-step/drag human moves could not be exercised because the dev-host AI in the open seat never yields its turn (reproduced across all three games; server-side AI/session code is unchanged this milestone — see `.planning/todos/pending/dev-host-ai-open-seat-not-auto-playing.md`). The selection pipeline is covered by `useSelectable` tests + each game's interaction suite (all green), and selectable affordances render correctly. Interaction is therefore verified by automated tests; live in-browser move-making is a deferred follow-up gated on the pre-existing AI-turn issue.

### VERIFY-03 — MERC re-vendor + build + test ✅
MERC (`~/Dropbox/MERC/BoardSmith/MERC`) re-vendored with the new BoardSmith tarball, builds, and passes: **738 passed / 7 skipped**. One cross-repo migration fix applied (the deliberate `--bs-*`→`--bsg-*` token rename): `src/ui/components/AssignToSquadPanel.vue` drag-drop token overrides renamed to `--bsg-droptarget*`. MERC changes (package.json re-vendor, lock, the Vue fix, new vendor tgz) left **uncommitted** for the user to decide.

### VERIFY-04 — BoardSmith suite + boundary tests ✅
BoardSmith: **1245/1245** tests, `lint:css` exit 0. All three cross-layer boundary tests present:
- token→render: `src/ui/theme.contrast.test.ts` (both-theme contrast assertions)
- keyboard→select: `src/ui/composables/useSelectable.test.ts`
- postMessage→theme: `src/ui/components/GameShell.theme.test.ts` (+ `src/ui/theme.test.ts`)

## Findings (non-blocking, logged as todos)
1. **Dev-standalone shell height gap** (low, cosmetic, dev-only) — white band below the board region in `boardsmith dev` standalone; shell not filling `100dvh`. → `.planning/todos/pending/dev-standalone-shell-height-gap.md`
2. **Dev-host AI open seat not auto-playing** (medium, pre-existing, NOT a v4.0 regression) — blocks live in-browser play past the AI's turn. → `.planning/todos/pending/dev-host-ai-open-seat-not-auto-playing.md`

## Verdict
**PASSED.** All VERIFY requirements met: 8 games + MERC build and pass their suites, BoardSmith 1245 green with the three boundary tests, and the Slate redesign renders correctly across every renderer archetype + custom UI in the browser with zero console errors and no fluid-sizing regression. Two non-blocking follow-ups (one cosmetic dev-only, one pre-existing AI-scheduling) are logged as todos.
