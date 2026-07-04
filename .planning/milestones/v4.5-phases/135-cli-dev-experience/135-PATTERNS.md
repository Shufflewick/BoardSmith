# Phase 135: CLI & Dev Experience - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 11 (6 modified source files + 1 new lib file [discretion] + 3 new test files + 1 extended test file)
**Analogs found:** 11 / 11 (all files have a same-repo analog; this phase is a pure internal refactor of existing CLI files, so most "analogs" are the files' own current content plus one sibling command)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|---------------|
| `src/cli/cli.ts` | config (commander registration) | request-response (CLI arg parsing) | itself (modify in place) — sibling `simulate` registration block (lines 86-93) for option-declaration style | exact |
| `src/cli/commands/dev.ts` | controller (CLI command handler) | request-response + event-driven (spawns WS/Vite servers) | `src/cli/commands/simulate.ts` (fail-fast numeric validation, lines 145-156) + itself for structure | role-match (validation snippet) / exact (structure) |
| `src/cli/commands/validate.ts` | controller (CLI command handler) | request-response (batch of checks → report) | itself (extend `validateMetadata`, add unknown-key check + did-you-mean) | exact |
| `src/cli/commands/init.ts` | controller (CLI command handler) + template generator | file-I/O (scaffold write) | itself (`InitOptions`, `generateGameTs`) — drop `template` field | exact |
| `src/cli/commands/build.ts` | controller (CLI command handler) | batch (build pipeline → manifest write) | `src/cli/commands/simulate.ts:158-167` (`getProjectContext` + `loadGameDefinition` usage pattern) | role-match |
| `src/cli/lib/project-scaffold.ts` | utility (template/string generator) | transform (config → generated file contents) | itself (`generateBoardsmithJson`, `generateRulesIndexTs`) | exact |
| `src/cli/lib/config-schema.ts` (NEW, discretion) | utility (validation helper) | transform (key list + levenshtein → suggestion) | no direct analog in repo — hand-roll per RESEARCH.md "Don't Hand-Roll" table; model on `validate.ts`'s existing `ValidationResult`-shaped helper functions | no analog (new pattern) |
| `src/cli/commands/dev.test.ts` (NEW) | test | request-response (arg validation, no real sockets) | `src/cli/commands/simulate.test.ts` (`simulateCommand` describe block, lines 101-136) | exact |
| `src/cli/commands/validate.test.ts` (NEW) | test | request-response (unit-test exported validators) | `src/cli/commands/simulate.test.ts` (fixture-project-dir setup via `mkdtempSync`/`process.chdir`, lines 101-123) | role-match |
| `src/cli/commands/build.test.ts` (NEW) | test | batch (manifest derivation) | `src/cli/commands/simulate.test.ts` (fixture-project-dir + `runSimulation`-style pure-function extraction, lines 53-99) | role-match |
| `src/cli/commands/init.test.ts` (EXTEND) | test | file-I/O (template string assertions) | itself (existing `describe('generateGameTs …')` blocks) | exact |
| `src/cli/lib/project-scaffold.test.ts` (EXTEND) | test | transform (template string assertions) | itself (existing `describe('generateBoardsmithJson')` block) | exact |

## Pattern Assignments

### `src/cli/commands/dev.ts` (controller, request-response/event-driven)

**Analog:** `src/cli/commands/simulate.ts` (fail-fast numeric pattern) + itself (existing structure)

**Current minPlayers/maxPlayers three-way fallback to collapse** (lines 359-360, verified current):
```typescript
minPlayers = gameDefinition.minPlayers ?? config.playerCount?.min ?? config.minPlayers ?? 2;
maxPlayers = gameDefinition.maxPlayers ?? config.playerCount?.max ?? config.maxPlayers ?? 4;
```
CLIX-01: collapse to a single read of `gameDefinition.minPlayers`/`maxPlayers` (gameDefinition is now the sole source; `config.playerCount`/`config.minPlayers`/`config.maxPlayers` fallbacks are removed since `boardsmith.json` no longer carries these keys).

**Fail-fast numeric pattern to copy for `--port`/`--players`** (source: `simulate.ts:145-153`, exact style to imitate for CLIX-06):
```typescript
const gamesCount = Number(options.games);
const playersCount = Number(options.players);
if (!Number.isInteger(playersCount) || playersCount < 1) {
  console.error(chalk.red(`Error: --players must be a positive integer, got "${options.players}"`));
  process.exit(1);
}
```
Apply the identical shape to `dev.ts`'s current unguarded parses (lines 280-281):
```typescript
const port = parseInt(options.port, 10);
const playerCount = parseInt(options.players, 10);
```
Replace with `Number(...)` + `Number.isInteger` guards before use, matching `simulate.ts`'s error message shape ("Error: --X must be a positive integer, got \"raw\"").

**Current `--ai` pre-clamp validation to move (ordering bug — CLIX-06/Pitfall 3)** (lines 302-308, verified current):
```typescript
const invalidAiPlayers = aiPlayers.filter(p => p < 1 || p > playerCount);
if (invalidAiPlayers.length > 0) {
  console.error(chalk.red(`Error: Invalid AI player position(s): ${invalidAiPlayers.join(', ')}`));
  console.error(chalk.dim(`Player positions are 1-indexed (1 to ${playerCount}).`));
  console.error(chalk.dim(`Example: --ai 2 for a 2-player game means player 2 is AI.`));
  process.exit(1);
}
```
Must move to after `effectivePlayerCount` is computed (current line 393: `const effectivePlayerCount = Math.min(Math.max(playerCount, minPlayers), maxPlayers);`), and compare against `effectivePlayerCount` instead of the raw pre-clamp `playerCount`. Per CONTEXT.md CLIX-06, out-of-range `--players` should ERROR (not clamp) once `minPlayers`/`maxPlayers` are known — so the clamp math itself likely becomes an error branch instead of `Math.min(Math.max(...))`.

**Host default + banner** (line 283, verified current):
```typescript
// Default to all interfaces so other computers on the LAN can join the game.
const host = options.host ?? '0.0.0.0';
```
Existing network-URL banner already present (lines 596-598, verified current — do not duplicate, extend):
```typescript
for (const networkUrl of vite.resolvedUrls?.network ?? []) {
  console.log(chalk.cyan(`  Network (others can join): ${networkUrl}`));
}
```
CLIX-04 adds a loud banner specifically for the *default* (host-not-overridden) case, distinct from this existing per-URL banner — print once near the top when `!options.host` (binding all interfaces), e.g. `chalk.yellow('Serving to your whole network — pass --host 127.0.0.1 for local-only')`.

**Config loading error pattern to keep verbatim** (lines 310-317, verified current — same shape used by `validate.ts`, `build.ts`, `simulate.ts`):
```typescript
const configPath = join(cwd, 'boardsmith.json');
if (!existsSync(configPath)) {
  console.error(chalk.red('Error: boardsmith.json not found'));
  console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
  process.exit(1);
}
const config: BoardSmithConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
```

---

### `src/cli/commands/build.ts` (controller, batch)

**Analog:** `src/cli/commands/simulate.ts:158-167` (loadGameDefinition usage — the exact pattern to imitate)

**Pattern to copy — Node-side gameDefinition load** (source: `simulate.ts:158-167`, verified current):
```typescript
const context = getProjectContext(cwd);

const tempDir = join(cwd, '.boardsmith');
if (!existsSync(tempDir)) {
  mkdirSync(tempDir, { recursive: true });
}

let gameDefinition;
try {
  ({ gameDefinition } = await loadGameDefinition(rulesPath, tempDir, context));
} catch (error) {
  console.error(chalk.red('Failed to load game rules:'), error);
  process.exit(1);
}
```
`loadGameDefinition` itself lives in `src/cli/commands/game-runtime.ts:109-140` (already exported, already imported by `simulate.ts`):
```typescript
export async function loadGameDefinition(
  rulesPath: string,
  tempDir: string,
  context: 'monorepo' | 'standalone',
): Promise<{ gameDefinition: GameDefinition }> { /* esbuild-bundles rules/index.ts, dynamic-imports it */ }
```

**Current (wrong) manifest generation to replace** (source: `build.ts:107-116`, verified current):
```typescript
const manifest = {
  ...config,
  buildTime: new Date().toISOString(),
  version: config.version || '1.0.0',
  engineProtocol: BUNDLE_PROTOCOL_VERSION,
};
```
CLIX-01 requires positively deriving playerCount from `gameDefinition`, NOT relying on the `...config` spread — since `build.ts` currently never loads `gameDefinition` at all (only `getProjectContext` exists in this file today, imported inline; `rulesPath`/`tempDir` setup must be added, mirroring `dev.ts`/`simulate.ts`'s `join(cwd, '.boardsmith')` + `context` resolution). Target shape:
```typescript
const manifest = {
  ...config,
  buildTime: new Date().toISOString(),
  version: config.version || '1.0.0',
  engineProtocol: BUNDLE_PROTOCOL_VERSION,
  playerCount: { min: gameDefinition.minPlayers, max: gameDefinition.maxPlayers }, // derived, not copied
};
```

**`getProjectContext` — build.ts currently has its OWN local copy** (lines 17-29, verified current) that duplicates `game-runtime.ts`'s exported version (lines 13-25 there, byte-identical implementation). Since `build.ts` will now need `loadGameDefinition` from `game-runtime.ts` anyway, this is a good moment to import `getProjectContext` from `game-runtime.ts` too (as `simulate.ts` and `dev.ts` already do) instead of keeping the duplicate — reduces drift risk, though not explicitly required by CONTEXT.md.

**Error handling wrapper to keep** (source: `build.ts:136-140`, verified current):
```typescript
} catch (error) {
  spinner.fail('Build failed');
  console.error(chalk.red('\nBuild error:'), error);
  process.exit(1);
}
```

---

### `src/cli/commands/validate.ts` (controller, request-response)

**Analog:** itself — extend existing `validateMetadata` and `validateBundleSize`; no cross-file pattern needed for CLIX-02/03 beyond the shared constant module (discretion).

**Current metadata check to extend** (source: `validate.ts:94-109`, verified current):
```typescript
const required = ['name', 'displayName', 'description', 'playerCount'];
for (const field of required) {
  if (!config[field]) {
    issues.push(`Missing required field: ${field}`);
  }
}

// Player count validation
if (config.playerCount) {
  if (!config.playerCount.min || !config.playerCount.max) {
    issues.push('playerCount must have min and max');
  }
  if (config.playerCount.min > config.playerCount.max) {
    issues.push('playerCount.min cannot be greater than playerCount.max');
  }
}
```
CLIX-01 removes `playerCount` from `required` (no longer a required — or even valid — key) and CLIX-02 makes its *presence* an error via the new unknown-key check (did-you-mean-flavored migration message, e.g. "Unknown key 'playerCount' — player count is now derived from your gameDefinition, remove this key.").

**`ValidationResult` shape to reuse for the new unknown-key check** (source: `validate.ts:8-13`, verified current):
```typescript
interface ValidationResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string[];
}
```
New check follows the exact same async-function-returning-`ValidationResult` shape as `validateMetadata`/`validateAssetPaths`, registered into the `results` array alongside the existing six checks (`validate.ts:31-46`).

**Current (wrong) bundle-size constant to fix** (source: `validate.ts:222-226`, verified current):
```typescript
// Limits match server-side enforcement:
//   rules.js: 1MB (executor MAX_BUNDLE_SIZE)
//   total bundle zip: 50MB (games worker MAX_BUNDLE_SIZE)      <- comment is RIGHT
const maxRulesJs = 1 * 1024 * 1024; // 1MB - executor limit
const maxTotalBundle = 200 * 1024 * 1024; // 200MB - upload limit   <- constant is WRONG, must be 50MB
```
Fix the constant (not the comment) to `50 * 1024 * 1024`, sourced from a shared exported constant (discretion module `src/cli/lib/bundle-limits.ts`) so `validate.ts`'s test can assert `expect(maxTotalBundle).toBe(50 * 1024 * 1024)` against an importable value rather than a private local.

**Error-reporting structure at the command level to keep verbatim** (source: `validate.ts:48-83`, verified current — the icon/pass-fail loop and exit-code convention all new checks plug into unchanged):
```typescript
for (const result of results) {
  const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
  const status = result.passed ? chalk.green('PASS') : chalk.red('FAIL');
  console.log(`  ${icon} ${result.name}: ${status}`);
  if (!result.passed) {
    allPassed = false;
    console.log(chalk.dim(`    ${result.message}`));
    if (result.details) {
      for (const detail of result.details) {
        console.log(chalk.dim(`      - ${detail}`));
      }
    }
  }
}
```

---

### `src/cli/commands/init.ts` (controller + template generator, file-I/O)

**Analog:** itself — drop the `template` field entirely.

**Current dead field to remove** (source: `init.ts:15-17`, verified current — confirmed no read site anywhere in `initCommand` per RESEARCH.md A2):
```typescript
interface InitOptions {
  template: string;
}
```
CLIX-05: delete `InitOptions.template` and its corresponding `-t, --template` registration in `cli.ts:27`. `initCommand`'s signature (`name: string, options: InitOptions`) stays the same shape otherwise.

---

### `src/cli/cli.ts` (config, request-response)

**Analog:** itself — `dev` command's option-registration block for style; sibling `simulate`/`pack` blocks as the `-t`-removal precedent (`pack` also registers `-t, --target` at line 62, a DIFFERENT flag — do not touch it, only `init`'s `-t, --template` at line 27 is in scope).

**Current dead flag registration to remove** (source: `cli.ts:24-28`, verified current):
```typescript
program
  .command('init <name>')
  .description('Create a new BoardSmith game project')
  .option('-t, --template <template>', 'Template to use (default: card-game)', 'card-game')
  .action(initCommand);
```
Target: drop the `.option(...)` line entirely, matching the `.command().description().action()` shape other simple commands already use (e.g. `validate` at lines 66-69, `lint` at lines 72-75).

**Misleading `--host` help text to fix** (source: `cli.ts:35`, verified current):
```typescript
.option('--host <host>', 'Host to bind the server to (e.g., 0.0.0.0 for network access)')
```
CLIX-04: help text must state the ACTUAL default (`0.0.0.0`) since CONTEXT.md keeps LAN-by-default as the product decision — e.g. `'Host to bind the server to (default: 0.0.0.0 — all interfaces; use 127.0.0.1 or --lan-shorthand-off for local-only)'`. Also register the optional `--lan` boolean alias per CONTEXT.md's discretion item, following the existing boolean-flag style used by `--lock-teaching` (line 39: `.option('--lock-teaching', 'Disable AI hint, ...')`).

---

### `src/cli/lib/project-scaffold.ts` (utility, transform)

**Analog:** itself — `generateBoardsmithJson` and `generateRulesIndexTs`.

**Current scaffold write of `playerCount` into boardsmith.json to remove** (source: `project-scaffold.ts:103-118`, verified current):
```typescript
export function generateBoardsmithJson(config: ProjectConfig): string {
  const json = {
    $schema: 'https://boardsmith.io/schemas/game.json',
    name: config.name,
    displayName: config.displayName,
    description: config.description,
    playerCount: config.playerCount,
    estimatedDuration: '15-30 minutes',
    complexity: 2,
    categories: config.categories || ['card-game'],
    thumbnail: './public/thumbnail.png',
    scoreboard: { stats: ['score'] },
    ui: config.ui ?? 'auto',
  };
  return JSON.stringify(json, null, 2);
}
```
CLIX-01: drop the `playerCount: config.playerCount,` line from the emitted JSON. Note `ProjectConfig.playerCount` (interface field, line 21) STAYS as the scaffold's internal generation parameter (per RESEARCH.md's State-of-the-Art table) — it still seeds `generateRulesIndexTs`'s hardcoded `minPlayers`/`maxPlayers` (below) and `generateAppVue`'s `:player-count` template attr (lines 292/329) — only the JSON *output* key is removed.

