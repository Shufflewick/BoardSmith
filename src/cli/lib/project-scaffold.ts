/**
 * Project Scaffold
 *
 * Shared library for generating BoardSmith project structure.
 * Used by both `init` and `design` commands.
 */

import { DESIGN_DIR, SCRATCH_DIR } from './project-paths.js';
import { existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Project configuration
 */
export interface ProjectConfig {
  name: string;
  displayName: string;
  description: string;
  playerCount: { min: number; max: number };
  audience?: string;
  tags?: string[];
  ui?: string;
}

/**
 * Generated file with path and content
 */
export interface GeneratedFile {
  path: string;
  content: string;
}

/**
 * Check if running from local dev environment
 */
export function getMonorepoRoot(): string | null {
  // Try multiple possible paths depending on how CLI is built/bundled:
  // - Unbundled: dist/cli/lib/project-scaffold.js -> go up 3 levels
  // - Bundled:   dist/cli/cli.mjs -> go up 2 levels
  // - Source:    src/cli/lib/project-scaffold.ts -> go up 3 levels
  const candidates = [
    join(__dirname, '..', '..', '..'),  // lib -> cli -> dist -> BoardSmith
    join(__dirname, '..', '..'),        // cli -> dist -> BoardSmith (bundled)
  ];

  for (const candidate of candidates) {
    const enginePath = join(candidate, 'src', 'engine');
    const uiPath = join(candidate, 'src', 'ui');
    if (existsSync(enginePath) && existsSync(uiPath)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Get the `boardsmith` dependency spec for a project being scaffolded at
 * `projectPath` — a local `file:` link when the CLI can see the monorepo,
 * the published version otherwise.
 *
 * The local link is RELATIVE to `projectPath`. An absolute `file:` path bakes
 * the scaffolding developer's home directory into the new game's
 * package.json, so `npm install` fails on every other machine and in CI — the
 * defect issue 142 was filed for, after it reached five games.
 */
export function getDependencyPaths(projectPath: string): {
  boardsmith: string;
  isLocalDev: boolean;
} {
  const monorepoRoot = getMonorepoRoot();

  if (monorepoRoot !== null) {
    // `relative` between two absolute paths; `resolve` first so a caller's
    // relative projectPath still produces a link that resolves correctly.
    const link = relative(resolve(projectPath), resolve(monorepoRoot));
    return {
      boardsmith: `file:${toPosixPath(link)}`,
      isLocalDev: true,
    };
  }

  return {
    boardsmith: '^0.0.1',
    isLocalDev: false,
  };
}

/**
 * package.json is a cross-platform file: a `file:` link must use forward
 * slashes even when the scaffold runs on Windows.
 */
function toPosixPath(path: string): string {
  return path.split('\\').join('/');
}

/**
 * Convert name to PascalCase
 */
export function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Convert name to display name
 */
export function toDisplayName(str: string): string {
  return str
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Generate boardsmith.json
 */
export function generateBoardsmithJson(config: ProjectConfig): string {
  const json = {
    name: config.name,
    displayName: config.displayName,
    description: config.description,
    audience: config.audience || 'casual',
    tags: config.tags || [],
    playtime: { min: 15, max: 30 },
    cooperative: false,
    complexity: 2,
    // No `thumbnail` key, deliberately. The scaffold creates no thumbnail
    // image, and `deriveManifest` stamps whatever this file declares straight
    // into dist/manifest.json — so scaffolding the key meant every new game
    // shipped a manifest naming a file the bundle did not carry (issue 142).
    // Add it once there is art behind it; `boardsmith validate` now fails on a
    // declared asset path that resolves to nothing.
    scoreboard: { stats: ['score'] },
    // No `ui` field, deliberately. A game's UIs are declared in src/ui/uis.ts
    // (defineGameUIs) — the one place. The manifest used to carry a `"ui"` key
    // that nothing read after scaffolding, so it rotted: most games dropped it,
    // one pointed at App.vue itself, and a game comment asserted it was the
    // source of truth while nothing consumed it. Don't reintroduce it.
  };
  return JSON.stringify(json, null, 2);
}

/**
 * Generate package.json
 */
export function generatePackageJson(config: ProjectConfig, projectPath: string): string {
  const deps = getDependencyPaths(projectPath);

  // No `scripts` block, deliberately. The BoardSmith CLI is the one way to
  // build, test, lint, and validate a game — `npx boardsmith test`, not
  // `npm test`. Script aliases would fork that into two commands that drift
  // apart (a game pinning `vitest` while the CLI moves on, or a stale
  // `npm run dev` that skips CLI setup), and would make every game's tooling
  // subtly different from every other game's.
  const pkg = {
    name: config.name,
    version: '0.0.1',
    type: 'module',
    dependencies: {
      boardsmith: deps.boardsmith,
      vue: '^3.4.0',
    },
    devDependencies: {
      '@vitejs/plugin-vue': '^5.0.0',
      // Explicit (not just transitively hoisted via @vitejs/plugin-vue) so
      // `types: ["vite/client"]` in the generated tsconfig always resolves
      // regardless of package-manager hoisting behavior (Phase 149 Defect 1).
      vite: '^5.4.0',
      typescript: '^5.7.0',
      // `boardsmith validate` type-checks with vue-tsc, not plain tsc: tsc
      // cannot read .vue files, and the ambient `declare module '*.vue'` shim
      // that used to paper over that erased every component's prop types AND
      // bound them to BoardSmith's copy of vue. vue-tsc compiles SFCs for real
      // and resolves vue per-file, so this project can upgrade vue whenever it
      // likes.
      'vue-tsc': '^2.2.12',
      vitest: '^2.0.0',
      // Vitest v2 does not bundle jsdom; the a11y example opens with
      // `// @vitest-environment jsdom` and needs the package installed.
      jsdom: '^29.1.1',
      'axe-core': '^4.12.1',
      '@vue/test-utils': '^2.4.11',
      // Tests are type-checked (tsconfig `include` names `tests/**`) and a test
      // that reads a file imports `node:fs`. Without this those imports fail
      // TS2307 under `boardsmith validate` while the same file runs green under
      // `boardsmith test`, because vitest never type-checks (ShufflewickPub
      // #241). Not paired with a `types` entry: see the note there.
      '@types/node': '^22.0.0',
    },
  };

  return JSON.stringify(pkg, null, 2);
}

/**
 * Generate tsconfig.json
 */
export function generateTsConfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      // `src/ui/index.ts` re-exports types from `boardsmith/ui`, and the
      // scaffold's `GameTable.vue` imports `UseActionControllerReturn` from
      // `boardsmith/ui` directly. In local-monorepo dev mode `boardsmith`'s
      // `./ui` export resolves to raw source, so tsc must fully type-check
      // that module graph — which reaches `useActionController.ts`'s
      // `import.meta.env.DEV` (a Vite-ambient global). Without this, a
      // freshly-scaffolded, unmodified project fails `tsc --noEmit` out of
      // the box with TS2339 on `ImportMeta.env` (Phase 149 dry-run Defect 1).
      //
      // COUPLING (WR-04): listing `types` at all switches tsc from
      // "auto-include every @types/* in node_modules" to "include ONLY these".
      // Any future scaffold/game file that relies on ambient globals — vitest
      // globals via `globals: true`, extra `@types/web` — will silently fail to
      // type-check until its package is appended here explicitly (and added as
      // a devDependency). Keep this array in sync when introducing such a
      // dependency.
      //
      // `node` is deliberately NOT listed. This array governs AMBIENT types; an
      // explicit `import ... from 'node:fs'` in a test resolves through ordinary
      // module resolution as long as @types/node is installed, which is why that
      // package is a scaffold devDependency and this line is unchanged.
      types: ['vite/client'],
      // Resolve `vue` (and its @vue/* internals) from THIS project, whatever
      // version is installed. NOT a version pin — it names a LOCATION, never a
      // version, so vue can be upgraded freely; this is what MAKES that safe.
      //
      // `boardsmith` installs as a symlink to a checkout carrying its own vue,
      // so without this BoardSmith's copy leaks into the compilation and its
      // `Ref`/`DefineComponent` are nominally distinct types from yours —
      // passing a template ref into a BoardSmith composable then fails on
      // `[RefSymbol]`. `@vue/*` matters as much as `vue`: `Ref` comes from
      // @vue/reactivity.
      paths: {
        vue: ['./node_modules/vue'],
        '@vue/*': ['./node_modules/@vue/*'],
      },
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      jsx: 'preserve',
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      outDir: './dist',
    },
    // `tests/**` IS PART OF THE PROJECT, not an afterthought. `boardsmith
    // validate` type-checks whatever this `include` names, and `boardsmith
    // test` runs `tests/**` with vitest; naming only `src/**` makes those two
    // commands look at different projects, so every test file is executed
    // without ever being type-checked and a real error survives in whichever
    // gate nobody runs (ShufflewickPub #241).
    //
    // This is also why there is no `rootDir`: an include reaching outside it is
    // a TS6059 CONFIG error, which stops tsc before it checks a single file
    // while still exiting 0. See docs/typecheck.md.
    include: ['src/**/*', 'tests/**/*'],
    exclude: ['node_modules', 'dist'],
  };
  return JSON.stringify(config, null, 2);
}

/**
 * Generate vite.config.ts
 */
export function generateViteConfig(): string {
  return `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // \`boardsmith\` installs as a symlink to a checkout carrying its own copy of
    // vue, so without this the bundle can contain two Vue runtimes — two
    // separate reactivity systems and provide/inject registries, which silently
    // breaks state shared across the game/library boundary.
    //
    // A SINGLE-COPY guarantee, not a version pin: it never constrains which vue
    // you install, so upgrade freely. Types are handled separately —
    // \`boardsmith validate\` runs vue-tsc, which resolves each file's vue from
    // that file's own location.
    dedupe: ['vue'],
  },
});
`;
}

/**
 * Generate index.html
 */
export function generateIndexHtml(config: ProjectConfig): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>${config.displayName}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { height: 100%; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;
}

/**
 * Generate src/main.ts
 */
export function generateMainTs(): string {
  return `import { createApp } from 'vue';
import { App } from './ui/index.js';

const app = createApp(App);
app.mount('#app');
`;
}

/**
 * Generate src/rules/index.ts
 */
export function generateRulesIndexTs(config: ProjectConfig): string {
  const pascal = toPascalCase(config.name);
  return `export { ${pascal}Game, ${pascal}Player } from './game.js';
export * from './elements.js';
export * from './actions.js';
export { createGameFlow } from './flow.js';

import { ${pascal}Game } from './game.js';

export const gameDefinition = {
  gameClass: ${pascal}Game,
  gameType: '${config.name}',
  displayName: '${config.displayName}',
  minPlayers: ${config.playerCount.min},
  maxPlayers: ${config.playerCount.max},
} as const;
`;
}

/**
 * Generate src/ui/index.ts
 */
export function generateUiIndexTs(): string {
  return `export type { UseActionControllerReturn } from 'boardsmith/ui';

import App from './App.vue';
export { App };
`;
}

/**
 * Generate src/ui/uis.ts — the game's UI registry.
 *
 * This is the ONE place a game says which boards it has and which one ships.
 * Auto-UI games start with the auto-UI as their default and a custom board
 * stub kept dev-only; when the author is ready they swap which one is wrapped
 * in `defaultUI()`. That swap is the whole migration.
 */
export function generateUisTs(config: ProjectConfig): string {
  const custom = config.ui && config.ui !== 'auto' ? config.ui : undefined;
  if (!custom) {
    return `import { defineGameUIs, defaultUI, devUI } from 'boardsmith/ui';
import AutoUI from 'boardsmith/ui/auto-ui';

/**
 * Every UI this game has. Exactly one must be defaultUI() — that is what
 * players get; the compiler rejects zero or two.
 *
 * devUI() entries exist only under \`boardsmith dev\`. They are stripped from
 * production builds entirely: JS, CSS, and assets. Building your own board?
 * Move defaultUI() onto it and mark Auto as devUI().
 */
export default defineGameUIs({
  Auto: defaultUI(AutoUI),
  Custom: devUI(() => import('./components/GameTable.vue')),
});
`;
  }
  const name = custom.split('/').pop()?.replace(/\.vue$/, '') || 'GameUI';
  return `import { defineGameUIs, defaultUI, devUI } from 'boardsmith/ui';
import ${name} from '${custom}';

/**
 * Every UI this game has. Exactly one must be defaultUI() — that is what
 * players get; the compiler rejects zero or two.
 *
 * The shipped board is imported statically so it can never fail to arrive
 * separately from the app. devUI() entries are lazy on purpose: the dynamic
 * import inside a dev-only branch is what lets production strip them entirely,
 * JS, CSS, and assets.
 */
export default defineGameUIs({
  ${name}: defaultUI(${name}),
  Auto: devUI(() => import('boardsmith/ui/auto-ui')),
});
`;
}

/**
 * Generate src/ui/App.vue
 *
 * Branches on config.ui:
 *   "auto" (default) → single AutoUI import
 *   relative path    → single custom component import (no AutoUI)
 */
export function generateAppVue(config: ProjectConfig): string {
  return `<script setup lang="ts">
import { GameShell } from 'boardsmith/ui';
import uis from './uis.js';
</script>

<template>
  <!--
    The board comes from the UI registry (src/ui/uis.ts). There is no board
    slot: one declaration, one render path, so nothing can disagree about
    which UI ships.
  -->
  <GameShell
    game-type="${config.name}"
    display-name="${config.displayName}"
    :player-count="${config.playerCount.min}"
    :uis="uis"
  >
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
.stat-label { color: var(--bsg-ink-2); }
.stat-value { font-weight: bold; color: var(--bsg-accent); }
</style>
`;
}

/**
 * Generate src/ui/components/GameTable.vue
 *
 * Optional custom-UI stub — start here when you want a bespoke interface.
 * The auto-UI ships and handles everything until you're ready to fill this in.
 * To activate: set boardsmith.json "ui" to the path of this file.
 */
export function generateGameTableVue(): string {
  return `<script setup lang="ts">
/**
 * Custom UI — start here when you want to design a bespoke interface.
 *
 * The auto-UI (AutoUI) renders your game out of the box and can ship as-is
 * for simple games. Fill this component in when you want full control over
 * how the game looks, then update boardsmith.json:
 *
 *   "ui": "./ui/components/GameTable.vue"
 *
 * Pit of Success: the easy path (keeping "ui": "auto") is the right path —
 * switch here only when you're ready to invest in a custom interface.
 */
import { computed } from 'vue';
import type { UseActionControllerReturn } from 'boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerSeat: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
}>();

const canTakeAction = computed(() => props.availableActions.length > 0);
const firstAction = computed(() => props.availableActions[0]);

function handleAction() {
  if (firstAction.value) {
    props.actionController.start(firstAction.value);
  }
}
</script>

<template>
  <!-- Build your custom UI here. AutoUI handles everything until you're ready. -->
  <div class="game-board">
    <div class="turn-status">
      <span v-if="isMyTurn" class="turn-indicator">Your Turn</span>
      <span v-else class="waiting">Waiting for other player...</span>
    </div>

    <button
      v-if="canTakeAction && isMyTurn"
      @click="handleAction"
      class="action-button"
      :aria-label="\`Take the \${firstAction} action\`"
    >
      {{ firstAction }}
    </button>
  </div>
</template>

<style scoped>
.game-board {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  gap: 20px;
}

.turn-status {
  font-size: 1.1rem;
}

.turn-indicator {
  background: var(--bsg-accent);
  color: var(--bsg-accent-ink);
  padding: 8px 24px;
  border-radius: 20px;
  font-weight: bold;
}

.waiting {
  color: var(--bsg-ink-2);
}

.action-button {
  background: var(--bsg-accent);
  color: var(--bsg-accent-ink);
  border: none;
  padding: 12px 32px;
  border-radius: 8px;
  font-weight: bold;
  font-size: 1.1rem;
  cursor: pointer;
  text-transform: capitalize;
}

.action-button:hover {
  transform: scale(1.05);
}
</style>
`;
}

/**
 * Generate tests/a11y.example.test.ts
 *
 * Example accessibility test demonstrating the axe-core scan pattern every UI
 * chunk's a11y floor (UIQ-03) copies. Scans the scaffold's own GameTable.vue
 * stub — replace with your own component(s) as you build UI chunks.
 */
export function generateA11yExampleTestTs(): string {
  return `// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import axe from 'axe-core';
import GameTable from '../src/ui/components/GameTable.vue';

describe('GameTable — a11y floor (axe-core scan)', () => {
  it('has no axe-core violations', async () => {
    // axe.run() only scans nodes that are actually IN the document —
    // \`mount\` without \`attachTo\` renders into a DETACHED node and axe throws
    // "No elements found for include in page Context". Attach on mount, then
    // detach in \`finally\` so the node never leaks into the next test.
    // Mount with a real available action so GameTable renders its action
    // <button> (canTakeAction = availableActions.length > 0). This is the copy-me
    // template for every UI chunk's a11y floor: axe must scan a real interactive
    // control (a focusable button with a game-semantic aria-label), not an
    // empty render. Replace 'draw' with an action name from your own game.
    const wrapper = mount(GameTable, {
      attachTo: document.body,
      props: {
        gameView: null,
        playerSeat: 0,
        isMyTurn: true,
        availableActions: ['draw'],
        actionController: {} as never,
      },
    });
    try {
      const results = await axe.run(wrapper.element);
      expect(results.violations).toEqual([]);
    } finally {
      wrapper.unmount();
    }
  });
});
`;
}

/**
 * Generate .gitignore
 */
export function generateGitignore(): string {
  return `node_modules/
dist/
.DS_Store
*.log

# Dev-host build output and agent scratch (${SCRATCH_DIR}). Regenerated on every
# run and never portable — tracking it made every dev-server run show spurious
# deletions, and it is where throwaway repro/debug scripts belong so they can
# never become tracked litter in the project root.
.boardsmith/
`;
}

/**
 * Generate all scaffold files for a project
 */
export function generateScaffoldFiles(config: ProjectConfig, projectPath: string): GeneratedFile[] {
  return [
    { path: 'boardsmith.json', content: generateBoardsmithJson(config) },
    { path: 'package.json', content: generatePackageJson(config, projectPath) },
    { path: 'tsconfig.json', content: generateTsConfig() },
    { path: 'vite.config.ts', content: generateViteConfig() },
    { path: 'index.html', content: generateIndexHtml(config) },
    { path: 'src/main.ts', content: generateMainTs() },
    { path: 'src/rules/index.ts', content: generateRulesIndexTs(config) },
    { path: 'src/ui/index.ts', content: generateUiIndexTs() },
    { path: 'src/ui/uis.ts', content: generateUisTs(config) },
    { path: 'src/ui/App.vue', content: generateAppVue(config) },
    { path: 'src/ui/components/GameTable.vue', content: generateGameTableVue() },
    { path: 'tests/a11y.example.test.ts', content: generateA11yExampleTestTs() },
    { path: '.gitignore', content: generateGitignore() },
  ];
}

/**
 * Get required directory structure
 */
export function getRequiredDirectories(): string[] {
  return [
    'src',
    'src/rules',
    'src/ui',
    'src/ui/components',
    'src/ui/assets',
    'tests',
    'public',
    // The bs- skills' design artifacts (SKETCH.md, chunks/, rulebook/, …) all live here.
    DESIGN_DIR,
  ];
}
