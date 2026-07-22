---
requirements-completed: [DEVHOST-01, PROC-01]
---

# Plan 161-03 Summary — gameOption/Preset Selector, Browser Side (D13, PROC-01)

**Plan:** 161-03 (execute — DevHost.vue only, file-disjoint from Plans 01/02/04; ran serially after
161-02 landed)
**Completed:** 2026-07-21
**Result:** PASS — the dev-host lobby claim area now renders a selector for the game's declared
`gameOptions` and `presets` (read from `DevHostConfig`, populated by Plan 02), styled with the
existing `--bsg-*` claim-area tokens. Applying a selection sends the host's `{type:'configure',
gameOptions, preset?}` message over the existing `wsSend` plumbing; choosing a preset fills the
option selectors with its bundle before apply.

## What was done

1. **Task 1 (RED):** Created `DevHost.gameoptions.test.ts`, copying the `FakeWebSocket` +
   `mountAndActivate`-style scaffolding from `DevHost.restart.test.ts`. Injected a `cfg` declaring a
   `difficulty` select gameOption (default `'easy'`, choices `easy`/`hard`) and a `'Quick Match'`
   preset (`options: {difficulty: 'hard'}`). Four cases: option control renders, preset picker
   renders, choosing `difficulty=hard` + apply sends `{type:'configure', gameOptions:{difficulty:
   'hard'}}` on the wire, and choosing the preset fills the option selector (`hard`) before apply
   sends `{type:'configure', preset:'Quick Match'}`. Written against the CURRENT `DevHost.vue` (no
   selector exists) — all 4 FAIL for the right reason (`data-testid` selectors not found; no
   production source touched). Commit `6941b7ca`.
2. **Task 2 (GREEN):** Added `optionSelection` (a `Record<string, unknown>` ref seeded from each
   declared option's `.default`) and `presetSelection` refs to `DevHost.vue`, mirroring the
   `colorInput` precedent. `onPresetSelect()` overlays the chosen preset's `options` bundle onto
   `optionSelection` (preset is a shortcut for setting the underlying options, per CONTEXT D13).
   `applyLobbyOptions()` sends `wsSend({type:'configure', gameOptions:{...optionSelection.value},
   preset?})` — the existing `wsSend` helper, no parallel wire path. Rendered the selectors inside
   `lobby__claim` (`:482-508` region) using `.dev-chrome__label` + `.dev-chrome__select` (the same
   classes the UI switcher already uses) and a `.btn` Apply button — reused verbatim, no new design
   tokens; added one small `.lobby__option` flex rule matching `.lobby__colors`. The whole block is
   guarded by `v-if="cfg.gameOptions.length || cfg.presets.length"`, exactly like the color row's
   `v-if="cfg.colorPalette.length"` — renders nothing when a game declares neither. Host `{type:
   'error'}` responses already route through the pre-existing `errorMsg` ref/banner (`onHostMessage`'s
   `case 'error'`), so an invalid selection surfaces via the existing error UI with no new plumbing.
   Commit `548080a0`.

No Task 3 (adversarial) in this plan — PROC-01's RED/GREEN pair was the full test scope per the
plan's task list (only two tasks defined).

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 FAIL  src/cli/dev-host/DevHost.gameoptions.test.ts > DevHost — lobby gameOption/preset selector (D13) > renders a control for the declared gameOption in the lobby claim area
AssertionError: expected false to be true // Object.is equality
 ❯ src/cli/dev-host/DevHost.gameoptions.test.ts:151:36

 FAIL  src/cli/dev-host/DevHost.gameoptions.test.ts > DevHost — lobby gameOption/preset selector (D13) > renders a picker for the declared preset in the lobby claim area
AssertionError: expected false to be true // Object.is equality
 ❯ src/cli/dev-host/DevHost.gameoptions.test.ts:157:36

 FAIL  src/cli/dev-host/DevHost.gameoptions.test.ts > DevHost — lobby gameOption/preset selector (D13) > choosing difficulty=hard and applying sends {type:configure, gameOptions:{difficulty:"hard"}}
AssertionError: expected false to be true // Object.is equality
 ❯ src/cli/dev-host/DevHost.gameoptions.test.ts:167:29

 FAIL  src/cli/dev-host/DevHost.gameoptions.test.ts > DevHost — lobby gameOption/preset selector (D13) > selecting the preset fills the option selector with the preset bundle and applying sends the preset name
AssertionError: expected false to be true // Object.is equality
 ❯ src/cli/dev-host/DevHost.gameoptions.test.ts:187:35

 Test Files  1 failed (1)
      Tests  4 failed (4)
```
All four fail on `data-testid` lookups (`lobby-option-difficulty`, `lobby-preset-picker`,
`lobby-apply-options`) returning `exists() === false` — the selector genuinely does not exist
pre-fix, not a harness bug.

## GREEN output

```
 ✓ src/cli/dev-host/DevHost.gameoptions.test.ts (4 tests) 52ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Full suite:
```
 Test Files  205 passed (205)
      Tests  2902 passed (2902)
```
Baseline (post-161-02) was 204 files / 2898 tests — +1 file (`DevHost.gameoptions.test.ts`), +4
tests, all green, no regressions.

## Verification

- `npx vitest run src/cli/dev-host/DevHost.gameoptions.test.ts` — 4/4 pass.
- `npm test` — 205 files / 2902 tests pass (baseline 204/2898).
- `npx vue-tsc --noEmit -p tsconfig.json` — zero new errors involving `DevHost.vue`.
- Grep gate: `grep -c "cfg.gameOptions\|cfg.presets" src/cli/dev-host/DevHost.vue` → 8 (≥1 required).
- Grep gate: `grep -n "wsSend" src/cli/dev-host/DevHost.vue` — `applyLobbyOptions()` calls `wsSend`
  with the `configure` message (line 86), reusing the same helper every other lobby/game action uses
  (`join`, `leave`, `restart`, `follow`) — no parallel wire path.

## Deviations from Plan

### Auto-fixed Issues
None — plan executed exactly as written.

### Auth gates
None encountered.

## Known Stubs
None. The selector is fully wired: it reads live `cfg.gameOptions`/`cfg.presets`, mutates real refs,
and sends a real `configure` frame on apply.

## Threat Flags
None — this plan implements the client (advisory) half of T-161-02; the host (Plan 02) remains the
authoritative validator, unchanged by this plan. No new security-relevant surface: the selector only
offers the game's own declared option ids/choices, already present in `DevHostConfig` (dev is a local
trusted tool, T-161-06 accept).

## Self-Check: PASSED

- `src/cli/dev-host/DevHost.gameoptions.test.ts` — FOUND
- `src/cli/dev-host/DevHost.vue` (`optionSelection`, `presetSelection`, `onPresetSelect`,
  `applyLobbyOptions`, `lobby-option-*`/`lobby-preset-picker`/`lobby-apply-options` data-testids) —
  FOUND
- Commit `6941b7ca` (RED) — FOUND in `git log`
- Commit `548080a0` (GREEN) — FOUND in `git log`
