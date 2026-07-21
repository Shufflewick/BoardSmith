# Phase 161: Dev-Host Tooling - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Make `boardsmith dev` fully usable for the games that hit its gaps, closing four dev-host defects:
- **D13/DEVHOST-01 (Doom):** select a declared `gameOption`/preset (dev currently reads options only
  from `boardsmith.json`, never from the game definition, and never reads presets; start is frozen to
  defaults with no selector).
- **D14/DEVHOST-02 (Doom):** bare solo start (the CLI hardcodes `--players` default `'2'`, so a
  1-player game errors out).
- **D15/Seven-dlx/DEVHOST-03:** the first seat is orphaned when a client disconnects mid-`startGame`
  await — reserved to a vanished human, not AI-covered, loop stalls.
- **D16/Seven/DEVHOST-04:** dev drops to the engine's red/blue/green default instead of honoring the
  game's declared color palette.

IN SCOPE: `src/cli/cli.ts` (flags), `src/cli/commands/dev.ts` (config build, players default, palette
+ gameOption/preset reading), `src/cli/dev-host/multiplayer-host.ts` (seat reconciliation, start op),
`src/cli/dev-host/DevHost.vue` (gameOption/preset selector UI), `src/session/types.ts`
(`GameDefinition.colorPalette` new field), and validate/publish/engine threading for the palette, plus
tests.

OUT OF SCOPE: removing per-game dev workarounds (Phase 169), the already-fixed DEF-C stale-close race
(distinct from D15), and any broader lobby redesign.
</domain>

<decisions>
## Implementation Decisions

### D13 — gameOption / Preset Selection
- Expose selection **both ways**: CLI flags (`--game-option k=v` repeatable, `--preset name`) for
  scripted/agent starts, AND an interactive **selector in DevHost.vue's lobby/claim area** for humans.
- Read `gameDefinition.gameOptions` **and** `gameDefinition.presets` (dev.ts reads neither today —
  options come only from `boardsmith.json`, presets are never read). Merge with `boardsmith.json` if
  present, game definition authoritative.
- Selection is **pre-start (lobby)**: the chosen option values flow into the `start` op's
  gameOptions (replacing the frozen `.default`-only `baseGameOptions` at `dev.ts:696` /
  `multiplayer-host.ts:526`). Changing after start = restart (works via Phase 157).
- A **preset applies its bundle** of gameOption values (and player count if the preset declares one),
  filling the option selectors; selecting a preset is a shortcut for setting the underlying options.

### D14 — Solo Start
- **Default `--players` to the game's `minPlayers`**, not the literal `'2'` (`cli.ts:36`). A solo game
  (`minPlayers=1`) bare-starts at 1; a 2-min game still starts at 2. The game decides. `MultiplayerHost`
  already tolerates `playerCount:1` — the defect is purely the CLI default. `resolveEffectivePlayerCount`
  (dev.ts:85-92) still range-checks and errors on an explicit out-of-range `--players`.

### D15 — First-Seat Orphan Race
- Fix by **reconciling human/AI seats against actually-connected clients AFTER `await session.start()`**
  in `startGame` (multiplayer-host.ts, the window between `starting=true` at :508 and the phase commit /
  reinit at :574-586). A seat whose client disconnected during the start-await becomes **AI-covered** so
  the flow loop cannot stall.
- The seat stays **reclaimable** if the human reconnects — do NOT permanently convert it to AI; the
  reconciliation only ensures the loop has a driver (bot) while the seat is disconnected.
- This is DISTINCT from the already-fixed DEF-C stale-close (connection-handler.ts:59-68 guard); D15 is
  "disconnect lands mid-`startGame`-await," which no existing guard reconciles.

### D16 — Canonical Palette Source
- **Add `colorPalette?` to `GameDefinition`** (`src/session/types.ts`, alongside the existing
  `gameOptions`/`presets`/`playerOptions`) as the single code-declared source a game uses to declare
  its palette. Entry shape matches the validated `{id, hex, label}` / normalized `{value, label}`
  contract already enforced (`validate.ts:187-208`).
- **Dev fallback order:** `gameDefinition.colorPalette` → `boardsmith.json` `config.colorPalette` →
  engine `DEFAULT_COLOR_PALETTE`. dev.ts (`:523-546`) currently reads only boardsmith.json; add the
  game-definition source ahead of it, and thread it into `buildDevConfig` + `MultiplayerHost` + the
  `start` op's `colors` so per-seat `color` (mp-host.ts:464) reflects the game's palette.
- Keep the threading **additive and minimal** (D16 is Low severity) — engine already accepts
  `options.colors` (game.ts:659); publish already writes `manifest.colorPalette`. This unifies the
  declaration so dev matches publish.

