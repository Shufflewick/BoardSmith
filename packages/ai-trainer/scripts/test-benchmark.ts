/**
 * Diagnostic test for benchmark win rate issue.
 *
 * Runs a quick benchmark to verify:
 * 1. Features are generated correctly
 * 2. Objectives are being used
 * 3. Per-position win rates are reported correctly
 *
 * Run with: npx tsx packages/ai-trainer/scripts/test-benchmark.ts
 */

import { resolve } from 'path';
import { introspectGame, createIntrospectionGame } from '../src/introspector.js';
import { generateCandidateFeatures } from '../src/feature-generator.js';
import { benchmarkAI } from '../src/benchmark.js';
import type { LearnedObjective, CandidateFeature } from '../src/types.js';

// Dynamically load the Hex game module
const hexModulePath = resolve(process.cwd(), 'packages/games/hex/rules/dist/index.js');
const hexModule = await import(`file://${hexModulePath}`);
const HexGame = hexModule.HexGame;

async function main() {
  console.log('=== Benchmark Diagnostic Test ===\n');

  // Step 1: Introspect game
  console.log('1. Introspecting Hex game...');
  const game = createIntrospectionGame(HexGame as any);
  const structure = introspectGame(game);
  console.log(`   Players: ${structure.playerCount}`);
  console.log(`   Game type: ${structure.gameType}`);
  console.log(`   Has board: ${structure.spatialInfo.hasBoard}`);
  console.log(`   Is hex: ${structure.spatialInfo.isHex}`);
  console.log(`   Dimensions: ${structure.spatialInfo.dimensions?.rows}x${structure.spatialInfo.dimensions?.cols}`);

  // Step 2: Generate features
  console.log('\n2. Generating candidate features...');
  const features = generateCandidateFeatures(structure);
  console.log(`   Generated ${features.length} features:`);

  // Group by category
  const byCategory = new Map<string, CandidateFeature[]>();
  for (const f of features) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }
  for (const [category, categoryFeatures] of byCategory) {
    console.log(`     ${category}: ${categoryFeatures.length}`);
    for (const f of categoryFeatures.slice(0, 3)) {
      console.log(`       - ${f.id}: ${f.description}`);
    }
    if (categoryFeatures.length > 3) {
      console.log(`       ... and ${categoryFeatures.length - 3} more`);
    }
  }

  // Step 3: Create objectives from USEFUL features (comparison + boolean, NOT score)
  console.log('\n3. Creating test objectives from useful features...');
  const usefulFeatures = features.filter(f =>
    f.category === 'comparison' || f.category === 'boolean'
  );
  console.log(`   Found ${usefulFeatures.length} useful features (comparison + boolean)`);

  const objectives: LearnedObjective[] = usefulFeatures.slice(0, 5).map((f, i) => ({
    featureId: f.id,
    description: f.description,
    weight: (5 - i) * 1.0, // Higher weights: 5.0, 4.0, 3.0, 2.0, 1.0
    checkerCode: '() => true',
    correlation: 0.1,
  }));

  for (const obj of objectives) {
    console.log(`   - ${obj.featureId}: weight=${obj.weight}`);
  }

  // Step 4: Simple test - just MCTS-50 vs MCTS-1, no objectives (baseline)
  console.log('\n4. BASELINE: MCTS-50 vs MCTS-1 (10 games as P0, no objectives)...');
  const baselineResult = await runOneSidedBenchmark(HexGame as any, 'hex', [], features, 10, 0, 50, 1);
  console.log(`   Result: ${baselineResult.wins}W / ${baselineResult.losses}L / ${baselineResult.draws}D`);
  console.log(`   Win rate: ${(baselineResult.winRate * 100).toFixed(1)}%`);

  // Step 5: Run benchmark WITH objectives
  console.log('\n5. WITH OBJECTIVES: MCTS-50 vs MCTS-1 (10 games as P0)...');
  const withObjResult = await runOneSidedBenchmark(HexGame as any, 'hex', objectives, features, 10, 0, 50, 1);
  console.log(`   Result: ${withObjResult.wins}W / ${withObjResult.losses}L / ${withObjResult.draws}D`);
  console.log(`   Win rate: ${(withObjResult.winRate * 100).toFixed(1)}%`);

  // Also test opponent at P0 to check first-player advantage
  console.log('\n6. BASELINE as P1: MCTS-50 vs MCTS-1 (10 games as P1, no objectives)...');
  const baselineP1Result = await runOneSidedBenchmark(HexGame as any, 'hex', [], features, 10, 1, 50, 1);
  console.log(`   Result: ${baselineP1Result.wins}W / ${baselineP1Result.losses}L / ${baselineP1Result.draws}D`);
  console.log(`   Win rate: ${(baselineP1Result.winRate * 100).toFixed(1)}%`);

  // Step 7: Run standard benchmark (position swap)
  console.log('\n7. Running standard benchmark with position swap (10 games)...');
  const standardResult = await benchmarkAI(
    HexGame as any,
    'hex',
    objectives,
    {
      gameCount: 10,
      mctsIterations: 15,
      timeout: 30000,
      maxActions: 100,
      seed: 'test-standard',
      features,
    }
  );
  console.log(`   Result: ${standardResult.wins}W / ${standardResult.losses}L / ${standardResult.draws}D`);
  console.log(`   Combined win rate: ${(standardResult.winRate * 100).toFixed(1)}%`);
  console.log(`   P0 win rate: ${(standardResult.winRateAsPlayer0 * 100).toFixed(1)}%`);
  console.log(`   P1 win rate: ${(standardResult.winRateAsPlayer1 * 100).toFixed(1)}%`);

  // Analysis
  console.log('\n=== Analysis ===');

  console.log('\n1. MCTS strength test (baseline vs MCTS-1):');
  if (baselineResult.winRate > 0.6) {
    console.log(`   ✓ MCTS-50 wins ${(baselineResult.winRate * 100).toFixed(0)}% as P0 - stronger bot works`);
  } else if (baselineResult.winRate < 0.4) {
    console.log(`   ❌ MCTS-50 loses ${((1 - baselineResult.winRate) * 100).toFixed(0)}% as P0 - something is WRONG`);
    console.log(`      This should never happen - higher iterations should win more`);
  } else {
    console.log(`   ⚠ MCTS-50 wins ${(baselineResult.winRate * 100).toFixed(0)}% as P0 - marginal difference`);
  }

  console.log('\n2. First-player advantage test:');
  console.log(`   P0 win rate: ${(baselineResult.winRate * 100).toFixed(0)}%`);
  console.log(`   P1 win rate: ${(baselineP1Result.winRate * 100).toFixed(0)}%`);
  if (baselineResult.winRate > baselineP1Result.winRate + 0.1) {
    console.log('   ✓ First-player advantage confirmed (P0 > P1)');
  } else {
    console.log('   ⚠ No clear first-player advantage');
  }

  console.log('\n3. Objectives effect test:');
  if (withObjResult.winRate === baselineResult.winRate) {
    console.log('   ❌ PROBLEM: Win rates identical with/without objectives');
    console.log('   Objectives are not affecting MCTS decisions');
  } else {
    const diff = withObjResult.winRate - baselineResult.winRate;
    console.log(`   ${diff > 0 ? '✓' : '⚠'} Objectives effect: ${diff > 0 ? '+' : ''}${(diff * 100).toFixed(1)}% difference`);
  }

  console.log('\n4. Position swap effect (standard benchmark):');
  console.log(`   Combined win rate: ${(standardResult.winRate * 100).toFixed(0)}%`);
  console.log(`   P0 win rate: ${(standardResult.winRateAsPlayer0 * 100).toFixed(0)}%`);
  console.log(`   P1 win rate: ${(standardResult.winRateAsPlayer1 * 100).toFixed(0)}%`);

  if (Math.abs(standardResult.winRate - 0.5) < 0.05) {
    console.log('   ⚠ Combined ~50% - position swap is canceling everything out');
  }

  console.log('\nDone!');
}

