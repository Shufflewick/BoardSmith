# Phase 125: Headless Simulation - Research

**Researched:** 2026-07-02
**Domain:** BoardSmith `src/session/` public API surface + `src/cli/` command (Node/TS monorepo tooling)
**Confidence:** HIGH

## Summary

Both requirements for this phase are promotions/wiring of code that already exists and is already proven — this is not new-algorithm work. SIM-01 is a **file move**: `createHeadlessSession` (`src/session/testing/headless-harness.ts`) has zero dependencies on `src/testing/` or `src/ai/` — it only imports `SnapshotSessionHost` and `executeOp`/`GameDefinitionLike`/`Op` from sibling files already inside `src/session/`. It can move to `src/session/` proper with no circular-dependency risk, and its only consumers today are 4 test files, all trivially import-path-updated. SIM-02 is a **CLI command wrapper** around `simulateRandomGames` (`src/testing/random-simulation.ts`), which already has exactly the seeded, replayable, stuck/crashed/completed reporting model the CLI needs to mirror — it takes a raw `GameClass` constructor (not a `GameDefinitionLike`), has no vitest coupling, and derives per-game seeds deterministically (`${baseSeed}-${playerCount}-${i}`).

The one real design decision is **how the CLI loads the game's rules module from TS source**. `boardsmith dev` (`src/cli/commands/dev.ts`) already solves this exact problem with `loadGameRuntime()`: it esbuild-bundles a synthetic entry point re-exporting `gameDefinition` from the project's `src/rules/index.ts` (path resolved via `boardsmith.json` `paths.rules`) plus `executeOp` from `boardsmith/session`, into a single ESM bundle, then dynamically imports it. This is the reuse target for `simulate` — it guarantees rules and engine share one module graph (important for `instanceof` checks) and needs no separate build step from the developer. `evolve-ai-weights.ts` uses a different, staler pattern (look for pre-built `dist/rules/rules.js` or a pnpm workspace `dist`) that requires the developer to build first — **do not copy that pattern**; `dev.ts`'s live-bundle approach is the one that matches "quick iterate + simulate" ergonomics and is consistent with the CONTEXT's CLI-conventions expectation.

