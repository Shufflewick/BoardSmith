# Phase 135: CLI & Dev Experience - Research

**Researched:** 2026-07-03
**Domain:** BoardSmith CLI (`src/cli/`) — config validation, dev-host arg parsing, publish bundle-size gate
**Confidence:** HIGH (all six findings re-verified against current source at exact file:line; no library research required — this phase is pure internal refactor/validation, no new dependencies)

## Summary

Phase 135 fixes six audit-confirmed CLI footguns, all self-contained to `src/cli/`. None require new libraries — commander (already a dependency) handles arg parsing, and a hand-rolled key-check/levenshtein is the right call since no did-you-mean utility exists in the repo today. Every trace point named in the phase brief was re-verified against current line numbers; all match the audit almost exactly (line numbers shifted by 0-2 lines in a couple of spots, noted below).

The most consequential finding for planning is CLIX-01/CLIX-03: `build.ts`'s manifest generation is `{ ...config, buildTime, version, engineProtocol }` — a raw spread of the parsed `boardsmith.json`, so **any** `playerCount` key surviving in the JSON silently rides into the published manifest regardless of what the scaffold or dev.ts does. Removing `playerCount` from the scaffold isn't enough — `build.ts` must positively derive min/max players from `gameDefinition` (via the existing `loadGameDefinition` helper already used by `simulate.ts`) rather than merely stop writing the field. For CLIX-03, the real server limit was independently re-confirmed at `~/ShufflewickPubGames/src/upload.ts:4` as `MAX_BUNDLE_SIZE = 50 * 1024 * 1024` (50MB) — the code's `200MB` constant is wrong, not the comment; fix the constant to 50MB, not the comment.

