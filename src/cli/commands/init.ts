import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
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
import { ingestArchiveCommand } from './ingest-archive.js';

export interface InitOptions {
  /**
   * Path to a source rulebook. When given, `init` archives it into the new project and writes
   * `rulebook/INDEX.md`'s provenance header before returning.
   *
   * WHY THIS IS A FLAG ON `init` RATHER THAN A SEPARATE STEP
   *
   * Eleven mechanisms were tried to get an ingest session to archive the source. Ten lived in
   * skill text at various points in the flow and none ever executed across ten measured live
   * runs. The eleventh added it as item 4 of the Step 1 verification sequence, whose items 1-3
   * (`init`, `tsc --noEmit`, serve-check + kill) execute correctly in every run — and the
   * session performed items 1-3 and skipped the newly added item 4, from a file it had just
   * read. The model's prior for "the scaffold sequence is three steps" overrode the file.
   *
   * What no run ever skips is `boardsmith init <name>` itself, because it needs the command to
   * create the directory. So the archive rides on the command already being invoked instead of
   * asking the session to invoke another one.
   */
  rulebook?: string;
  /** Edition string as stated in the rulebook, passed through to the provenance header. */
  edition?: string;
  /**
   * Explicit "there is no rulebook" acknowledgement. Required when `rulebook` is absent, so a
   * missing archive is always a deliberate choice rather than an omission nobody noticed.
   */
  withoutRulebook?: boolean;
}

