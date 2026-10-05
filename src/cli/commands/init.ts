import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  generateScaffoldFiles,
  getRequiredDirectories,
  getDependencyPaths,
  toPascalCase,
  toDisplayName,
  type GeneratedFile,
  type ProjectConfig,
  generateSmokeSpecTs,
} from '../lib/project-scaffold.js';
import {
  generateWorldA11yTestTs,
  generateWorldBoardVue,
  generateWorldElementsTs,
  generateWorldGameTs,
  generateWorldUisTs,
  generateWorldReadme,
  generateWorldRulesIndexTs,
  generateWorldTestTs,
  generateWorldTs,
  worldScaffoldStatus,
} from '../lib/world-scaffold.js';
import { worldEntryFiles } from '../lib/world-entry.js';
import { SMOKE_SPEC_PATH } from '../../testing/browser-smoke-verdict.js';
import { ingestArchiveCommand, rulebookArchivePaths } from './ingest-archive.js';
import { installIngestHook } from '../lib/ingest-hook.js';
import { assertGameName } from '../lib/user-name.js';
import { gitOutput } from '../lib/git-output.js';

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
   * (`init`, the compile gate, serve-check + kill) execute correctly in every run — and the
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
   * Further documents the rules incorporate (`--additional-source`, repeatable), archived beside
   * the rulebook and recorded with their own hashes. Passed straight to `ingest-archive`; needs
   * `rulebook`, since an additional source is additional to a primary one.
   */
  additionalSource?: string[];
  /**
   * Explicit "there is no rulebook" acknowledgement. Required when `rulebook` is absent, so a
   * missing archive is always a deliberate choice rather than an omission nobody noticed.
   */
  withoutRulebook?: boolean;
  /**
   * Scaffold a PERSISTENT WORLD rather than a table game.
   *
   * A FLAG AND NOT A PROMPT, for the same reason `--rulebook` is one: almost
   * nothing that runs `boardsmith init` is a person at a terminal. The bs-
   * skills invoke it from a subagent, CI invokes it with no TTY, and a prompt
   * in either place either hangs or needs a silent default -- which is a
   * fallback, and a fallback here decides the shape of somebody's whole game.
   * A flag is also the only form of the decision that survives: it is in the
   * shell history and in the README the scaffold writes, where a prompt's
   * answer is gone the moment the terminal scrolls.
   *
   * It is not the same kind of decision as `--rulebook`, which is REQUIRED
   * because omitting it was silently wrong -- the archive was simply missing
   * and nobody found out until a later verify pass. Omitting `--world` is
   * loudly wrong instead: you get a card game, and you can see that you did.
   * So it takes a default, and the default is the game most people are making.
   *
   * A world is what a game IS, so the flag writes the `world` block into
   * `boardsmith.json` and is never needed again -- the block is the single
   * declaration every later command reads.
   */
  world?: boolean;
  /**
   * Scaffold into the git repository `init` is run from instead of creating `<name>/`.
   *
   * A game often starts as a repository of design research, with history and a remote, before
   * anyone runs BoardSmith (#304). Copying a scaffold in by hand drops what `init` does to
   * `.git`, most importantly the ingest `pre-commit` hook. So this mode writes the same files,
   * archive and hook a fresh `init` does, and never touches the designer's own work: it refuses
   * to run anywhere but the top folder of a git repository, refuses to overwrite any file
   * (naming every one), and leaves `git init` and the scaffold commit out, because the
   * repository and its history already exist.
   */
  intoExisting?: boolean;
}

/**
 * THE TWO KINDS OF PROJECT `boardsmith init` CAN CREATE.
 *
 * A table game and a persistent world differ in three places and nowhere else:
 * the manifest they declare, the sources they write, and the first command an
 * author is honestly sent to. Threading a `world` boolean through `initCommand`
 * put those three decisions in three different paragraphs of one function, so
 * "what is a world project" could only be answered by reading the whole thing —
 * and a fourth difference would have been a fourth place to remember.
 */
interface ProjectScaffold {
  /** The `boardsmith.json` this kind of project declares. */
  config(name: string): ProjectConfig;
  /** The rules, tests and UI that make it that kind of project. */
  sources(config: ProjectConfig): GeneratedFile[];
  /** What to run next, which is not the same command for both. `firstSteps` opens the list. */
  printNextSteps(firstSteps: string[]): void;
}

