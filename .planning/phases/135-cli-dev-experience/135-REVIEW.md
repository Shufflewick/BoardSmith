---
phase: 135-cli-dev-experience
reviewed: 2026-07-03T19:05:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - docs/getting-started.md
  - src/cli/cli.ts
  - src/cli/commands/init.ts
  - src/cli/commands/init.test.ts
  - src/cli/commands/build.test.ts
  - src/cli/commands/build.ts
  - src/cli/commands/dev.test.ts
  - src/cli/commands/dev.ts
  - src/cli/commands/validate.test.ts
  - src/cli/commands/validate.ts
  - src/cli/lib/boardsmith.schema.json
  - src/cli/lib/bundle-limits.ts
  - src/cli/lib/config-schema.ts
  - src/cli/lib/project-scaffold.test.ts
  - src/cli/lib/project-scaffold.ts
findings:
  critical: 2
  warning: 5
  info: 6
  total: 13
status: issues_found
---

# Phase 135: Code Review Report

**Reviewed:** 2026-07-03T19:05:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Reviewed the Phase 135 CLI & dev-experience changes: `--template` removal, `--host`/`--lan` hardening, scaffold `playerCount`/`$schema` removal, `deriveManifest`, unknown-key validation, and fail-fast dev flag parsing. The new pure helpers (`parsePositiveInt`, `parseAiSeats`, `resolveEffectivePlayerCount`, `validateAiSeats`, `resolveHost`, `deriveManifest`, `checkMetadataIssues`) are well-factored and well-tested; all 57 tests in the five test files pass.

Two Critical findings survived adversarial verification: (1) the scaffold emits a broken `Player` re-export that makes every fresh `boardsmith init` project fail `tsc --noEmit` — i.e. the scaffold fails the very `boardsmith validate` gate this phase hardened (verified by generating the scaffold and running tsc: `TS2305`); (2) the new unknown-key rejection hard-fails validate on the `$schema` key that every existing game in `~/BoardSmithGames` carries, with a generic unhelpful message — while the phase simultaneously ships `boardsmith.schema.json` with a public `$id` that can only be consumed via that exact key.

Cross-module key audit: every key actually read from `boardsmith.json` by dev/build/publish/simulate/evolve-ai-weights/validate (`name`, `displayName`, `description`, `paths`, `ui`, `gameOptions`, `playerOptions`, `colorPalette`, `gameId`, `version`) is present in `ALLOWED_TOP_LEVEL_KEYS` — no consumed key is falsely rejected. No residual `config.playerCount` read site exists anywhere in `src/cli` (dev-host `playerCount` values all originate from CLI flags/gameDefinition), and `deriveManifest` keeps the `playerCount: {min,max}` shape in the published manifest, preserving the platform contract through `zip.ts`'s `manifest.json → boardsmith.json` mapping.

## Critical Issues

### CR-01: Scaffolded project fails its own `boardsmith validate` — `Player` re-exported from the wrong module

**File:** `src/cli/lib/project-scaffold.ts:231` (interacts with `src/cli/commands/init.ts:167`)
**Issue:** `generateRulesIndexTs` emits:

```ts
export { ${pascal}Player } from './elements.js';
```

but the `${pascal}Player` class is defined in `game.ts` (`init.ts` `generateGameTs`), not `elements.ts` — `generateElementsTs` only defines `Card`, `Hand`, `Deck`, `PlayArea`. Verified by generating the scaffold files and compiling: every fresh project gets

```
rules/index.ts(2,10): error TS2305: Module '"./elements.js"' has no exported member 'DemoPlayer'.
```

Consequences: `boardsmith validate` FAILS out of the box on a brand-new `init` project (the TypeScript check runs `tsc --noEmit`), `boardsmith build`'s Rollup lib build fails on the unresolved re-export, and IDEs show a red error on line 2 of the first file a new user opens. Only `boardsmith dev` masks it because its esbuild bundles run with `logLevel: 'silent'`, which downgrades the missing re-export to a suppressed warning (the export is silently `undefined`) — which is exactly why the dev-server playability gates never caught it. This is pre-existing (since 40-02), but this phase touched both generator files and made `validate` the promoted hard gate, so the scaffold now visibly contradicts the "pit of success" goal of the phase.
**Fix:**
```ts
// src/cli/lib/project-scaffold.ts generateRulesIndexTs
export { ${pascal}Game, ${pascal}Player } from './game.js';
```
and add a scaffold regression test that type-checks (or at least esbuild-bundles with `logLevel: 'error'`) the full generated rules module set.

### CR-02: `validate` hard-fails every existing game on the `$schema` key with a generic "not recognized" error

