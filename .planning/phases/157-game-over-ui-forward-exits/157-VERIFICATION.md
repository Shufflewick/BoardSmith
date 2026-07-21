---
phase: 157-game-over-ui-forward-exits
verified: 2026-07-20T20:15:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
---

# Phase 157: Game-Over UI + Forward Exits Verification Report

**Phase Goal:** A game controls its own end state — the shell `GameOverCard` is suppressable/dismissable and never mislabels a no-winner ending, and every forward exit (Rematch / New Game / dev-restart) actually restarts, unblocking multi-game formats.
**Verified:** 2026-07-20
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A game can suppress/replace the shell `GameOverCard` via `#game-over` slot / `providesOwnGameOverUI`, the default card never mislabels a no-winner ending, and the card is dismissable (ENDGAME-01) | ✓ VERIFIED | `GameOverCard.vue` `titleText` computed is a pure function of `winners.length` + `isDraw` (0 winners + `isDraw=true` → "Draw"; 0 winners + `isDraw=false`/undefined → "Game Over"); close button (`aria-label="Close"`, 44×44px) + `useFocusTrap({escapeToClose:true, onClose: () => emit('dismiss')})`. `GameShell.vue:2150-2170` wraps both the `#game-over` slot and the default `<GameOverCard>` in one `v-if="state?.flowState?.complete && !props.providesOwnGameOverUI && !gameOverDismissed"` template — a filled slot suppresses the default card via `v-if="$slots['game-over']"` / `v-else`; `providesOwnGameOverUI` suppresses both branches by gating the whole template block. `isDraw` computed at the source: `snapshot-session-host.ts:283,307` — `isDraw: this.isComplete && this.winners.length === 0` — threaded through `bridge.ts` (widened `DevSession.meta()` return type + local mirror) → `multiplayer-host.ts` (`game_state` frame `isDraw: meta.isDraw`) → `GameShell.vue:1188` (`isDraw.value = data.isDraw === true`) → card prop. |
| 2 | Rematch / New Game / dev-restart from a finished game actually restart (ENDGAME-02) | ✓ VERIFIED | `DevHost.vue:229` — `onWindowMessage` branch for `op === 'debug:restart'` calls `newGame()` (→ `wsSend({type:'restart'})`), placed BEFORE the generic `server_request` forward that previously swallowed it. `GameShell.vue:1768` — `handleMenuItemClick('new-game')` now calls `handleRestartGame()` (same path as Rematch), replacing the old `leaveGame()` call. `DebugPanel.vue` emits `restart-game` → `GameShell.vue:2433` `@restart-game="handleRestartGame"` — same real path. All four forward exits (Rematch, New Game, dev-restart, DebugPanel restart) converge on `{type:'restart'}` → `multiplayer-host.ts handleRestart` → `startGame()` (fresh runner + seed). `handleRestart`'s guard (`this.phase !== 'playing' \|\| !this.session`) already admitted finished games pre-fix (no `'complete'` LobbyPhase value exists — completion never flips `phase` off `'playing'`); this was confirmed via code read, not just SUMMARY claim. |
| 3 | Both covered by tests that fail on pre-fix behavior and pass after (PROC-01) | ✓ VERIFIED | RED commit `78158e9b` (157-01): 10 failed / 47 passed against unfixed source, genuine assertion failures (`'Game Over' to be 'Draw'`, missing close control, slot silently dropped, `providesOwnGameOverUI` ignored) — verified via `git show --stat`. RED commit `bf73ed2b` (157-02): 3 failed / 44 passed — `DevHost.restart.test.ts` (`debug:restart` → no `{type:'restart'}` on wire; unhandled frame forwarded instead) and `GameShell.restart.test.ts` (`'new-game'` called `leaveGame()`, never requested restart) are TRUE RED; the `multiplayer-host.test.ts` "restart from a finished game" block is correctly identified and documented as CHARACTERIZATION (passed pre-fix too — proving the guard was never the bug), not a false RED. This matches the corrected D11 root cause (routing, not a guard relaxation) — the SUMMARY explicitly states the guard tightening is "defensive-only hardening... NOT the D11 fix," which I independently confirmed by reading `multiplayer-host.ts:262-271`'s own comment and the `LobbyPhase` type (no `'complete'` value). Full suite run independently: `npm test` → 195 files / 2808 tests pass, matching the expected baseline exactly. |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/components/GameOverCard.vue` | Draw/unknown labeling, dismiss affordance, no winner-token leak | ✓ VERIFIED | Read in full; matches spec exactly |
| `src/ui/components/GameShell.vue` | `#game-over` slot, `providesOwnGameOverUI`, isDraw capture, new-game routing | ✓ VERIFIED | Slot/flag suppression logic + `isDraw.value` capture at line 1188 + `handleMenuItemClick` line 1768 confirmed |
| `src/cli/dev-host/DevHost.vue` | `debug:restart` handler | ✓ VERIFIED | Line 229, routes to `newGame()` before generic forward |
| `src/cli/dev-host/multiplayer-host.ts` | isDraw threading, restart guard (unchanged behavior for finished games) | ✓ VERIFIED | `isDraw` present in `game_state` frame; guard confirmed pre-existing-permissive via `LobbyPhase` type read |
| `src/cli/dev-host/bridge.ts` | Widened meta type to carry `isDraw` | ✓ VERIFIED | `DevSessionOptions`/`DevSession.meta()` widened, local mirror captured in broadcast callback |
| `src/session/snapshot-session-host.ts` | `isDraw` computed at the source | ✓ VERIFIED | Lines 283, 307 |
| `GameOverCard.test.ts`, `GameShell.game-over.test.ts`, `GameShell.restart.test.ts`, `DevHost.restart.test.ts`, `multiplayer-host.test.ts` (extended) | PROC-01 RED/GREEN coverage | ✓ VERIFIED | Test names and RED output confirmed against `git show` of RED commits; degrade-vs-draw negative-control test present (`stays "Game Over" (not "Draw") when isDraw=false and winnerSeats=[]`) |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `GameShell.vue` template | `GameOverCard.vue` / `#game-over` slot | `v-if` mutually-exclusive branches, gated by `providesOwnGameOverUI` and `gameOverDismissed` | ✓ WIRED (real DOM removal, not `v-show`) |
| `snapshot-session-host.ts` | `GameOverCard` `is-draw` prop | `isDraw` → `bridge.ts` mirror → `multiplayer-host.ts` `game_state.isDraw` → `GameShell.vue:1188` → template `:is-draw="isDraw"` | ✓ WIRED (full chain read end-to-end) |
| `DevHost.vue onWindowMessage` | `multiplayer-host.ts handleRestart` | `debug:restart` → `newGame()` → `wsSend({type:'restart'})` → ws `restart` message | ✓ WIRED |
| `GameShell.vue handleMenuItemClick('new-game')` | `handleRestartGame` | direct call (was `leaveGame()`) | ✓ WIRED |
| `DebugPanel.vue restart-game` event | `handleRestartGame` | `@restart-game="handleRestartGame"` (GameShell.vue:2433) | ✓ WIRED |

