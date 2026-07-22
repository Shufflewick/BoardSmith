---
requirements-completed: [DEVHOST-02, DEVHOST-04, PROC-01]
---

# Plan 161-01 Summary — Solo Default + Canonical Palette Source (D14, D16, PROC-01)

**Plan:** 161-01 (execute — dev.ts/cli.ts/session/types.ts, file-disjoint from Plans 02-04)
**Completed:** 2026-07-21
**Result:** PASS — `--players` now defaults to the game's `minPlayers` (range-check on an explicit
value unchanged); `GameDefinition.colorPalette` added and threaded through dev ahead of
`boardsmith.json` and the engine default. Each defect got its own RED cycle (PROC-01).

## What was done

1. **Task 1 (RED):** Added 6 cases to `src/cli/commands/dev.test.ts` driving two not-yet-existing
   pure helpers (`resolvePlayerCount`, `resolveColorPalette`) — all 6 failed with `is not a function`
   (right reason: missing helpers, not a typo). Created
   `src/cli/dev-host/multiplayer-host.palette.test.ts` (new file, disjoint from
   `multiplayer-host.test.ts`, which other 161-plans touch) with a characterization case (explicit
   `colorPalette` reaches `playerOptions[0].color`) and an adversarial case (a non-default hex reaches
   the per-seat color, proving the engine red/blue/green isn't substituted) — both PASSED pre-fix,
   since the host already threads an explicit `colorPalette` constructor option; these prove the
   per-seat plumbing so Task 3 only needed to fix dev.ts's palette *source*, not `multiplayer-host.ts`.
   No production source touched. Commit `dcf44bec`.
2. **Task 2 (GREEN D14):** Removed the literal `'2'` default from `cli.ts`'s `--players` option;
   `DevOptions.players` is now `string | undefined`. Added `resolvePlayerCount(rawPlayers, minPlayers,
   maxPlayers)` to `dev.ts` — returns `minPlayers` when `rawPlayers` is `undefined`, else still runs
   `parsePositiveInt` + `resolveEffectivePlayerCount` (range-check untouched). Moved player-count
   resolution in `devCommand` from an eager pre-load parse to after `gameDefinition.minPlayers`/
   `maxPlayers` are known. Commit `77cbf18d`.
3. **Task 3 (GREEN D16 + adversarial):** Added `GameDefinition.colorPalette?:
   Array<{id,hex,label}>` to `session/types.ts`, reusing the exact shape `validate.ts` already
   enforces for `boardsmith.json`'s `colorPalette` — no new shape invented. Added
   `resolveColorPalette(gameDefinition, config)` to `dev.ts`: `gameDefinition.colorPalette` ->
   `config.colorPalette` -> `[...DEFAULT_COLOR_PALETTE]` (imported from `engine/index.js`), reusing
   the existing `normalizeColorPalette` coercer. Replaced the `if (config.colorPalette)` conditional in
   `devCommand` with an unconditional call to the resolver, so `colorPalette` (fed into both
   `buildDevConfig` and `MultiplayerHost`) and the `color` `playerOption` are always sourced from this
   one resolver. Did not touch `multiplayer-host.ts` — its per-seat color plumbing already consumed
   whatever `colorPalette` it was constructed with. Commit `8f4d2fc5`.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 ❯ src/cli/commands/dev.test.ts (32 tests | 6 failed) 8ms
   × resolvePlayerCount ... > defaults to minPlayers=1 for a solo game when --players is unset (bare `dev` on minPlayers=1,maxPlayers=1 must NOT error)
     → resolvePlayerCount is not a function
   × resolvePlayerCount ... > defaults to minPlayers=2 when --players is unset on a min=2 game
     → resolvePlayerCount is not a function
   × resolvePlayerCount ... > still ERRORS naming the bound when an EXPLICIT --players is out of range (range-check not weakened)
     → expected error to be instance of DevFlagError (received TypeError: resolvePlayerCount is not a function)
   × resolveColorPalette ... > honors gameDefinition.colorPalette when config has none
     → resolveColorPalette is not a function
   × resolveColorPalette ... > prefers gameDefinition.colorPalette over boardsmith.json config.colorPalette
     → resolveColorPalette is not a function
   × resolveColorPalette ... > falls back to the engine DEFAULT_COLOR_PALETTE when neither source declares a palette
     → resolveColorPalette is not a function

 Test Files  1 failed | 1 passed (2)
      Tests  6 failed | 28 passed (34)
```
(The 1 passed file was `multiplayer-host.palette.test.ts` — both its cases PASSED pre-fix, as expected:
a characterization/adversarial guard on plumbing that already worked, not a pre-fix RED.)

## GREEN output

Task 2 (`dev.test.ts` alone): 29 passed, 3 still-failing D16 cases (expected — D16 not yet fixed).

Task 3 (full target + suite):
```
 ✓ src/cli/dev-host/multiplayer-host.palette.test.ts (2 tests) 6ms
 ✓ src/cli/commands/dev.test.ts (32 tests) 5ms

 Test Files  2 passed (2)
      Tests  34 passed (34)

...

 Test Files  203 passed (203)
      Tests  2879 passed (2879)
```
Baseline was 202 files / 2871 tests; +1 file (the new palette test file), +8 tests (6 dev.test.ts +
2 palette test file) — all green, no regressions.

## Verification

- `npx vitest run src/cli/commands/dev.test.ts src/cli/dev-host/multiplayer-host.palette.test.ts` — 34/34 pass.
- `npm test` — 203 files / 2879 tests pass (baseline 202/2871).
- Grep gate: `grep -n "'--players" src/cli/cli.ts` — the `dev` command's `--players` line has no
  trailing `'2'` literal default (only `simulate`'s unrelated `--players` option still defaults to `'2'`,
  out of scope).
- Grep gate: `grep -c "colorPalette" src/session/types.ts` — 4 (>= 1 required).

## Interfaces for Plans 02/03 (dev.ts/cli.ts continuity)

- **`GameDefinition.colorPalette?: Array<{ id: string; hex: string; label: string }>`**
  (`src/session/types.ts`) — the validated `{id,hex,label}` shape, matching `validate.ts`'s
  `colorPalette` check. Optional; absent on games that don't declare one.
- **`resolveColorPalette(gameDefinition: { colorPalette?: Array<{id,hex,label}> }, config: {
  colorPalette?: Array<string | Record<string, unknown>> }): Array<{ value: string; label: string }>`**
  (`src/cli/commands/dev.ts`, exported) — ordered fallback: `gameDefinition.colorPalette` ->
  `config.colorPalette` -> `[...DEFAULT_COLOR_PALETTE]`. Always returns a non-empty array (the engine
  default is the final fallback), so `devConfig.colorPalette`/the `color` playerOption are always
  populated now (previously only when `boardsmith.json` declared a palette).
- **`resolvePlayerCount(rawPlayers: string | undefined, minPlayers: number, maxPlayers: number):
  number`** (`src/cli/commands/dev.ts`, exported) — `minPlayers` when `rawPlayers` is `undefined`,
  else `parsePositiveInt` + `resolveEffectivePlayerCount` (still throws `DevFlagError` on an explicit
  out-of-range value). `devCommand` now resolves player count AFTER `gameDefinition` loads (not
  before), so Plan 02/03 work touching `--game-option`/`--preset` flags in `cli.ts`/`dev.ts` should be
  aware the players resolution point has moved later in `devCommand`'s body (was `:440` pre-load, now
  after `minPlayers`/`maxPlayers` are known, replacing the old `:571` `resolveEffectivePlayerCount`
  call site).
- `DevOptions.players` is now `string | undefined` (was `string`) — any new code reading
  `options.players` directly must handle `undefined`.

## Deviations from Plan

None — plan executed exactly as written. The D16 fix intentionally makes `colorPalette`/`playerOptions.color`
always non-empty (previously only populated when `boardsmith.json` declared a palette) — this was an
explicit plan instruction ("keep the existing playerOptions.color choices wiring fed from the resolved
palette", replacing the `if (config.colorPalette)` conditional), not an unplanned deviation.

### Auth gates
None encountered.

## Known Stubs
None.

## Threat Flags
None — this plan implements the mitigations specified in its own threat model (T-161-01, T-161-02);
no new, unlisted security-relevant surface introduced.

## Self-Check: PASSED

- `src/cli/commands/dev.test.ts` (resolvePlayerCount/resolveColorPalette tests) — FOUND
- `src/cli/dev-host/multiplayer-host.palette.test.ts` — FOUND
- `src/cli/cli.ts` (no trailing `'2'` on dev `--players`) — FOUND
- `src/cli/commands/dev.ts` (`resolvePlayerCount`, `resolveColorPalette` exported) — FOUND
- `src/session/types.ts` (`GameDefinition.colorPalette`) — FOUND
- Commit `dcf44bec` (RED) — FOUND in `git log`
- Commit `77cbf18d` (GREEN D14) — FOUND in `git log`
- Commit `8f4d2fc5` (GREEN D16) — FOUND in `git log`
