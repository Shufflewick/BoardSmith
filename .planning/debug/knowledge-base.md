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

