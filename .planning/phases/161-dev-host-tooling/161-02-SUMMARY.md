---
requirements-completed: [DEVHOST-01, PROC-01]
---

# Plan 161-02 Summary — gameOption/Preset Selection, Server Side (D13, PROC-01)

**Plan:** 161-02 (execute — cli.ts/dev.ts/config-types.ts/multiplayer-host.ts, file-disjoint from
Plans 01/03/04; ran serially after 161-01 landed)
**Completed:** 2026-07-21
**Result:** PASS — `--game-option key=value` (repeatable) and `--preset name` CLI flags, plus a host
`configure` wire message, now replace the frozen `.default`-only `baseGameOptions` in the `start` op.
`gameDefinition.gameOptions` merges with `boardsmith.json` (game-definition authoritative) and
`gameDefinition.presets` are read for the first time. Undeclared option keys/invalid choice values are
rejected before reaching the start op (T-161-02/03).

## What was done

1. **Task 1 (RED):** Added `dev.test.ts` cases for three not-yet-existing pure helpers
   (`parseGameOptionFlags`, `mergeGameOptionDefinitions`, `resolvePreset`). Created
   `multiplayer-host.gameoptions.test.ts` (new file, disjoint from `multiplayer-host.test.ts`) with a
   `DifficultyGame` fixture declaring a `difficulty` select option (default `'easy'`, choices include
   `'hard'`) and a `rounds` number option; a `configure` selection/preset-apply case and an
   undeclared-key rejection case. All 14 cases failed for the right reason (missing helpers; no
   `configure` handler so only `.default` reached the start op). No production source touched.
   Commit `43996a3e`.
