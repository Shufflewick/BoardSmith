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
      test: 'vitest',
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
  return `export { ${pascal}Game } from './game.js';
export { ${pascal}Player } from './elements.js';
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
.stat-label { color: #888; }
.stat-value { font-weight: bold; color: #00d9ff; }
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
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  padding: 8px 24px;
  border-radius: 20px;
  font-weight: bold;
}

.waiting {
  color: #888;
}

.action-button {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
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
