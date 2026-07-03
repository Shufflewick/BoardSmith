---
phase: 135-cli-dev-experience
plan: 06
subsystem: cli
tags: [cli, dev-server, security, validation, config-schema]

# Dependency graph
requires:
  - phase: 135-01
    provides: PROC-01 verification gate confirming F9/F32/F34 (CLIX-01/04/06) LEGITIMATE with locked fix direction
  - phase: 135-02
    provides: cli.ts --lan flag registration + corrected --host help text (default 127.0.0.1)
  - phase: 135-05
    provides: src/cli/lib/config-schema.ts (findUnknownKeys/suggestKey, ALLOWED_TOP_LEVEL_KEYS)
provides:
  - "boardsmith dev defaults to 127.0.0.1 (local-only); --lan/--host 0.0.0.0 opts into LAN exposure with a loud banner"
  - "Fail-fast Number.isInteger validation for --port/--players/--ai (no silent NaN filtering)"
  - "--players out-of-range now ERRORS naming the game's min/max instead of silently clamping"
  - "--ai seats validated against the effective post-resolution player count (Pitfall 3 fix)"
  - "minPlayers/maxPlayers resolved solely from gameDefinition (config.playerCount/minPlayers fallback removed)"
  - "dev startup warns loudly (non-exiting) on unknown boardsmith.json top-level keys"