**Primary recommendation:** Move `createHeadlessSession` into `src/session/index.ts` (its own file inside `src/session/`, e.g. `src/session/headless-session.ts`) with a clean-break export, update the 4 existing test call sites, add unit tests for the public path. Build `boardsmith simulate` as a new `src/cli/commands/simulate.ts` that (a) resolves+bundles the rules module using the same esbuild pattern as `loadGameRuntime` in `dev.ts` (extract/duplicate the minimal subset needed, since it's currently private to `dev.ts`), (b) calls `simulateRandomGames(gameDefinition.gameClass, { count, playerCounts: [players], seed })`, and (c) renders human-readable table output by default / `--json` per-game array matching the CONTEXT-specified shape.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Public headless session API (SIM-01) | API/Backend (engine/session library surface) | — | `createHeadlessSession` drives the same `SnapshotSessionHost`/`executeOp` boundary that powers production sessions; it is a library export, not UI or CDN concern |
| `boardsmith simulate` CLI (SIM-02) | CLI/Dev-tooling (Node process, not a runtime tier) | Database/Storage: none (no persistence) | CLI commands are a distinct "tier" from the 5-tier web model — they run in the developer's Node process, import the rules module directly, and never touch a browser/server boundary |
| Rules-module loading for CLI | CLI/Dev-tooling (esbuild + dynamic import, in-process) | — | Mirrors `dev.ts`'s `loadGameRuntime`; no network/CDN involved, purely local module resolution |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| esbuild | (already a devDependency, used by `dev.ts`/`build.ts`) | Bundle a synthetic entry re-exporting `gameDefinition` + `executeOp` into one ESM module graph | Already the project's chosen bundler for CLI-side rules loading (`dev.ts` `loadGameRuntime`, `build.ts`) [VERIFIED: src/cli/commands/dev.ts:208-216] |
| commander | ^12.0.0 | CLI command/flag registration | Already used for every existing command in `src/cli/cli.ts` [VERIFIED: package.json:80, src/cli/cli.ts] |
| chalk | ^5.3.0 | Colored terminal output | Used by every existing command (`validate.ts`, `analyze.ts`, `dev.ts`) [VERIFIED: src/cli/commands/validate.ts:4] |
| ora | ^8.0.0 | Spinner for long-running CLI operations | Used in `validate.ts`/`evolve-ai-weights.ts` for multi-step operations; `simulate` running N games is a similar long-running case | 

No new npm packages are required for this phase — everything reuses already-installed dependencies and in-repo modules.

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `simulateRandomGames`/`replayRandomGame` | in-repo (`src/testing/random-simulation.ts`) | Core seeded simulation loop with completed/crashed/timedOut/exceededMaxActions/stuck classification | Reuse directly for `boardsmith simulate` — do not reimplement |
| `SeededRandom` | in-repo (`src/utils/random.ts`) | Deterministic RNG used inside `simulateSingleGame` | Already wired into `random-simulation.ts`; no direct CLI usage needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `simulateRandomGames` (random moves) | `createHeadlessSession` + manual AI-seat driving | CONTEXT explicitly scopes SIM-02 to pass/stuck/error reporting, not AI benchmarking — `simulateRandomGames` is the correct, smaller-surface fit; AI-seat simulation would need a new loop (out of scope) |
| esbuild live-bundle (`dev.ts` pattern) | pre-built `dist/rules/rules.js` lookup (`evolve-ai-weights.ts` pattern) | The dist-lookup pattern requires the developer to run a build first and silently uses stale code if they forget; the live-bundle pattern always reflects current source, matching `boardsmith dev`'s ergonomics and the "quick audit" use case for `simulate` |

**Installation:**
```bash
# No new dependencies — reuses esbuild, commander, chalk, ora already in package.json
```

**Version verification:** No new packages recommended for this phase; skipping the install-verification step accordingly.

## Package Legitimacy Audit

Not applicable — this phase introduces zero new external packages. All functionality reuses `esbuild`, `commander`, `chalk`, `ora` (already installed) and in-repo modules (`simulateRandomGames`, `SnapshotSessionHost`, `executeOp`).

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Developer terminal
   │
   │  `import { createHeadlessSession } from 'boardsmith/session'`  (SIM-01, library consumer)
   ▼
createHeadlessSession(def, gameOptions, aiSeats)
   │
   ├─▶ new SnapshotSessionHost({ playerCount, aiSeats, executeOp, broadcast })
   │        │
   │        └─▶ executeOp(def, gameOptions, snapshot, pendingState, op)   [stateless-ops.ts, same in-process engine]
   │
   └─▶ { host, broadcasts, start(), send(seat, op) }   ← caller drives ops directly, in-process, no network


Developer terminal
   │
   │  `boardsmith simulate --games N --seed S --players P [--json]`  (SIM-02, CLI entry point)
   ▼
src/cli/commands/simulate.ts
   │
   ├─▶ read boardsmith.json → resolve paths.rules (same convention as dev.ts/validate.ts)
   │
   ├─▶ esbuild-bundle a synthetic entry re-exporting `gameDefinition` from <rulesPath>/index.ts
   │        (mirrors dev.ts loadGameRuntime — one module graph, no separate build step required)
   │
   ├─▶ dynamic import() the bundle → gameDefinition.gameClass
   │
   ├─▶ simulateRandomGames(gameDefinition.gameClass, { count, playerCounts: [players], seed })
   │        │
   │        └─▶ per game: createTestGame → drive engine's own getSelectionChoices → doAction loop
   │                       → classify completed | crashed | timedOut | exceededMaxActions | stuck
   │
   └─▶ format output: human table (default) OR --json array of {index, seed, status, turns, winner, error?}
             exit code 0 if all completed, non-zero if any stuck/crashed
```

### Recommended Project Structure
```
src/
├── session/
│   ├── index.ts              # add: export { createHeadlessSession } from './headless-session.js'
│   ├── headless-session.ts   # NEW — moved+renamed from session/testing/headless-harness.ts
│   └── headless-session.test.ts  # NEW — public-path unit tests (seed determinism, AI seats, action ops)
├── testing/
│   └── random-simulation.ts  # unchanged — reused by CLI, not moved
├── cli/
│   ├── cli.ts                 # add: `simulate` command registration
│   └── commands/
│       └── simulate.ts        # NEW — CLI command; reuses dev.ts's rules-loading pattern
```

Old path `src/session/testing/headless-harness.ts` and its directory should be fully removed once the 4 test files are migrated — no re-export shim (clean break, per CONTEXT and CLAUDE.md "No Backward Compatibility").

### Pattern 1: In-process rules-module loading for a CLI command
**What:** Bundle a synthetic ESM entry point with esbuild that re-exports the project's `gameDefinition` (from `paths.rules` in `boardsmith.json`) into a temp file, then `import()` it dynamically. This guarantees the rules module and any BoardSmith engine code it references share exactly one module graph (needed for `instanceof` checks against engine base classes).
**When to use:** Any CLI command that needs to execute a game's actual rules class (not just parse source text, as `analyze.ts` does).
**Example:**
```typescript
// Source: src/cli/commands/dev.ts:192-229 (loadGameRuntime) — existing, proven pattern to mirror
const entryPath = join(tempDir, 'runtime-entry.ts');
writeFileSync(
  entryPath,
  [`export { gameDefinition } from ${JSON.stringify(rulesIndexPath)};`].join('\n'),
);
await build({
  entryPoints: [entryPath],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
});
const module = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);
const GameClass = module.gameDefinition.gameClass;
```
Note: `dev.ts`'s version also re-exports `executeOp` from `boardsmith/session` in the same bundle because the Node multiplayer host needs both to share an engine instance. `simulate` only needs `gameDefinition.gameClass` for `simulateRandomGames`, so the synthetic entry can be a single-line re-export of `gameDefinition` alone — simpler than the dev-host version.

### Pattern 2: Seeded, replayable batch simulation with structured failure classification
**What:** `simulateRandomGames` drives each game via the engine's own `getSelectionChoices` introspection (never guesses at valid moves), classifies outcome as `completed`/`crashed`/`timedOut`/`exceededMaxActions`/`stuck`, and derives a per-game seed (`${baseSeed}-${playerCount}-${i}`) that `replayRandomGame` can reproduce exactly.
**When to use:** Directly reuse for `boardsmith simulate` — do not build a new loop.
**Example:**
```typescript
// Source: src/testing/random-simulation.ts:512-587 (existing, in-repo)
const results = await simulateRandomGames(GameClass, {
  count: options.games,      // --games N
  playerCounts: [options.players], // --players N (single count, not a range)
  seed: options.seed,        // --seed S (omit to auto-generate; results.seed reports the base used)
});
// results.games: SingleGameResult[] — completed/crashed/timedOut/exceededMaxActions/stuck/error/seed/winners
```

### Anti-Patterns to Avoid
- **Re-exporting `createHeadlessSession` from the old `session/testing/` path "just in case":** CONTEXT and CLAUDE.md both mandate a clean break — no deprecation shims. Update all 4 call sites in the same change.
- **Reimplementing a random-move driver inside `simulate.ts`:** `simulateRandomGames` already solves this with engine-introspection-driven move generation (not naive random action-name picking) — a hand-rolled loop would regress correctness (e.g. missing the `MAX_CONSECUTIVE_FAILURES` stuck-detection or the `buildRandomArgs` selection-type handling).
- **Using `evolve-ai-weights.ts`'s dist-lookup pattern for `simulate`:** that pattern silently loads stale pre-built code if the developer forgot to rebuild. `simulate` is meant for quick auditing during development — it must always reflect current source, matching `dev.ts`'s live-bundle approach.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Random-but-valid move generation across selection types (text/number/choice/element/elements, multiSelect, optional) | A new move-picker in `simulate.ts` | `simulateRandomGames`'s internal `buildRandomArgs`/`buildRandomMoves` (already correct, tested) | Correctly handles every `Selection` subtype and multiSelect min/max resolution; re-deriving this is exactly the kind of "hand-rolled ~400 lines" risk this project explicitly flags elsewhere (checkers move-validation, HELP-03) |
| Deterministic per-game seed derivation for a batch | A new seed-scheme in the CLI | `simulateRandomGames`'s `${baseSeed}-${playerCount}-${i}` scheme, surfaced on `SimulationResults.seed` and each `SingleGameResult.seed` | Already replayable via `replayRandomGame`; inventing a second scheme in the CLI would fragment "how do I reproduce game 7" across two code paths |
| Rules-module dynamic loading from TS source | A new bundling/import mechanism | Mirror `dev.ts`'s `loadGameRuntime` esbuild pattern | Already solves module-graph-sharing correctly; a second, different loader risks subtly different `instanceof` behavior against engine base classes |

**Key insight:** Every piece of "hard" logic this phase needs (move generation, seed derivation, module loading) already exists and is proven elsewhere in the codebase. The actual net-new code for this phase is thin: a file move + export (SIM-01) and a CLI wrapper/formatter (SIM-02).

## Common Pitfalls

### Pitfall 1: Moving `headless-harness.ts` without updating all 4 call sites in the same commit
**What goes wrong:** Leaving stale imports at `../session/testing/headless-harness.js` breaks `src/runtime/runner.test.ts`, `src/session/testing/undo-authoritative.test.ts`, `src/session/testing/parity-contract.test.ts`, and `src/session/testing/eachplayer-clone.test.ts` [VERIFIED: grep across src/, all 4 sites confirmed test files].
**Why it happens:** The harness currently lives inside `session/testing/`, a directory whose other files (fixtures, sequence-advance.test.ts, stateful-*-authoritative.test.ts) stay put — only `headless-harness.ts` itself moves out.
**How to avoid:** Grep for `headless-harness` before considering the move complete; update every import to the new path (`../headless-session.js` or `./headless-session.js` depending on relative location) and to the new function location if renamed.
**Warning signs:** `npm run test` failures citing "Cannot find module" for the old path.

### Pitfall 2: Treating `simulateRandomGames`'s `GameClass` parameter as a `GameDefinitionLike`
**What goes wrong:** `simulateRandomGames<G extends Game>(GameClass: new (options: GameOptions) => G, options)` takes the bare constructor [VERIFIED: src/testing/random-simulation.ts:512-514], whereas `createHeadlessSession` and most session-layer functions take a `GameDefinitionLike` (`{ gameClass, gameType, minPlayers, maxPlayers, ... }`) [VERIFIED: src/session/types.ts:158-163]. If `simulate.ts` naively passes the whole `gameDefinition` object where a `GameClass` constructor is expected, TypeScript will catch it, but only if strict typing is enforced — passing `gameDefinition.gameClass` (not `gameDefinition`) is required.
**Why it happens:** Two different "reuse the existing simulation machinery" paths in CONTEXT (`simulateRandomGames` and/or headless harness) have genuinely different signatures.
**How to avoid:** When wiring `simulate.ts`, extract `gameDefinition.gameClass` and pass that constructor, not the definition object.
**Warning signs:** TS error "Argument of type 'GameDefinition' is not assignable to parameter of type 'new (options: GameOptions) => G'".

### Pitfall 3: Assuming `--players N` maps directly to `playerCounts: number[]`
**What goes wrong:** `SimulateRandomGamesOptions.playerCounts` is an array (the function was designed to sweep multiple player counts in one run) but CONTEXT's `--players N` flag is a single number. Passing `[N]` is correct and simple — but if a future iteration tries to support a range (`--players 2-4`), it must be parsed into an array before hitting `simulateRandomGames`, and the per-game seed derivation (`${baseSeed}-${playerCount}-${i}`) already accounts for multiple player counts, so no changes are needed there.
**Why it happens:** The existing API's design intent (test completeness across player counts) is broader than the CLI's stated flag (fixed player count for reproducibility-focused audits).
**How to avoid:** Wrap `--players N` as `playerCounts: [N]` in `simulate.ts`; don't expose a range syntax unless explicitly requested (CONTEXT doesn't ask for it).
**Warning signs:** none — this is a design note, not a live bug, as long as the CLI only exposes a single `--players N` value per CONTEXT.

### Pitfall 4: Bundling the rules module for `simulate` the same way `dev.ts` bundles for the dev server (including `executeOp`)
**What goes wrong:** `dev.ts`'s `loadGameRuntime` re-exports both `gameDefinition` AND `executeOp` from `boardsmith/session` because the dev host's `MultiplayerHost` needs the same engine instance both provide. `simulate` doesn't call `executeOp` directly — `simulateRandomGames` internally uses `createTestGame`, not the stateless-ops executor. Re-exporting `executeOp` unnecessarily adds bundle surface and a second import that isn't used.
**Why it happens:** Copy-pasting `loadGameRuntime` wholesale without checking what `simulateRandomGames`'s call path actually needs.
**How to avoid:** Simulate's synthetic entry only needs `export { gameDefinition } from '<rulesPath>/index.ts'` — verify this is sufficient before adding `executeOp` back in.
**Warning signs:** none functionally (extra export is harmless) but it's dead code / needless coupling; flag in code review.

### Pitfall 5: `boardsmith simulate` run from a directory without `boardsmith.json`
**What goes wrong:** Every existing CLI command (`validate.ts`, `analyze.ts`, `evolve-ai-weights.ts`, `dev.ts`) checks for `boardsmith.json` at `cwd` first and exits(1) with an actionable message if missing [VERIFIED: src/cli/commands/validate.ts:19-24, analyze.ts:386-390, evolve-ai-weights.ts:20-25]. `simulate.ts` must follow the same convention — this is the established CLI pattern, not optional.
**Why it happens:** Easy to skip when focused on the simulation logic itself.
**How to avoid:** Copy the boilerplate check verbatim (same error message style) at the top of `simulateCommand`.
**Warning signs:** Confusing stack traces instead of "Error: boardsmith.json not found" when run from the wrong directory.

## Code Examples

### Reading `paths.rules` from `boardsmith.json` (existing convention, reuse exactly)
```typescript
// Source: src/cli/commands/dev.ts:389 (also evolve-ai-weights.ts:31 — same convention, different fallback dir name)
const rulesPath = config.paths?.rules ? resolve(cwd, config.paths.rules) : join(cwd, 'src', 'rules');
```

### Deriving CLI exit code from simulation results (pattern to add, no direct precedent in-repo but matches `validate.ts`'s `allPassed` → `process.exit(1)` idiom)
```typescript
// Source: pattern mirrors src/cli/commands/validate.ts:70-83 exit-code convention
const anyFailed = results.games.some(g => g.stuck || g.crashed);
if (anyFailed) {
  // print failing games' seed + replay instructions (CONTEXT specifics)
  process.exit(1);
}
```

### `--json` output precedent already exists in the CLI
```typescript
// Source: src/cli/commands/analyze.ts:80-82 (option definition), 425-428 (branch)
program.command('analyze').option('--json', 'Output results as JSON') /* ... */
if (options.json) {
  console.log(JSON.stringify(analysis, null, 2));
  return;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `Math.random()` fallback in shuffle/RNG paths (would have made simulation non-reproducible) | Deterministic seeded RNG end-to-end, no fallback | Phase 123 (2026-07-01, this same milestone) | This phase (125) is only trustworthy because Phase 123 already closed this gap — `playUntilComplete` and `GameRunner` are deterministic by default now [VERIFIED: STATE.md Decisions log, Phase 123 entries] |

**Deprecated/outdated:** None specific to this phase — `createHeadlessSession`'s internal shape (structuredClone-enforced broadcast/op boundary) is current and unchanged; only its export location moves.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ora` should be used for `simulate`'s progress reporting (spinner while N games run) | Standard Stack / Core | Low — purely cosmetic; if wrong, plain `console.log` progress lines work fine instead |
| A2 | `simulate.ts`'s synthetic esbuild entry needs only `gameDefinition` (not `executeOp`) since `simulateRandomGames` uses `createTestGame` internally, not the stateless-ops executor | Common Pitfalls #4 | Low-Medium — verified by reading `random-simulation.ts`'s imports (uses `createTestGame` from `./test-game.js`, no `executeOp` import); if wrong, adding the extra export back is a one-line fix |

**All other findings in this research are VERIFIED via direct file reads (file:line citations throughout) or CITED from the CONTEXT.md decisions already locked by the user** — no other user confirmation is needed before planning.

## Open Questions (RESOLVED)

1. **Should `createHeadlessSession` be renamed as part of the move?**
   - What we know: CONTEXT says "rename only if trivially aligned with the introspection family" and leaves exact naming to Claude's discretion.
   - What's unclear: whether "the introspection family" implies a specific naming convention (e.g. `getFlowDebugInfo`-style) that `createHeadlessSession` should match, or whether it's fine as-is.
   - RESOLVED (adopted by plans 125-01/125-02) — Recommendation: Keep the name `createHeadlessSession` unchanged — it's already clear, matches its JSDoc, and no existing "introspection family" naming pattern (e.g. `get*`/`describe*`) applies to a session-constructor function. Only the file location changes.

2. **Exact CLI output table format for the human-readable default (non-JSON) path**
   - What we know: CONTEXT specifies the `--json` shape precisely (`{index, seed, status, turns, winner, error?}`) and the failure-message format ("Game 7 stuck (seed ...). Replay: ..."), but not the exact human-table column layout for the default output.
   - What's unclear: whether to use a real table library or simple aligned `console.log` lines (existing commands like `analyze.ts` use manual chalk-formatted sections, not a table library).
   - RESOLVED (adopted by plans 125-01/125-02) — Recommendation: Follow `analyze.ts`'s existing style (chalk-bold section headers, manual column alignment via template literals) rather than introducing a new table-formatting dependency — consistent with "no new deps without discussion" (CLAUDE.md).

## Environment Availability

Skipped — this phase has no external service/runtime dependencies beyond what's already installed in the monorepo (Node, esbuild, commander, chalk, ora — all present in `package.json` and used by sibling CLI commands already).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.0 |
| Config file | `vitest.config.ts` (repo root, existing) |
| Quick run command | `npx vitest run src/session/headless-session.test.ts src/cli/commands/simulate.test.ts` |
| Full suite command | `npm run test` (i.e. `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SIM-01 | `createHeadlessSession` importable from `boardsmith/session`; seed control + AI seats + action-op surface work post-move | unit | `npx vitest run src/session/headless-session.test.ts` | ❌ Wave 0 (new file; existing behavior already covered indirectly by the 4 migrated test files, which should keep passing after the import-path update) |
| SIM-01 | Existing 4 call sites (`runner.test.ts`, `undo-authoritative.test.ts`, `parity-contract.test.ts`, `eachplayer-clone.test.ts`) still pass after import-path update | regression | `npx vitest run src/runtime/runner.test.ts src/session/testing/undo-authoritative.test.ts src/session/testing/parity-contract.test.ts src/session/testing/eachplayer-clone.test.ts` | ✅ (existing files, update imports only) |
| SIM-02 | `boardsmith simulate --games N --seed S` reports pass/stuck/error per game | integration | `npx vitest run src/cli/commands/simulate.test.ts` | ❌ Wave 0 |
| SIM-02 | Running `simulate` twice with the same seed produces identical results (determinism) | integration | same file, dedicated test case comparing two `simulateRandomGames`-backed runs (or two CLI invocations) with identical `--seed` | ❌ Wave 0 |
| SIM-02 | Exit code non-zero when any game is stuck/errored | integration | same file, asserting `process.exitCode`/child-process exit code via a spawned CLI invocation, or refactor `simulateCommand` to return a result the test asserts on directly (avoid spawning a real child process in unit tests where possible) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test files>`
- **Per wave merge:** `npm run test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus a manual `boardsmith simulate --games 5` smoke-test against a real game in `~/BoardSmithGames/` (e.g. go-fish) per CLAUDE.md's "verify in the browser/real app, not just code review" rule — though this is a CLI so verification is a terminal run, not a browser session.

### Wave 0 Gaps
- [ ] `src/session/headless-session.test.ts` — covers SIM-01 (seeded determinism, AI seats, action ops on the public path)
- [ ] `src/cli/commands/simulate.test.ts` — covers SIM-02 (games/seed/players flags, `--json` shape, exit codes, determinism-on-rerun)
- [ ] No new fixtures needed — `src/session/testing/fixtures/` already has a game fixture usable for `headless-session.test.ts` (moving/renaming, not deleting, the `fixtures/` dir since only `headless-harness.ts` itself relocates)

## Security Domain

Not applicable in the ASVS web-application sense — this phase adds no authentication, session management, or network-facing input surface. `boardsmith simulate` is a local dev-only CLI tool operating on the developer's own game source; `createHeadlessSession` is an in-process API with no network boundary (the `structuredClone` calls in the existing harness already enforce the same non-cloneable-data guard production RPC would). No new ASVS categories apply beyond what's already enforced by the existing `structuredClone` boundary checks.

## Sources

### Primary (HIGH confidence — direct file reads with file:line citations)
- `src/session/testing/headless-harness.ts` (full file) — current `createHeadlessSession` implementation
- `src/session/index.ts` (full file) — current public export surface, confirms no existing headless export
- `src/testing/random-simulation.ts` (full file) — `simulateRandomGames`/`replayRandomGame` implementation, report shape, seed derivation
- `src/session/stateless-ops.ts:140-163` — `GameDefinitionLike` shape
- `src/session/types.ts:78-97` — `GameDefinition` shape (session-facing, richer than `GameDefinitionLike`)
- `src/cli/cli.ts` (full file) — command registration conventions, existing flag patterns
- `src/cli/commands/dev.ts:147-229, 342-454` — `boardsmithResolvePlugin`, `loadGameRuntime` (the rules-loading pattern to mirror), `paths.rules` resolution
- `src/cli/commands/validate.ts` (full file) — `boardsmith.json` existence check convention, exit-code pattern, `chalk`/`ora` usage
- `src/cli/commands/analyze.ts` (full file) — `--json` flag precedent, output-formatting style
- `src/cli/commands/evolve-ai-weights.ts` (full file) — alternative (rejected) rules-loading pattern via pre-built dist lookup
- `src/testing/index.ts` (full file) — confirms `simulateRandomGames`/`replayRandomGame` already public via `boardsmith/testing`
- `package.json` — confirmed `esbuild`, `commander@^12.0.0`, `chalk@^5.3.0`, `ora@^8.0.0`, `vitest@^2.1.0` already present; exports map confirms `./session` → `src/session/index.ts`
- Bash greps confirming: (a) only 4 test-file consumers of `createHeadlessSession` exist repo-wide; (b) no `src/session/*.ts` imports `src/testing/`; (c) `random-simulation.ts` has no `vitest` import (safe for CLI use)
- `.planning/phases/125-headless-simulation/125-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md` — phase scope, requirement text, milestone decisions (Phase 123 determinism dependency)

### Secondary (MEDIUM confidence)
None — all findings for this phase were directly verifiable in the local codebase; no external web research was needed since this is entirely internal-API reuse work.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies; every recommended library already installed and used identically elsewhere in the codebase
- Architecture: HIGH - both the file-move (SIM-01) and CLI-reuse (SIM-02) patterns were verified directly against existing, working code (`dev.ts`, `random-simulation.ts`)
- Pitfalls: HIGH - all five pitfalls are grounded in specific file:line evidence (signature mismatches, existing call sites, existing conventions), not speculation

**Research date:** 2026-07-02
**Valid until:** Stable — 30+ days (this is internal-API reuse research tied to code that doesn't change on an external release cadence; revalidate only if Phase 123/124 plans change `random-simulation.ts` or `stateless-ops.ts` signatures before Phase 125 planning begins)