**Primary recommendation:** Treat CLIX-01 as "derive, don't just delete" (manifest must actively compute playerCount from gameDefinition, not merely lose a field), treat CLIX-03 as "code was wrong, comment was right" (change the constant to 50MB), and treat CLIX-04/05/06 as narrowly-scoped one-file fixes with existing patterns to imitate (simulate.ts's `Number.isInteger` fail-fast style for CLIX-06).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| boardsmith.json schema validation | CLI (Node, build-time) | — | Runs in `validate`/`dev` startup, no browser/server involvement |
| Player-count source of truth | CLI (Node, build-time) reading compiled `gameDefinition` | Publish manifest (derived at build) | gameDefinition is the runtime engine's truth; CLI must read it, not duplicate it |
| Bundle-size enforcement | CLI (`validate`/`publish`, local pre-check) | External games-worker (`~/ShufflewickPubGames/src/upload.ts`, authoritative) | CLI check is advisory/pre-emptive; the worker is the real gate and BoardSmith cannot change it from this repo — only match it |
| Dev-host bind address & flags | CLI (`dev.ts`, Node process spinning Vite + WS) | — | Local process; no client/server split relevant |
| Scaffold generation (`init`) | CLI (Node, file writer) | — | One-shot local file generation |

## Standard Stack

No new libraries. This phase modifies existing CLI code only.

### Core (already present, no version changes needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | (existing dependency, see package.json) | CLI arg parsing/registration (`cli.ts`) | Already used for all option registration; NaN/range validation belongs in the action handler, not commander itself (commander has no built-in numeric-range validator worth adding a dependency for) |

### Don't add
- No JSON-schema validation library (e.g. `ajv`, `zod`) — CLAUDE.md requires discussing new dependencies first, and CONTEXT.md's discretion section explicitly allows "hand-rolled key check vs shipped JSON schema file — no new dependencies without discussion." A hand-rolled allowed-key-set check + Levenshtein distance function (~15 lines, no dependency) covers did-you-mean suggestions.
- No did-you-mean/levenshtein package exists in the repo (`grep -rln "levenshtein\|didYouMean"` returned nothing) — must hand-roll (trivial: classic DP levenshtein, ~20 lines).

## Package Legitimacy Audit

**Not applicable.** This phase installs no external packages — all six requirements (CLIX-01..06) are internal refactors to existing `src/cli/` files. No `npm install` step, no slopcheck run needed.

## Architecture Patterns

### Recommended Project Structure (no new files strictly required, but a shared module is worth adding)
```
src/cli/
├── cli.ts                        # commander registration — CLIX-04 (help text), CLIX-05 (-t removal)
├── commands/
│   ├── dev.ts                    # CLIX-01 (minPlayers chain), CLIX-04 (host default+banner), CLIX-06 (--players/--ai)
│   ├── validate.ts               # CLIX-02 (unknown-key check), CLIX-03 (bundle constant)
│   ├── build.ts                  # CLIX-01 (manifest playerCount derivation from gameDefinition)
│   ├── init.ts                   # CLIX-05 (drop template option/InitOptions.template)
│   └── game-runtime.ts           # loadGameDefinition — reuse for build.ts's gameDefinition read
├── lib/
│   ├── project-scaffold.ts       # CLIX-01 (drop playerCount from generateBoardsmithJson), CLIX-02 (fix/drop $schema)
│   ├── config-schema.ts          # NEW (discretion) — canonical allowed-key list + did-you-mean, shared by validate.ts + dev.ts
│   └── bundle-limits.ts          # NEW (discretion) — single MAX_BUNDLE_SIZE constant, imported by validate.ts (and documented for the external worker to mirror)
```

### Pattern 1: Derive-not-duplicate for player count (CLIX-01)
**What:** `gameDefinition.minPlayers`/`maxPlayers` (compiled from `src/rules/index.ts`) is the only place player count is authored. `boardsmith.json` loses the `playerCount` key entirely (scaffold no longer writes it). `dev.ts`'s resolution chain collapses from three fallbacks to one read of `gameDefinition`. `validate.ts` gains a check: if `playerCount` key is present in `boardsmith.json` at all, error with a migration message (it's now an unknown/removed key, folds naturally into CLIX-02's unknown-key rejection). `build.ts`'s manifest must call the existing `loadGameDefinition(rulesPath, tempDir, context)` helper (already used by `simulate.ts:167`) to read the real `minPlayers`/`maxPlayers` from the compiled rules, then write those into `manifest.json` explicitly — NOT rely on the `{ ...config }` spread.
**When to use:** Any manifest-affecting field that must reflect compiled game code rather than the static JSON.
**Example:**
```typescript
// Source: src/cli/commands/build.ts (current, line ~48 area — config loaded, no gameDefinition read yet)
// Source: src/cli/commands/simulate.ts:167 (existing pattern to imitate)
const { gameDefinition } = await loadGameDefinition(rulesPath, tempDir, context);
const manifest = {
  ...config,                 // no longer carries playerCount — key removed from scaffold+schema
  buildTime: new Date().toISOString(),
  version: config.version || '1.0.0',
  engineProtocol: BUNDLE_PROTOCOL_VERSION,
  playerCount: { min: gameDefinition.minPlayers, max: gameDefinition.maxPlayers }, // derived, not copied
};
```
Note: `build.ts` currently does NOT call esbuild to load the compiled rules at all — it only runs `viteBuild()` (browser/lib bundling), it never `import()`s the rules module in Node. Adding `loadGameDefinition` here is new work, not a rename — plan a task for it, including the `rulesPath`/`tempDir` setup `dev.ts`/`simulate.ts` already do (`join(cwd, '.boardsmith')`, `getProjectContext`).

### Pattern 2: Fail-fast numeric CLI flags (CLIX-06)
**What:** `simulate.ts:145-153` already does exactly what CLIX-06 wants for `--games`:
```typescript
// Source: src/cli/commands/simulate.ts:145-153 (existing, working pattern — copy this style for dev.ts)
const gamesCount = Number(options.games);
const playersCount = Number(options.players);
if (!Number.isInteger(playersCount) || playersCount < 1) {
  console.error(chalk.red(`Error: --players must be a positive integer, got "${options.players}"`));
  process.exit(1);
}
```
**When to use:** Apply the identical shape to `dev.ts`'s `--players`, `--port`, and `--ai` parsing (currently `parseInt(options.port, 10)` and `parseInt(options.players, 10)` at dev.ts:280-281 with no `isNaN`/range guard before use). Also fix the clamp-then-validate ordering bug: `dev.ts:302`'s `invalidAiPlayers` check runs against the raw pre-clamp `playerCount` (line 281), but the effective clamp happens at line 393 — validate `--ai` against `effectivePlayerCount` (post-clamp) instead, and per CONTEXT.md's decision, error (not clamp) when `--players` is out of the game's min/max range once `minPlayers`/`maxPlayers` are known (which only happens after `loadGameRuntime` resolves at line ~359 — later than the current `--ai` validation site at line 302, so the `--ai` check needs to move after minPlayers/maxPlayers are known, not just change its comparison value).

### Anti-Patterns to Avoid
- **Object-spread manifest generation from untrusted-shape JSON:** `build.ts`'s `{ ...config, ... }` pattern silently forwards any key present in `boardsmith.json` into the publish artifact. Once CLIX-02's unknown-key rejection ships, this becomes safer, but CLIX-01 specifically must NOT rely on "the key won't be there" — explicitly compute and overwrite `playerCount` in the manifest object literal (as shown above) so it can never come from the raw config even if validation is bypassed or a stale key lingers.
- **Fixing the comment instead of the code (CLIX-03):** The audit's own suggestion text is deliberately open ("if 200MB is now the real limit, update the comment") — research confirms code is wrong. Do not "fix" by rewriting the comment to say 200MB; the external worker at `~/ShufflewickPubGames/src/upload.ts:4` is unambiguous: `MAX_BUNDLE_SIZE = 50 * 1024 * 1024`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Numeric flag validation | Custom regex/parseFloat dance | `Number.isInteger(Number(str))` pattern already in `simulate.ts:145-153` | Proven pattern in the same codebase, zero new code style to invent |
| Reading compiled gameDefinition in a CLI command | A fresh esbuild+dynamic-import bespoke to `build.ts` | `loadGameDefinition()` from `src/cli/commands/game-runtime.ts` (already exported, already used by `simulate.ts`) | Exact same need (Node-side read of the compiled `gameDefinition` without the full dev-host bundle); avoids a second bespoke bundler invocation with its own trust-model comment to maintain |
| Did-you-mean suggestions | An npm package (`leven`, `fastest-levenshtein`, etc.) | Hand-rolled Levenshtein (small, no deps, CLAUDE.md forbids adding deps without discussion) | Problem is genuinely small (a handful of known keys); a dependency is disproportionate |

**Key insight:** The codebase already contains the exact validation idiom this phase needs (`simulate.ts`'s `Number.isInteger` guard) and the exact data-loading idiom (`loadGameDefinition`) — this phase is applying existing house patterns to `dev.ts`/`build.ts`, not inventing new ones.

## Common Pitfalls

### Pitfall 1: Deleting `playerCount` from the scaffold without touching `build.ts`'s manifest spread
**What goes wrong:** CLIX-01 looks "done" (scaffold no longer writes it, dev.ts's chain simplified) but `build.ts:108`'s `{ ...config, ... }` still forwards whatever is in a hand-edited or pre-existing `boardsmith.json`, and nothing populates a *correct* `playerCount` in the manifest going forward — the manifest field either vanishes (breaking the platform lobby contract if it still expects the key) or carries stale/absent data.
**Why it happens:** The manifest-generation site (`build.ts`) is a different file from the three places the audit named (dev.ts, project-scaffold.ts, validate.ts) and is easy to miss.
**How to avoid:** Explicitly plan a `build.ts` task that calls `loadGameDefinition` and writes a derived `playerCount: { min, max }` (or renamed field — confirm with the manifest consumer contract, see Open Questions) into the manifest object literal.
**Warning signs:** Any test asserting `manifest.json` shape that still expects `playerCount` to come from `config` verbatim.

### Pitfall 2: Confusing `GameOptions.playerCount` (constructor option, a number) with `boardsmith.json`'s `playerCount` (a `{min,max}` object)
**What goes wrong:** A grep for `playerCount` across the repo returns dozens of unrelated hits — `docs/ai-system.md`, `docs/agent-control.md`, `docs/teaching-and-tutorials.md`, `docs/core-concepts.md:508`, and `src/ui/components/GameShell.vue` all use `playerCount` as the **engine's per-instance player count** (a plain `number` passed to `new Game({ playerCount: 2 })`), which is completely unrelated to this phase's `boardsmith.json` `{min,max}` field.
**Why it happens:** Same identifier, different meaning, different layer.
**How to avoid:** Only `docs/getting-started.md:115` (the "Game Configuration" JSON example) and the example games' `boardsmith.json` files (Phase 138's job) are in scope for the doc/data fix. Do not touch `GameOptions.playerCount` call sites.
**Warning signs:** A task diff touching `docs/core-concepts.md:508`, `docs/ai-system.md`, or `GameShell.vue`'s `playerCount` prop — those are out of scope.

### Pitfall 3: `--ai` validated against pre-clamp `playerCount`, but `minPlayers`/`maxPlayers` aren't known until later in `dev.ts`
**What goes wrong:** The AI-seat validation (`dev.ts:301-307`) runs immediately after parsing CLI args, before `boardsmith.json` is even read (`configPath` check is at line 310) and long before `gameDefinition`'s `minPlayers`/`maxPlayers` are resolved (line ~359, inside the `try` block that loads the game runtime). Moving the "validate `--ai` against effective post-clamp count" logic naively will hit ordering problems — the effective count (`Math.min(Math.max(playerCount, minPlayers), maxPlayers)`, line 393) isn't computable until after the game runtime loads.
**Why it happens:** `dev.ts` interleaves flag parsing, file-existence checks, and async game-runtime loading in a single top-to-bottom function; validation steps were added incrementally at whatever point in the function felt natural, not architected as "validate everything, then act."
**How to avoid:** Plan CLIX-06's `--ai` fix as "move the `--ai` bounds check to after `effectivePlayerCount` is computed (after line 393)," not "change the comparison operand in place at line 301." The early `--players`/`--port` NaN-and-basic-range checks (CLIX-06's other half) CAN stay early since they don't depend on `gameDefinition`.
**Warning signs:** A diff that only changes `playerCount` → `effectivePlayerCount` at line 302 without moving the whole `invalidAiPlayers` block later in the function — this compiles but `effectivePlayerCount` doesn't exist yet at that point in the function, so it would actually be a build error, catching the mistake at least.

## Code Examples

### Existing fail-fast numeric pattern to imitate (CLIX-06)
```typescript
// Source: src/cli/commands/simulate.ts:145-153 (verified current)
const gamesCount = Number(options.games);
const playersCount = Number(options.players);
if (!Number.isInteger(playersCount) || playersCount < 1) {
  console.error(chalk.red(`Error: --players must be a positive integer, got "${options.players}"`));
  process.exit(1);
}
```

### Existing Node-side gameDefinition loader to reuse (CLIX-01)
```typescript
// Source: src/cli/commands/game-runtime.ts:109-137 (verified current, already exported & used by simulate.ts:167)
export async function loadGameDefinition(
  rulesPath: string,
  tempDir: string,
  context: 'monorepo' | 'standalone',
): Promise<{ gameDefinition: GameDefinition }> { /* ...esbuild-bundles rules/index.ts and dynamic-imports it... */ }
```

### Current (wrong) manifest generation to replace (CLIX-01)
```typescript
// Source: src/cli/commands/build.ts:107-115 (verified current)
const manifest = {
  ...config,                              // raw spread of boardsmith.json — carries stale/removed keys forward
  buildTime: new Date().toISOString(),
  version: config.version || '1.0.0',
  engineProtocol: BUNDLE_PROTOCOL_VERSION,
};
```

### Current (wrong) bundle-size constant to fix (CLIX-03)
```typescript
// Source: src/cli/commands/validate.ts:222-226 (verified current)
// Limits match server-side enforcement:
//   rules.js: 1MB (executor MAX_BUNDLE_SIZE)
//   total bundle zip: 50MB (games worker MAX_BUNDLE_SIZE)      <- comment is RIGHT
const maxRulesJs = 1 * 1024 * 1024; // 1MB - executor limit
const maxTotalBundle = 200 * 1024 * 1024; // 200MB - upload limit   <- constant is WRONG, must be 50MB
```
```typescript
// Source: ~/ShufflewickPubGames/src/upload.ts:4 (external repo, verified current — the actual enforcement)
const MAX_BUNDLE_SIZE = 50 * 1024 * 1024; // 50MB
```

### Current dev.ts precedence chain to collapse (CLIX-01)
```typescript
// Source: src/cli/commands/dev.ts:358-360 (verified current — three-way fallback to remove)
minPlayers = gameDefinition.minPlayers ?? config.playerCount?.min ?? config.minPlayers ?? 2;
maxPlayers = gameDefinition.maxPlayers ?? config.playerCount?.max ?? config.maxPlayers ?? 4;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `boardsmith.json.playerCount` + `gameDefinition.{min,max}Players` dual-write | `gameDefinition` only; `boardsmith.json` has no `playerCount` key | This phase | Scaffold's `generateBoardsmithJson`/`generateRulesIndexTs` both change; `ProjectConfig.playerCount` (project-scaffold.ts:21) stays as the scaffold's *internal* config type (used to seed `gameDefinition`'s hardcoded values and the App.vue `:player-count` template attrs at lines 292/329) — it's the JSON *output* field that's removed, not the scaffold's internal generation parameter |
| `boardsmith dev` binds `0.0.0.0` by default, help text implies localhost-by-default | Same 0.0.0.0 default (CONTEXT.md keeps LAN-by-default as a product decision) — help text corrected + loud startup banner already exists at dev.ts:594-599 for network URLs (verified: `Network (others can join): ...` is printed today) | This phase | CLIX-04's fix is narrower than the audit's original "high severity" framing suggested — verdict downgraded the finding to low severity because the disclosure banner already exists; the real gap is only the misleading `--host` help string at cli.ts:35 and no banner for the *host default itself* (as opposed to the resolved network URLs) |
| `-t/--template` accepted, silently ignored | Removed from `cli.ts` + `InitOptions` | This phase | `initCommand`'s `options.template` (init.ts:16) is provably dead — confirmed no read site anywhere in `initCommand` |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The manifest's `playerCount` field name/shape (`{min,max}`) is still the contract the (external, unowned-by-this-repo) publish platform expects — i.e., renaming/removing it outright (rather than deriving it) would break platform lobby display | Pattern 1 / Pitfall 1 | If the platform's manifest consumer expects a *different* shape or the field entirely elsewhere, the derived value could still be wrong-shaped; no access to the platform's manifest-consumer code was available in this research session (only the games-worker's `upload.ts` size-limit code was checked) — flag for confirmation before finalizing the manifest task |
| A2 | No project in `~/BoardSmithGames/` or in this repo relies on `-t/--template` accepting a non-default value today | Pattern/CLIX-05 | Low risk — confirmed via source read that `initCommand` never branches on `options.template`, so no invocation could have produced different output regardless of the flag value; safe to remove |

**If this table is empty:** N/A — see above, only A1 carries meaningful risk (external, unverifiable in this session).

## Open Questions

1. **What is the exact manifest field the publish platform (`~/ShufflewickPub` or its Convex backend) reads for player-count display?**
   - What we know: `build.ts` currently spreads the full `boardsmith.json` config (including a `playerCount: {min,max}` object) into `manifest.json`. `~/ShufflewickPubGames/src/upload.ts` handles bundle-size enforcement but was not searched for manifest-field consumption in this session (out of `src/cli` grep scope; the platform's lobby-rendering code lives in a separate repo not enumerated here).
   - What's unclear: Whether the platform code has its own fallback/derivation if `playerCount` is absent from the manifest, or whether it will show "undefined players" until re-deployed against a manifest that always carries the derived field.
   - Recommendation: The planner should not need cross-repo platform changes for Phase 135 to be complete and testable (this phase's tests are internal to BoardSmith), but should note in the plan that the manifest's `playerCount` field is being changed from "copied" to "derived" with the same key name and shape — a safe, low-risk change that preserves the on-the-wire contract even without confirming the platform's consumer code.

2. **Should the JSON schema `$schema` URL be fixed to a resolving path, or dropped?**
   - What we know: CONTEXT.md's decisions say "Ship the JSON schema in the package and point `$schema` at a path/URL that resolves (or drop the dead `$schema` URL)" — both options are explicitly sanctioned, left to discretion.
   - What's unclear: Whether shipping an actual schema file (e.g. `dist/schemas/boardsmith.schema.json`) that a scaffolded project's `$schema` field references via a relative path is worth the packaging complexity, versus simply dropping `$schema` entirely and relying on `boardsmith validate`'s runtime unknown-key check (CLIX-02) as the sole enforcement mechanism.
   - Recommendation: Given "no new dependencies" and the hand-rolled validator being the confirmed approach (per CONTEXT.md discretion), dropping `$schema` (or pointing it at a real local file path shipped with the package, e.g. via a `schema.json` in the npm package that editors can resolve through VS Code's schema-store settings) is lower-effort than authoring and maintaining a full JSON Schema document in parallel with the hand-rolled validator — the planner should pick one during task breakdown; both satisfy the requirement.

## Environment Availability

Skipped — this phase has no external tool/service dependencies (no databases, no browsers-in-CI, no Docker). All work is Node/TypeScript source changes plus existing vitest tests. `~/ShufflewickPubGames` was read-only referenced for the bundle-size constant (already confirmed present on disk in this session — no missing-dependency risk).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (per `package.json` `"test": "vitest run"`) |
| Config file | `vitest.config.ts` (repo root) |
| Quick run command | `npx vitest run src/cli --reporter=dot` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLIX-01 | `boardsmith.json` `playerCount` key removed from scaffold output; `build.ts` manifest derives `playerCount` from `gameDefinition`; `validate` errors on leftover `playerCount` key | unit | `npx vitest run src/cli/lib/project-scaffold.test.ts` (extend) + new `src/cli/commands/build.test.ts` + `src/cli/commands/validate.test.ts` (new file — none exists today) | ❌ Wave 0 (no `build.test.ts` or `validate.test.ts` exist yet) |
| CLIX-02 | `validate` rejects unknown top-level keys with did-you-mean; `dev` startup warns on same | unit | `npx vitest run src/cli/commands/validate.test.ts` | ❌ Wave 0 |
| CLIX-03 | Bundle-size constant matches 50MB server limit | unit | `npx vitest run src/cli/commands/validate.test.ts` | ❌ Wave 0 (folds into same new file as CLIX-02) |
| CLIX-04 | `--host` help text matches actual default; loud host-default banner (not just network-URL banner) | unit (assert help string + assert console output on default invocation, no real socket bind — use a stub/mock for `createViteServer`) | `npx vitest run src/cli/commands/dev.test.ts` (new) or extend `dev-host.integration.test.ts` | ❌ Wave 0 (no `dev.test.ts` exists; only `dev-host.integration.test.ts` and `multiplayer-host.test.ts` under `src/cli/dev-host/`) |
| CLIX-05 | `-t/--template` removed from `cli.ts` and `InitOptions` | unit | `npx vitest run src/cli/commands/init.test.ts` (extend existing file) | ✅ (extend existing) |
| CLIX-06 | Non-numeric `--players`/`--port`/`--ai` error immediately; out-of-range `--players` errors (no clamp); `--ai` validated against effective post-clamp count | unit | `npx vitest run src/cli/commands/dev.test.ts` (new — mirror `simulate.test.ts`'s arg-validation test style) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli --reporter=dot`
- **Per wave merge:** `npm test` (full suite; baseline per CONTEXT.md is 169 files / 2230 tests green after Phase 134)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/cli/commands/dev.test.ts` — does not exist; needed for CLIX-04 and CLIX-06 (arg-parsing/host-default assertions without opening real sockets — extract the pure-function pieces of `devCommand` that don't require Vite/WS if possible, or mock `createViteServer`/`WebSocketServer`; see Pitfall 3 for why `--ai` validation must be tested post-move)
- [ ] `src/cli/commands/validate.test.ts` — does not exist; needed for CLIX-02 (unknown-key rejection + did-you-mean) and CLIX-03 (bundle-size constant assertion, e.g. `expect(maxTotalBundle).toBe(50 * 1024 * 1024)` exposed via an exported constant rather than a private local — the constant should move to an importable module per the "Recommended Project Structure" above so both `validate.ts` and its test — and potentially a future server-side consumer — can reference one source)
- [ ] `src/cli/commands/build.test.ts` — does not exist; needed for CLIX-01's manifest-derivation behavior (currently `build.ts` has zero test coverage in the repo — confirmed via file listing of `src/cli/commands/*.test.ts`, which shows `init.test.ts` and `simulate.test.ts` only)
- [ ] Framework install: none — Vitest already configured and used throughout `src/cli/`

## Security Domain

Not applicable in the ASVS sense — this phase touches no authentication, session, or cryptography surface. The one security-flavored finding (CLIX-04, LAN exposure) was verdict-downgraded to low severity by the audit itself because the dev host already prints a loud "Network (others can join)" banner (dev.ts:594-599, verified present); this phase's job is a help-text/default-disclosure correction, not a security control.

| Known Threat Pattern | STRIDE | Standard Mitigation (already present or added this phase) |
|-----------------------|--------|--------------------------------------------------------------|
| Dev server bound to 0.0.0.0 exposing project source via Vite `/@fs/` and an unauthenticated WS join endpoint to anyone on the LAN | Information Disclosure / Elevation of Privilege (unauthenticated multiplayer join) | Already mitigated by design (LAN play is the intended dev-host feature per CLAUDE.md) + existing network-URL banner; this phase adds an explicit "you are bound to all interfaces" banner and corrects the `--host` help text so the behavior is discoverable, not hidden |

## Sources

### Primary (HIGH confidence — direct source reads, this session)
- `src/cli/commands/dev.ts` (630 lines, read in full via targeted ranges) — minPlayers chain (358-360), host default (283), --players/--ai parsing (280-307), effectivePlayerCount clamp (393), network banner (594-599)
- `src/cli/commands/validate.ts` (379 lines, read in full) — validateMetadata (86-143), validateBundleSize (221-262)
- `src/cli/commands/init.ts` (317 lines, read in full) — InitOptions.template dead field (15-17), no read site confirmed by full-file read
- `src/cli/cli.ts` (129 lines, read in full) — `-t/--template` registration (27), `--host` help text (35)
- `src/cli/lib/project-scaffold.ts` (targeted reads: 1-260) — generateBoardsmithJson (102-117), generateRulesIndexTs (232-249), $schema (105)
- `src/cli/commands/build.ts` (read in full) — manifest spread (107-121), no gameDefinition load present
- `src/cli/commands/game-runtime.ts` (read in full) — `loadGameDefinition` (109-137), reusable helper
- `src/cli/commands/simulate.ts` (grep + targeted read) — fail-fast numeric pattern (145-153)
- `src/cli/dev-host/multiplayer-host.ts` (grep) — NaN-seat loop confirmed at line 147/486/505
- `~/ShufflewickPubGames/src/upload.ts` (grep, external sibling repo) — `MAX_BUNDLE_SIZE = 50 * 1024 * 1024` confirmed at line 4
- `docs/getting-started.md` (targeted read) — playerCount JSON example (115), no `--template` mentions found
- `docs/core-concepts.md` (grep) — "single source of truth" claim about boardsmith.json (355)
- `~/BoardSmithGames/{checkers,hex,go-fish,cribbage}/boardsmith.json` — confirmed all four carry a `playerCount` key (Phase 138 migration scope, noted for cross-reference)
- `.planning/phases/135-cli-dev-experience/135-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/tmp/v4.5-audit-findings.json` (indices 8, 20, 21, 31, 32, 33)

### Secondary (MEDIUM confidence)
- None — no WebSearch/Context7 lookups were needed for this phase; it is a pure internal-code research task with no external library/framework surface.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; existing commander/vitest usage confirmed by direct read
- Architecture: HIGH — every trace point (dev.ts, validate.ts, init.ts, cli.ts, project-scaffold.ts, build.ts, game-runtime.ts, multiplayer-host.ts) read directly this session; line numbers re-verified against current HEAD
- Pitfalls: HIGH — Pitfall 1 (build.ts manifest spread) and Pitfall 3 (--ai validation ordering) are newly-surfaced by this research (not called out explicitly in the audit findings or CONTEXT.md) and are load-bearing for correct task sequencing

**Research date:** 2026-07-03
**Valid until:** 30 days (stable internal codebase; only external-repo dependency is `~/ShufflewickPubGames`'s `MAX_BUNDLE_SIZE`, which could change independently — re-verify that single constant if this research is consumed after a gap)