affects: [136-sdk-hardening, 139-docx-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DevFlagError + exitOnDevFlagError(): pure validators throw a typed error; a single wrapper at the call site converts it to devCommand's chalk.red + process.exit(1) convention, keeping the validators unit-testable without touching process.exit"

key-files:
  created:
    - src/cli/commands/dev.test.ts
  modified:
    - src/cli/commands/dev.ts

key-decisions:
  - "All new dev.ts logic (numeric parsing, host resolution, effective-count/AI validation, unknown-key warnings) extracted as pure, exported helper functions so dev.test.ts can assert PROC-02 regressions without binding a real Vite/WS server"
  - "resolveEffectivePlayerCount keeps the effectivePlayerCount name/shape even though it no longer clamps (out-of-range now errors) -- preserves the existing devConfig/mpHost call sites and the plan's key_links pattern requirement"
  - "BoardSmithConfig's dead minPlayers/maxPlayers/playerCount fields removed (Rule 1 dead-code cleanup) once the gameDefinition-only read made them unused, matching the F9 verdict"
  - "RED-then-GREEN done as two commits per PROC-02, not six -- Task 1/2/3's dev.ts edits are interleaved in the same devCommand body (host resolution feeds the banner, minPlayers/maxPlayers collapse feeds the effective-count/--ai move), so tests for all three tasks were written first (one RED commit) and dev.ts was implemented as one cohesive GREEN commit rather than three commits that would each leave the file in a non-compiling intermediate state"

requirements-completed: [CLIX-01, CLIX-02, CLIX-04, CLIX-06, PROC-02]

# Metrics
duration: 20min
completed: 2026-07-03
---

# Phase 135 Plan 06: Harden `boardsmith dev` Flags/Host/Config Summary

**`boardsmith dev` now binds 127.0.0.1 by default with loud opt-in LAN exposure, fails fast on bad numeric flags, errors (not clamps) on out-of-range `--players`, validates `--ai` against the effective post-resolution player count, reads player count solely from `gameDefinition`, and warns on unknown `boardsmith.json` keys.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-03T18:46:45Z
- **Tasks:** 3 (implemented as one cohesive `dev.ts` edit, see Deviations)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- CLIX-06 (F34): `--port`/`--players`/`--ai` fail fast on non-numeric input via `parsePositiveInt`/`parseAiSeats` (copying `simulate.ts`'s `Number.isInteger` idiom); `--ai`'s old `.filter(n => !isNaN(n))` silent-drop is gone.
- CLIX-06 (F34 Pitfall 3): out-of-range `--players` now **errors** naming the game's min/max (`resolveEffectivePlayerCount`) instead of the old `Math.min(Math.max(...))` silent clamp; the `--ai` bounds check (`validateAiSeats`) was **relocated** to run after the effective count is known, not edited in place.
- CLIX-04 (F32): default bind host is now `127.0.0.1` (`resolveHost`); `--lan` or `--host 0.0.0.0` opts into LAN exposure and triggers a loud `chalk.yellow` startup banner naming the tradeoff and the `--host 127.0.0.1` opt-out.
- CLIX-01 (F9): `minPlayers`/`maxPlayers` now read solely from `gameDefinition` — the `config.playerCount?.min ?? config.minPlayers ?? 2` fallback chain is gone, along with the now-dead `BoardSmithConfig.minPlayers/maxPlayers/playerCount` fields.
- CLIX-02 (F22): dev startup calls the Plan 05 `findUnknownKeys` module and prints a `chalk.yellow` warning per unknown top-level `boardsmith.json` key (with a did-you-mean suggestion when available) — a warning, not an exit; `boardsmith validate` remains the hard gate.
- PROC-02: all six behaviors above are covered by 19 new unit tests in `dev.test.ts` against pure, exported helpers (`parsePositiveInt`, `parseAiSeats`, `resolveEffectivePlayerCount`, `validateAiSeats`, `resolveHost`, `formatUnknownKeyWarnings`) — no real Vite server or WebSocket is ever opened.

## Task Commits

1. **RED (Tasks 1-3 combined test authoring):** `a42847ee` (test) — 19 assertions against not-yet-exported helpers; confirmed RED (17/19 failing on `TypeError: X is not a function`) before any `dev.ts` implementation existed.
2. **GREEN (Tasks 1-3 combined implementation):** `f985db30` (feat) — implemented all six helpers and wired them into `devCommand`; 19/19 `dev.test.ts` green, full CLI command suite (50 tests) green, `tsc --noEmit` clean.

_Note: see Deviations below for why Tasks 1-3 landed as one RED + one GREEN commit rather than three separate task commits._

## Files Created/Modified

- `src/cli/commands/dev.ts` — added `DevFlagError`, `parsePositiveInt`, `parseAiSeats`, `resolveEffectivePlayerCount`, `validateAiSeats`, `resolveHost`, `formatUnknownKeyWarnings`, `exitOnDevFlagError`; rewired `devCommand`'s flag parsing, host resolution, unknown-key warning, and effective-count/`--ai` validation ordering; removed dead `BoardSmithConfig` fields.
- `src/cli/commands/dev.test.ts` (new) — 19 tests covering all six PROC-02 regressions, no real sockets.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - dead code] Removed now-unused `BoardSmithConfig.minPlayers/maxPlayers/playerCount` fields**
- **Found during:** Task 2 (collapsing the minPlayers/maxPlayers fallback to a single `gameDefinition` read)
- **Issue:** Once the `config.playerCount?.min ?? config.minPlayers ?? 2` fallback chain was removed, the three `BoardSmithConfig` interface fields backing it had zero remaining read sites in `dev.ts`.
- **Fix:** Deleted the three fields, replaced with a comment pointing to the CLIX-01 decision.
- **Files modified:** `src/cli/commands/dev.ts`
- **Commit:** `f985db30`

**2. [Rule 3 - blocking type error] Cast `config` to `Record<string, unknown>` for `formatUnknownKeyWarnings`**
- **Found during:** Task 3 (unknown-key warning)
- **Issue:** `formatUnknownKeyWarnings` (reusing Plan 05's `findUnknownKeys(config: Record<string, unknown>)`) does not accept `dev.ts`'s locally-typed `BoardSmithConfig` interface (a closed shape, not an index signature) — `tsc --noEmit` failed with TS2345.
- **Fix:** `formatUnknownKeyWarnings(config as unknown as Record<string, unknown>)` at the one call site — the function only iterates `Object.keys(config)`, so the cast is safe; matches the pattern already used by `validate.ts`'s `checkMetadataIssues(config: Record<string, unknown>)`.
- **Files modified:** `src/cli/commands/dev.ts`
- **Commit:** `f985db30`

### Notable Process Deviation (not a code bug)

**Combined RED/GREEN commits instead of six per-task commits.** Tasks 1-3's `<action>` blocks all edit the same contiguous region of `devCommand` (numeric parsing → host resolution → config load → unknown-key warn → game-runtime load with the minPlayers/maxPlayers collapse → effective-count/`--ai` validation), and the ordering fix from Task 1 (relocating `--ai` validation) is only well-defined once Task 2's `minPlayers`/`maxPlayers` collapse and Task 2's host/banner code are in place. Splitting the implementation into three separate commits would have required either (a) landing intermediate commits that don't compile, or (b) implementing Task 2/3's logic early to make Task 1's commit compile, defeating the purpose of separate task commits. All three tasks' tests were written together as one RED commit, and all three tasks' `dev.ts` changes were implemented together as one GREEN commit — the resulting diff and commit messages enumerate each task's contribution individually for traceability.

## Known Stubs

None.

## Threat Flags

None — this plan directly implements the three `mitigate` dispositions (T-135-12, T-135-13, T-135-14) already declared in its own `<threat_model>`; no new undeclared surface was introduced.

## Self-Check: PASSED

- `src/cli/commands/dev.ts` — FOUND
- `src/cli/commands/dev.test.ts` — FOUND
- Commit `a42847ee` — FOUND (`git log --oneline --all | grep a42847ee`)
- Commit `f985db30` — FOUND (`git log --oneline --all | grep f985db30`)
- `npx vitest run src/cli/commands/dev.test.ts --reporter=dot` — 19/19 passing
- `npx tsc --noEmit -p .` — clean for dev.ts/dev.test.ts