2. **Task 2 (GREEN):** `cli.ts` gained `--game-option <kv...>` and `--preset <name>`. `dev.ts` gained
   `parseGameOptionFlags` (first-`=` split, `DevFlagError` on a missing `=`), `mergeGameOptionDefinitions`
   (gameDefinition authoritative on key conflict — replaces the old `...(gameOptions && {gameOptions})`
   replace-only spread at the old `dev.ts:557`), and `resolvePreset` (looks up by name in
   `gameDefinition.presets`, returns `{options, playerCount?}`, throws `DevFlagError` naming the unknown
   preset + declared names). `devCommand` now computes `selectedGameOptions = {...presetBundle.options,
   ...gameOptionFlags}` (flag beats preset), validates it against the merged declared options
   (`validateGameOptionSelection`), and — when `--players` was NOT explicit — lets a preset's declared
   player count feed `resolvePlayerCount`. `baseGameOptions` is now `{...optionDefaults,
   ...selectedGameOptions}`, replacing the old `.default`-only computation.
   `config-types.ts` gained `DevHostConfig.presets: GamePreset[]` (populated in `buildDevConfig` from
   `gd.presets`) and the shared `validateGameOptionSelection`/`GameOptionSelectionError`
   (T-161-02: unknown key or out-of-choices select value → actionable error; `playerCount` is exempt,
   it's a host-level field a preset may also set, not a per-game option).
   `multiplayer-host.ts` gained a `configure` `ClientInbound` variant (`{gameOptions?, preset?}`),
   `MultiplayerHostOptions.declaredGameOptions`/`presets`, and a mutable `appliedGameOptions` field
   (seeded from `opts.baseGameOptions`) that `startGame` now spreads instead of `opts.baseGameOptions`
   directly — so a selection persists across a restart. `handleConfigure` resolves the preset bundle
   (overlaid by any `gameOptions`), validates the WHOLE bundle before applying anything, then
   `startGame()`s (modeled on `handleRestart`). A preset's player count rides in a reserved
   `playerCount` key in the applied selection — it overrides only the `start` op's `playerCount` field
   via object-spread order (`{playerCount, seed, ...appliedGameOptions, ...}`), and deliberately does
   NOT touch `this.seats`/seat reconciliation (Plan 04/D15 territory). Three `DevHost.*.test.ts`
   fixtures needed `presets: []` added (now-required `DevHostConfig` field) — Rule 3 (blocking
   TypeScript compile error caused by this task's own type change), verified with a scoped `tsc
   --noEmit` diff (no other files in `src/cli/**` newly failed). Commit `cb66f60b`.
3. **Task 3 (adversarial):** Extended the host test: a preset applies EVERY option in its bundle AND
   its declared player count (3, from `players: [...]` length 3) lands in the start op; a
   `--game-option`-equivalent `gameOptions` entry overrides the preset's value for the same key
   (`rounds`); a selection survives a subsequent `restart` (does not revert to `.default`). Extended
   `dev.test.ts`'s merge test with the adversarial case: a game-definition-only option key survives
   even when `boardsmith.json` declares a disjoint set (the regression the old replace-only spread
   would have caused). Ran the full suite. Commit `ff2b33ba`.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 FAIL  src/cli/commands/dev.test.ts > resolvePreset ... > returns the preset's player count when it declares `players`
TypeError: resolvePreset is not a function

 FAIL  src/cli/commands/dev.test.ts > resolvePreset ... > omits playerCount when the preset does not declare `players`
TypeError: resolvePreset is not a function

 FAIL  src/cli/commands/dev.test.ts > resolvePreset ... > throws an actionable DevFlagError naming the unknown preset and the declared names
AssertionError: expected error to be instance of DevFlagError
+ Received: [TypeError: __vite_ssr_import_2__.resolvePreset is not a function]

 FAIL  src/cli/dev-host/multiplayer-host.gameoptions.test.ts > ... > a `configure` selection REPLACES the default in the (re)started op
AssertionError: expected 'easy' to be 'hard' // Object.is equality

 FAIL  src/cli/dev-host/multiplayer-host.gameoptions.test.ts > ... > applying a preset by name sets EVERY option in its bundle
AssertionError: expected 'easy' to be 'hard' // Object.is equality

 FAIL  src/cli/dev-host/multiplayer-host.gameoptions.test.ts > ... > rejects an UNDECLARED option key — the start op must not carry the bogus key
AssertionError: expected undefined to be truthy

 Test Files  2 failed (2)
      Tests  14 failed | 33 passed (47)
```
(`parseGameOptionFlags`/`mergeGameOptionDefinitions` cases also failed with "is not a function"; the
14-count above is the full failing set. The 33 passes were pre-existing 161-01 cases plus the two
host-side "frozen default reaches the start op" characterization cases, which correctly PASS pre-fix.)

## GREEN output

Task 2 (target files): `multiplayer-host.gameoptions.test.ts` (4 tests), `dev.test.ts` (43 tests),
`multiplayer-host.test.ts` (38 tests), `multiplayer-host.palette.test.ts` (2 tests), and all three
`DevHost.*.test.ts` files (18 tests) — 7 files / 105 tests, all passed.

Task 3 (target + full suite):
```
 ✓ src/cli/dev-host/multiplayer-host.gameoptions.test.ts (7 tests)
 ✓ src/cli/commands/dev.test.ts (44 tests)

 Test Files  2 passed (2)
      Tests  51 passed (51)

...

 Test Files  204 passed (204)
      Tests  2898 passed (2898)
```
Baseline (post-161-01) was 203 files / 2879 tests; +1 file (`multiplayer-host.gameoptions.test.ts`),
+19 tests — all green, no regressions.

## Host selection message shape (for Plan 03's DevHost.vue selector)

```ts
{ type: 'configure'; gameOptions?: Record<string, unknown>; preset?: string }
```
- Either field may be present; both may be present together — a `preset` applies its whole `options`
  bundle first (plus a reserved `playerCount` entry derived from `preset.players.length`, if the
  preset declares `players`), then `gameOptions` (if present) overlays on top, so an explicit
  selection for a key the preset also sets WINS.
- The WHOLE resulting bundle is validated against `MultiplayerHostOptions.declaredGameOptions`
  (an unknown key, or a `select` value not among its declared `choices`, rejects the ENTIRE selection —
  nothing partial is applied) before anything is applied.
- On success, the host applies the selection (merged into its persistent `appliedGameOptions`, so it
  survives a later `restart`) and immediately `(re)start()`s — mirrors `{ type: 'restart' }`'s
  "clean slate" semantics.
- On rejection, the host replies `{ type: 'error'; message }` to the requesting client only; the
  bogus/invalid selection never reaches the `start` op.
- `DevHostConfig.presets: GamePreset[]` (`{name, description?, options, players?}`) is now populated
  from `gameDefinition.presets` — Plan 03's selector can render these names directly and send
  `{ type: 'configure', preset: name }`.

## Verification

- `npx vitest run src/cli/commands/dev.test.ts src/cli/dev-host/multiplayer-host.gameoptions.test.ts` — 51/51 pass.
- `npm test` — 204 files / 2898 tests pass (baseline 203/2879).
- `npx tsc --noEmit -p tsconfig.json` — zero new errors in any file under `src/cli/**` (pre-existing
  unrelated errors elsewhere in the repo, e.g. `src/ai/mcts-redaction.test.ts`, `src/ui/**`, are
  untouched by and unrelated to this plan).
- Grep gate: `grep -c "presets" src/cli/dev-host/config-types.ts` → 2 (≥1 required).
- Grep gate: `grep -n "o.default" src/cli/commands/dev.ts` → 1 hit, now only computing `optionDefaults`
  (the base layer), immediately overlaid by `...selectedGameOptions` — no longer the sole driver of
  `baseGameOptions`.
- Grep gate: `grep -c "game-option\|preset" src/cli/cli.ts` → 2 (≥2 required).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking] `DevHostConfig.presets` becoming required broke 3 test fixtures**
- **Found during:** Task 2, `npx tsc --noEmit` after adding the required `presets` field to
  `DevHostConfig`.
- **Issue:** `DevHost.debug-relay.test.ts`, `DevHost.restart.test.ts`, `DevHost.seats.test.ts` each
  construct a hand-written `TEST_CONFIG: DevHostConfig` fixture predating this plan; none declared
  `presets`, so the type change blocked compilation.
- **Fix:** Added `presets: []` to each fixture (no behavior change — these tests don't exercise
  presets).
- **Files modified:** `src/cli/dev-host/DevHost.debug-relay.test.ts`,
  `src/cli/dev-host/DevHost.restart.test.ts`, `src/cli/dev-host/DevHost.seats.test.ts`.
- **Commit:** `cb66f60b`.

### Auth gates
None encountered.

## Known Stubs
None.

## Threat Flags
None — this plan implements the mitigations specified in its own threat model (T-161-02, T-161-03);
T-161-05 is an accepted risk per the threat model (no mitigation required); no new, unlisted
security-relevant surface introduced. `startGame`'s seat-reconciliation body (D15/Plan 04 territory)
was not touched.

## Self-Check: PASSED

- `src/cli/commands/dev.test.ts` (`parseGameOptionFlags`/`mergeGameOptionDefinitions`/`resolvePreset`
  cases) — FOUND
- `src/cli/dev-host/multiplayer-host.gameoptions.test.ts` — FOUND
- `src/cli/cli.ts` (`--game-option`, `--preset`) — FOUND
- `src/cli/commands/dev.ts` (`parseGameOptionFlags`, `mergeGameOptionDefinitions`, `resolvePreset`
  exported) — FOUND
- `src/cli/dev-host/config-types.ts` (`presets`, `validateGameOptionSelection`) — FOUND
- `src/cli/dev-host/multiplayer-host.ts` (`configure` handler, `appliedGameOptions`) — FOUND
- Commit `43996a3e` (RED) — FOUND in `git log`
- Commit `cb66f60b` (GREEN) — FOUND in `git log`
- Commit `ff2b33ba` (adversarial) — FOUND in `git log`
