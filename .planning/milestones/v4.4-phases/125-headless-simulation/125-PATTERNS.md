# Phase 125: Headless Simulation - Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 8 (2 new/moved product files, 1 new test file, 1 new CLI test file, 4 existing test files needing import-path updates)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/session/headless-session.ts` (new — moved from `src/session/testing/headless-harness.ts`) | service (session factory) | request-response (in-process op execution) | `src/session/testing/headless-harness.ts` (itself, unchanged logic, new location) | exact |
| `src/session/index.ts` (modified — add export) | config (barrel export) | — | itself (existing export-block conventions) | exact |
| `src/session/headless-session.test.ts` (new) | test | request-response | `src/session/testing/eachplayer-clone.test.ts` | exact |
| `src/cli/commands/simulate.ts` (new) | controller (CLI command) | batch (N-game loop) | `src/cli/commands/validate.ts` + `src/cli/commands/analyze.ts` + `src/cli/commands/dev.ts` (`loadGameRuntime`) | role-match, composed from 3 analogs |
| `src/cli/commands/simulate.test.ts` (new) | test | batch | `src/cli/commands/validate.ts` (behavior under test) — no direct CLI-command test precedent found; model after unit-testing the exported `simulateCommand` function directly (avoid spawning child process) | partial (no existing CLI-command test file exists to copy structure from) |
| `src/cli/cli.ts` (modified — register `simulate`) | route (commander registration) | — | existing `analyze`/`evolve-ai-weights` registration blocks | exact |
| `src/runtime/runner.test.ts` (modified — import path only) | test | — | itself | exact (mechanical edit) |
| `src/session/testing/{undo-authoritative,parity-contract,eachplayer-clone}.test.ts` (modified — import path only) | test | — | themselves | exact (mechanical edit) |

## Pattern Assignments

### `src/session/headless-session.ts` (service, request-response)

**Analog:** `src/session/testing/headless-harness.ts` (full file, 35 lines — copy verbatim, only the file location changes; do not alter logic)

**Full current content to relocate** (`src/session/testing/headless-harness.ts:1-35`):
```typescript
import { SnapshotSessionHost } from '../snapshot-session-host.js';
import { executeOp, type GameDefinitionLike, type Op } from '../stateless-ops.js';

/** Drives a SnapshotSessionHost with an IN-PROCESS executeOp, forcing every op
 *  payload and every broadcast through structuredClone so non-cloneable data
 *  throws exactly as postMessage would in the production iframe. */
export function createHeadlessSession(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; seed?: string },
  aiSeats: Array<{ seat: number; level?: string }> = [],
) {
  const broadcasts: unknown[] = [];
  const host = new SnapshotSessionHost({
    playerCount: gameOptions.playerCount,
    aiSeats,
    executeOp: (snap, pend, op) => executeOp(def, gameOptions, snap, pend, op),
    broadcast: (views) => {
      broadcasts.push(structuredClone(views));
    },
  });
  return {
    host,
    broadcasts,
    async start() {
      await host.start();
    },
    async send(seat: number, op: Op) {
      structuredClone(op);
      return host.handleOp(seat, op);
    },
  };
}
```

**Import path change:** once moved to `src/session/headless-session.ts`, the relative imports become `./snapshot-session-host.js` and `./stateless-ops.js` (one level shallower than the current `../` from `session/testing/`).

**JSDoc worked example to add** (CONTEXT requires this): model after the module-level `@example` block already at the top of `src/session/index.ts:8-31` (JSDoc `@example` with a fenced `typescript` block showing `GameSession.create` + `performAction`) — write an equivalent example showing `createHeadlessSession(gameDefinition, { playerCount: 2, seed: 'demo' })` → `await session.start()` → `await session.send(1, { type: 'action', ... })`.

---

### `src/session/index.ts` (config, barrel export)

**Analog:** itself — existing export-block conventions (full file read, 146 lines)

**Pattern to follow** (see `src/session/index.ts:112-137` for the "Core Classes" section style — grouped export blocks with a `// ====` banner comment and a one-line rationale comment above re-exports that need one):
```typescript
export {
  GameSession,
  type GameSessionOptions,
  type ActionResult,
  type UndoResult,
  type ElementDiff,
} from './game-session.js';
```

Add a new banner section (mirroring the `// Core Classes` banner at line 108-110) directly after the `GameSession`/`AIController` exports, e.g.:
```typescript
// ============================================
// Headless Simulation
// ============================================

export { createHeadlessSession } from './headless-session.js';
```
No re-export shim at the old `./testing/headless-harness.js` path — CONTEXT mandates a clean break.

---

### `src/session/headless-session.test.ts` (test, request-response)

**Analog:** `src/session/testing/eachplayer-clone.test.ts` (lines 1-30 read; full test file is short)

**Import + setup pattern** (lines 1-13):
```typescript
import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from './headless-harness.js'; // → becomes './headless-session.js'
import { eachPlayerFixtureDefinition } from './fixtures/each-player-fixture.js'; // fixtures/ stays in src/session/testing/, import path becomes './testing/fixtures/...'

const gameOptions = { playerCount: 2, seed: 't' };
```

