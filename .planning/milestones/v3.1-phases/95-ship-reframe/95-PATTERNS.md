# Phase 95: Ship & Reframe - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 8 (5 modified, 1 new, 6 doc-only edits)
**Analogs found:** 4 / 8 (doc files have no meaningful analog — text-only edits)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cli/lib/project-scaffold.ts` | utility (template generator) | transform | itself (existing generator functions) | exact — modify in-place |
| `src/cli/lib/project-scaffold.test.ts` | test | transform | `src/cli/lib/sandbox-scan.test.ts` | role-match (same module, same vitest style) |
| `src/cli/commands/validate.ts` | utility (validator) | request-response | itself (existing `validateMetadata()`) | exact — add one optional field |
| `docs/ui-components.md` | docs | n/a | — | text-only, no analog needed |
| `docs/component-showcase.md` | docs | n/a | — | text-only, no analog needed |
| `docs/nomenclature.md` | docs | n/a | — | text-only, no analog needed |
| `docs/llm-overview.md` | docs | n/a | — | text-only, no analog needed |
| `src/cli/slash-command/instructions.md` | docs | n/a | — | text-only, no analog needed |

---

## Pattern Assignments

### `src/cli/lib/project-scaffold.ts` (utility, transform)

**Analog:** itself — existing generator functions in the same file are the pattern to copy for any new generator. No new functions are needed; the planner modifies four existing ones.

**Generator function signature pattern** (`project-scaffold.ts` lines 102–116, 251–257, 263–348, 353–455):
```typescript
// All generators are pure exported functions:
//   (config?: ProjectConfig) => string
// They return a multi-line template literal directly.
// No side effects, no async, no file I/O.

export function generateBoardsmithJson(config: ProjectConfig): string {
  const json = { /* object */ };
  return JSON.stringify(json, null, 2);
}

export function generateUiIndexTs(): string {
  return `export type ...
export { App };
export { default as GameTable } from './components/GameTable.vue';
`;
}

export function generateAppVue(config: ProjectConfig): string {
  return `<script setup lang="ts">
...
</script>
<template>...</template>
<style scoped>...</style>
`;
}
```

**What to change — `generateBoardsmithJson()` (lines 102–116):**
Add `ui: 'auto'` to the `json` object before `JSON.stringify`. The existing pattern builds a plain object literal and stringifies it — just insert the field there:
```typescript
// Current json object (lines 103–113):
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
};
// ADD: ui: 'auto' to this object
```

**What to change — `generateUiIndexTs()` (lines 251–257):**
Remove the `GameTable` re-export line (line 256). This is a tree-shaking landmine: if `src/main.ts` imports from `./ui/index.js` and that barrel re-exports `GameTable`, Rollup may include the stub in the bundle even when `App.vue` doesn't use it. After removal the function becomes:
```typescript
export function generateUiIndexTs(): string {
  return `export type { UseActionControllerReturn } from 'boardsmith/ui';

import App from './App.vue';
export { App };
`;
}
```

**What to change — `generateAppVue()` (lines 263–348):**
Replace the entire body. Remove the two-column comparison layout and GameTable import. Single-UI result:
```typescript
export function generateAppVue(config: ProjectConfig): string {
  return `<script setup lang="ts">
import { GameShell, AutoUI } from 'boardsmith/ui';
</script>

<template>
  <GameShell
    game-type="${config.name}"
    display-name="${config.displayName}"
    :player-count="${config.playerCount.min}"
  >
    <template #game-board="{ gameView, playerSeat, state }">
      <AutoUI
        :game-view="gameView || null"
        :player-seat="playerSeat"
        :flow-state="state?.flowState as any"
      />
    </template>

    <template #player-stats="{ player }">
      <div class="player-stat">
        <span class="stat-label">Score:</span>
        <span class="stat-value">{{ (player as any).score || 0 }}</span>
      </div>
    </template>
  </GameShell>
</template>

<style scoped>
.player-stat {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  margin-top: 8px;
}
.stat-label { color: #888; }
.stat-value { font-weight: bold; color: #00d9ff; }
</style>
`;
}
```
Key removals: `import GameTable from './components/GameTable.vue'`, `board-comparison` grid, `board-section` divs, `board-title` h2s, `board-comparison` CSS.

**What to change — `generateGameTableVue()` (lines 353–455):**
Remove the `placeholder-notice` div (lines 385–387) and its CSS (lines 411–420). Replace with a "start here" comment and keep the useful props/structure. The component stays on disk as an optional custom-UI entry point — it just no longer screams that it is mandatory. Pattern to follow: same `<script setup>` / `<template>` / `<style scoped>` structure, same `defineProps<{...}>()` usage.

---

### `src/cli/lib/project-scaffold.test.ts` (test, transform)

**Analog:** `src/cli/lib/sandbox-scan.test.ts`

This is the primary pattern for CLI module unit tests. Key characteristics:
- Vitest `describe/it/expect` (no Jest compat layer)
- Tests call pure exported functions directly — no mocking, no file system required for string-generator tests
- When file system IS needed (like `sandbox-scan.test.ts`), uses `mkdtempSync` / `rmSync` with `beforeEach/afterEach` cleanup
- Assertions use `toContain`, `toHaveLength`, `toBe` — not snapshot assertions

**Imports pattern** (`sandbox-scan.test.ts` lines 1–4):
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSandboxViolations } from './sandbox-scan.js';
```

