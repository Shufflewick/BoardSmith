# Phase 157: Game-Over UI + Forward Exits - Research

**Researched:** 2026-07-20
**Confidence:** HIGH (both defects root-caused via codebase scout)

## Summary

Two independent defects sharing a phase. D10 is presentation (labeling + suppression + dismiss on an
existing card). D11 is control-flow: the real restart path exists but the forward-exit controls don't
reach it, and the one that does is guard-rejected for finished games.

## D10 — Game-Over UI (ENDGAME-01)

- `GameOverCard.vue` — props `winnerSeats:number[]`, `players:Player[]`; emits `rematch`,`new-game`.
  Mislabel site: `titleText` computed `:69-81` (no draw concept; `winners.length===0` → generic
  "Game Over"; multi → always "win"). No dismiss (`escapeToClose:false`, `:12-13`). No slot.
- Mount guard `GameShell.vue:2088-2094` (`v-if="state?.flowState?.complete"`). `winnerSeats` from
  postMessage `:306-308`,`:1144-1150` (defaults `[]` on degrade — collapses draw and unknown).
- Slot convention: `#game-board`/`#action-panel`/`#sidebar-extra`/`#player-stats`. Boolean-prop
  precedent: `suppressActionPanel?`/`presentation?` (`:139-142`). `#game-over` + `providesOwnGameOverUI`
  follow these directly.
- **Draw-vs-unknown signal must come from the session**: today the card only sees `winnerSeats:[]`.
  Thread `flowState.winners` as defined-array (draw) vs undefined (unknown), or an explicit `isDraw`.

## D11 — Forward Exits (ENDGAME-02)

- Real restart: `multiplayer-host.handleRestart` (`:256-271`) → `startGame()` (`:269-270`); runner
  rebuild `game-session.ts:515-545`. Reached via `{type:'restart'}` (`dev-host-client.ts:73,233-234`).
- **Crux 1 — dead op**: GameOverCard Rematch → `handleRestartGame` (`GameShell.vue:1687-1704`); in
  platform mode it posts `debug:restart` which has NO handler (`bridge.ts:42-43` claims DevHost
  handles it; DevHost does not). Round-trips to nothing.
- **Crux 2 — inert New Game**: `handleMenuItemClick('new-game')` → `leaveGame()` (`:1723-1729`) — goes
  to a (nonexistent-in-dev) lobby, never restarts.
- **Crux 3 — guard**: DevHost `newGame()` → `wsSend({type:'restart'})` DOES reach `handleRestart`, but
  it's gated `if (this.phase !== 'playing')` (`:257`) → rejects a finished game.
- Production HTTP `client.restartGame` → `POST /games/:id/restart` (`client.ts:332-345`) — no route in
  this repo (platform-owned); OUT OF SCOPE.
- **Fix**: route all exits to `{type:'restart'}`→`handleRestart`→`startGame()`; relax the phase guard
  to allow restart when complete; add a DevHost `debug:restart` handler that calls `newGame()`; New
  Game restarts instead of `leaveGame()`.

## Pitfalls

- Do not invent a new reset — `startGame()`/`handleRestart` already rebuild the runner with a fresh
  seed. Wire to it.
- The card defaults `winnerSeats` to `[]`; a naive "empty === draw" reintroduces the mislabel for the
  dev-degrade case. The draw signal must be explicit (defined-empty vs undefined).
- Relaxing the phase guard must still reject a restart mid-setup / when there is genuinely no game —
  gate on `playing || complete`, not "always."

## Validation Architecture

| Req | Defect | Layer | Validation | File |
|-----|--------|-------|-----------|------|
| ENDGAME-01 | D10 | UI component | RED: default card labels a genuine draw "Game Over" (or claims a winner) AND ignores slot/flag pre-fix; post-fix labels "Draw" and slot/`providesOwnGameOverUI` suppress it. Assert rendered text + card presence. | `src/ui/components/GameOverCard.test.ts`, GameShell component test |
| ENDGAME-01 | D10 | a11y | Escape + close button dismiss; live-region announces "Draw". | `useFocusTrap.test.ts`, `GameShell.live-region.test.ts` |
| ENDGAME-02 | D11 | session/host | RED: forward exit from a FINISHED game does not restart (guard rejects / dead op); post-fix restarts with fresh runner+seed. Assert game actually resets. | `src/session/multiplayer-host` test / `snapshot-session-host.test.ts` |
| ENDGAME-02 | D11 | dev-host wiring | `debug:restart` postMessage → DevHost `newGame()` → restart. | DevHost-level test or host integration |
| PROC-01 | — | process | Each: fix at library/dev-host layer + RED proven on pre-fix + adversarial (restart truly resets, not just emits) before close. | git RED→GREEN |

### Wave 0 gaps
- No existing test asserts the draw label or card suppression — net-new.
- No existing test asserts a forward exit from a finished game restarts — net-new.
- The `debug:restart` dead-op wiring has zero coverage.
