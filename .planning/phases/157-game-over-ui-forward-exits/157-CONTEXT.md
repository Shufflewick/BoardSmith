# Phase 157: Game-Over UI + Forward Exits - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Close D10 (ENDGAME-01) and D11 (ENDGAME-02): a game controls its own end state — the shell
`GameOverCard` is suppressable (via a `#game-over` slot and a `providesOwnGameOverUI` prop),
dismissable, and never mislabels a no-winner ending; and every forward exit (Rematch / New Game /
dev-restart) actually restarts the game via one real restart path, unblocking multi-game formats.

IN SCOPE: `src/ui/components/GameOverCard.vue`, `src/ui/components/GameShell.vue` (mount guard +
slot + forward-exit handlers), `src/cli/dev-host/DevHost.vue` (the `debug:restart` handler),
`src/session/multiplayer-host.ts` (`handleRestart` phase guard), and the session/flowState signal
that distinguishes a draw from unknown winners. Plus their tests.

OUT OF SCOPE: the production HTTP restart route (no server in this repo — the platform owns
`POST /games/:id/restart`; this phase wires the client/dev/platform-mode path only), the
rematch-vs-new-settings distinction (a platform/lobby concern), removing per-game workarounds
(Phase 169), and any redesign of the lobby.
</domain>

<decisions>
## Implementation Decisions

### Game-Over UI Suppression & Slot API (ENDGAME-01)
- Provide **both** mechanisms: a `#game-over` **slot** (a game injects its own end-state card in
  place of the default) AND a `providesOwnGameOverUI?: boolean` **prop** (a game that renders its
  end state inside its own board suppresses the shell card entirely). A **filled `#game-over` slot
  auto-suppresses** the default card.
- The card becomes **dismissable**: add a close affordance and allow **Escape** to close (reversing
  the current hard `escapeToClose:false` and the "Escape does NOT close" comment). Dismissing
  reveals the final board.
- The `#game-over` slot exposes `winners`, `players`, `isDraw`, and the forward-exit handlers
  (rematch / new-game), so a custom card has everything the default had.
- When neither slot nor flag is present, show the **improved** default card (correct labeling +
  dismissable).

### No-Winner / Draw Labeling
- **Distinguish a draw from unknown winners.** A game that completes with an explicit zero winners is
  a **draw** → label "Draw" / "No winner". Winner data that is merely *unavailable* (the dev-WS
  degrade, where `winners` could not be validated) stays generic "Game Over".
- The distinction is driven by whether `flowState.winners` is a **defined array** (draw when empty)
  vs **undefined** (unknown → "Game Over"). Thread this signal from the session/flowState rather than
  inferring in the card from a bare `[]` (today `winnerSeats` defaults to `[]`, which is why the two
  cases currently collapse — the card must receive `isDraw` / a defined-vs-undefined winners signal,
  not just the array).
- Only say "win" when the game genuinely means co-winners; a multi-seat terminal the rules treat as a
  draw is labeled "Draw", not "X and Y win".

### Forward-Exit Routing (ENDGAME-02)
- Route **all** forward exits — GameOverCard Rematch, dev-restart, DebugPanel restart, and New Game —
  to the **one real restart path**: `{type:'restart'}` → `multiplayer-host.handleRestart` →
  `startGame()` (rebuilds the runner with a fresh seed, same seats). Kill the dead `debug:restart`
  round-trip that has no handler.
- **Relax the `phase !== 'playing'` guard** in `handleRestart` so a restart from a `finished` game is
  allowed (restart when phase is `playing` OR the game is complete). That rejection is the direct
  cause of "restart from a finished game does nothing."
- For GameShell platform/iframe mode: add a **DevHost handler** for the `debug:restart` postMessage
  that calls the working `newGame()` path (`wsSend({type:'restart'})`), rather than inventing a new
  op. GameShell keeps posting `debug:restart`; DevHost now honors it.
- **"New Game" restarts** in dev/platform mode (fresh seed) — it stops calling the inert
  `leaveGame()`. In dev there is no lobby to land in, so "leave" was a dead end. The
  rematch-vs-new-settings distinction is deferred to the platform/lobby (out of scope).

### Test & Verification Strategy (PROC-01)
- **ENDGAME-01 RED**: a component test proving the default card (a) **mislabels** a no-winner ending
  pre-fix (says "Game Over" for a genuine draw, or claims a winner) and (b) is **unsuppressable**
  (slot/flag ignored). Post-fix: labels "Draw", and the slot/flag suppress it. Assert on rendered
  text + presence of the card, not internal props.
- **ENDGAME-02 RED**: a host/session test proving a forward exit from a **finished** game does **not**
  restart pre-fix (guard rejects / dead op) and **does** restart post-fix (fresh runner, new seed
  observable). Assert on the game actually resetting, not on an event emit.
