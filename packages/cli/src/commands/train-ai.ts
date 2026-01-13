import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { cpus } from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import type { Game, GameOptions } from '@boardsmith/engine';
import type { TrainingProgress, LearnedObjective, LearnedActionPreference, FeatureStats, ActionStats, CandidateFeature, GameStructure } from '@boardsmith/ai-trainer';

interface TrainAIOptions {
  games?: string;
  iterations?: string;
  output?: string;
  verbose?: boolean;
  mcts?: string;
  fresh?: boolean;
  parallel?: boolean;
  workers?: string;
}

export async function trainAICommand(options: TrainAIOptions): Promise<void> {
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

  console.log(chalk.cyan(`\nTraining AI for ${gameName}...\n`));

  // Parse options
  const gamesPerIteration = parseInt(options.games || '200', 10);
  const iterations = parseInt(options.iterations || '5', 10);
  const mctsIterations = parseInt(options.mcts || '15', 10);
  const outputPath = options.output || join(cwd, 'src', 'rules', 'ai.ts');
  const parallelMode = options.parallel ?? false;
  const workerCount = options.workers ? parseInt(options.workers, 10) : Math.max(1, cpus().length - 1);

  // Check for existing ai.ts to build upon
  const existingAIPath = (!options.fresh && existsSync(outputPath)) ? outputPath : undefined;

  console.log(chalk.dim(`  Games per iteration: ${gamesPerIteration}`));
  console.log(chalk.dim(`  Iterations: ${iterations}`));
  console.log(chalk.dim(`  MCTS iterations: ${mctsIterations}`));
  console.log(chalk.dim(`  Output: ${outputPath}`));
  if (parallelMode) {
    console.log(chalk.cyan(`  Parallel mode: enabled (${workerCount} workers)`));
  } else {
    console.log(chalk.dim(`  Parallel mode: disabled`));
  }
  if (existingAIPath) {
    console.log(chalk.yellow(`  Building on existing: ${outputPath}`));
  }
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

    // Import trainer (dynamically to avoid build issues)
    spinner.start('Initializing AI trainer...');

    // Use dynamic import for the trainer
    const trainerModule = await import('@boardsmith/ai-trainer');
    const { AITrainer, generateAICode, introspectGame, generateCandidateFeatures, printGameStructure, estimateComplexity } = trainerModule;

    spinner.succeed('AI trainer initialized');

    // Create introspection game
    spinner.start('Analyzing game structure...');
    const introGame = new GameClass({ playerCount: 2, seed: 'introspection' });
    const structure = introspectGame(introGame);

    // Estimate complexity and adjust MCTS if not explicitly set
    const complexity = estimateComplexity(structure);
    const effectiveMCTS = options.mcts ? mctsIterations : complexity.recommendedMCTS;

    spinner.succeed(`Game structure analyzed (complexity: ${complexity.category}, score: ${complexity.score})`);

    if (!options.mcts) {
      console.log(chalk.dim(`  Auto-detected MCTS iterations: ${effectiveMCTS} (based on game complexity)`));
    }

    if (options.verbose) {
      printGameStructure(structure);
    }

    // Generate candidate features
    spinner.start('Generating candidate features...');
    const features = generateCandidateFeatures(structure);
    spinner.succeed(`Generated ${features.length} candidate features`);

    if (options.verbose) {
      console.log(chalk.dim('\nFeature categories:'));
      const byCategory = new Map<string, number>();
      for (const f of features) {
        byCategory.set(f.category, (byCategory.get(f.category) || 0) + 1);
      }
      for (const [cat, count] of byCategory) {
        console.log(chalk.dim(`  ${cat}: ${count}`));
      }
    }

    // Run training
    spinner.start(`Training AI (${gamesPerIteration} games x ${iterations} iterations)...`);
    const startTime = Date.now();

    let result;

    if (parallelMode) {
      // Parallel path: bypass AITrainer and run parallel simulations directly
      const { runParallelSimulations, analyzeFeatures, analyzeActions, selectTopFeatures, correlationToWeight, parseExistingAI, parsedToLearned, mergeObjectives, getCumulativeStats } = trainerModule;

      // Load existing AI if available
      let existingAI = null;
      let existingObjectives: LearnedObjective[] = [];
      if (existingAIPath) {
        existingAI = parseExistingAI(existingAIPath);
        if (existingAI) {
          existingObjectives = parsedToLearned(existingAI.objectives);
        }
      }

      // Run parallel training iterations
      let allFeatureStats: FeatureStats[] = [];
      let allActionStats: ActionStats[] = [];
      let selectedFeatures: FeatureStats[] = [];
      let learnedObjectives: LearnedObjective[] = [...existingObjectives];
      let bestWinRate = 0;
      let totalStates = 0;
      let totalGamesPlayed = 0;

      for (let iteration = 1; iteration <= iterations; iteration++) {
        spinner.text = chalk.dim(`Iteration ${iteration}/${iterations}: Running parallel simulations...`);

        const simResults = await runParallelSimulations(
          modulePath,
          gameType,
          {
            gameCount: gamesPerIteration,
            playerCount: structure.playerCount,
            features,
            timeout: 60000,
            maxActions: 300,
            seed: `train-${Date.now()}-iter-${iteration}`,
            aiConfig: {
              useAI: true,
              iterations: effectiveMCTS,
              objectives: learnedObjectives.length > 0 ? learnedObjectives : undefined,
            },
            onProgress: (completed: number, total: number) => {
              if (completed % 20 === 0) {
                spinner.text = chalk.dim(
                  `Iteration ${iteration}/${iterations}: ` +
                  `${completed}/${total} games ` +
                  `(${selectedFeatures.length} features selected)`
                );
              }
            },
          },
          structure,
          { workerCount }
        );

        totalStates += simResults.totalStates;
        totalGamesPlayed += simResults.games.length;

        // Analyze results
        spinner.text = chalk.dim(`Iteration ${iteration}/${iterations}: Analyzing results...`);
        allFeatureStats = analyzeFeatures(simResults.games, features);
        allActionStats = analyzeActions(simResults.games);

        // Select top features
        selectedFeatures = selectTopFeatures(allFeatureStats, 20, 0.01);

        // Create learned objectives from selected features
        const newObjectives = selectedFeatures.map((stat: FeatureStats) => {
          const feature = features.find((f: CandidateFeature) => f.id === stat.featureId);
          if (!feature) return null;
          const weight = correlationToWeight(stat.correlation, 10);
          if (Math.abs(weight) < 0.5) return null;
          return {
            featureId: stat.featureId,
            description: feature.description,
            weight: Math.round(weight * 10) / 10,
            checkerCode: `() => /* ${feature.description} */ true`,
            correlation: stat.correlation,
          };
        }).filter((obj: LearnedObjective | null): obj is LearnedObjective => obj !== null);

        // Merge with existing objectives
        if (existingObjectives.length > 0) {
          learnedObjectives = mergeObjectives(existingObjectives, newObjectives, {
            decayFactor: 0.9,
            blendRatio: 0.4,
          });
        } else {
          learnedObjectives = newObjectives;
        }

        // Calculate win rate estimate
        const avgCorrelation = selectedFeatures.reduce(
          (sum: number, f: FeatureStats) => sum + Math.abs(f.correlation), 0
        ) / Math.max(1, selectedFeatures.length);
        bestWinRate = 0.5 + avgCorrelation * 0.3;
      }

      // Create action preferences
      const actionPreferences: LearnedActionPreference[] = allActionStats
        .map((stat: ActionStats) => {
          const winRateDiff = stat.winRateWhenTaken - stat.winRateWhenNotTaken;
          if (Math.abs(winRateDiff) < 0.05) return null;
          return {
            actionName: stat.actionName,
            contextFeatures: [] as string[],
            weight: Math.round(winRateDiff * 10 * 10) / 10,
          };
        })
        .filter((pref): pref is LearnedActionPreference => pref !== null)
        .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
        .slice(0, 10);

      // Calculate cumulative stats if building on existing
      const cumulativeStats = getCumulativeStats(
        existingAI?.metadata,
        { gamesPlayed: totalGamesPlayed, iterations }
      );

      result = {
        objectives: learnedObjectives,
        actionPreferences,
        featureStats: allFeatureStats,
        actionStats: allActionStats,
        metadata: {
          gamesPlayed: cumulativeStats.gamesPlayed,
          gamesCompleted: cumulativeStats.gamesPlayed,
          totalStates,
          candidateFeaturesGenerated: features.length,
          featuresSelected: learnedObjectives.length,
          iterations: cumulativeStats.iterations,
          finalWinRate: bestWinRate,
        },
      };
    } else {
      // Non-parallel path: use AITrainer as before
      const trainer = new AITrainer(GameClass, gameType, {
        gamesPerIteration,
        iterations,
        mctsIterations: effectiveMCTS,
        existingAIPath,
        seed: `train-${Date.now()}`,
        onProgress: (progress: TrainingProgress) => {
          if (progress.gamesCompleted > 0 && progress.gamesCompleted % 20 === 0) {
            spinner.text = chalk.dim(
              `Iteration ${progress.iteration}/${progress.totalIterations}: ` +
              `${progress.gamesCompleted}/${progress.totalGames} games ` +
              `(${progress.featuresSelected} features selected)`
            );
          }
        },
      });

      result = await trainer.train();
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    spinner.succeed(`Training complete in ${duration}s`);

    // Report results
    console.log(chalk.green('\n=== Training Results ===\n'));
    console.log(`  Games played: ${result.metadata.gamesPlayed}`);
    console.log(`  States analyzed: ${result.metadata.totalStates}`);
    console.log(`  Features discovered: ${result.objectives.length}`);
    console.log(`  Estimated win rate: ${(result.metadata.finalWinRate * 100).toFixed(1)}%`);

    if (result.objectives.length > 0) {
      console.log(chalk.cyan('\nTop objectives:'));
      for (const obj of result.objectives.slice(0, 5)) {
        const sign = obj.weight > 0 ? '+' : '';
        console.log(chalk.dim(`  ${obj.featureId}: ${sign}${obj.weight.toFixed(1)} - ${obj.description}`));
      }
    }

    if (result.actionPreferences.length > 0) {
      console.log(chalk.cyan('\nAction preferences:'));
      for (const pref of result.actionPreferences.slice(0, 3)) {
        const verb = pref.weight > 0 ? 'prefer' : 'avoid';
        console.log(chalk.dim(`  ${pref.actionName}: ${verb} (${pref.weight > 0 ? '+' : ''}${pref.weight.toFixed(1)})`));
      }
    }

    // Generate code
    spinner.start('Generating ai.ts...');

    const code = generateAICode(result, {
      gameClassName: GameClass.name,
      playerClassName: undefined, // Could be detected
      includeMetadata: true,
      includeActionHints: true,
      structure,
      features,
    });

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(outputPath, code, 'utf-8');
    spinner.succeed(`Generated ${outputPath}`);

    // Summary
    console.log(chalk.green('\n=== Done ===\n'));
    console.log(chalk.dim('The generated ai.ts file contains:'));
    console.log(chalk.dim(`  - ${result.objectives.length} learned objectives with weights`));
    console.log(chalk.dim(`  - Training metadata as comments`));
    console.log(chalk.dim(`  - Action preference hints\n`));

    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.dim('  1. Review the generated ai.ts file'));
    console.log(chalk.dim('  2. Test with: boardsmith dev --ai 1'));
    console.log(chalk.dim('  3. Re-run training with more games for better results\n'));

  } catch (error) {
    spinner.fail('Training failed');
    console.error(chalk.red('\nError:'), error);

    if (options.verbose && error instanceof Error) {
      console.error(chalk.dim('\nStack trace:'));
      console.error(chalk.dim(error.stack));
    }

    process.exit(1);
  }
}