**Core assertion pattern** (lines 19-30):
```typescript
describe('...', () => {
  it('...', async () => {
    const session = createHeadlessSession(eachPlayerFixtureDefinition, gameOptions);
    await session.start();
    const p1 = await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });
    expect(p1.success).toBe(true);
  });
});
```

New test file should add: seeded-determinism assertion (run same seed twice, assert identical `p1`/`p2` snapshot/flowState), AI-seat assertion (pass `aiSeats: [{ seat: 2, level: 'easy' }]` and assert AI acts without an explicit `send`), and an action-op round-trip assertion (already covered by the pattern above).

---

### `src/cli/commands/simulate.ts` (controller, batch)

**Analog 1 — `boardsmith.json` existence check + exit code convention:** `src/cli/commands/validate.ts:15-24`
```typescript
export async function validateCommand(): Promise<void> {
  const cwd = process.cwd();

  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }
```
Same check appears verbatim (message included) in `analyze.ts:386-390` and `dev.ts:374-378` — this is the established, copy-verbatim convention.

**Analog 2 — rules path resolution:** `src/cli/commands/dev.ts:389`
```typescript
const rulesPath = config.paths?.rules ? resolve(cwd, config.paths.rules) : join(cwd, 'src', 'rules');
```

**Analog 3 — synthetic esbuild entry + dynamic import (rules-only, no `executeOp` needed per Pitfall 4):** adapted from `src/cli/commands/dev.ts:192-229` (`loadGameRuntime`), simplified:
```typescript
const rulesIndexPath = join(rulesPath, 'index.ts');
const entryPath = join(tempDir, 'runtime-entry.ts');
writeFileSync(
  entryPath,
  [`export { gameDefinition } from ${JSON.stringify(toPosix(rulesIndexPath))};`].join('\n'),
);
const bundlePath = join(tempDir, 'runtime-bundle.mjs');
await build({
  entryPoints: [entryPath],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
  plugins: [boardsmithResolvePlugin(context)],
});
const module = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);
if (!module.gameDefinition) {
  throw new Error('Rules module must export a gameDefinition');
}
const GameClass = module.gameDefinition.gameClass;
```
Note: `dev.ts` also re-exports `executeOp` (line 203) — do NOT copy that line; `simulateRandomGames` uses `createTestGame` internally, not `executeOp` (Pitfall 4 in RESEARCH.md).

