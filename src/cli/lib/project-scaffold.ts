/**
 * Project Scaffold
 *
 * Shared library for generating BoardSmith project structure.
 * Used by both `init` and `design` commands.
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
  categories?: string[];
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
 * Get dependency paths (local file: links or npm versions)
 */
export function getDependencyPaths(): {
  boardsmith: string;
  isLocalDev: boolean;
} {
  const monorepoRoot = getMonorepoRoot();
  const isLocalDev = monorepoRoot !== null;

  if (isLocalDev) {
    return {
      boardsmith: `file:${monorepoRoot}`,
      isLocalDev: true,
    };
  }

  return {
    boardsmith: '^0.0.1',
    isLocalDev: false,
  };
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
    estimatedDuration: '15-30 minutes',
    complexity: 2,
    categories: config.categories || ['card-game'],
    thumbnail: './public/thumbnail.png',
    scoreboard: { stats: ['score'] },
    ui: config.ui ?? 'auto',
  };
  return JSON.stringify(json, null, 2);
}

/**
 * Generate package.json
 */
export function generatePackageJson(config: ProjectConfig): string {
  const deps = getDependencyPaths();

  const pkg = {
    name: config.name,
    version: '0.0.1',
    type: 'module',
    scripts: {
      dev: 'npx boardsmith dev',
      build: 'npx boardsmith build',
      // `vitest run` (not bare `vitest`) so `npm test` runs once and exits —
      // matching BoardSmith's own convention and the no-hanging-process rule.
      // Use `npm run test:watch` for interactive watch mode.
      test: 'vitest run',
      'test:watch': 'vitest',
      lint: 'npx boardsmith lint',
      validate: 'npx boardsmith validate',
    },
    dependencies: {
      boardsmith: deps.boardsmith,
      vue: '^3.4.0',
    },
    devDependencies: {
      '@vitejs/plugin-vue': '^5.0.0',
      typescript: '^5.7.0',
      vitest: '^2.0.0',
      // Vitest v2 does not bundle jsdom; the a11y example opens with
      // `// @vitest-environment jsdom` and needs the package installed.
      jsdom: '^29.1.1',
      'axe-core': '^4.12.1',
      '@vue/test-utils': '^2.4.11',
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
      rootDir: './src',
    },
    include: ['src/**/*'],
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
 * Generate src/ui/App.vue
 *
 * Branches on config.ui:
 *   "auto" (default) → single AutoUI import
 *   relative path    → single custom component import (no AutoUI)
 */
export function generateAppVue(config: ProjectConfig): string {
  const ui = config.ui ?? 'auto';

  const sharedStyles = `<style scoped>
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

  if (ui === 'auto') {
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

${sharedStyles}`;
  }

  // Custom UI path: derive a component name from the filename. Guard against an
  // empty segment (e.g. a path ending in "/") — `??` would not catch "", which
  // would emit an invalid `import  from '...'`. `boardsmith validate` rejects
  // such a path up front; this is the generator-side safety net.
  const derivedName = ui.split('/').pop()?.replace(/\.vue$/, '');
  const componentName = derivedName && derivedName.length > 0 ? derivedName : 'GameUI';
  return `<script setup lang="ts">
import { GameShell } from 'boardsmith/ui';
import ${componentName} from '${ui}';
</script>

<template>
  <GameShell
    game-type="${config.name}"
    display-name="${config.displayName}"
    :player-count="${config.playerCount.min}"
  >
    <template #game-board="{ gameView, playerSeat, isMyTurn, availableActions, actionController }">
      <${componentName}
        :game-view="gameView"
        :player-seat="playerSeat"
        :is-my-turn="isMyTurn"
        :available-actions="availableActions"
        :action-controller="actionController"
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

${sharedStyles}`;
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
`;
}

/**
 * Generate all scaffold files for a project
 */
export function generateScaffoldFiles(config: ProjectConfig): GeneratedFile[] {
  return [
    { path: 'boardsmith.json', content: generateBoardsmithJson(config) },
    { path: 'package.json', content: generatePackageJson(config) },
    { path: 'tsconfig.json', content: generateTsConfig() },
    { path: 'vite.config.ts', content: generateViteConfig() },
    { path: 'index.html', content: generateIndexHtml(config) },
    { path: 'src/main.ts', content: generateMainTs() },
    { path: 'src/rules/index.ts', content: generateRulesIndexTs(config) },
    { path: 'src/ui/index.ts', content: generateUiIndexTs() },
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
  ];
}