/**
 * Run benchmark with all games as a specific player position (no position swap)
 */
async function runOneSidedBenchmark(
  GameClass: any,
  gameType: string,
  objectives: LearnedObjective[],
  features: CandidateFeature[],
  gameCount: number,
  playerIndex: number,
  trainedMctsIterations: number = 50,
  opponentMctsIterations: number = 1
): Promise<{ wins: number; losses: number; draws: number; winRate: number }> {
  // Import the benchmark internals we need
  const { GameRunner } = await import('@boardsmith/runtime');
  const { createBot } = await import('@boardsmith/ai');

  let wins = 0;
  let losses = 0;
  let draws = 0;

  // Build feature map for objectives
  const featureMap = new Map(features.map(f => [f.id, f]));

  // Create objectives function
  const aiObjectives = objectives.length > 0
    ? (game: any, pIdx: number) => {
        const result: Record<string, { checker: () => boolean; weight: number }> = {};
        for (const obj of objectives) {
          const feature = featureMap.get(obj.featureId);
          if (!feature) continue;
          result[obj.featureId] = {
            checker: () => feature.evaluate(game, pIdx),
            weight: obj.weight,
          };
        }
        return result;
      }
    : undefined;

  for (let i = 0; i < gameCount; i++) {
    const runner = new GameRunner({
      GameClass,
      gameType,
      gameOptions: {
        playerCount: 2,
        seed: `test-${playerIndex}-${i}`,
      },
    });

    let flowState = runner.start();
    const trainedPlayer = playerIndex;
    const opponentPlayer = 1 - playerIndex;
    let actionCount = 0;
    const maxActions = 100;

    while (!flowState.complete && actionCount < maxActions) {
      if (!flowState.awaitingInput) break;
      // currentPlayer is a POSITION (1-indexed), trainedPlayer is an INDEX (0-indexed)
      const currentPlayer = flowState.currentPlayer;
      if (currentPlayer === undefined) break;

      const availableActions = flowState.availableActions ?? [];
      if (availableActions.length === 0) break;

      let action: string;
      let args: Record<string, unknown>;

      // Convert index to position for comparison
      const trainedPosition = trainedPlayer + 1;
      if (currentPlayer === trainedPosition) {
        // Trained AI with MCTS + objectives
        const bot = createBot(
          runner.game,
          GameClass,
          gameType,
          currentPlayer,
          runner.actionHistory,
          trainedMctsIterations,
          aiObjectives ? { objectives: aiObjectives } : undefined
        );
        const move = await bot.play();
        action = move.action;
        args = move.args;
      } else {
        // Opponent with minimal MCTS
        const bot = createBot(
          runner.game,
          GameClass,
          gameType,
          currentPlayer,
          runner.actionHistory,
          opponentMctsIterations
        );
        const move = await bot.play();
        action = move.action;
        args = move.args;
      }

      const result = runner.performAction(action, currentPlayer, args);
      if (!result.success) break;

      actionCount++;
      flowState = runner.getFlowState() ?? flowState;
    }

    // Determine outcome
    if (!flowState.complete) {
      draws++;
      continue;
    }

    // winners contains player POSITIONS (1-indexed), not indices (0-indexed)
    const winners = (runner.game.settings.winners as number[]) ?? [];
    const trainedPosition = trainedPlayer + 1;
    const opponentPosition = opponentPlayer + 1;

    if (winners.length === 0) {
      draws++;
    } else if (winners.includes(trainedPosition)) {
      if (winners.includes(opponentPosition)) {
        draws++;
      } else {
        wins++;
      }
    } else {
      losses++;
    }
  }

  const total = wins + losses + draws;
  return {
    wins,
    losses,
    draws,
    winRate: total > 0 ? wins / total : 0,
  };
}

main().catch(console.error);
