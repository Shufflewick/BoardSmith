---
phase: 161-dev-host-tooling
reviewed: 2026-07-21T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/cli/commands/dev.ts
  - src/cli/cli.ts
  - src/session/types.ts
  - src/cli/dev-host/config-types.ts
  - src/cli/dev-host/multiplayer-host.ts
  - src/cli/dev-host/DevHost.vue
findings:
  critical: 2
  warning: 3
  info: 1
  total: 6
status: resolved
resolved: 2026-07-21T00:00:00Z
---

# Phase 161: Code Review Report

**Reviewed:** 2026-07-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** resolved (all 6 findings fixed; see "Resolution" below)

## Resolution (2026-07-21)

All 6 findings fixed, PROC-01 RED-first for both BLOCKERs and WR-02:

- **CR-01** — FIXED. `handleConfigure` now resizes the seat map (`resizeSeats`,
  mutates `this.opts.playerCount`) to match a preset-declared player count
  BEFORE `startGame` derives `playerOptions`/`playerIsAI`/`playerConfigs`, so
  they never diverge from the reported `playerCount`. Test:
  `multiplayer-host.gameoptions.test.ts` (new CR-01 array-length case).
- **CR-02** — FIXED. `coerceGameOptionValue` (config-types.ts) coerces by
  declared `type`, called from the shared `validateGameOptionSelection` (both
  `dev.ts` and `multiplayer-host.ts` route through it). Tests:
  `config-types.test.ts` (new file), `multiplayer-host.gameoptions.test.ts`
  (new CR-02 describe block).
- **WR-01** — FIXED. `applyLobbyOptions` (DevHost.vue) filters out
  undefined-valued entries before sending `configure`.
- **WR-02** — FIXED. `startGame`'s post-commit reinit pass now covers every
  currently seated + connected client, not just the pre-await `humanSeats`
  snapshot — a join landing mid-await gets `init`/`game_state` as part of
  startGame's own commit. `handleJoin` was intentionally NOT guarded against
  `this.starting` (a reject/queue guard would have regressed the existing
  D15 reclaim test, which relies on a mid-await join succeeding). Test:
  `multiplayer-host.startrace.test.ts` (new WR-02 case).
- **WR-03** — FIXED. `boolean` options render a real checkbox; `number`
  options render `<input type="number">` (DevHost.vue).
- **IN-01** — FIXED. `normalizeColorPalette` (dev.ts) warns and drops a
  malformed colorPalette entry instead of emitting an empty-string swatch.

Verification: `npm test` — 207 files / 2923 tests pass (baseline 205/2902).
`npx tsc --noEmit` — zero new errors in `src/cli/**`.

## Summary

D14 (solo default) and D15 (first-seat race reconciliation) are solid — `resolvePlayerCount` is correctly wired into the real `devCommand` flow, and the D15 reconciliation loop in `multiplayer-host.ts` is well-designed and covered by a dedicated race-condition test suite (`multiplayer-host.startrace.test.ts`) that proves reconnect-yields-AI, mid-game disconnect stays reserved, and the reconciliation is scoped to the in-await interleave only. D16's palette resolver fallback order and shape conversion are correct and null-safe.

D13 has two real defects. First, a preset's declared player count, applied post-start via the lobby `configure` message, is written into the `start` op's `playerCount` field but the parallel `playerOptions`/`playerIsAI`/`playerConfigs` arrays stay sized to the host's original (CLI-launched) player count — a length mismatch that reaches the game constructor. The project's own test (`multiplayer-host.gameoptions.test.ts:122-132`) demonstrates the exact scenario (`playerCount: 2` host, preset declaring 3 players) and asserts only `opts.playerCount === 3`, without noticing the arrays are still length 2. Second, `--game-option key=value` CLI flags and the lobby's free-text option inputs never coerce the value to the option's declared `type` — every flag value is a raw string, so `number`/`boolean` options silently receive `"5"`/`"false"` (JS-truthy) instead of typed values, and `select` options with non-string choice values can never be set via `--game-option` at all (string never `===` the declared choice).

## Critical Issues

### CR-01: Preset-applied playerCount diverges from the arrays sized to the original host playerCount

