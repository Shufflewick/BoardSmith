---
phase: 135-cli-dev-experience
verified: 2026-07-03T22:00:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 135: CLI Dev Experience Verification Report

**Phase Goal:** `boardsmith` CLI commands catch misconfiguration and invalid input instead of silently diverging, clamping, or ignoring flags.
**Verified:** 2026-07-03T22:00:00Z
**Status:** passed
**Re-verification:** No — initial verification (post code-review fix loop)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (CLIX-01) | `playerCount` has ONE source of truth (`gameDefinition`); scaffold no longer double-writes it; manifest derives it, never forwards it | VERIFIED | Scaffold (`src/cli/lib/project-scaffold.ts`) emits `boardsmith.json` with no `playerCount` key (only internal `ProjectConfig.playerCount` seeds `generateRulesIndexTs`'s hardcoded `minPlayers`/`maxPlayers`, the sole write site). `build.ts:126-149` loads compiled `gameDefinition` via `loadGameDefinition` and `deriveManifest` (`build.ts:26-41`) computes `manifest.playerCount` from it, never from raw config spread. `validate.ts:111-118` rejects a leftover `playerCount` key with a pointed migration message. `dev.ts` reads `minPlayers`/`maxPlayers` from `gameDefinition` only (no `config.playerCount` fallback chain remains). |
| 2 (CLIX-02) | `boardsmith validate` rejects unknown top-level `boardsmith.json` keys with did-you-mean | VERIFIED | `config-schema.ts` derives `ALLOWED_TOP_LEVEL_KEYS` from `boardsmith.schema.json`'s `properties` (single source); `findUnknownKeys` + `suggestKey` (levenshtein) implement did-you-mean; `validate.ts:113` calls `findUnknownKeys(config)` and fails on any unrecognized key. `$schema` (CR-02 fix, commit b4f0c8ca) added to the schema's own `properties` so the shipped `boardsmith.schema.json`'s public `$id` can be consumed via `$schema` without validate self-rejecting it — verified all 8 sibling games in `~/BoardSmithGames` would no longer false-fail (schema-level fix, not a special case). |
| 3 (CLIX-03) | Bundle-size validation enforces the real 50MB server limit, not 200MB | VERIFIED | `bundle-limits.ts`: `MAX_BUNDLE_SIZE = 50 * 1024 * 1024`, comment cites `~/ShufflewickPubGames/src/upload.ts:4` as authoritative. WR-05 fix (commit 9fc6b718) additionally moved both `validate.ts` and `publish.ts` to measure the actual compressed publish zip (`createZip`) rather than raw `dist/` size, closing a false-rejection gap the original fix would have left open. `publish.ts` now gates `zip.length` before upload. |
| 4 (CLIX-04) | `boardsmith dev` binds `127.0.0.1` by default; `--lan`/`--host 0.0.0.0` is required for LAN; loud banner on non-local bind | VERIFIED | `dev.ts:125`: `const host = options.host ?? (options.lan ? '0.0.0.0' : '127.0.0.1')`. `dev.ts:465-467` prints a yellow non-local banner naming the tradeoff and the `--host 127.0.0.1` opt-out. `cli.ts` `--host`/`--lan` help text states the real default and mutual-exclusion. WR-04 fix (commit 24a50eff) makes `--lan` + `--host` together a hard `DevFlagError`, not silent-drop. WR-01 fix (commit d00e5e4d) makes the multiplayer banner host-aware (`multiplayerBannerLine`) instead of always telling users to invite others when bound local-only. |
| 5 (CLIX-05) | `-t/--template` removed outright (no-op flag deleted, not documented) | VERIFIED | `grep -n "template" src/cli/cli.ts src/cli/commands/init.ts` returns zero matches — flag and `InitOptions.template` field both fully removed. |
| 6 (CLIX-06) | Non-numeric `--players`/`--port`/`--ai` fail fast; out-of-range `--players` errors (not clamps); `--ai` validated against effective post-clamp count | VERIFIED | `dev.ts:419-421` calls `exitOnDevFlagError(parsePositiveInt/parseAiSeats)` before any use — non-numeric input throws `DevFlagError` and exits with an actionable message. `dev.ts:551-552`: `resolveEffectivePlayerCount` (errors on out-of-range, does not clamp) runs first, then `validateAiSeats(aiPlayers, effectivePlayerCount)` runs against the now-known effective count — the check was relocated (per F34's Pitfall-3 ordering note), not edited in place. |

**Score:** 6/6 truths verified

### PROC-01 / PROC-02 Gate Compliance

| Requirement | Evidence |
|---|---|
| PROC-01 | `135-FINDINGS-VERIFICATION.md` records LEGITIMATE verdicts with current-HEAD file:line traces for all 6 in-scope findings (F9, F21, F22, F32, F33, F34), written in Plan 01 before any fix task (Plans 02-06) ran. Verified the document itself contains no fix code, only trace + verdict, per its own purpose statement. |
| PROC-02 | Each plan's must_haves required a RED-then-fixed regression test: `init.test.ts` (no-template assertion), `project-scaffold.test.ts` (no-`playerCount`-in-JSON, plus the CR-01-driven full tsc type-check regression), `build.test.ts` (derived-manifest fixture, new file), `validate.test.ts` (unknown-key rejection, playerCount migration message, MAX_BUNDLE_SIZE, WR-05 zip-vs-dist regression), `dev.test.ts` (default host, banner, fail-fast numeric flags, post-move `--ai` validation, WR-04 conflict). All confirmed present and passing in the current test run (see Behavioral Spot-Checks). |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/cli/cli.ts` | No `--template`; corrected `--host` help; `--lan` flag | VERIFIED | Confirmed by grep — flag registered, help text accurate, mutual-exclusion documented |
| `src/cli/commands/init.ts` | `InitOptions` without `template` | VERIFIED | Zero read/declare sites remain |
| `src/cli/lib/project-scaffold.ts` | No `playerCount`/dead `$schema` in emitted JSON; sole write via `generateRulesIndexTs` | VERIFIED | Plus CR-01 fix: `PlayerClass` static field pattern, re-export from `game.js` (not `elements.js`) |
| `src/cli/commands/build.ts` | Manifest derives `playerCount` via `loadGameDefinition`/`deriveManifest` | VERIFIED | `build.ts:126-149` |
| `src/cli/commands/validate.ts` | Unknown-key rejection, playerCount migration message, 50MB zip check | VERIFIED | Plus WR-05: measures actual publish zip, not raw dist |
| `src/cli/lib/config-schema.ts` | `ALLOWED_TOP_LEVEL_KEYS` + `suggestKey`/`findUnknownKeys` from single schema | VERIFIED | Sourced from `boardsmith.schema.json` |
| `src/cli/lib/bundle-limits.ts` | `MAX_BUNDLE_SIZE = 50 * 1024 * 1024` shared constant | VERIFIED | Plus WR-05 `describeZipSizeViolation` shared helper used by both validate and publish |
| `src/cli/commands/dev.ts` | Default 127.0.0.1, `--lan` resolution, banner, fail-fast flags, moved `--ai` check, single `gameDefinition` read, unknown-key warn | VERIFIED | All confirmed by direct read; WR-01/WR-04 review fixes also present |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `cli.ts` dev command | `dev.ts` | `--lan`/`--host` options consumed by `devCommand` | WIRED | `resolveHost({ host: options.host, lan: options.lan })` |
| `generateRulesIndexTs` | `gameDefinition.minPlayers/maxPlayers` | scaffold-time write | WIRED | Only remaining write site after `playerCount` JSON-key removal |
| `build.ts` | `loadGameDefinition` (`game-runtime.ts`) | Node-side esbuild+import mirroring `simulate.ts` | WIRED | Confirmed import + call at `build.ts:139` |
| `validate.ts` | `config-schema.ts` `findUnknownKeys`/`suggestKey` | new ValidationResult check | WIRED | `validate.ts:113` |
| `config-schema.ts` | `boardsmith.schema.json` | `Object.keys(schema.properties)` | WIRED | `config-schema.ts:18-19` |
| `dev.ts` startup | `config-schema.findUnknownKeys` | loud warn on unknown keys | WIRED | Confirmed via grep for `findUnknownKeys` in `dev.ts` |
| `dev.ts` `--ai` validation | `effectivePlayerCount` | moved to post-resolution | WIRED | `dev.ts:551-552`, after `resolveEffectivePlayerCount` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| CLI test suite (all 17 CLI test files) | `npx vitest run src/cli` | 179 tests passed, including CR-01 tsc regression (`project-scaffold.test.ts`) and WR-05 zip-vs-dist regression (`validate.test.ts`) | PASS |
| Full repo test suite (regression check) | `npx vitest run` | 172 files / 2285 tests passed | PASS |
| `tsc --noEmit` (no new src/cli errors) | `npx tsc --noEmit \| grep src/cli` | 0 matches (36 pre-existing errors elsewhere, unchanged per REVIEW.md baseline) | PASS |
| Debt-marker scan on all phase-touched files | `grep -n "TBD\|FIXME\|XXX"` across 9 touched files | 0 matches | PASS |

### Code-Review Fix Loop Verification

The phase underwent a `standard`-depth review (`135-REVIEW.md`) that found 2 Critical + 5 Warning issues. Both Criticals and all 5 Warnings were fixed in commits `d01965fd`, `b4f0c8ca`, `d00e5e4d`, `1a8dc469`, `24a50eff`, `9fc6b718`, `544bac49`, and the fix-status was re-marked `resolved` in the REVIEW.md frontmatter with a post-fix full-suite gate (172 files / 2285 tests) — independently reproduced above, matching exactly. Both Critical fixes were re-derived from source, not merely trusted:

- **CR-01** (scaffold `Player` re-export from wrong module, breaking `tsc --noEmit` on every fresh `init` project): confirmed fixed — `init.ts` now declares `${pascal}Player` before `${pascal}Game` with a `static PlayerClass` field (matching the real engine pattern used by `hex`), and `project-scaffold.ts`'s `generateRulesIndexTs` re-exports from `./game.js`. The regression test added (`project-scaffold.test.ts`) uses `ts.createProgram` (not esbuild, since esbuild was proven unable to catch this class of error) and is present and passing.
- **CR-02** (`$schema` self-rejected by the phase's own unknown-key gate): confirmed fixed — `boardsmith.schema.json`'s `properties` now includes `$schema`, so `ALLOWED_TOP_LEVEL_KEYS` (derived from that single source) accepts it without a special case in `config-schema.ts`.

No must-have regressed as a result of the fix loop — all 6 observable truths above were verified against the current, post-fix HEAD, not against the pre-fix state described earlier in REVIEW.md.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| PROC-01 | 135-01 | Every finding verified before fix | SATISFIED | `135-FINDINGS-VERIFICATION.md` all 6 LEGITIMATE with traces |
| CLIX-05 | 135-02 | `-t/--template` removed | SATISFIED | Zero references in cli.ts/init.ts |
| CLIX-04 (registration) | 135-02 | `--host`/`--lan` help + flag | SATISFIED | cli.ts help text accurate |
| PROC-02 | 135-02..06 | Regression tests per fix | SATISFIED | Confirmed present + passing in each *.test.ts |
| CLIX-01 | 135-03/04/06 | Player-count single source of truth | SATISFIED | Scaffold + build.ts + dev.ts all confirmed |
| CLIX-02 | 135-03/05/06 | `$schema` removed from scaffold; unknown-key rejection | SATISFIED | Scaffold no dead `$schema`; validate.ts + dev.ts warn/reject |
| CLIX-03 | 135-05 | 50MB bundle limit enforced correctly | SATISFIED | bundle-limits.ts + WR-05 zip-based fix |
| CLIX-06 | 135-06 | Fail-fast numeric flags, moved `--ai` check | SATISFIED | dev.ts confirmed |

No orphaned requirements found — all CLIX-01..06 and PROC-01/02 declared in plan frontmatter map to REQUIREMENTS.md entries, all marked Complete there.

### Anti-Patterns Found

None found in phase-touched files (`src/cli/cli.ts`, `src/cli/commands/init.ts`, `src/cli/commands/dev.ts`, `src/cli/commands/build.ts`, `src/cli/commands/validate.ts`, `src/cli/lib/project-scaffold.ts`, `src/cli/lib/config-schema.ts`, `src/cli/lib/bundle-limits.ts`, `src/cli/lib/boardsmith.schema.json`): no TBD/FIXME/XXX, no placeholder returns, no unwired stubs.

**Note (non-blocking, informational):** `135-REVIEW.md` intentionally left 6 Info-severity findings open (out of `fix_scope: critical_warning`): IN-01 (did-you-mean threshold absurd for short keys), IN-02 (dev's playerCount warning lacks validate's migration detail), IN-03 (`--ai` accepts 0/negative at parse time, rejected later), IN-04 (dead `rulesPackage` field on `BoardSmithConfig`), IN-05 (`::1` flagged as non-local), IN-06 (docs example missing `"ui": "auto"`). None of these contradict the phase's observable truths or must-haves — they are polish items correctly scoped out of this phase per the review's own `fix_scope`.

### Human Verification Required

None. All must-haves are verifiable via source inspection, automated test execution, and `tsc`. No visual, real-time, or external-service behavior is in scope for this phase.

### Gaps Summary

No gaps. All 6 observable truths (CLIX-01 through CLIX-06) are verified directly against current HEAD source, not SUMMARY.md claims. The code-review fix loop (2 Critical + 5 Warning) is independently reproduced: the CR-01 scaffold rebuild (static `PlayerClass` pattern) and CR-02 `$schema` allow-list fix are both present and their regression tests pass. Full test suite (2285 tests) and `tsc --noEmit` (no new src/cli errors) confirm no regression from the fix loop.

---

_Verified: 2026-07-03T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
