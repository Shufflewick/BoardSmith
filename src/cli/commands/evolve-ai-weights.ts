import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import type { TrainingProgress } from '../../ai-trainer/index.js';

interface EvolveAIWeightsOptions {
  generations?: string;
  population?: string;
  mcts?: string;
  workers?: string;
  verbose?: boolean;
}

export async function evolveAIWeightsCommand(options: EvolveAIWeightsOptions): Promise<void> {
  const cwd = process.cwd();

  // Validate project
  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const gameName = config.displayName || config.name;

  // Use paths.rules from config, fallback to src/rules for backwards compatibility
  const rulesPath = config.paths?.rules || 'src/rules';
  const aiPath = join(cwd, rulesPath, 'ai.ts');

  // Require existing ai.ts
  if (!existsSync(aiPath)) {
    console.error(chalk.red('Error: ai.ts not found'));
    console.error(chalk.dim(`Expected at: ${aiPath}`));
    console.error();
    console.error(chalk.yellow('This command optimizes weights for an existing AI.'));
    console.error(chalk.yellow('To create a new AI, use the /generate-ai slash command in Claude Code:'));
    console.error(chalk.dim('  boardsmith claude install'));
    console.error(chalk.dim('  Then in Claude Code: /generate-ai'));
    process.exit(1);
  }

  console.log(chalk.cyan(`\nOptimizing AI weights for ${gameName}...\n`));

  // Parse options
  const workerCount = options.workers ? parseInt(options.workers, 10) : Math.max(1, cpus().length - 1);
  const generations = options.generations ? parseInt(options.generations, 10) : 5;
  const population = options.population ? parseInt(options.population, 10) : 20;
  const mctsIterations = options.mcts ? parseInt(options.mcts, 10) : 100;

  console.log(chalk.dim(`  AI file: ${aiPath}`));
  console.log(chalk.dim(`  Generations: ${generations}`));
  console.log(chalk.dim(`  Population: ${population}`));
  console.log(chalk.dim(`  MCTS iterations: ${mctsIterations}`));
  console.log(chalk.cyan(`  Workers: ${workerCount}`));
  console.log();

  const spinner = ora('Loading game module...').start();

  try {
    // Dynamic import of the game module
    // Look for built rules in order of preference:
    // 1. rules/dist/index.js (from pnpm build in rules package)
    // 2. .boardsmith/rules-bundle.mjs (from boardsmith dev)
    // 3. dist/rules/rules.js (from boardsmith build)
    const rulesPkgDist = join(cwd, 'rules', 'dist', 'index.js');
    const devBundle = join(cwd, '.boardsmith', 'rules-bundle.mjs');
    const buildDist = join(cwd, 'dist', 'rules', 'rules.js');

    let modulePath: string | undefined;
    if (existsSync(rulesPkgDist)) {
      modulePath = rulesPkgDist;
    } else if (existsSync(devBundle)) {
      modulePath = devBundle;
    } else if (existsSync(buildDist)) {
      modulePath = buildDist;
    }

    if (!modulePath) {
      spinner.fail('Game rules not found');
      console.error(chalk.red('\nNo compiled rules found. Run one of:'));
      console.error(chalk.dim('  pnpm --filter <rules-package> build'));
      console.error(chalk.dim('  npx boardsmith build'));
      process.exit(1);
    }

    // Import the game module
    const gameModule = await import(`file://${modulePath}`);
    const { gameDefinition } = gameModule;

    if (!gameDefinition || !gameDefinition.gameClass) {
      spinner.fail('Invalid game module');
      console.error(chalk.red('\nGame module must export gameDefinition with gameClass'));
      process.exit(1);
    }

    const GameClass = gameDefinition.gameClass;
    const gameType = gameDefinition.gameType || config.name;

    spinner.succeed('Game module loaded');

    // Import trainer
    spinner.start('Initializing weight optimizer...');

    const trainerModule = await import('../../ai-trainer/index.js');
    const { WeightEvolver, updateAIWeights } = trainerModule;

    spinner.succeed('Weight optimizer initialized');

    // Parse existing AI
    spinner.start('Parsing existing ai.ts...');
    const { parseExistingAI, parsedToLearned } = trainerModule;
    const existingAI = parseExistingAI(aiPath);

    if (!existingAI || existingAI.objectives.length === 0) {
      spinner.fail('No objectives found in ai.ts');
      console.error(chalk.red('\nThe existing ai.ts file has no objectives to optimize.'));
      console.error(chalk.dim('Use /generate-ai to create an AI with objectives first.'));
      process.exit(1);
    }

    const existingObjectives = parsedToLearned(existingAI.objectives);
    spinner.succeed(`Found ${existingObjectives.length} objectives to optimize`);

    if (options.verbose) {
      console.log(chalk.dim('\nExisting objectives:'));
      for (const obj of existingObjectives.slice(0, 5)) {
        console.log(chalk.dim(`  ${obj.featureId}: weight=${obj.weight.toFixed(1)}`));
      }
      if (existingObjectives.length > 5) {
        console.log(chalk.dim(`  ... and ${existingObjectives.length - 5} more`));
      }
    }

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

    // Report results
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

    // Update the ai.ts file with new weights
    spinner.start('Updating ai.ts with optimized weights...');

    const originalCode = readFileSync(aiPath, 'utf-8');
    const updatedCode = updateAIWeights(originalCode, result.objectives, {
      addMetadata: true,
      evolutionStats: {
        generations,
        population,
        initialWinRate: result.initialFitness,
        finalWinRate: result.bestFitness,
      },
    });

    writeFileSync(aiPath, updatedCode, 'utf-8');
    spinner.succeed(`Updated ${aiPath}`);

    // Summary
    console.log(chalk.green('\n=== Done ===\n'));
    console.log(chalk.dim('The ai.ts file has been updated with optimized weights.'));
    console.log(chalk.dim('All code structure (checker functions, imports) is preserved.\n'));

    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.dim('  1. Review the weight changes in ai.ts'));
    console.log(chalk.dim('  2. Test with: boardsmith dev --ai 1'));
    console.log(chalk.dim('  3. Run again with more generations for further optimization\n'));

  } catch (error) {
    spinner.fail('Weight evolution failed');
    console.error(chalk.red('\nError:'), error);

    if (options.verbose && error instanceof Error) {
      console.error(chalk.dim('\nStack trace:'));
      console.error(chalk.dim(error.stack));
    }

    process.exit(1);
  }
}
