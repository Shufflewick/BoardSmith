import { mkdir, writeFile, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Detect if running from local dev (npm link) by checking if we're in the monorepo
function getMonorepoRoot(): string | null {
  // __dirname is like /path/to/BoardSmith/packages/cli/dist/commands
  // Go up: commands -> dist -> cli -> packages -> BoardSmith
  const potentialRoot = join(__dirname, '..', '..', '..', '..');
  const enginePath = join(potentialRoot, 'packages', 'engine', 'package.json');
  const uiPath = join(potentialRoot, 'packages', 'ui', 'package.json');

  if (existsSync(enginePath) && existsSync(uiPath)) {
    return potentialRoot;
  }
  return null;
}

interface InitOptions {
  template: string;
}

export async function initCommand(name: string, options: InitOptions): Promise<void> {
  const projectPath = join(process.cwd(), name);

  if (existsSync(projectPath)) {
    console.error(chalk.red(`Error: Directory "${name}" already exists`));
    process.exit(1);
  }

  const spinner = ora(`Creating ${name}...`).start();

  try {
    await mkdir(projectPath);
    await mkdir(join(projectPath, 'src'));
    await mkdir(join(projectPath, 'src', 'rules'));
    await mkdir(join(projectPath, 'src', 'ui'));
    await mkdir(join(projectPath, 'src', 'ui', 'components'));
    await mkdir(join(projectPath, 'src', 'ui', 'assets'));
    await mkdir(join(projectPath, 'tests'));
    await mkdir(join(projectPath, 'public'));

    const config = {
      '$schema': 'https://boardsmith.io/schemas/game.json',
      name: name,
      displayName: toDisplayName(name),
      description: 'A fun game for 2-4 players',
      playerCount: { min: 2, max: 4 },
      estimatedDuration: '15-30 minutes',
      complexity: 2,
      categories: ['card-game'],
      thumbnail: './public/thumbnail.png',
      scoreboard: { stats: ['score'] },
    };
    await writeFile(join(projectPath, 'boardsmith.json'), JSON.stringify(config, null, 2));

    // Check if we're running from local dev environment
    const monorepoRoot = getMonorepoRoot();
    const isLocalDev = monorepoRoot !== null;

    const engineDep = isLocalDev
      ? `file:${join(monorepoRoot!, 'packages', 'engine')}`
      : '^0.0.1';
    const uiDep = isLocalDev
      ? `file:${join(monorepoRoot!, 'packages', 'ui')}`
      : '^0.0.1';
    const cliDep = isLocalDev
      ? `file:${join(monorepoRoot!, 'packages', 'cli')}`
      : '^0.0.1';

    if (isLocalDev) {
      console.log(chalk.dim(`  Using local packages from ${monorepoRoot}`));
    }

    const packageJson = {
      name: `@mygames/${name}`,
      version: '0.0.1',
      type: 'module',
      scripts: {
        dev: 'boardsmith dev',
        build: 'boardsmith build',
        test: 'vitest',
        validate: 'boardsmith validate',
      },
      dependencies: {
        '@boardsmith/engine': engineDep,
        '@boardsmith/ui': uiDep,
        vue: '^3.4.0',
      },
      devDependencies: {
        '@boardsmith/cli': cliDep,
        typescript: '^5.7.0',
        vitest: '^2.0.0',
        '@vitejs/plugin-vue': '^5.0.0',
      },
    };
    await writeFile(join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2));

    const tsconfig = {
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
    await writeFile(join(projectPath, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

    await writeFile(join(projectPath, 'src', 'rules', 'game.ts'), generateGameTs(name));
    await writeFile(join(projectPath, 'src', 'rules', 'elements.ts'), generateElementsTs());
    await writeFile(join(projectPath, 'src', 'rules', 'actions.ts'), generateActionsTs(name));
    await writeFile(join(projectPath, 'src', 'rules', 'flow.ts'), generateFlowTs(name));
    await writeFile(join(projectPath, 'src', 'rules', 'index.ts'), generateRulesIndexTs(name));
    await writeFile(join(projectPath, 'src', 'ui', 'App.vue'), generateAppVue(name));
    await writeFile(join(projectPath, 'src', 'ui', 'components', 'GameBoard.vue'), generateGameBoardVue());
    await writeFile(join(projectPath, 'src', 'ui', 'index.ts'), generateUiIndexTs());
    await writeFile(join(projectPath, 'tests', 'game.test.ts'), generateTestTs(name));
    await writeFile(join(projectPath, '.gitignore'), 'node_modules/\ndist/\n.DS_Store\n*.log\n');
    await writeFile(join(projectPath, 'vite.config.ts'), generateViteConfig());
    await writeFile(join(projectPath, 'index.html'), generateIndexHtml(name));
    await writeFile(join(projectPath, 'src', 'main.ts'), generateMainTs());

    spinner.succeed(chalk.green(`Created ${name} successfully!`));
    console.log(`
${chalk.cyan('Next steps:')}

  cd ${name}
  npm install
  boardsmith dev

${chalk.dim('This will start the development server and open player tabs in your browser.')}
`);
  } catch (error) {
    spinner.fail(chalk.red('Failed to create project'));
    console.error(error);
    process.exit(1);
  }
}

function toPascalCase(str: string): string {
  return str.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

function toDisplayName(str: string): string {
  return str.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function generateGameTs(name: string): string {
  const pascal = toPascalCase(name);
  return `import { Game, Player, type GameOptions } from '@boardsmith/engine';
import { Card, Hand, Deck } from './elements.js';
import { createGameFlow } from './flow.js';
import { createDrawAction, createPlayAction } from './actions.js';

export interface ${pascal}Options extends GameOptions {
  seed?: string;
}

export class ${pascal}Game extends Game<${pascal}Game, ${pascal}Player> {
  deck!: Deck;

  constructor(options: ${pascal}Options) {
    super(options);

    // Register element classes
    this.registerElements([Card, Hand, Deck]);

    // Create deck
    this.deck = this.create(Deck, 'deck');
    this.deck.setOrder('stacking');

    // Create standard 52-card deck
    const suits = ['H', 'D', 'C', 'S'] as const;
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
    for (const suit of suits) {
      for (const rank of ranks) {
        this.deck.create(Card, \`\${rank}\${suit}\`, { suit, rank });
      }
    }

    // Shuffle and deal
    this.deck.shuffle();
    for (const player of this.players) {
      for (let i = 0; i < 5; i++) {
        const card = this.deck.first(Card);
        if (card) {
          const hand = this.getPlayerHand(player);
          card.putInto(hand);
        }
      }
    }

    // Register actions
    this.registerAction(createDrawAction(this));
    this.registerAction(createPlayAction(this));

    // Set up game flow
    this.setFlow(createGameFlow(this));
  }

  protected override createPlayer(position: number, name: string): ${pascal}Player {
    return new ${pascal}Player(position, name, this);
  }

  getPlayerHand(player: ${pascal}Player): Hand {
    return this.first(Hand, \`hand-\${player.position}\`)!;
  }

  override isFinished(): boolean {
    return this.deck.count(Card) === 0;
  }

  override getWinners(): ${pascal}Player[] {
    if (!this.isFinished()) return [];
    let winner = this.players[0];
    for (const player of this.players) {
      if (player.score > winner.score) {
        winner = player;
      }
    }
    return [winner];
  }
}

export class ${pascal}Player extends Player<${pascal}Game, ${pascal}Player> {
  hand!: Hand;
  score: number = 0;

  constructor(position: number, name: string, game: ${pascal}Game) {
    super(position, name);
    this.game = game;
    // Create player's hand
    this.hand = game.create(Hand, \`hand-\${position}\`);
    this.hand.player = this;
    this.hand.contentsVisibleToOwner();
  }
}
`;
}

function generateElementsTs(): string {
  return `import { Card as BaseCard, Hand as BaseHand, Deck as BaseDeck, Space } from '@boardsmith/engine';

export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export class Card extends BaseCard {
  suit!: Suit;
  rank!: Rank;
}

export class Hand extends BaseHand {
}

export class Deck extends BaseDeck {
}

export class PlayArea extends Space {
}
`;
}

function generateActionsTs(name: string): string {
  const pascal = toPascalCase(name);
  return `import { Action, type ActionDefinition } from '@boardsmith/engine';
import type { ${pascal}Game, ${pascal}Player } from './game.js';
import { Card } from './elements.js';

export function createDrawAction(game: ${pascal}Game): ActionDefinition {
  return Action.create('draw')
    .prompt('Draw a card from the deck')
    .execute((args, ctx) => {
      const player = ctx.player as ${pascal}Player;
      const card = game.deck.first(Card);
      if (card) {
        card.putInto(player.hand);
        return { success: true, message: 'Drew a card' };
      }
      return { success: false, message: 'No cards left in deck' };
    });
}

export function createPlayAction(game: ${pascal}Game): ActionDefinition {
  return Action.create('play')
    .prompt('Play a card from your hand')
    .chooseFrom<Card>('card', {
      prompt: 'Select a card to play',
      choices: (ctx) => {
        const player = ctx.player as ${pascal}Player;
        return [...player.hand.all(Card)];
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as ${pascal}Player;
      const card = args.card as Card;
      card.remove();
      player.score += 1;
      return { success: true, message: 'Played a card' };
    });
}
`;
}

function generateFlowTs(name: string): string {
  const pascal = toPascalCase(name);
  return `import {
  loop,
  eachPlayer,
  actionStep,
  sequence,
  type FlowDefinition,
} from '@boardsmith/engine';
import type { ${pascal}Game, ${pascal}Player } from './game.js';
import { Card } from './elements.js';

export function createGameFlow(game: ${pascal}Game): FlowDefinition {
  // Player turn: draw a card, then play a card
  const playerTurn = sequence(
    actionStep({
      name: 'draw-step',
      actions: ['draw'],
      prompt: 'Draw a card from the deck',
      skipIf: () => game.deck.count(Card) === 0,
    }),
    actionStep({
      name: 'play-step',
      actions: ['play'],
      prompt: 'Play a card from your hand',
      skipIf: (ctx) => {
        const player = ctx.player as ${pascal}Player;
        return player.hand.count(Card) === 0;
      },
    }),
  );

  return {
    root: loop({
      name: 'game-loop',
      while: () => game.deck.count(Card) > 0,
      maxIterations: 100,
      do: eachPlayer({
        name: 'player-turns',
        do: playerTurn,
      }),
    }),
    isComplete: () => game.deck.count(Card) === 0,
    getWinners: () => game.getWinners(),
  };
}
`;
}

function generateRulesIndexTs(name: string): string {
  const pascal = toPascalCase(name);
  const display = toDisplayName(name);
  return `export { ${pascal}Game, ${pascal}Player } from './game.js';
export { Card, Hand, Deck, PlayArea } from './elements.js';
export { createDrawAction, createPlayAction } from './actions.js';
export { createGameFlow } from './flow.js';

import { ${pascal}Game } from './game.js';

export const gameDefinition = {
  gameClass: ${pascal}Game,
  gameType: '${name}',
  displayName: '${display}',
  minPlayers: 2,
  maxPlayers: 4,
} as const;
`;
}

function generateAppVue(name: string): string {
  const display = toDisplayName(name);
  return `<script setup lang="ts">
import { GameShell, AutoUI } from '@boardsmith/ui';
import GameBoard from './components/GameBoard.vue';
<\/script>

<template>
  <GameShell
    game-type="${name}"
    display-name="${display}"
    :player-count="2"
  >
    <template #game-board="{ state, gameView, playerPosition, isMyTurn, availableActions, action, actionArgs, executeAction, setBoardPrompt }">
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
        <span class="stat-label">Cards:</span>
        <span class="stat-value">
          {{
            gameView?.children?.find((c: any) =>
              c.attributes?.$type === 'hand' && c.attributes?.player?.position === player.position
            )?.children?.length || 0
          }}
        </span>
      </div>
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

function generateGameBoardVue(): string {
  return `<script setup lang="ts">
import { computed } from 'vue';

interface Card {
  id: string;
  name: string;
  attributes?: {
    rank?: string;
    suit?: string;
  };
}

// Props from GameShell
// - actionArgs: Shared reactive object with ActionPanel for bidirectional sync
//   Write to it to pre-fill selections, read from it to see ActionPanel selections
const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  action: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  actionArgs: Record<string, unknown>;  // Bidirectional sync with ActionPanel
  executeAction: (name: string) => Promise<void>;
  setBoardPrompt: (prompt: string | null) => void;
}>();

// Computed properties to extract data from gameView
const myHand = computed<Card[]>(() => {
  if (!props.gameView) return [];
  const handElement = props.gameView.children?.find(
    (c: any) => c.attributes?.$type === 'hand' && c.attributes?.player?.position === props.playerPosition
  );
  return handElement?.children?.filter((c: any) => c.attributes?.rank) || [];
});

const deckCount = computed(() => {
  if (!props.gameView) return 0;
  const deck = props.gameView.children?.find((c: any) => c.attributes?.$type === 'deck');
  return deck?.children?.length || deck?.childCount || 0;
});

// Helpers
function getSuitSymbol(suit: string): string {
  const symbols: Record<string, string> = {
    'H': '\\u2665', 'D': '\\u2666', 'C': '\\u2663', 'S': '\\u2660',
    'hearts': '\\u2665', 'diamonds': '\\u2666', 'clubs': '\\u2663', 'spades': '\\u2660',
  };
  return symbols[suit] || suit;
}

function getSuitColor(suit: string): string {
  return suit === 'H' || suit === 'D' || suit === 'hearts' || suit === 'diamonds' ? '#e74c3c' : '#2c3e50';
}

// Actions
async function drawCard() {
  if (!props.isMyTurn || !props.availableActions.includes('draw')) return;
  await props.action('draw', {});
}

async function playCard(card: Card) {
  if (!props.isMyTurn || !props.availableActions.includes('play')) return;
  await props.action('play', { card: card.id });
}
<\/script>

<template>
  <div class="game-board">
    <!-- Deck Area -->
    <div class="deck-area">
      <div
        class="deck"
        :class="{ clickable: isMyTurn && availableActions.includes('draw') }"
        @click="drawCard"
      >
        <span v-if="deckCount > 0">{{ deckCount }} cards</span>
        <span v-else>Empty</span>
      </div>
      <div class="deck-label">Deck</div>
    </div>

    <!-- My Hand -->
    <div class="hand-area">
      <div class="area-header">
        <span class="area-title">Your Hand</span>
        <span class="card-count">{{ myHand.length }} cards</span>
      </div>
      <div class="cards">
        <div
          v-for="card in myHand"
          :key="card.id"
          class="card"
          :class="{ clickable: isMyTurn && availableActions.includes('play') }"
          :style="{ color: getSuitColor(card.attributes?.suit || '') }"
          @click="playCard(card)"
        >
          <span class="rank">{{ card.attributes?.rank }}</span>
          <span class="suit">{{ getSuitSymbol(card.attributes?.suit || '') }}</span>
        </div>
        <div v-if="myHand.length === 0" class="no-cards">No cards in hand</div>
      </div>
    </div>

    <!-- Turn indicator -->
    <div v-if="isMyTurn" class="turn-indicator">
      Your Turn
    </div>
  </div>
</template>

<style scoped>
.game-board {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 30px;
  padding: 20px;
}

.deck-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.deck {
  width: 100px;
  height: 140px;
  background: linear-gradient(135deg, #1a365d 0%, #2c5282 100%);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  box-shadow: 0 4px 6px rgba(0,0,0,0.3);
  transition: transform 0.2s;
}

.deck.clickable {
  cursor: pointer;
}

.deck.clickable:hover {
  transform: translateY(-4px);
}

.deck-label {
  color: #888;
  font-size: 0.9rem;
}

.hand-area {
  background: rgba(255, 255, 255, 0.05);
  padding: 20px;
  border-radius: 12px;
  width: 100%;
  max-width: 600px;
}

.area-header {
  display: flex;
  gap: 20px;
  margin-bottom: 15px;
  align-items: center;
}

.area-title {
  font-weight: bold;
  font-size: 1.1rem;
}

.card-count {
  font-size: 0.9rem;
  color: #aaa;
}

.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.no-cards {
  color: #666;
  font-style: italic;
}

.card {
  width: 60px;
  height: 84px;
  background: #fff;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.card.clickable {
  cursor: pointer;
}

.card.clickable:hover {
  transform: translateY(-8px);
  box-shadow: 0 8px 20px rgba(0, 217, 255, 0.4);
}

.card .rank {
  font-size: 1.5rem;
}

.card .suit {
  font-size: 1.8rem;
}

.turn-indicator {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  padding: 8px 24px;
  border-radius: 20px;
  font-weight: bold;
}
</style>
`;
}

function generateUiIndexTs(): string {
  return `import App from './App.vue';
export { App };
export { default as GameBoard } from './components/GameBoard.vue';
`;
}

function generateTestTs(name: string): string {
  const pascal = toPascalCase(name);
  return `import { describe, it, expect } from 'vitest';
import { ${pascal}Game } from '../src/rules/game.js';

describe('${pascal}Game', () => {
  it('should create a game with correct number of cards', () => {
    const game = new ${pascal}Game({ playerCount: 2, seed: 'test' });
    game.setup();
    expect(game.deck.all().length).toBe(52);
  });

  it('should deal 5 cards to each player', () => {
    const game = new ${pascal}Game({ playerCount: 2, seed: 'test' });
    game.setup();
    game.start();
    for (const player of game.players) {
      expect(player.hand.all().length).toBe(5);
    }
  });
});
`;
}

function generateViteConfig(): string {
  return `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
});
`;
}

function generateIndexHtml(name: string): string {
  const display = toDisplayName(name);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${display}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { height: 100%; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"><\/script>
  </body>
</html>
`;
}

function generateMainTs(): string {
  return `import { createApp } from 'vue';
import { App } from './ui/index.js';

const app = createApp(App);
app.mount('#app');
`;
}
