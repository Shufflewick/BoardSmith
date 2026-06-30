---
phase: 110-demonstration-refinement
type: handoff
status: in-progress
created: 2026-06-29
---

# Phase 110 — Handoff for a fresh agent

Read this first, then `110-REFINEMENTS.md` (the running friction/fix log) and
`110-DEMO-SCRIPT.md` (the DEMO-01 test checklist). We are mid **DEMO-01** — a live
browser refinement pass of the checkers teaching features in the dev host.

## Repos & how the dev host works
- BoardSmith library: `~/BoardSmith`. Checkers game: `~/BoardSmithGames/checkers`.
- `~/BoardSmithGames/checkers/node_modules/boardsmith` is a **symlink to ~/BoardSmith**, so the running dev host uses BoardSmith source live.
- Launch: `cd ~/BoardSmithGames/checkers && npx boardsmith dev --ai 2` → http://localhost:5173.
- **Client-side changes (Vue: ActionPanel/GameShell/ControlsMenu/HintOverlay/BoardMessage, useActionController/useBoardActionBridge)** → **hard-refresh** the browser (Cmd+Shift+R). Vue composable HMR is unreliable; hard reload.
- **Server-side changes (src/session/*, src/cli/dev-host/bridge.ts)** → **RESTART the dev host node process** (`pkill -f "boardsmith dev"` then relaunch). Vite HMR does NOT pick these up.
- Dev-host seat note: seats are pinned to a browser's persistent id. The user holds **Seat 1** in their own browser; a 2nd browser can only take Seat 2. "Follow active seat" (seat dropdown) drives the active seat but is a DIFFERENT controller instance — it has different broadcast timing, so it does NOT faithfully reproduce seat-1-only timing bugs (this fooled an earlier "verified"). For timing-sensitive bugs you need genuine Seat 1 (ask the user to free it).

## Current dev server
A dev host is running (`npx boardsmith dev --ai 2`, started after the last fix). If unsure, `lsof -nP -iTCP:5173 -sTCP:LISTEN`. **Per CLAUDE.md, kill any dev server you start before returning to the user.**

## State of the test suites
- BoardSmith: **1662/1662 green**. Checkers: **38/38 green**. (`cd ~/BoardSmith && npx vitest run`)
- Pre-existing `tsc --noEmit` errors exist in unrelated test files ($images, external `@boardsmith/checkers-rules`, type casts) — NOT from this work. vitest is the gate.

## Work completed this session (ALL uncommitted, all unit-tested)

Earlier (the tutorial-hang saga — user-confirmed working):
- **R-06b** — false "No options available" for board-anchored choice destinations. Fix in `ActionPanel.vue` (empty-state checks `filteredChoices.length===0 && anchoredChoices.length===0`).
- **R-07** — tutorial hung on the FIRST move: an auto-started Move action (choices = pre-tutorial pieces) survived the tutorial `setup()` board reset. Fix in `useActionController.ts` tutorialStep watcher: on inactive→active, cancel the stale non-server-pending action.
- **R-08** — multi-jump didn't auto-end the turn (stray End Turn + Undo). Root cause: the selection-step completion path never toggles `isExecuting`. Fix: controller pulses `actionCompletedTick`; bridge `useBoardActionBridge.ts` arms an auto-end and retries when `pendingFollowUp` clears. Checkers tutorial `confirm-turn` step reworded. **User CONFIRMED this works.**

This turn (the 5 UI/UX issues the user raised — see screenshots in the chat):
1. **Action dock layout** — anchored choices now render INLINE in the dock flex flow (no separate "Select on board or choose here" centered block). `ActionPanel.vue` template + removed `.anchored-choices*` CSS. **Verified in browser.**
2. **AI hint empty + covers board** — `src/session/move-summary.ts` (new) builds readable move text; hint text is now "Suggested: c5 → a3" (`stateless-ops.ts` handleHint + `game-session.ts` requestHint). `HintOverlay.vue` `bubbleFallbackStyle` repositioned BELOW the board. **NEEDS USER BROWSER CONFIRMATION.**
3. **Tutorial in its own menu section** — merged into the single TEACHING group in `ControlsMenu.vue`. **Verified in browser.**
4. **AI demo narration showed JSON** — `snapshot-session-host.ts buildNarration` + `game-session.ts` default narrator now use `describeMoveDestination` → "Player 1: move c5 → a3 (capture)". `BoardMessage.vue` narration `max-width` widened to `min(440px,92vw)`. **Verified in browser (readable text).**
5. **AI demo too fast / no controls** — added a live **demo control bar** (Slow/Normal/Fast speed, ◀ back, ⏸/▶ play-pause, ▶| step, Stop) in `GameShell.vue`. Server: new `demoControl` op (`stateless-ops.ts` Op union, `bridge.ts` wire op `demo-control`), `snapshot-session-host.ts` refactored `runDemoLoop` into a controllable pace-gate (`demoPaceOrPause` + `wakeDemo`) with pause/step/back + speed, broadcasting `state.demoControls = { paused, delay, canStepBack }`. **Speed + Pause verified in browser. Step/Back: fixed a freeze bug (wakeDemo was nulling its gate handle so play/step after pause froze) — fix applied + suite green, but NOT yet re-confirmed end-to-end in the browser (got bounced to join screen). USER MUST CONFIRM step/◀ advance.**

## Files changed this turn (all uncommitted)
- `src/ui/components/auto-ui/ActionPanel.vue` (inline anchored choices)
- `src/ui/components/ControlsMenu.vue` (teaching/tutorial merge)
- `src/ui/components/helpers/HintOverlay.vue` (fallback below board)
- `src/ui/components/helpers/BoardMessage.vue` (narration width)
- `src/ui/components/GameShell.vue` (demo control bar + handlers + CSS)
- `src/session/move-summary.ts` (NEW) + `src/session/move-summary.test.ts` (NEW)
- `src/session/snapshot-session-host.ts` (narration + demo controls/loop) + `.test.ts` (demoControl test)
- `src/session/stateless-ops.ts` (hint text + demoControl Op)
- `src/session/game-session.ts` (hint text + narration)
- `src/cli/dev-host/bridge.ts` (demo-control wire op)
- (earlier R-06b/R-07/R-08): `useActionController.ts(+.test)`, `useBoardActionBridge.ts(+.test)`, `ActionPanel.interaction.test.ts`, checkers `src/rules/tutorial.ts`

## What's left
1. **User confirms**: hint (issue 2) + demo step/back (issue 5) in their Seat 1 browser after a hard refresh.
2. **Commit** the batch once confirmed — suggest logical groups: (a) R-06b, (b) R-07, (c) R-08 + checkers tutorial reword, (d) the 5 UI fixes (or split hint/narration/menu/dock/demo-controls). End commit messages with the Co-Authored-By line from CLAUDE.md. Checkers tutorial reword is a separate commit in `~/BoardSmithGames/checkers`.
3. **Resume DEMO-01** test checklist (`110-DEMO-SCRIPT.md`): Beat 1 (tutorial) ✅ done; remaining Beats 2 (hint), 3 (AI demo), 4 (heatmap), 5 (action help), 6 (AutoUI parity). User reply "approved" closes the DEMO-01 gate.
4. Update `110-REFINEMENTS.md` with the issue-1..5 entries (not yet logged there — ran out of context).

## How to verify quickly
- `cd ~/BoardSmith && npx vitest run` (expect 1662 pass) and `cd ~/BoardSmithGames/checkers && npx vitest run` (38 pass).
- Browser: hard-refresh; Controls menu (⋮) → Teaching → Watch AI demo to exercise the control bar; Get a hint to check the hint bubble.