### Test & Verification Strategy (PROC-01)
- **Harness:** `multiplayer-host.test.ts` (construct `MultiplayerHost` directly; stub `executeOp` to
  capture the `start` op's options/seeds/colors) for solo-start, gameOption/preset-in-start-op,
  palette-per-seat, and the disconnect-mid-start race. `dev.ts` exported helpers
  (`parsePositiveInt`, `resolveEffectivePlayerCount`) unit-tested directly for the players default.
- **D15 RED:** call `disconnect(A)` between `startGame`'s `starting=true` and its post-await phase
  commit → pre-fix seat 1 is a disconnected human, not AI-covered, loop stalls; post-fix AI-covered,
  loop proceeds, seat reclaimable. Assert on the reconciled seat's AI/human + loop progress.
- **D13/D16 RED:** a selected gameOption/preset appears in the `start` op (not just `.default`); the
  game's declared palette reaches per-seat `color` (not the engine red/blue/green).
- **D14 RED:** bare `dev` on a solo game (minPlayers=1,maxPlayers=1) errors pre-fix (default 2 > max 1),
  starts post-fix.

### Claude's Discretion
- CLI flag syntax details (`--game-option name=value` parsing, repeatable vs comma-list) and the
  DevHost.vue selector's exact markup (reuse existing `--bsg-*` tokens / the lobby claim area).
- Whether the D15 reconciliation lives inline in `startGame` or in a small helper; and whether it keys
  off `this.connected`/socket state — provided the disconnected-during-start seat is AI-covered and
  reclaimable, proven by the race test.
- The exact `GameDefinition.colorPalette` entry type (reuse the validated shape).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DevHostConfig` (`config-types.ts:20-47`) already carries `gameOptions`, `playerOptions`,
  `colorPalette` — the selector + palette thread into existing fields.
- `GameDefinition` (`session/types.ts:87-91`) already declares `gameOptions`, `playerOptions`,
  `presets` (GamePreset `types.ts:171-178`) — dev just doesn't read them; add `colorPalette` here.
- `MultiplayerHost` already tolerates `playerCount:1` (constructor loop `:153-155`); `assignSeat`
  (`:464`) keys color off `colorPalette?.[seat-1]?.value`; `buildPerSeatOptions` (`:592-600`).
- `resolveEffectivePlayerCount` (dev.ts:85-92), `parsePositiveInt`, `normalizeColorPalette`
  (dev.ts:205-217) — exported, unit-testable.
- Validate enforces palette `{id,hex,label}` (`validate.ts:187-208`); publish writes
  `manifest.colorPalette` (`publish-api.ts:82`); engine takes `options.colors` (`game.ts:659`,
  `DEFAULT_COLOR_PALETTE` `:185`).

### Established Patterns
- Start options are frozen to defaults: `baseGameOptions = fromEntries(gameOptions.map(o =>
  [o.id, o.default]))` (dev.ts:696) → spread into the `start` op (`multiplayer-host.ts:526`). The D13
  fix replaces `.default` with the selected value.
- Seat lifecycle: `hello()` (mp-host.ts:166-216) → `assignSeat` → `await startGame()`; `startGame`
  (`:507-587`) sets `starting=true` (`:508`), captures `humanSeats` (`:510-512`), awaits
  `session.start()` (`:566`) + `runAITurns()` (`:580`), then commits `phase='playing'` + reinit
  (`:574-586`). `disconnect` (`:218-233`) only flips `connected=false`, keeps seat human — the D15 gap.
- Dev-host test harness: `MultiplayerHost` direct (multiplayer-host.test.ts helpers `:52,:75`, stub
  `executeOp` capturing `startOptions` `:192,:601`); `FakeWebSocket` (DevHost.restart.test.ts:33) for
  DevHost.vue UI; real `ws` + `createDevHostConnectionHandler` (dev-host.integration.test.ts:82).

### Integration Points
- D14: `cli.ts:36` default; dev.ts:440 parse; dev.ts:533-534 min/max; dev.ts:571 range-check.
- D13: dev.ts:537-543 (gameOptions from boardsmith.json only), dev.ts:696 (frozen defaults),
  DevHost.vue:644-682 (read-only Table setup), DevHost.vue:482-508 (lobby claim area — selector home).
- D15: multiplayer-host.ts:508 (starting=true), :566 (await session.start), :574-586 (commit/reinit),
  :218-233 (disconnect). connection-handler.ts:59-68 (the DEF-C guard, not D15).
- D16: dev.ts:523-546 (palette from boardsmith.json only), :581/:703 (thread), mp-host.ts:464/:592-600
  (per-seat color), game.ts:659 (engine default), DevHost.vue:487-508 (swatches, `v-if` on palette).

</code_context>

<specifics>
## Specific Ideas

- D13/D14 hit Doom; D15 Seven-dlx; D16 Seven. All dev-host layer; Phase 169 removes game workarounds.
- D15 is the hard one — the RED must interleave the disconnect INSIDE the `startGame` await window
  (between `starting=true` and the phase commit), not a normal close. It presents as "the dev host
  claimed seat 1 then the game froze with nobody able to act."
- D16 is Low severity — keep the palette threading additive; the value is symmetry (dev matches
  publish) via one `GameDefinition.colorPalette` declaration.

</specifics>

<deferred>
## Deferred Ideas

- Removing per-game dev-host workarounds and re-verifying — Phase 169.
- A broader lobby/table-setup UI redesign — out of scope; D13 adds a selector, not a redesign.
- Unifying all color-palette sources (boardsmith.json vs GameDefinition vs engine) into one — this phase
  adds the GameDefinition source with a fallback chain; a full consolidation is future work.

</deferred>
