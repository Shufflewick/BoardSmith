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
}

/**
 * Generated file with path and content
 */
export interface GeneratedFile {
  path: string;
  content: string;
}

/**
 * Check if running from local dev (monorepo) environment
 */
export function getMonorepoRoot(): string | null {
  // __dirname is like /path/to/BoardSmith/packages/cli/dist/lib
  // Go up: lib -> dist -> cli -> packages -> BoardSmith
  const potentialRoot = join(__dirname, '..', '..', '..', '..');
  const enginePath = join(potentialRoot, 'packages', 'engine', 'package.json');
  const uiPath = join(potentialRoot, 'packages', 'ui', 'package.json');

  if (existsSync(enginePath) && existsSync(uiPath)) {
    return potentialRoot;
  }
  return null;
}

/**
 * Get dependency paths (local file: links or npm versions)
 */
export function getDependencyPaths(): {
  engine: string;
  ui: string;
  cli: string;
  testing: string;
  isLocalDev: boolean;
} {
  const monorepoRoot = getMonorepoRoot();
  const isLocalDev = monorepoRoot !== null;

  if (isLocalDev) {
    return {
      engine: `file:${join(monorepoRoot!, 'packages', 'engine')}`,
      ui: `file:${join(monorepoRoot!, 'packages', 'ui')}`,
      cli: `file:${join(monorepoRoot!, 'packages', 'cli')}`,
      testing: `file:${join(monorepoRoot!, 'packages', 'testing')}`,
      isLocalDev: true,
    };
  }

  return {
    engine: '^0.0.1',
    ui: '^0.0.1',
    cli: '^0.0.1',
    testing: '^0.0.1',
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
  };
  return JSON.stringify(json, null, 2);
}

/**
 * Generate package.json
 */
export function generatePackageJson(config: ProjectConfig): string {
  const deps = getDependencyPaths();

  const pkg = {
    name: `@mygames/${config.name}`,
    version: '0.0.1',
    type: 'module',
    scripts: {
      dev: 'boardsmith dev',
      build: 'boardsmith build',
      test: 'vitest',
      validate: 'boardsmith validate',
    },
    dependencies: {
      '@boardsmith/engine': deps.engine,
      '@boardsmith/ui': deps.ui,
      vue: '^3.4.0',
    },
    devDependencies: {
      '@boardsmith/cli': deps.cli,
      '@boardsmith/testing': deps.testing,
      typescript: '^5.7.0',
      vitest: '^2.0.0',
      '@vitejs/plugin-vue': '^5.0.0',
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
  return `import App from './App.vue';
export { App };
export { default as GameBoard } from './components/GameBoard.vue';
`;
}

/**
 * Generate src/ui/App.vue
 */
export function generateAppVue(config: ProjectConfig): string {
  return `<script setup lang="ts">
import { GameShell, AutoUI } from '@boardsmith/ui';
import GameBoard from './components/GameBoard.vue';
</script>

<template>
  <GameShell
    game-type="${config.name}"
    display-name="${config.displayName}"
    :player-count="${config.playerCount.min}"
  >
    <template #game-board="{ state, gameView, playerPosition, isMyTurn, availableActions, action, actionArgs, executeAction, setBoardPrompt, startAction }">
      <div class="board-comparison">
        <div class="board-section">
          <h2 class="board-title">Custom UI</h2>
          <GameBoard
            :game-view="gameView"
            :player-position="playerPosition"
            :is-my-turn="isMyTurn"
            :available-actions="availableActions"
            :action="action"
            :action-args="actionArgs"
            :execute-action="executeAction"
            :set-board-prompt="setBoardPrompt"
            :start-action="startAction"
          />
        </div>
        <div class="board-section">
          <h2 class="board-title">Auto-Generated UI</h2>
          <AutoUI
            :game-view="gameView || null"
            :player-position="playerPosition"
            :flow-state="state?.flowState as any"
          />
        </div>
      </div>
    </template>

    <template #player-stats="{ player, gameView }">
      <div class="player-stat">
        <span class="stat-label">Score:</span>
        <span class="stat-value">{{ (player as any).score || 0 }}</span>
      </div>
    </template>
  </GameShell>
</template>

<style scoped>
.board-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  width: 100%;
  height: 100%;
}

.board-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.board-title {
  font-size: 1.2rem;
  margin: 0 0 12px 0;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  text-align: center;
}

.player-stat {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  margin-top: 8px;
}

.stat-label {
  color: #888;
}

.stat-value {
  font-weight: bold;
  color: #00d9ff;
}
</style>
`;
}

/**
 * Generate src/ui/components/GameBoard.vue (placeholder)
 */
export function generateGameBoardVue(): string {
  return `<script setup lang="ts">
// Props from GameShell
const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  action: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  actionArgs: Record<string, unknown>;
  executeAction: (name: string) => Promise<void>;
  setBoardPrompt: (prompt: string | null) => void;
  startAction: (name: string, initialArgs?: Record<string, unknown>) => void;
}>();
</script>

<template>
  <div class="game-board">
    <p v-if="isMyTurn" class="turn-indicator">Your Turn</p>
    <p v-else class="waiting">Waiting for other player...</p>

    <div class="game-state">
      <pre>{{ JSON.stringify(gameView, null, 2) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.game-board {
  padding: 20px;
}

.turn-indicator {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  padding: 8px 24px;
  border-radius: 20px;
  font-weight: bold;
  display: inline-block;
  margin-bottom: 20px;
}

.waiting {
  color: #888;
}

.game-state {
  background: rgba(0, 0, 0, 0.3);
  padding: 16px;
  border-radius: 8px;
  overflow: auto;
  max-height: 400px;
}

.game-state pre {
  font-size: 12px;
  color: #aaa;
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
    { path: 'src/ui/components/GameBoard.vue', content: generateGameBoardVue() },
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