**File:** `src/cli/lib/boardsmith.schema.json:9-76` / `src/cli/lib/config-schema.ts:18-22` / `src/cli/commands/validate.ts:112-121`
**Issue:** `ALLOWED_TOP_LEVEL_KEYS` (derived from the schema's `properties`) does not include `$schema`. All 8 games in `~/BoardSmithGames` (`checkers`, `cribbage`, `go-fish`, `hex`, `polyhedral-potions`, all demo-*) carry `$schema` in `boardsmith.json`, so `boardsmith validate` now FAILS all of them with `Unknown key '$schema' — not a recognized boardsmith.json field.` (verified: `findUnknownKeys({'$schema': ...})` returns no suggestion). Unlike `playerCount`, which gets a pointed migration message and is deliberate migration pressure, the `$schema` rejection is self-contradictory: this same phase ships `boardsmith.schema.json` with a public `$id` (`https://boardsmith.io/schemas/boardsmith.schema.json`) — the only way an editor consumes that schema is via a top-level `$schema` key, which `validate` then rejects. The intended pit of success (IDE autocomplete + did-you-mean from one schema) is broken by its own gate. `boardsmith dev` likewise prints a bogus warning for it on every existing game.
**Fix:** Either add `$schema` to the schema's `properties` (a string, documented as "optional editor schema reference; ignored by the CLI"), or special-case it in `findUnknownKeys` the way `checkMetadataIssues` special-cases `playerCount`. If rejection is truly intended, emit a pointed message ("remove the editor `$schema` line; it is no longer used") and migrate the sibling game repos in the same change.

## Warnings

### WR-01: Dev banner still says "open the page on another computer to join" while binding local-only

**File:** `src/cli/commands/dev.ts:737`
**Issue:** With the new `127.0.0.1` default, no other computer can connect, yet this line prints unconditionally: `Multiplayer: each browser is a player; open the page on another computer to join.` The network-URL loop above it correctly prints nothing on a loopback bind, but this message actively tells the user to do something that will fail, with no pointer to `--lan`.
**Fix:** Branch on `isNonLocal`: when local-only, print e.g. `Multiplayer: each browser tab is a player. To let other computers join, restart with --lan.`

### WR-02: `boardsmith build` deletes the entire shared `.boardsmith` directory, including files it didn't create

**File:** `src/cli/commands/build.ts:130-144`
**Issue:** The new manifest-derivation step uses `join(cwd, '.boardsmith')` as its temp dir and then `rmSync(tempDir, { recursive: true, force: true })` in `finally`. `.boardsmith` is a shared directory: `boardsmith pack` defaults its tarball output to `.boardsmith/tarballs` (cli.ts:61), `evolve-ai-weights.ts:70` reads `.boardsmith/rules-bundle.mjs` as a fallback, and a concurrently running `boardsmith dev` keeps its runtime bundle there. Running `build` wipes all of it. This copies simulate.ts's pre-existing pattern (simulate.ts:171,188 has the same defect), but this phase adds another instance of it.
**Fix:** Use a command-scoped subdirectory and remove only that:
```ts
const tempDir = join(cwd, '.boardsmith', 'build-tmp');
mkdirSync(tempDir, { recursive: true });
// ... finally { rmSync(tempDir, ...) }  // removes only build-tmp
```
(Apply the same to simulate.ts as a follow-up.)

### WR-03: getting-started.md dev-server section documents commands that now error

**File:** `docs/getting-started.md:53-73, 88-92`
**Issue:** This file was touched this phase (the `$schema` example line was removed) but the surrounding content is now actively wrong, not just stale:
- Line 66: `boardsmith dev --ai 0 2` — seats are 1-indexed; with the new fail-fast `validateAiSeats`, this documented command now exits with `Invalid AI player position(s): 0`.
- Line 72: `--worker-port 9000` — no such flag exists (cli.ts registers no `--worker-port`); commander exits with `unknown option`.
- Lines 53-56: "A game server on port 8787" / "Automatically opens browser tabs for each player" — the dev host attaches its WS to the Vite server (single port) and opens one host tab.
- The new `--host`/`--lan` options and the local-only-by-default behavior change (the headline security change of this phase) are undocumented here.
- Lines 88-92: claims `validate` runs "Random game simulation to detect infinite loops" — validate.ts runs no simulation (that is `boardsmith simulate`).
**Fix:** Rewrite the Dev Server Options block against the current cli.ts option set (`--port`, `--host`, `--lan`, `--players`, `--ai` 1-indexed, `--ai-level`, `--lock-teaching`) and correct the validate description.

### WR-04: `--lan` is silently ignored when `--host` is also passed

**File:** `src/cli/commands/dev.ts:114-118`, `src/cli/cli.ts:34-35`
**Issue:** `resolveHost` gives an explicit `--host` unconditional precedence: `boardsmith dev --lan --host 127.0.0.1` binds local-only and drops `--lan` without any notice. The precedence is documented only in a code comment, not in the CLI help. This phase's own theme is fail-fast on contradictory/ignored input (`--ai` no longer silently drops bad entries); silently ignoring a security-relevant flag is the same class of defect.
**Fix:** Error (or at minimum warn) when both `--lan` and `--host` are supplied and they disagree, e.g. throw `DevFlagError('--lan and --host <h> conflict; pass one or the other')`, or use commander's `conflicts('host')` on the `--lan` option.

### WR-05: Bundle-size check compares uncompressed dist size against a limit the server enforces on the compressed zip; publish still has no pre-upload gate

**File:** `src/cli/commands/validate.ts:244-284`, `src/cli/lib/bundle-limits.ts:1-11`
**Issue:** Two gaps against the F21/CLIX-03 goal ("validate must agree with the real publish gate"):
1. `validateBundleSize` sums the raw `dist/` directory (`getDirSize`) and compares it to `MAX_BUNDLE_SIZE`, but the authoritative games-worker gate applies 50MB to the uploaded **zip**. A game whose dist is 60MB of compressible JSON/JS can zip under 50MB — validate FAILs it even though publish would succeed (false rejection, the inverse of the original bug).
2. `bundle-limits.ts`'s header says the constant is single-sourced "for `boardsmith validate`/`publish`", but publish.ts never imports it — it builds the zip (`zip.length` at publish.ts:120-121) and uploads without a local size check, so an oversized bundle still round-trips to the server to fail. The comparison the constant was created for exists at exactly the point where `zip.length` is known.
**Fix:** In publish.ts, gate on `zip.length > MAX_BUNDLE_SIZE` before upload with an actionable error; in validate.ts, either label the dist-size check as an approximation in its message or (better) build the same zip in-memory via `createZip` and measure that.

## Info

### IN-01: Absolute did-you-mean threshold produces absurd suggestions for short keys

**File:** `src/cli/lib/config-schema.ts:28, 65-78`
**Issue:** `SUGGESTION_THRESHOLD = 3` regardless of key length: unknown keys `ai`, `ci`, `id` all get `did you mean 'ui'?` (verified). Ties are also broken arbitrarily by schema iteration order.
**Fix:** Scale the threshold to key length, e.g. `Math.min(3, Math.max(1, Math.floor(key.length / 3)))`.

### IN-02: dev's leftover-`playerCount` warning lacks the migration guidance validate gives

**File:** `src/cli/commands/dev.ts:125-131` vs `src/cli/commands/validate.ts:112-118`
**Issue:** `boardsmith dev` on a config with leftover `playerCount` prints the generic `Unknown boardsmith.json key "playerCount" — this key is ignored.` (no did-you-mean is within threshold), while validate gives the pointed "derived from your gameDefinition, remove this key" message. The two surfaces were supposed to warn/reject on the same basis; the dev message doesn't tell the user what replaced the key. The validate message could also name the write site (`minPlayers`/`maxPlayers` in `src/rules/index.ts`).
**Fix:** Special-case `playerCount` in `formatUnknownKeyWarnings` with the same migration text (or move the message mapping into config-schema.ts so both surfaces share it).

### IN-03: `parseAiSeats` error message promises "positive integers" but accepts 0/negatives at parse time

**File:** `src/cli/commands/dev.ts:62-76`
**Issue:** The thrown message says "must be a comma-separated list of positive integers", but only `Number.isInteger` is checked — `--ai 0` and `--ai -1` parse fine and are only rejected ~seconds later by `validateAiSeats` after the rules bundle loads. Duplicates (`--ai 1,1`) are also not deduped before reaching `MultiplayerHost.designatedAiSeats`.
**Fix:** Add `value < 1` to the parse-time check (keeps the fail-fast promise) and `[...new Set(seats)]` the result.

### IN-04: Dead `rulesPackage` field on dev.ts's `BoardSmithConfig`

**File:** `src/cli/commands/dev.ts:149`
**Issue:** `rulesPackage?: string` is declared but has zero read sites anywhere in `src/`, and it is not in `ALLOWED_TOP_LEVEL_KEYS` — so dev's own type claims a key is legitimate that its own startup warning calls unknown.
**Fix:** Delete the field.

### IN-05: `resolveHost` flags IPv6 loopback `::1` as non-local

**File:** `src/cli/commands/dev.ts:116`
**Issue:** `host !== '127.0.0.1' && host !== 'localhost'` — `--host ::1` binds loopback but triggers the scary "anyone on your LAN can join" banner. An empty-string `--host ""` also yields `isNonLocal: true` while Vite treats it as falsy/localhost.
**Fix:** Include `'::1'` in the local set (and treat `''` as unset or reject it).

### IN-06: getting-started boardsmith.json example drifted from scaffold output

**File:** `docs/getting-started.md:109-119`
**Issue:** The example config omits the `"ui": "auto"` key the scaffold now always emits (project-scaffold.ts:113). Minor, but this is the file readers diff against their generated project.
**Fix:** Add `"ui": "auto"` to the example.

---

_Reviewed: 2026-07-03T19:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