### Anti-Patterns Found

None. Grepped `TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER\|not yet implemented\|not available` across all 6 touched production files — zero matches.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| ENDGAME-01 | 157-01 | Suppressable/dismissable/correctly-labeled GameOverCard | ✓ SATISFIED | See Truth 1 |
| ENDGAME-02 | 157-02 | All forward exits from a finished game restart | ✓ SATISFIED | See Truth 2 |
| PROC-01 | 157-01, 157-02 | RED-before-GREEN + adversarial verification | ✓ SATISFIED | See Truth 3; RED commits independently confirmed via `git show`, not just SUMMARY narrative |

### Independent Test Run

`npm test` executed directly by the verifier (not sourced from SUMMARY): **195 files / 2808 tests pass**, matching the expected baseline exactly, 0 failures.

### Human Verification Required

None. All success criteria are code-level (component logic, message routing, threading) and were verified by direct source read plus an independently-executed test run; no visual/UX judgment call is required beyond what the automated test suite already covers (button hit-target sizing, focus-trap Escape behavior, DOM-presence-based suppression assertions).

### Gaps Summary

None. All 3 roadmap success criteria verified directly against source (not SUMMARY claims). The SUMMARY's account of the corrected D11 root cause (routing fix, not a guard relaxation) was independently confirmed by reading `multiplayer-host.ts`'s `handleRestart` guard and the `LobbyPhase` type — no `'complete'` phase value exists, so the guard never blocked a finished-game restart; the routing gaps (DevHost's missing `debug:restart` branch, GameShell's `'new-game'` calling `leaveGame()`) were the real D11 defects, and both are now fixed and test-covered.

---

_Verified: 2026-07-20_
_Verifier: Claude (gsd-verifier)_