const TABLE_SCAFFOLD: ProjectScaffold = {
  config: (name) => ({
    name,
    backend: 'table',
    displayName: toDisplayName(name),
    description: 'A fun game for 2-4 players',
    playerCount: { min: 2, max: 4 },
    audience: 'casual',
    tags: ['card-game'],
  }),

  sources: (config) => {
    const pascal = toPascalCase(config.name);
    return [
      { path: join('src', 'rules', 'game.ts'), content: generateGameTs(pascal) },
      { path: join('src', 'rules', 'elements.ts'), content: generateElementsTs() },
      { path: join('src', 'rules', 'actions.ts'), content: generateActionsTs(pascal) },
      { path: join('src', 'rules', 'flow.ts'), content: generateFlowTs(pascal) },
      { path: join('tests', 'game.test.ts'), content: generateTestTs(pascal) },
      { path: SMOKE_SPEC_PATH, content: generateSmokeSpecTs(['draw', 'play']) },
    ];
  },

  printNextSteps: (firstSteps) => {
    console.log(`
${chalk.cyan('Next steps:')}

${firstSteps.map((step) => `  ${step}`).join('\n')}
  boardsmith dev

${chalk.dim('This will start the development server and open player tabs in your browser.')}

${chalk.cyan('Everything else runs through the same CLI:')}

  ${chalk.dim('boardsmith test')}      ${chalk.dim("- run your game's tests")}
  ${chalk.dim('boardsmith lint')}      ${chalk.dim('- check for BoardSmith pitfalls')}
  ${chalk.dim('boardsmith build')}     ${chalk.dim('- build the publishable bundle')}
  ${chalk.dim('boardsmith validate')}  ${chalk.dim('- run pre-publish checks')}
  ${chalk.dim('boardsmith --help')}    ${chalk.dim('- see every command')}
`);
  },
};

const WORLD_SCAFFOLD: ProjectScaffold = {
  config: (name) => ({
    name,
    backend: 'world',
    displayName: toDisplayName(name),
    description: 'A persistent world: a place that keeps going while nobody is looking.',
    // NO `playerCount`: a world has no table roster. Its seats are a lifetime
    // count declared in the compiled rules (#171 / ShufflewickPub #354).
    audience: 'casual',
    tags: ['persistent-world'],
  }),

  sources: (config) => {
    // A world has no actions and no flow: its verbs are a command table and
    // its clock is a schedule, so there is nothing for either file to hold.
    const pascal = toPascalCase(config.name);
    return [
      { path: join('src', 'rules', 'game.ts'), content: generateWorldGameTs(pascal) },
      { path: join('src', 'rules', 'elements.ts'), content: generateWorldElementsTs() },
      { path: join('src', 'rules', 'world.ts'), content: generateWorldTs(pascal) },
      { path: join('src', 'rules', 'index.ts'), content: generateWorldRulesIndexTs(config) },
      { path: join('tests', 'world.test.ts'), content: generateWorldTestTs() },
      { path: join('tests', 'a11y.example.test.ts'), content: generateWorldA11yTestTs() },
      { path: SMOKE_SPEC_PATH, content: generateSmokeSpecTs(['tend']) },
      // The world entry is the SAME pair `boardsmith build` and `boardsmith dev`
      // write for a world project that has none (#170), from the same generator:
      // one definition of what a world's entry is, so a scaffolded project and a
      // rescued one are the same project.
      ...worldEntryFiles(String(config.displayName || config.name)),
      { path: join('src', 'ui', 'uis.ts'), content: generateWorldUisTs() },
      { path: join('src', 'ui', 'components', 'WorldBoard.vue'), content: generateWorldBoardVue() },
      { path: 'README.md', content: generateWorldReadme(config) },
    ];
  },

  // THE FIRST COMMAND IS THE ONE THAT OPENS THE WORLD. Until #167 it could not
  // be: `boardsmith dev` served the table half and a world project has none, so
  // an author was sent to `boardsmith test` instead. The status below lists
  // both, and the README the scaffold wrote keeps listing them after this
  // scrolls away.
  printNextSteps: (firstSteps) => {
    console.log(`
${chalk.cyan('Next steps:')}

${firstSteps.map((step) => `  ${step}`).join('\n')}
  boardsmith dev

${worldScaffoldStatus()
  .map((line) => chalk.dim(line))
  .join('\n')}

  ${chalk.dim('boardsmith --help')}    ${chalk.dim('- see every command')}
`);
  },
};

/**
 * Give a new project directory a git repo and an initial commit.
 *
 * The `/bs-build-chunk` skill's Git Protocol commits at every step
 * (chunk-<slug>/step-<name>) — without a repo here, the very first commit that
 * protocol calls for fails outright (Phase 149 dry-run Finding 1). Every
 * failure is non-fatal and reported: scaffolding must not fail because git
 * setup did (no git on PATH, or the project dir is nested in a repo the user
 * manages themselves).
 *
 * Init/staging is split from the commit so the skip message names the actual
 * failure point (WR-03). If `git init`/`git add` fail, the remedy is "run git
 * init manually". If only the commit fails (the common "no git identity
 * configured" case), the repo already exists and staging succeeded — telling
 * the user to run `git init` again would be misleading.
 */
