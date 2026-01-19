import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  generateScaffoldFiles,
  getRequiredDirectories,
  getDependencyPaths,
  toPascalCase,
  toDisplayName,
  type ProjectConfig,
} from '../lib/project-scaffold.js';

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
    // Create directory structure
    await mkdir(projectPath);
    for (const dir of getRequiredDirectories()) {
      await mkdir(join(projectPath, dir), { recursive: true });
    }

    // Create project config
    const config: ProjectConfig = {
      name,
      displayName: toDisplayName(name),
      description: 'A fun game for 2-4 players',
      playerCount: { min: 2, max: 4 },
      categories: ['card-game'],
    };

    // Generate scaffold files
    const scaffoldFiles = generateScaffoldFiles(config);
    for (const file of scaffoldFiles) {
      await writeFile(join(projectPath, file.path), file.content);
    }

    // Generate game-specific files
    const pascal = toPascalCase(name);
    await writeFile(join(projectPath, 'src', 'rules', 'game.ts'), generateGameTs(pascal));
    await writeFile(join(projectPath, 'src', 'rules', 'elements.ts'), generateElementsTs());
    await writeFile(join(projectPath, 'src', 'rules', 'actions.ts'), generateActionsTs(pascal));
    await writeFile(join(projectPath, 'src', 'rules', 'flow.ts'), generateFlowTs(pascal));
    await writeFile(join(projectPath, 'tests', 'game.test.ts'), generateTestTs(pascal));

    // Log if using local dev
    const deps = getDependencyPaths();
    if (deps.isLocalDev) {
      console.log(chalk.dim(`  Using local BoardSmith from monorepo`));
    }

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

function generateGameTs(pascal: string): string {
  return `import { Game, Player, type GameOptions } from 'boardsmith';
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
  return `import { Card as BaseCard, Hand as BaseHand, Deck as BaseDeck, Space } from 'boardsmith';

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

function generateActionsTs(pascal: string): string {
  return `import { Action, type ActionDefinition } from 'boardsmith';
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

function generateFlowTs(pascal: string): string {
  return `import {
  loop,
  eachPlayer,
  actionStep,
  sequence,
  type FlowDefinition,
} from 'boardsmith';
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

function generateTestTs(pascal: string): string {
  return `import { describe, it, expect } from 'vitest';
import { ${pascal}Game, ${pascal}Player } from '../src/rules/game.js';

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
    for (const player of game.all(${pascal}Player)) {
      expect(player.hand.all().length).toBe(5);
    }
  });
});
`;
}
