import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import type { LearnedObjective, TrainingProgress } from '../../bot-trainer/index.js';
import { requireGameProject, resolveRulesDir, requireRulesIndex } from '../lib/game-project.js';
import { makeCommandBuildDir } from '../lib/project-paths.js';
import { getProjectContext, loadGameDefinition } from './game-runtime.js';

interface EvolveBotWeightsOptions {
  generations?: string;
  population?: string;
  mcts?: string;
  workers?: string;
  verbose?: boolean;
}

export async function evolveBotWeightsCommand(options: EvolveBotWeightsOptions): Promise<void> {
  const cwd = process.cwd();

  const configPath = requireGameProject(cwd);

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const gameName = config.displayName || config.name;

  // Where the rules live is `resolveRulesDir`'s to decide, so a project cannot
  // be laid out one way for `dev` and another for weight evolution. Deriving it
  // here also joined an absolute `paths.rules` onto cwd (#239).
  const rulesDir = resolveRulesDir(cwd, config);
  requireRulesIndex(rulesDir);
  const botPath = join(rulesDir, 'bot.ts');

  // Require existing bot.ts
  if (!existsSync(botPath)) {
    console.error(chalk.red('Error: bot.ts not found'));
    console.error(chalk.dim(`Expected at: ${botPath}`));
    console.error();
    console.error(chalk.yellow('This command optimizes weights for an existing bot.'));
    console.error(chalk.yellow('To create a new bot, use the /bs-build-bot skill in Claude Code:'));
    console.error(chalk.dim('  boardsmith claude install'));
    console.error(chalk.dim('  Then in Claude Code: /bs-build-bot'));
    process.exit(1);
  }

  console.log(chalk.cyan(`\nOptimizing bot weights for ${gameName}...\n`));

  const { workerCount, generations, population, mctsIterations } = evolutionSettings(options);

  console.log(chalk.dim(`  bot file: ${botPath}`));
  console.log(chalk.dim(`  Generations: ${generations}`));
  console.log(chalk.dim(`  Population: ${population}`));
  console.log(chalk.dim(`  MCTS iterations: ${mctsIterations}`));
  console.log(chalk.cyan(`  Workers: ${workerCount}`));
  console.log();

  const spinner = ora('Bundling the game rules...').start();

  // This run's own build directory (#543), removed below; never `.boardsmith/`
  // itself (#391). The rules are bundled from source here rather than read from
  // some earlier build, so the weights are tuned against the rules as they are
  // now (#399). The bundle stays until the evolution ends: the worker threads
  // load the game from it.
  const tempDir = makeCommandBuildDir(cwd, 'evolve-bot-weights');

  try {
    const { gameDefinition, bundlePath: modulePath } = await loadGameDefinition(
      rulesDir,
      tempDir,
      getProjectContext(cwd),
    );

    const GameClass = gameDefinition.gameClass;
    const gameType = gameDefinition.gameType || config.name;

    spinner.succeed('Game rules bundled');

    // Import trainer
    spinner.start('Initializing weight optimizer...');

    const trainerModule = await import('../../bot-trainer/index.js');
    const { WeightEvolver, updateBotWeights } = trainerModule;

    spinner.succeed('Weight optimizer initialized');

    // Parse existing bot
    spinner.start('Parsing existing bot.ts...');
    const { parseExistingBot, parsedToLearned } = trainerModule;
    const existingBot = parseExistingBot(botPath);

    if (!existingBot || existingBot.objectives.length === 0) {
      throw new Error(
        `${botPath} has no objectives to optimize. Use /bs-build-bot to create a bot with objectives first.`,
      );
    }

    const existingObjectives = parsedToLearned(existingBot.objectives);
    spinner.succeed(`Found ${existingObjectives.length} objectives to optimize`);

    if (options.verbose) printExistingObjectives(existingObjectives);

    // Run evolution
    spinner.start(`Evolving weights (${generations} generations x ${population} population)...`);
    const startTime = Date.now();

    const evolver = new WeightEvolver(GameClass, gameType, modulePath, {
      workerCount,
      evolutionGenerations: generations,
      evolutionLambda: population,
      benchmarkMCTSIterations: mctsIterations,
      seed: `evolve-${Date.now()}`,
      onProgress: (progress: TrainingProgress) => {
        spinner.text = chalk.cyan(progress.message);
      },
    });

    const result = await evolver.evolve(existingObjectives);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    spinner.succeed(`Evolution complete in ${duration}s`);

    printEvolutionResult(result);

    // Update the bot.ts file with new weights
    spinner.start('Updating bot.ts with optimized weights...');

    const originalCode = readFileSync(botPath, 'utf-8');
    const updatedCode = updateBotWeights(originalCode, result.objectives, {
      addMetadata: true,
      evolutionStats: {
        generations,
        population,
        initialWinRate: result.initialFitness,
        finalWinRate: result.bestFitness,
      },
    });

    writeFileSync(botPath, updatedCode, 'utf-8');
    spinner.succeed(`Updated ${botPath}`);

    printNextSteps();
  } catch (error) {
    spinner.fail('Weight evolution failed');
    // THROWN, NOT PRINTED (#240): `cli.ts`'s handler renders one clean line.
    // `--verbose` used to add the stack on top of the printed error object, and
    // it is gone rather than kept behind a flag: CLAUDE.md's rule that a stack
    // trace never reaches a user has no opt-out, and a flag that turns the
    // forbidden output back on is the rule with a hole in it.
    throw new Error(
      `Evolving this bot's weights failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/** The run's settings, from the flags or their defaults. */
function evolutionSettings(options: EvolveBotWeightsOptions) {
  return {
    workerCount: options.workers ? parseInt(options.workers, 10) : Math.max(1, cpus().length - 1),
    generations: options.generations ? parseInt(options.generations, 10) : 5,
    population: options.population ? parseInt(options.population, 10) : 20,
    mctsIterations: options.mcts ? parseInt(options.mcts, 10) : 100,
  };
}

/** `--verbose`: the first few objectives the evolution starts from. */
function printExistingObjectives(objectives: readonly LearnedObjective[]): void {
  console.log(chalk.dim('\nExisting objectives:'));
  for (const obj of objectives.slice(0, 5)) {
    console.log(chalk.dim(`  ${obj.featureId}: weight=${obj.weight.toFixed(1)}`));
  }
  if (objectives.length > 5) {
    console.log(chalk.dim(`  ... and ${objectives.length - 5} more`));
  }
}

function printEvolutionResult(result: {
  initialFitness: number;
  bestFitness: number;
  objectives: readonly LearnedObjective[];
}): void {
  console.log(chalk.green('\n=== Evolution Results ===\n'));
  console.log(`  Initial win rate: ${(result.initialFitness * 100).toFixed(1)}%`);
  console.log(`  Final win rate: ${(result.bestFitness * 100).toFixed(1)}%`);
  console.log(`  Improvement: ${((result.bestFitness - result.initialFitness) * 100).toFixed(1)}%`);

  if (result.objectives.length > 0) {
    console.log(chalk.cyan('\nOptimized weights:'));
    for (const obj of result.objectives.slice(0, 5)) {
      const sign = obj.weight > 0 ? '+' : '';
      console.log(chalk.dim(`  ${obj.featureId}: ${sign}${obj.weight.toFixed(1)}`));
    }
  }
}

function printNextSteps(): void {
  console.log(chalk.green('\n=== Done ===\n'));
  console.log(chalk.dim('The bot.ts file has been updated with optimized weights.'));
  console.log(chalk.dim('All code structure (checker functions, imports) is preserved.\n'));

  console.log(chalk.cyan('Next steps:'));
  console.log(chalk.dim('  1. Review the weight changes in bot.ts'));
  console.log(chalk.dim('  2. Test with: boardsmith dev --bot 1'));
  console.log(chalk.dim('  3. Run again with more generations for further optimization\n'));
}