**File:** `src/cli/dev-host/multiplayer-host.ts:596-647` (see also `:344-371`, `:703-712`)
**Issue:** `handleConfigure` lets an in-lobby `configure` message apply a preset whose `players.length` differs from the count `MultiplayerHost` was constructed with (`opts.playerCount`, fixed at CLI-launch time via `--players`/`--preset`). The preset's count is merged into `this.appliedGameOptions.playerCount` and, via spread order in `startGame()`, overrides the top-level `playerCount` field of `startGameOptions`. But `buildPerSeatOptions()`, `playerIsAI`, and `playerConfigs` are all built with `Array.from({ length: playerCount }, ...)` using the *original* `this.opts.playerCount` (captured at `startGame()`'s top, line 598), not the overridden value. The result: `startGameOptions.playerCount` (e.g. 3) diverges from `startGameOptions.playerOptions.length`/`playerIsAI.length`/`playerConfigs.length` (e.g. 2). Any game reading `options.playerOptions[2]`/`playerConfigs[2]` for the 3rd seat gets `undefined`, and `this.seats` (the host's own seat map, size 2) never gets resized to match either — the seat-picker, AI-seat assignment, and reconnection logic all continue to operate on the stale 2-seat map while the constructed `Game` believes it has 3 players. This is reachable through the primary lobby UI path (Plan 03's preset dropdown, `DevHost.vue:528-543`), not a contrived edge case — a game author who declares presets with varying player counts (a common pattern, e.g. "2p quick" vs "4p full") will trigger this on `boardsmith dev` any time a preset with a different count than the CLI launch is applied post-start.
**Fix:** Either (a) reject/ignore a preset's `players.length` when applied via `configure` on an already-running host (only honor preset player count via the CLI `--preset` flag, before `MultiplayerHost` is constructed — document that a lobby-applied preset changes options only, not seat count), or (b) make preset-driven player count changes actually resize `this.seats`/`aiSeats` and recompute `buildPerSeatOptions`/`playerIsAI`/`playerConfigs` from the (possibly new) count instead of the frozen `this.opts.playerCount`:
```ts
// multiplayer-host.ts: derive the arrays from the SAME count used for the start op
const effectivePlayerCount = (this.appliedGameOptions.playerCount as number | undefined) ?? this.opts.playerCount;
const perSeatOptions = this.buildPerSeatOptions(effectivePlayerCount);
// ...and resize this.seats to effectivePlayerCount before computing humanSeats/aiSeats.
```
At minimum, `handleConfigure` should reject a `preset` selection whose declared player count differs from `opts.playerCount` with an actionable error, so the mismatch can never reach the start op.

### CR-02: `--game-option`/lobby option values are never coerced to the declared option `type`

**File:** `src/cli/commands/dev.ts:263-276`, `src/cli/dev-host/config-types.ts:41-64`, `src/cli/dev-host/DevHost.vue:560-565`
**Issue:** `parseGameOptionFlags` (dev.ts) returns `Record<string, string>` — every `--game-option key=value` value is a raw string, with no coercion based on the option's declared `type` (`number`, `boolean`, `select`, ...). `validateGameOptionSelection` (config-types.ts:41-64) only validates `select`-typed options (via `allowed.includes(value)`), and leaves `number`/`boolean`/`text` values completely unvalidated and uncoerced. Consequences:
  1. A `number` option set via `--game-option rounds=5` reaches the `start` op as the string `"5"`, not the number `5` — any game code doing arithmetic (`rounds - 1`) or type-sensitive comparisons on it breaks silently.
  2. A `boolean` option set via `--game-option hardMode=false` reaches the game as the string `"false"`, which is JS-truthy — `if (options.hardMode)` evaluates `true`, the exact inverse of what was requested.
  3. A `select` option whose declared `choices[].value` are non-string (e.g. numeric difficulty levels) can **never** be set via `--game-option` at all: `allowed.includes("4")` never matches `allowed = [2, 4]`, so every attempt is rejected as "Invalid value" even though the user's intent was valid.
  The same defect exists in the browser lobby selector: `DevHost.vue:560-565` renders every non-`choices` game option (i.e. every `number`/`boolean`/`text` option) as a generic `<input type="text">` bound via `v-model` — the value sent in the `configure` message is always a string, hitting the identical unvalidated/uncoerced path in `multiplayer-host.ts`'s `handleConfigure`.
