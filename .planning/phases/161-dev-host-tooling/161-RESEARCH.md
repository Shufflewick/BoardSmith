# Phase 161: Dev-Host Tooling - Research

**Researched:** 2026-07-21
**Confidence:** HIGH (all four defects root-caused via codebase scout)

## Summary

Four dev-host defects. Three are "dev.ts doesn't read what the game declares" (D13 options/presets,
D16 palette) or a bad default (D14 players); D15 is a genuine async race in `startGame`.

## D13 — gameOption/preset selection
- dev.ts reads gameOptions ONLY from `boardsmith.json` (`config.gameOptions`, dev.ts:537-543), never
  from `gameDefinition.gameOptions`, and never reads `gameDefinition.presets` (0 grep hits).
- Start options frozen to `.default`: `baseGameOptions` (dev.ts:696) → spread into `start` op
  (multiplayer-host.ts:526). No selector — DevHost.vue Table-setup is read-only (`:644-682`).
- **Fix:** read `gameDefinition.gameOptions`+`presets`; add CLI flags (`--game-option`,`--preset`) +
  a DevHost.vue lobby selector (`:482-508` claim area); flow selected values into the start op.

## D14 — solo start
- `cli.ts:36` default `--players '2'`; `resolveEffectivePlayerCount` (dev.ts:85-92) errors when out of
  [minPlayers,maxPlayers]. Solo game (max=1): default 2 > 1 → hard error. Host tolerates
  `playerCount:1`. **Fix:** default to `gameDefinition.minPlayers`.

## D15 — first-seat orphan race (the crux)
- `hello()` (mp-host.ts:166-216) assigns seat, `await startGame()`. `startGame` (:507-587):
  `starting=true` (:508), capture `humanSeats` (:510-512), `await session.start()` (:566) +
  `runAITurns()` (:580), commit `phase='playing'` + reinit (:574-586).
- If client A disconnects during the `await session.start()` window, `disconnect` (:218-233) only sets
  `connected=false`, keeps the seat human. startGame resumes: seat 1 = disconnected human, `runAITurns`
  won't drive it (`playerIsAI[0]=false`), loop stalls; reinit `send` to A is dropped (socket closed).
- DISTINCT from DEF-C (connection-handler.ts:59-68 guard = reload-beats-close). **Fix:** after
  `await session.start()`, reconcile human/AI against `this.connected` — a disconnected-during-start
  seat is AI-covered (loop proceeds) but reclaimable on reconnect.

## D16 — palette
- dev palette ONLY from `boardsmith.json` (dev.ts:523-546). `GameDefinition` has NO `colorPalette`
  field; engine default `DEFAULT_COLOR_PALETTE` (game.ts:185, applied :659 `options.colors ?? DEFAULT`).
  So a game's declared palette (not in boardsmith.json) is dropped → red/blue/green.
- **Fix:** add `GameDefinition.colorPalette` (types.ts); dev fallback
  `gameDefinition.colorPalette → boardsmith.json → engine default`; thread into buildDevConfig +
  MultiplayerHost + start op `colors`. Reuse the validated `{id,hex,label}` shape (validate.ts:187-208);
  publish already writes `manifest.colorPalette` (publish-api.ts:82) — this unifies dev with publish.

## Pitfalls

- D15 RED must interleave the disconnect INSIDE the start-await window (not a normal close) — a plain
  close after start won't reproduce it.
- Don't PERMANENTLY convert the disconnected seat to AI (must stay reclaimable) — reconcile for the
  loop-driver only.
- The GameDefinition.colorPalette entry shape must match the validated `{id,hex,label}` contract (a
  recent enforcement) — don't invent a new shape.
- Reading gameDefinition options must not break games that declare options ONLY in boardsmith.json —
  merge, game-definition authoritative.

## Validation Architecture

| Req | Defect | Layer | Validation | File |
|-----|--------|-------|-----------|------|
| DEVHOST-01 | D13 | dev-host | RED: a selected gameOption/preset appears in the `start` op (pre-fix only `.default`). CLI flag + DevHost selector. | multiplayer-host.test.ts + DevHost.vue test |
| DEVHOST-02 | D14 | CLI | RED: bare `dev` on a solo game errors (default 2 > max 1) pre-fix; starts post-fix (default = minPlayers). | dev.ts helper unit test |
| DEVHOST-03 | D15 | dev-host host | RED: disconnect(A) mid-`startGame` → seat 1 orphaned (human, no AI, loop stalls) pre-fix; AI-covered + reclaimable post-fix. | multiplayer-host.test.ts (+ integration) |
| DEVHOST-04 | D16 | dev-host + engine | RED: game's declared palette reaches per-seat `color` (pre-fix red/blue/green). | multiplayer-host.test.ts + validate/publish check |
| PROC-01 | — | process | Each: fix at correct layer + RED on pre-fix + adversarial before close. | git RED→GREEN |

### Wave 0 gaps
- No existing test for palette-per-seat, gameOption/preset selection, solo-start, or disconnect-mid-start
  — all net-new.
- The D15 race needs a deterministic interleave harness (disconnect between starting=true and commit).