- Cover both layers: GameOverCard + GameShell component tests **and** a `multiplayer-host` /
  session-level restart test. Include the **dev-host** `debug:restart` → `newGame()` wiring.

### Claude's Discretion
- Exact copy for the draw / no-winner / unknown labels (must be accurate and not claim a winner),
  and the close-affordance visual (button vs icon), subject to the UI-SPEC.
- Exact name/shape of the draw signal on flowState (`isDraw` boolean vs relying on
  `winners: number[] | undefined`) — Claude's call, provided the card can tell draw from unknown.
- Whether the relaxed guard checks `game.isFinished()` / `flowState.complete` — pick the signal
  already authoritative in `multiplayer-host`.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `GameOverCard.vue` (264 lines): props `winnerSeats: number[]`, `players: Player[]`; emits
  `rematch`, `new-game`; `titleText` computed at `:69-81` is the mislabel site; focus trap at
  `:38-43` with `escapeToClose:false` (the dismiss blocker).
- `GameShell.vue` mount guard at `:2088-2094` (`v-if="state?.flowState?.complete"`) is where the
  slot / `providesOwnGameOverUI` guard hooks in. `winnerSeats` sourced at `:306-308`, `:1144-1150`.
- Existing named-slot convention: `#game-board` `:2221`, `#action-panel` `:2319`, `#sidebar-extra`
  `:2052`, `#player-stats` (documented `usePlayerStatAnimation.ts:8-10`) — `#game-over` follows it.
- Existing boolean shell-prop precedent: `suppressActionPanel?` `:139-140`, `presentation?`
  `:141-142` — `providesOwnGameOverUI?` belongs alongside these.
- **The real restart** already exists: `multiplayer-host.handleRestart` (`:256-271`) → `startGame()`
  (`:269-270`); runner-rebuild mechanics `game-session.ts:515-545`. Wire path:
  `dev-host-client.restart()` → `send({type:'restart'})` (`dev-host-client.ts:73,233-234`);
  incoming `RestartIncomingMessage` `client/types.ts:326-328`.

### Established Patterns
- `--bsg-*` theme tokens (`src/ui/theme.ts`); GameOverCard styles are scoped in-component
  (`:122-264`) using `--bsg-surface`, `--bsg-accent`, `--bsg-accent-ink`, `--bsg-ink`, `--bsg-line-2`,
  spacing `--bsg-s*`, radius `--bsg-r-*`, `--bsg-shadow`. A new UI-SPEC reuses this palette.
- Platform-mode bridge: `platformRequest('debug:restart', {})` posts `{type:'server_request',
  op:'debug:restart'}` (`GameShell.vue:459-465`); DevHost forwards `server_request` ops
  (`DevHost.vue:221-270`) — but `debug:restart` is a host-chrome op with NO handler
  (`bridge.ts:42-43` says "handled in DevHost, not here" — yet it isn't). This dead op is D11's crux.
- DevHost's own working restart: `newGame()` (`DevHost.vue:281-284`) → `wsSend({type:'restart'})`.

### Integration Points
- Four forward-exit controls (scout §4): GameOverCard Rematch → `handleRestartGame`
  (`GameShell.vue:1687-1704`, inert in platform mode via dead `debug:restart`); GameOverCard/menu
  "New Game" → `handleMenuItemClick('new-game')` → `leaveGame()` (`:1723-1729`, inert as restart);
  DevHost dev-restart → `newGame()` (works but guard-gated); DebugPanel `restart-game`
  (`DebugPanel.vue:549`) → `handleRestartGame` (inherits the dead path).
- `client.restartGame` → `POST /games/:id/restart` (`client.ts:332-345`) — **no route handler in this
  repo** (platform owns it); the production HTTP branch is out of scope, fix the dev/platform path.

</code_context>

<specifics>
## Specific Ideas

- D10 hit 3 games; D11 hit 2 games — both Blocker/Major. Fix at the library/dev-host layer only; no
  per-game patches (Phase 169 removes the game-side workarounds).
- The mislabel presents to a player as "it said Game Over but it was a draw" or "it announced a
  winner when nobody won" — the RED test should assert on the rendered label for the reason a player
  would report.
- The inert forward-exit presents as "I clicked Rematch and nothing happened" — the RED should assert
  the game state does not reset pre-fix.

</specifics>

<deferred>
## Deferred Ideas

- The production HTTP `POST /games/:id/restart` route — platform-owned, not in this repo.
- Rematch (same settings) vs New Game (choose new settings) as distinct flows — a platform/lobby
  concern; in this phase both simply restart.
- Removing per-game game-over workarounds in the game repos — Phase 169.

</deferred>