async function initVersionControl(projectPath: string): Promise<void> {
  try {
    await gitOutput(projectPath, ['init']);
    await gitOutput(projectPath, ['add', '-A']);
  } catch {
    console.log(
      chalk.dim('  (skipped git init — git not available; run `git init` manually if you want version control)')
    );
    return;
  }

  try {
    await gitOutput(projectPath, ['commit', '-m', 'chore: scaffold project via boardsmith init']);
  } catch {
    console.log(
      chalk.dim('  (git repo created but initial commit skipped — set `git config user.name` / `user.email`, then run `git commit`)')
    );
  }
}

/**
 * Install the ingest synthesis `pre-commit` hook, for a fresh project and an existing
 * repository alike, and say so whenever it was not installed.
 *
 * It runs on every commit after this one, including the ones the bs- build protocol makes during
 * chunk work, and is what sweeps `## Open Rules Gaps` once transcription has produced slices.
 */
async function installHookAndReport(projectPath: string): Promise<void> {
  const result = await installIngestHook(projectPath);
  if (result === 'skipped-existing') {
    console.log(
      chalk.dim('  (left your existing .git/hooks/pre-commit alone — run `boardsmith ingest-gaps` manually after transcription)'),
    );
  } else if (result === 'skipped-no-git') {
    console.log(
      chalk.yellow('  Could not install the ingest pre-commit hook into .git/hooks — run `boardsmith ingest-gaps` manually after transcription.'),
    );
  }
}

/**
 * `--into-existing` scaffolds into the repository it is run from, so that folder must BE the top
 * of a git repository: the hook is installed into its `.git/hooks`, and the hook reads
 * `design/rulebook/` relative to the folder git runs it from, which is the top folder.
 */
function assertGitTopFolder(projectPath: string): void {
  if (statSync(join(projectPath, '.git'), { throwIfNoEntry: false })?.isDirectory() === true) return;
  throw new Error(
    '--into-existing scaffolds into the git repository you run it from, and this folder is ' +
      'not the top folder of a git repository (it has no .git folder).\n' +
      "Run init from the repository's top folder, or run `git init` here first.",
  );
}

/**
 * Refuse, before anything is written, when any file the scaffold would write already exists.
 * Every conflict is named at once, so one pass of moving files is enough.
 */
function refuseConflicts(projectPath: string, name: string, paths: string[]): void {
  const conflicts = paths.filter((path) => existsSync(path)).map((path) => relative(projectPath, path));
  if (conflicts.length === 0) return;
  throw new Error(
    `Scaffolding "${name}" would overwrite files that already exist here, so nothing was changed:\n` +
      conflicts.map((path) => `  ${path}`).join('\n') +
      '\nMove or rename them, run init again, then merge anything you still need back in.',
  );
}