**Current dead `$schema` URL** (source: `project-scaffold.ts:105`, verified current):
```typescript
$schema: 'https://boardsmith.io/schemas/game.json',
```
CLIX-02: per CONTEXT.md/RESEARCH.md Open Question 2, either drop this line or point it at a real shipped local schema path — planner picks one (discretion).

**Current double-hardcode in generated rules/index.ts** (source: `project-scaffold.ts:240-246`, verified current):
```typescript
export const gameDefinition = {
  gameClass: ${pascal}Game,
  gameType: '${config.name}',
  displayName: '${config.displayName}',
  minPlayers: ${config.playerCount.min},
  maxPlayers: ${config.playerCount.max},
} as const;
```
This is the OTHER of the "two places" CLIX-01 mentions (RESEARCH.md's opening line: "Scaffold no longer hardcodes the value in two places"). Per CONTEXT.md, `gameDefinition` (code) remains the single source of truth — so THIS site is the one place the scaffold-time `config.playerCount.min/max` values are legitimately written (into the compiled rules), while `generateBoardsmithJson`'s copy is the duplicate to delete.

---

## Shared Patterns

### Config-load-or-exit
**Source:** `src/cli/commands/dev.ts:310-317`, `src/cli/commands/simulate.ts:128-133`, `src/cli/commands/validate.ts:19-24`, `src/cli/commands/build.ts:44-49` (byte-for-byte identical pattern in all four files)
**Apply to:** Any command reading `boardsmith.json`
```typescript
const configPath = join(cwd, 'boardsmith.json');
if (!existsSync(configPath)) {
  console.error(chalk.red('Error: boardsmith.json not found'));
  console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
```

### Fail-fast numeric CLI flag validation
**Source:** `src/cli/commands/simulate.ts:145-156`
**Apply to:** `dev.ts`'s `--players`, `--port`, `--ai` (CLIX-06)
```typescript
const playersCount = Number(options.players);
if (!Number.isInteger(playersCount) || playersCount < 1) {
  console.error(chalk.red(`Error: --players must be a positive integer, got "${options.players}"`));
  process.exit(1); // or process.exitCode = 1; return; — dev.ts uses process.exit like validate.ts/build.ts, not the exitCode-return style simulate.ts uses in its command wrapper
}
```

### Node-side gameDefinition load (esbuild + dynamic import)
**Source:** `src/cli/commands/game-runtime.ts:109-140` (`loadGameDefinition`), consumed by `src/cli/commands/simulate.ts:158-167`
**Apply to:** `build.ts` (new usage, CLIX-01 manifest derivation)
```typescript
const context = getProjectContext(cwd);
const tempDir = join(cwd, '.boardsmith');
if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
const { gameDefinition } = await loadGameDefinition(rulesPath, tempDir, context);
```

### chalk error/dim conventions
**Source:** used identically across all `src/cli/commands/*.ts` files
**Apply to:** All controller files
```typescript
console.error(chalk.red('Error: <what failed>'));
console.error(chalk.dim('<actionable next step>'));
process.exit(1);
```

### Test fixture project setup (mkdtemp + process.chdir)
**Source:** `src/cli/commands/simulate.test.ts:101-123` (`simulateCommand` describe block)
**Apply to:** `dev.test.ts`, `validate.test.ts`, `build.test.ts` (all need a fixture `boardsmith.json` + `src/rules/index.ts` on disk, and all need `--flag` validation to short-circuit before any real esbuild/Vite/child-process work runs)
```typescript
let projectDir: string;
let originalCwd: string;
let originalExitCode: number | string | null | undefined;

beforeEach(() => {
  originalCwd = process.cwd();
  originalExitCode = process.exitCode;
  projectDir = mkdtempSync(join(tmpdir(), 'boardsmith-<command>-cli-'));
  writeFileSync(join(projectDir, 'boardsmith.json'), JSON.stringify({ name: 'fixture' }));
  mkdirSync(join(projectDir, 'src', 'rules'), { recursive: true });
  writeFileSync(join(projectDir, 'src', 'rules', 'index.ts'), 'export const gameDefinition = {};\n');
  process.chdir(projectDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  process.exitCode = originalExitCode;
  rmSync(projectDir, { recursive: true, force: true });
});

it('IN-01: exits non-zero with an actionable message on a non-numeric flag', async () => {
  process.exitCode = 0;
  await someCommand({ /* invalid flag value */ });
  expect(process.exitCode).toBe(1);
});
```
Note: `simulateCommand`'s tests exploit that arg validation runs (and returns/exits) BEFORE bundling `rulesIndexPath`, so the stub rules file's contents don't matter — the same short-circuit property should hold for `dev.ts`'s NaN/range guards (CLIX-06) once moved before `loadGameRuntime`, making them cheaply testable without a real Vite/WS server. The CLIX-04 host-default banner test and the `--ai` post-clamp test (Pitfall 3) will need `loadGameRuntime`/`createViteServer` mocked or stubbed since they depend on `gameDefinition.minPlayers`/`maxPlayers` being resolved — extract the pure validation logic into a standalone function if `dev.ts`'s monolithic `devCommand` proves hard to test in place (see RESEARCH.md Wave-0-Gaps note).

### Pure-function extraction for testability
**Source:** `src/cli/commands/simulate.ts` — `runSimulation()` (lines 54-87) is a standalone exported function separate from `simulateCommand()` (the CLI action handler), letting `simulate.test.ts`'s `describe('runSimulation', ...)` block (lines 53-99) test the core logic with a bare game class, no esbuild/child-process/CLI-arg parsing involved.
**Apply to:** `build.ts`'s manifest-derivation logic (CLIX-01) — consider extracting a `deriveManifest(config, gameDefinition, protocolVersion)` pure function so `build.test.ts` can assert the derived `playerCount` shape without invoking `viteBuild()`. Also relevant to `dev.ts`'s `--ai`/`effectivePlayerCount` validation logic (CLIX-06) if `dev.test.ts` needs to test it without a real Vite server.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/cli/lib/config-schema.ts` (discretion — may not be created if hand-rolled inline in validate.ts instead) | utility | transform | No did-you-mean/levenshtein or allowed-key-set validator exists anywhere in the repo (`grep -rln "levenshtein\|didYouMean"` returned nothing per RESEARCH.md). Must hand-roll from scratch per RESEARCH.md's "Don't Hand-Roll" table guidance (~20-line classic DP levenshtein) — no local pattern to copy, only the general shape of other `src/cli/lib/*.ts` utility modules (e.g. `sandbox-scan.ts`, imported by `validate.ts:6`) as a structural precedent for "small standalone lib module, named export, imported by validate.ts + dev.ts". |
| `src/cli/lib/bundle-limits.ts` (discretion — may just be a constant relocated within validate.ts) | config/utility | transform | Single-constant module; no direct analog needed since it's a one-line extraction of `validate.ts`'s existing local `const maxTotalBundle`. |

## Metadata

**Analog search scope:** `src/cli/**/*.ts` (all files in cli.ts, commands/, lib/, dev-host/), plus `~/ShufflewickPubGames/src/upload.ts` (external, read-only, for the CLIX-03 constant confirmation — already captured in RESEARCH.md, not re-read here)
**Files scanned:** 11 (cli.ts, dev.ts, validate.ts, init.ts, build.ts, project-scaffold.ts, game-runtime.ts, simulate.ts, init.test.ts, simulate.test.ts, project-scaffold.test.ts) — all read in full (largest is dev.ts at 630 lines, well under the 2,000-line large-file threshold, so single-pass reads were used throughout)
**Pattern extraction date:** 2026-07-03