**Analog 4 — `--json` flag branch:** `src/cli/commands/analyze.ts:425-428`
```typescript
if (options.json) {
  console.log(JSON.stringify(analysis, null, 2));
  return;
}
```
For `simulate`, the JSON payload is the CONTEXT-specified shape: `{ index, seed, status: 'complete'|'stuck'|'error', turns, winner, error? }[]` — map from `SimulationResults.games` (see below), not dump the raw `SimulationResults` object (CONTEXT's shape is per-game, flatter, and status-enum-based rather than four separate booleans).

**Analog 5 — human-readable table / section output:** `src/cli/commands/validate.ts:48-83` (icon + colored PASS/FAIL lines, summary count, exit-code branch at the end) — mirror this structure: print one line per game (index, seed, status icon), then a summary line (`X/N completed, Y stuck, Z crashed`), then on failure print each failing game's seed + replay command before `process.exit(1)`.

**Core simulation call — the actual reuse target:** `src/testing/random-simulation.ts:512-587` (`simulateRandomGames`)
```typescript
const results = await simulateRandomGames(GameClass, {
  count: options.games,             // --games N (default 10)
  playerCounts: [options.players],  // --players N wrapped as single-element array (Pitfall 3)
  seed: options.seed,               // --seed S; omit → auto-generated, reported on results.seed
});
// results: SimulationResults { completed, crashed, timedOut, exceededMaxActions, stuck, total,
//   games: SingleGameResult[], averageActions, averageDuration, errors, seed }
// SingleGameResult: { completed, crashed, timedOut, exceededMaxActions, stuck, error?,
//   actionCount, duration, playerCount, seed, winners? }
```
Map each `SingleGameResult` to the CLI's per-game JSON shape: `status = g.completed ? 'complete' : g.stuck ? 'stuck' : 'error'` (crashed/timedOut/exceededMaxActions all fold into `'error'` for the CLI's simpler 3-state enum — confirm this folding against CONTEXT's exact wording before finalizing, since CONTEXT only lists `complete|stuck|error`).

**Failure/replay message pattern (CONTEXT-specified, no direct code precedent — new pattern to author):**
```typescript
// pattern mirrors validate.ts's exit-code idiom (validate.ts:80-83) + CONTEXT's exact wording
if (anyFailed) {
  for (const g of results.games.filter(g => g.stuck || g.crashed)) {
    console.log(chalk.red(`Game ${g index} ${g.stuck ? 'stuck' : 'errored'} (seed ${g.seed}).`));
    console.log(chalk.dim(`  Replay: boardsmith simulate --games 1 --seed ${g.seed}`));
  }
  process.exit(1);
}
```

**Registration in `src/cli/cli.ts`** — mirror `analyze`'s block (`src/cli/cli.ts:78-82`):
```typescript
program
  .command('analyze')
  .option('--json', 'Output results as JSON')
  .option('-v, --verbose', 'Show detailed information')
  .action(analyzeCommand);
```
New block:
```typescript
program
  .command('simulate')
  .option('--games <count>', 'Number of games to simulate', '10')
  .option('--seed <seed>', 'Base seed (per-game seeds derived and recorded in output)')
  .option('--players <count>', 'Player count for each simulated game', '2')
  .option('--json', 'Output results as JSON')
  .action(simulateCommand);
```

---

### `src/cli/commands/simulate.test.ts` (test, batch)

**No direct CLI-command test file exists in the repo to copy from** (RESEARCH.md confirms: existing CLI commands have no dedicated `*.test.ts` files under `src/cli/commands/`). Two options, in order of preference:
1. Export `simulateCommand` as a pure(ish) async function returning a result object (not just calling `process.exit`), and unit-test it directly with vitest against a fixture game (reuse `src/testing/random-simulation.ts`'s own test fixtures if present, or `src/session/testing/fixtures/`).
2. If CLI-boundary behavior (exit code, stdout) must be asserted, spawn the built CLI via `node_modules/.bin/boardsmith` — but RESEARCH.md explicitly recommends avoiding a spawned child process where possible.

**Determinism test pattern** (mirrors `simulateRandomGames`'s own doc example at `src/testing/random-simulation.ts:490-509`):
```typescript
const seed = 'fixed-seed';
const run1 = await simulateRandomGames(GameClass, { count: 3, playerCounts: [2], seed });
const run2 = await simulateRandomGames(GameClass, { count: 3, playerCounts: [2], seed });
expect(run1.games).toEqual(run2.games);
```

---

### Import-path-only edits (mechanical, no pattern extraction needed)

Four files change one import line each:

| File | Current import (line) | New import |
|------|------------------------|-------------|
| `src/runtime/runner.test.ts:17` | `import { createHeadlessSession } from '../session/testing/headless-harness.js';` | `import { createHeadlessSession } from '../session/headless-session.js';` |
| `src/session/testing/eachplayer-clone.test.ts:2` | `import { createHeadlessSession } from './headless-harness.js';` | `import { createHeadlessSession } from '../headless-session.js';` |
| `src/session/testing/parity-contract.test.ts:2` | `import { createHeadlessSession } from './headless-harness.js';` | `import { createHeadlessSession } from '../headless-session.js';` |
| `src/session/testing/undo-authoritative.test.ts:2` | `import { createHeadlessSession } from './headless-harness.js';` | `import { createHeadlessSession } from '../headless-session.js';` |

Delete `src/session/testing/headless-harness.ts` once all four are updated (grep for `headless-harness` afterward to confirm zero remaining references — Pitfall 1).

## Shared Patterns

### `boardsmith.json` existence + missing-config error
**Source:** `src/cli/commands/validate.ts:19-24` (identical wording also in `analyze.ts:386-390`, `dev.ts:374-378`)
**Apply to:** `src/cli/commands/simulate.ts`
```typescript
const configPath = join(cwd, 'boardsmith.json');
if (!existsSync(configPath)) {
  console.error(chalk.red('Error: boardsmith.json not found'));
  console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
  process.exit(1);
}
```

### Rules-module live-bundle loading (NOT the dist-lookup pattern in `evolve-ai-weights.ts`)
**Source:** `src/cli/commands/dev.ts:192-229` (`loadGameRuntime`)
**Apply to:** `src/cli/commands/simulate.ts` — simplified to omit the `executeOp` re-export (Pitfall 4)

### chalk color conventions
**Source:** used identically across `validate.ts`, `analyze.ts`, `dev.ts`: `chalk.red` for errors, `chalk.dim` for secondary/hint text, `chalk.cyan` for section headers, `chalk.green`/`chalk.yellow` for pass/warn states
**Apply to:** all output in `simulate.ts`

### `simulateRandomGames`/`SingleGameResult`/`SimulationResults` shapes
**Source:** `src/testing/random-simulation.ts:31-123, 512-587`
**Apply to:** `simulate.ts`'s core loop and both output formatters (table + `--json`)

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/cli/commands/simulate.test.ts` | test | batch | No existing CLI-command test file in the repo to copy structure from (see Pattern Assignments section above for the recommended approach — export testable function, avoid spawning a child process) |

## Metadata

**Analog search scope:** `src/session/`, `src/session/testing/`, `src/cli/commands/`, `src/testing/`, `src/cli/cli.ts`
**Files scanned:** `headless-harness.ts`, `session/index.ts`, `stateless-ops.ts`, `dev.ts`, `validate.ts`, `analyze.ts`, `random-simulation.ts`, `cli.ts`, `eachplayer-clone.test.ts`, plus grep confirmation of the 4 `headless-harness` import sites
**Pattern extraction date:** 2026-07-01