export async function initCommand(name: string, options: InitOptions = {}): Promise<void> {
  // BEFORE ANYTHING IS CREATED, and before `name` is interpolated into the
  // messages below. `<name>` is this project's directory AND its package name
  // AND its identifier in boardsmith.json AND the prefix of every generated
  // class, and `assertGameName` is the one place that decides what can be all
  // four (#240).
  assertGameName(name);

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
    throw new Error(
      'init requires an explicit rulebook decision.\n' +
        '\nPass one of:\n' +
        `  --rulebook <path>   archive that source rulebook into ${name}/ and write\n` +
        '                      rulebook/INDEX.md provenance (edition via --edition)\n' +
        '  --without-rulebook  no rulebook exists; the structured interview will supply\n' +
        '                      the rulebook/ content instead\n' +
        '\nExample:\n' +
        `  boardsmith init ${name} --rulebook ~/path/to/rules.pdf`,
    );
  }

  if (options.additionalSource?.length && !options.rulebook) {
    throw new Error(
      '--additional-source needs --rulebook: it records a document alongside the primary rulebook.\n' +
        `Pass the rulebook too, e.g. boardsmith init ${name} --rulebook ~/path/to/rules.md --additional-source ~/path/to/reference.md`,
    );
  }

  const scaffold: ProjectScaffold = options.world ? WORLD_SCAFFOLD : TABLE_SCAFFOLD;
  const projectPath = options.intoExisting ? process.cwd() : join(process.cwd(), name);

  if (options.intoExisting) {
    assertGitTopFolder(projectPath);
  } else if (existsSync(projectPath)) {
    throw new Error(
      `Directory "${name}" already exists in the directory you ran init from.\n` +
        'Pass a different name, remove that directory first, or run init from inside it with ' +
        '--into-existing if it is a git repository the game should live in.',
    );
  }

  // EVERYTHING THIS RUN WILL WRITE, decided before anything is. That is what lets
  // `--into-existing` refuse a conflict with nothing changed, rather than discovering it
  // halfway through someone's repository.
  const config = scaffold.config(name);
  const files = [...generateScaffoldFiles(config, projectPath), ...scaffold.sources(config)];
  const archive = options.rulebook
    ? {
        rulebook: options.rulebook,
        ...rulebookArchivePaths(projectPath, options.rulebook, options.additionalSource),
      }
    : undefined;
  if (options.intoExisting) {
    refuseConflicts(projectPath, name, [
      ...files.map((file) => join(projectPath, file.path)),
      ...(archive ? [...archive.archivePaths, archive.indexPath] : []),
    ]);
  }

  const spinner = ora(`Creating ${name}...`).start();

  // Every path this run created, which is exactly what the cleanup below may remove (#242). A
  // directory counts only when this run's `mkdir` created it, and a file only once it was checked
  // absent: the directory a fresh init is refused on, and every file `--into-existing` found
  // there, stay the user's. `mkdir` reports the topmost directory it created, the same
  // distinction `packAll` draws (#239).
  const created: string[] = [];
  const makeDir = async (dir: string): Promise<void> => {
    const first = await mkdir(dir, { recursive: true });
    if (first !== undefined) created.push(first);
  };

  try {
    await makeDir(projectPath);
    for (const dir of getRequiredDirectories()) {
      await makeDir(join(projectPath, dir));
    }

    // The manifest down, then the files that are the whole difference between the two kinds of
    // project.
    for (const file of files) {
      const path = join(projectPath, file.path);
      await makeDir(dirname(path));
      created.push(path);
      await writeFile(path, file.content);
    }

    // Log if using local dev
    const deps = getDependencyPaths(projectPath);
    if (deps.isLocalDev) {
      console.log(chalk.dim(`  Using local BoardSmith from monorepo`));
    }

    // An existing repository already has its history, so it gets no `git init` and no scaffold
    // commit: the designer reviews the scaffold beside their own work and commits it.
    if (!options.intoExisting) await initVersionControl(projectPath);

    if (archive) {
      // Archive inside init so it cannot be a step the session skips. A failure here is loud:
      // a scaffolded project whose provenance header describes an archive that does not exist
      // is worse than a failed init, because the gap only surfaces at a later verify pass.
      //
      // The spinner stops first because the archive prints a report of its own,
      // and it is not succeeded until AFTER the archive: the success line used
      // to be printed here and was immediately followed by `Failed to create
      // project` on an unreadable rulebook (#242). A command that says both is
      // worse than one that says neither.
      spinner.stop();
      await makeDir(dirname(archive.archivePaths[0]));
      created.push(...archive.archivePaths, archive.indexPath);
      await ingestArchiveCommand(archive.rulebook, {
        project: projectPath,
        edition: options.edition,
        additionalSource: options.additionalSource,
        gameName: name,
      });
    }

    // Last, so a failed init never leaves a hook behind in a repository it did not create.
    await installHookAndReport(projectPath);

    spinner.succeed(chalk.green(`Created ${name} successfully!`));

    if (options.intoExisting) {
      console.log(chalk.dim('  The scaffold is not committed: review it beside your own files, then commit it.'));
    }
    scaffold.printNextSteps(options.intoExisting ? ['npm install'] : [`cd ${name}`, 'npm install']);
  } catch (error) {
    // THROWN, NOT PRINTED (#240). `console.error(error)` here printed the whole
    // Error object -- stack frames, `src/cli/commands/init.ts:290:5`, the
    // absolute path of the CLI's own installation -- which CLAUDE.md forbids
    // outright, and then exited before `cli.ts`'s top-level handler could
    // render it as the one clean line every other command's failures get.
    spinner.fail(chalk.red('Failed to create project'));

    // A half-scaffolded project is worse than no project (#242). The archive is
    // the last step, so an unreadable `--rulebook` left a complete tree whose
    // `rulebook/INDEX.md` provenance describes an archive that does not exist,
    // and that gap only surfaces at a later verify pass. It is also exactly the
    // shape the `existsSync` refusal above rejects, so the retry the user
    // reaches for failed on a second, different error. Only what this run
    // created is removed.
    for (const path of created.reverse()) rmSync(path, { recursive: true, force: true });

    throw new Error(
      `Could not create the project "${name}": ${error instanceof Error ? error.message : String(error)}`,
    );
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
      // The same seat acts again right after drawing. 'continue' says this is
      // still that seat's turn, so undo can reach back over the draw too.
      turnScope: 'continue',
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