**Fix:** Coerce by declared type before validation, in both the CLI parser and the wire-level validator (single source of truth preferred — put it in `validateGameOptionSelection`/a shared coercion helper so both `dev.ts` and `multiplayer-host.ts` benefit):
```ts
// config-types.ts
function coerceGameOptionValue(def: DevOptionDef, raw: unknown): unknown {
  if (typeof raw !== 'string') return raw; // already typed (preset/browser select/number input)
  switch (def.type) {
    case 'number': {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new GameOptionSelectionError(`Game option "${def.id}" must be a number, got "${raw}".`);
      return n;
    }
    case 'boolean':
      if (raw !== 'true' && raw !== 'false') throw new GameOptionSelectionError(`Game option "${def.id}" must be "true" or "false", got "${raw}".`);
      return raw === 'true';
    default:
      return raw;
  }
}
```
Call this on each entry before the `select`-choices check in `validateGameOptionSelection`, and render `number`/`boolean` options in `DevHost.vue` with `<input type="number">`/a checkbox instead of `type="text"` so the browser produces typed values in the first place.

## Warnings

### WR-01: Lobby "Apply" always resends every declared option, including ones without a declared `default` — sends `undefined` and can spuriously fail validation

**File:** `src/cli/dev-host/DevHost.vue:71-87`, `src/cli/dev-host/config-types.ts:41-64`
**Issue:** `optionSelection` is seeded once via `Object.fromEntries(cfg.gameOptions.map((o) => [o.id, o.default]))`. If a game option declares no `default`, its entry is `undefined`. `applyLobbyOptions()` unconditionally spreads the *entire* `optionSelection` into the `configure` message's `gameOptions`, not just user-touched keys. For a `select`-typed option with no default, `validateGameOptionSelection` will reject the whole configure request with "Invalid value undefined for game option ..." the very first time the user clicks Apply, even if they never touched that field. For non-`select` types with no default, `undefined` passes validation unchecked and gets merged into `appliedGameOptions`, potentially propagating `undefined` into the `start` op's gameOptions.
**Fix:** Only include keys in the `configure` message that differ from `.default` (or that the user has explicitly interacted with), or have `validateGameOptionSelection` skip a key whose value is `undefined` (treat "not provided" the same for both CLI and lobby paths).

### WR-02: A `join` racing `startGame()`'s in-flight `await session.start()` is submitted to the start op as AI and not reinitialized until the next broadcast

**File:** `src/cli/dev-host/multiplayer-host.ts:408-423` (`handleJoin`) vs. `:596-699` (`startGame`)
**Issue:** `handleJoin` has no guard against `this.starting`. If client B sends `join` for an open seat while a different client's `hello()` is mid-`await session.start()`, `assignSeat`/`removeAiSeat` mutate live host state (`this.seats`, `this.aiSeats`), but the `start` op's `playerIsAI`/`playerConfigs` were already computed from the stale pre-await `humanSeats` snapshot (marking that seat AI) and have already been (or are about to be) submitted to `executeOp`. Additionally, `handleJoin`'s `if (this.phase === 'playing') this.reinitSeat(...)` check reads `false` (phase is still `'lobby'` during the await), so B never receives `init`/`game_state` at join time — nor does `startGame()`'s post-completion reinit loop cover B, since it only iterates the pre-await `humanSeats` set. B is left seated with no UI content until an unrelated broadcast happens to fire.
**Fix:** Guard `handleJoin` (and `handleLeave`) against `this.starting` — either queue the request until `startGame()` resolves, or reject with an actionable "game is starting, try again" error, matching the existing pattern already used for `hello()`'s reconnect branch (`if (this.starting) { this.broadcastLobby(); return; }`).

### WR-03: `boolean`-type game options render as a plain text input with no type affordance

**File:** `src/cli/dev-host/DevHost.vue:560-565`
**Issue:** The generic `<input v-else v-model="optionSelection[opt.id]" type="text">` branch is used for every non-`choices` option regardless of declared `type`, so a `boolean` option shows a free-text box where the user must type the literal strings `true`/`false` with no validation — compounding CR-02's type-coercion gap with a poor UX affordance.
**Fix:** Branch on `opt.type === 'boolean'` to render a checkbox, and `opt.type === 'number'` to render `<input type="number">`, alongside the existing `opt.choices` branch.

## Info

### IN-01: `normalizeColorPalette` silently produces empty swatches for malformed entries

**File:** `src/cli/commands/dev.ts:229-238`
**Issue:** For an object entry missing all of `value`/`hex`/`color`, `normalizeColorPalette` falls back to `{ value: '', label: '' }` rather than skipping the entry or warning — a malformed `boardsmith.json` `colorPalette` entry (or a game's `colorPalette` declaration with a typo'd field name) silently produces an invisible/unclickable swatch in the lobby color picker instead of a loud warning.
**Fix:** Warn (via the existing `formatUnknownKeyWarnings`-style loud-but-non-exiting pattern) and drop the malformed entry instead of emitting an empty-string swatch.

---

_Reviewed: 2026-07-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