For `project-scaffold.test.ts`, the imports will be simpler (no file system needed for string generators):
```typescript
import { describe, it, expect } from 'vitest';
import {
  generateAppVue,
  generateBoardsmithJson,
  generateGameTableVue,
  generateUiIndexTs,
  generateScaffoldFiles,
  type ProjectConfig,
} from './project-scaffold.js';
```

**Core test pattern** (`sandbox-scan.test.ts` lines 7–33) — shared test fixture + individual behavioral assertions:
```typescript
// Shared config fixture for the scaffold tests:
const config: ProjectConfig = {
  name: 'my-game',
  displayName: 'My Game',
  description: 'A test game',
  playerCount: { min: 2, max: 4 },
};

describe('generateAppVue', () => {
  it('imports only AutoUI — no GameTable import', () => {
    const out = generateAppVue(config);
    expect(out).toContain("import { GameShell, AutoUI } from 'boardsmith/ui'");
    expect(out).not.toContain("GameTable");
  });

  it('has no split-screen markup', () => {
    const out = generateAppVue(config);
    expect(out).not.toContain('board-comparison');
    expect(out).not.toContain('board-section');
    expect(out).not.toContain('Auto-Generated UI');
    expect(out).not.toContain('Custom UI');
  });

  it('renders AutoUI inside GameShell game-board slot', () => {
    const out = generateAppVue(config);
    expect(out).toContain('#game-board');
    expect(out).toContain('<AutoUI');
  });
});

describe('generateBoardsmithJson', () => {
  it('contains the "ui" field set to "auto"', () => {
    const parsed = JSON.parse(generateBoardsmithJson(config));
    expect(parsed.ui).toBe('auto');
  });
});

describe('generateUiIndexTs', () => {
  it('does not re-export GameTable (tree-shaking landmine)', () => {
    const out = generateUiIndexTs();
    expect(out).not.toContain('GameTable');
  });
});

describe('generateGameTableVue', () => {
  it('has no placeholder warning text', () => {
    const out = generateGameTableVue();
    expect(out).not.toContain('placeholder UI');
    expect(out).not.toContain('placeholder-notice');
    expect(out).not.toContain('⚠️');
  });

  it('has "start here" guidance for custom UI authors', () => {
    const out = generateGameTableVue();
    // Some indication it is optional / a starting point:
    expect(out.toLowerCase()).toContain('start here');
  });
});
```

**No snapshot tests.** The existing CLI test files in this project use explicit `toContain` / `not.toContain` / `toBe` assertions, not `.toMatchSnapshot()`. Follow this pattern to keep tests readable and diff-friendly.

---

### `src/cli/commands/validate.ts` (utility, request-response)

**Analog:** itself (`validateMetadata()` function, lines 86–130)

The `"ui"` field is optional in `boardsmith.json` — it should not be added to the `required` array. However, if present, its value should be validated (must be `"auto"` or a relative path string starting with `./`). The existing pattern for optional-field validation follows the same `issues.push(...)` approach:

**Required-field check pattern** (lines 93–99):
```typescript
// Required fields — do NOT add "ui" here (it is optional)
const required = ['name', 'displayName', 'description', 'playerCount'];
for (const field of required) {
  if (!config[field]) {
    issues.push(`Missing required field: ${field}`);
  }
}
```