export async function initCommand(name: string, options: InitOptions = {}): Promise<void> {
  // REQUIRE an explicit rulebook decision. This is the twelfth mechanism tried for the ingest
  // archive and the first that does not depend on the session reading anything.
  //
  // The eleventh added `--rulebook` to the `init` line in scaffold.md. A live session read that
  // file (it needs `<name>` from it) and ran `npx boardsmith init seven` — the flag absent. The
  // model reproduces these mechanics from its prior at every granularity: steps, subagent
  // prompts, and command lines. Documentation cannot win that.
  //
  // What it does reliably is fix failing commands — the traces show it iterating on `tsc`
  // errors until clean. So an omitted decision is now a hard failure with an actionable
  // message, not a silently missing archive discovered at a later verify pass.
  // Note: the flag is `--without-rulebook`, not `--no-rulebook`. Commander treats `--no-X` as a
  // negation of `--X`, so `--no-rulebook` would set `rulebook: false` and collide with
  // `--rulebook <path>` rather than producing its own field.
  if (!options.rulebook && !options.withoutRulebook) {
    console.error(
      chalk.red('Error: init requires an explicit rulebook decision.\n') +
        '\nPass one of:\n' +
        `  --rulebook <path>   archive that source rulebook into ${name}/ and write\n` +
        '                      rulebook/INDEX.md provenance (edition via --edition)\n' +
        '  --without-rulebook  no rulebook exists; the structured interview will supply\n' +
        '                      the rulebook/ content instead\n' +
        '\nExample:\n' +
        `  npx boardsmith init ${name} --rulebook ~/path/to/rules.pdf\n`,
    );
    process.exit(1);
  }

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
      audience: 'casual',
      tags: ['card-game'],
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

    // Initialize a git repository with an initial commit. The `/bs-build-chunk`
    // skill's Git Protocol commits at every step (chunk-<slug>/step-<name>) —
    // without this, a freshly scaffolded project has no git repo at all and
    // the very first commit that protocol calls for fails outright (Phase 149
    // dry-run Finding 1). Non-fatal on failure (e.g. no git on PATH, or the
    // project dir is already nested in a repo the user manages themselves) —
    // scaffolding must not fail because git setup did.
    // Split init/staging from the commit so the skip message names the actual
    // failure point (WR-03). If `git init`/`git add` fail (no git on PATH), the
    // remedy is "run git init manually". If only the commit fails (the common
    // "no git identity configured" case), the repo already exists and staging
    // succeeded — telling the user to run `git init` again would be misleading;
    // they need to set their git identity and commit.
    let gitRepoInitialized = false;
    try {
      execSync('git init', { cwd: projectPath, stdio: 'ignore' });
      execSync('git add -A', { cwd: projectPath, stdio: 'ignore' });
      gitRepoInitialized = true;
    } catch {
      console.log(
        chalk.dim('  (skipped git init — git not available; run `git init` manually if you want version control)')
      );
    }
    if (gitRepoInitialized) {
      try {
        execSync('git commit -m "chore: scaffold project via boardsmith init"', {
          cwd: projectPath,
          stdio: 'ignore',
        });
      } catch {
        console.log(
          chalk.dim('  (git repo created but initial commit skipped — set `git config user.name` / `user.email`, then run `git commit`)')
        );
      }
    }

    spinner.succeed(chalk.green(`Created ${name} successfully!`));

    if (options.rulebook) {
      // Archive inside init so it cannot be a step the session skips. A failure here is loud:
      // a scaffolded project whose provenance header describes an archive that does not exist
      // is worse than a failed init, because the gap only surfaces at a later verify pass.
      await ingestArchiveCommand(options.rulebook, {
        project: projectPath,
        edition: options.edition,
      });
    }

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

export function generateGameTs(pascal: string): string {
  return `import { Game, Player, type GameOptions } from 'boardsmith';
import { Card, Hand, Deck } from './elements.js';
import { createGameFlow } from './flow.js';
import { createDrawAction, createPlayAction } from './actions.js';

export interface ${pascal}Options extends GameOptions {
  seed?: string;
}

// Declared before ${pascal}Game so the static PlayerClass initializer below can
// reference it (classes are not hoisted).
export class ${pascal}Player extends Player<${pascal}Game, ${pascal}Player> {
  hand!: Hand;
  score: number = 0;
  // The player's hand is created by the game after registerElements
  // (see ${pascal}Game constructor) and assigned to this.hand there.
}

export class ${pascal}Game extends Game<${pascal}Game, ${pascal}Player> {
  // Tells the engine to construct each player as a ${pascal}Player. The engine
  // pre-creates players from options.playerCount during super().
  static PlayerClass = ${pascal}Player;

  deck!: Deck;

  constructor(options: ${pascal}Options) {
    super(options);

    // Register element classes
    this.registerElements([Card, Hand, Deck]);

    // Create each player's hand. The engine pre-creates players from
    // options.playerCount during super(), so this.players is already populated.
    // Hands must be created here (after registerElements), not in the Player
    // constructor — a Player is constructed before the game body runs
    // registerElements, so creating a Hand there leaves it unregistered and
    // unfindable by getPlayerHand().
    for (const player of this.players) {
      const hand = this.create(Hand, \`hand-\${player.seat}\`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      player.hand = hand;
    }

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

  getPlayerHand(player: ${pascal}Player): Hand {
    return this.first(Hand, \`hand-\${player.seat}\`)!;
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
`;
}

export function generateElementsTs(): string {
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

export function generateActionsTs(pascal: string): string {
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
    .chooseFrom('card', {
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

export function generateFlowTs(pascal: string): string {
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
      skipIf: () => game.deck.count(Card) === 0,
    }),
    actionStep({
      name: 'play-step',
      actions: ['play'],
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

export function generateTestTs(pascal: string): string {
  return `import { describe, it, expect } from 'vitest';
import { ${pascal}Game } from '../src/rules/game.js';
import { Card } from '../src/rules/elements.js';

// The game builds the deck and deals opening hands in its constructor, so these
// invariants hold immediately after construction — no setup()/start() needed.
describe('${pascal}Game', () => {
  it('builds a full 52-card deck', () => {
    const game = new ${pascal}Game({ playerCount: 2, seed: 'test' });
    // all(Card) counts cards everywhere — deck plus dealt hands.
    expect(game.all(Card).length).toBe(52);
  });

  it('deals 5 cards to each player and leaves the rest in the deck', () => {
    const game = new ${pascal}Game({ playerCount: 2, seed: 'test' });
    expect(game.players.length).toBe(2);
    for (const player of game.players) {
      expect(player.hand.all(Card).length).toBe(5);
    }
    expect(game.deck.all(Card).length).toBe(52 - game.players.length * 5);
  });
});
`;
}
