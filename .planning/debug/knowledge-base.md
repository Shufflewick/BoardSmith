# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## 110-checkers-multijump-hang — checkers tutorial multi-jump hang: tutorialStep suppressAutoFill timing race
- **Date:** 2026-06-29
- **Error patterns:** multi-jump, hang, followUp, suppressAutoFill, tutorialStep, stale, pendingOnServer, startFollowUp, execute-capture, selection-step
- **Root cause:** In startFollowUp, fetchAndAutoFill→tryAutoFillSelection fires while tutorialStep still holds the completing step (execute-capture, suppressAutoFill:true) because the game_state WebSocket broadcast hasn't arrived yet (separate async channel from platformRequest). isTutorialSuppressingAutoFill returns true → destination not auto-filled → isReady=false → R-04 guard misses → permanent hang. When broadcast later updates tutorialStep, no existing watcher retries auto-fill.
- **Fix:** Added watch on options.tutorialStep in useActionController. When suppressAutoFill changes true→false while a pendingOnServer action has an unfilled currentPick, retries tryAutoFillSelection (choices already in pickSnapshot) and routes through handleOnSelectFill (R-04 path) if isReady.
- **Files changed:** src/ui/composables/useActionController.ts, src/ui/composables/useActionController.picks.test.ts
---

## 138-devhost-seat-mismatch — boardsmith dev auto-open browser wins the seat-1 race against scripted clients
- **Date:** 2026-07-03
- **Error patterns:** isMyTurn never true, Not your turn, seat mismatch, dev host, MultiplayerHost, auto-seat, simultaneousActionStep, AI auto-discard, boardsmith dev, Playwright headless
- **Root cause:** `npx boardsmith dev` unconditionally calls `await open(hostUrl)` (src/cli/commands/dev.ts), auto-launching the real default browser as an uncontrolled WS client that wins MultiplayerHost.hello()'s "first arrival auto-seats seat 1" race before a scripted/headless driver connects, starving the scripted client of its own seat's turn (strict turn order) or letting the AI auto-play a simultaneousActionStep seat during the brief AI-owned window before the scripted client joins. Pre-existing since the always-on-multiplayer feature, not a version-specific regression — only surfaces when driving `boardsmith dev` headlessly/scripted.
- **Fix:** Added a pure `shouldOpenBrowser(options)` helper and a `--no-open` CLI flag (commander negatable-option convention) guarding the `open()` call in devCommand, so scripted/CI drivers can opt out and become the sole WS client.
- **Files changed:** src/cli/commands/dev.ts, src/cli/commands/dev.test.ts, src/cli/cli.ts
---

## seven-undo-message — seven's "published-discard undo" test asserted stale pre-BSR-7 message for seats 2/3
- **Date:** 2026-07-22
- **Error patterns:** No actions to undo, not your turn, computeUndoEligibility, undo, simultaneousActionStep, awaitingPlayers, currentPlayer, BSR-7, D4, SIM-02, published-discard, publication barrier
- **Root cause:** Not a library bug. The failing test in a downstream game (seven) was written against BSR-7's pre-fix behavior (`flowState.currentPlayer` pinned at 1 for a whole simultaneous step, so `handleUndo` refused every non-seat-1 op with "It's not your turn" regardless of real participation). BoardSmith Phase 160 (D4/SIM-02) fixed BSR-7 exactly as its own filing requested: `computeUndoEligibility` now authorizes per-seat from `flowState.awaitingPlayers` participation, not `currentPlayer`. By the time the test's forged undo runs, the discard barrier has already auto-published (a synchronous `execute()` flow node) and the round loop has advanced into a brand-new simultaneous step where every seat equally has zero actions taken — "No actions to undo" is therefore the objectively correct message for every seat, not just seat 1.
- **Fix:** No library change. Updated the downstream game's test assertion (was asserting stale BSR-7 pre-fix behavior) and marked BSR-7 RESOLVED in that game's BOARDSMITH-REQUESTS.md filing.
- **Files changed:** ~/BoardSmithGames/seven/tests/game.test.ts, ~/BoardSmithGames/seven/BOARDSMITH-REQUESTS.md (downstream repo, not BoardSmith itself)
---