**Optional-field validation pattern to add** (insert after playerCount validation, ~line 108):
```typescript
// Optional "ui" field — must be "auto" or a relative path
if (config.ui !== undefined) {
  if (config.ui !== 'auto' && !String(config.ui).startsWith('./')) {
    issues.push('"ui" must be "auto" or a relative path (e.g. "./ui/components/GameUI.vue")');
  }
}
```

Return type follows the `ValidationResult` interface (lines 8–13):
```typescript
interface ValidationResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string[];
}
```

---

## Shared Patterns

### String-template generator convention
**Source:** `src/cli/lib/project-scaffold.ts` (entire file)
**Apply to:** All four modified generator functions

Every generator in `project-scaffold.ts`:
1. Is a pure exported function — no side effects, no I/O
2. Returns a raw `string` (template literal or `JSON.stringify`)
3. Receives `config: ProjectConfig` when it needs game metadata; no config parameter when generic
4. Is called from `generateScaffoldFiles()` (line 471) which assembles the file list

Any new generator added to this file must follow this convention. `generateScaffoldFiles()` (lines 471–485) is the single registration point — if a new file is added to the scaffold output, add a `{ path: '...', content: generatorFn(config) }` entry there.

### Vitest test structure for CLI utility modules
**Source:** `src/cli/lib/sandbox-scan.test.ts`
**Apply to:** `src/cli/lib/project-scaffold.test.ts`

Pattern:
- Same file, `.test.ts` suffix, same directory as the module under test
- Import directly from `.js` extension (ESM project: `import { ... } from './project-scaffold.js'`)
- `describe` blocks per exported function
- `it` descriptions state the behavioral contract ("has no split-screen markup")
- Assertion style: `expect(str).toContain(...)` and `expect(str).not.toContain(...)`
- No snapshots, no file system for pure string-generator tests

### Chalk + actionable error messages
**Source:** `src/cli/commands/validate.ts` lines 50–83
**Apply to:** Any CLI output added in this phase

The project uses `chalk.green/red/cyan/dim/yellow` for CLI output. Error messages are actionable — they tell the user what to do next, not just what went wrong. See the `allPassed` branch (lines 70–83) for the "next steps" pattern.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `docs/ui-components.md` | docs | n/a | Markdown text edit — no code pattern needed |
| `docs/component-showcase.md` | docs | n/a | Markdown text edit — no code pattern needed |
| `docs/nomenclature.md` | docs | n/a | Markdown text edit — no code pattern needed |
| `docs/llm-overview.md` | docs | n/a | Markdown text edit — no code pattern needed |
| `src/cli/slash-command/instructions.md` | docs | n/a | Large embedded skill document — text edits at specific lines only; see RESEARCH.md §Reframe Surface for exact line numbers and replacement text |

---

## Exact Reframe Surface (for doc-only edits)

These are confirmed line numbers from RESEARCH.md for the doc-only changes — no pattern needed, just targeted text replacements:

| File | Line(s) | Current text (to remove/replace) |
|------|---------|----------------------------------|
| `docs/ui-components.md` | 139 | `Useful for prototyping or as a reference implementation.` |
| `docs/ui-components.md` | 155–161 | Bullet list — add production framing bullet |
| `docs/component-showcase.md` | 103 | `Automatic UI generation for prototyping.` |
| `docs/component-showcase.md` | 117–118 | `- Debugging game state` / `- Reference implementation` |
| `docs/nomenclature.md` | 416 | `Useful for prototyping and as a reference implementation.` |
| `docs/nomenclature.md` | 421 | `"Use AutoUI to test rules before building custom UI"` |
| `docs/llm-overview.md` | 13 | end of `AutoUI can render any game without custom components` line |
| `src/cli/slash-command/instructions.md` | 698–702 | `**You MUST customize GameTable.vue...** Never leave the JSON dump placeholder.` |
| `src/cli/slash-command/instructions.md` | 1027–1040 | entire "Step 4: Customize GameTable.vue (REQUIRED)" section |

---

## Metadata

**Analog search scope:** `src/cli/` (all subdirectories)
**Files scanned:** `project-scaffold.ts`, `sandbox-scan.test.ts`, `bridge.test.ts`, `multiplayer-host.test.ts`, `init.ts`, `validate.ts`
**Pattern extraction date:** 2026-06-22
