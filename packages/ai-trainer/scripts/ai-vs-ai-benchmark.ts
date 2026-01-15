/**
 * AI vs AI benchmark for testing MCTS improvements.
 *
 * Runs games between two AIs with identical settings to measure
 * if MCTS changes improve strategy quality.
 *
 * Run with: npx tsx packages/ai-trainer/scripts/ai-vs-ai-benchmark.ts
 */

import { resolve } from 'path';
import { GameRunner } from '@boardsmith/runtime';
import { createBot } from '@boardsmith/ai';

// Configuration
const GAME_COUNT = 40;
const MCTS_ITERATIONS = 100; // Same for both players
const MAX_ACTIONS = 200;
const TIMEOUT_MS = 30000;

interface BenchmarkResult {
  player1Wins: number;
  player2Wins: number;
  draws: number;
  totalGames: number;
  avgMovesPerGame: number;
  avgTimePerGame: number;
}

async function runAIvsAIBenchmark(): Promise<BenchmarkResult> {
  // Load the Hex game module
  const hexModulePath = resolve(process.cwd(), 'packages/games/hex/rules/dist/index.js');
  const hexModule = await import(`file://${hexModulePath}`);
  const HexGame = hexModule.HexGame;
  const getHexObjectives = hexModule.getHexObjectives;

  let player1Wins = 0;
  let player2Wins = 0;
  let draws = 0;
  let totalMoves = 0;
  let totalTime = 0;

  console.log(`\nRunning ${GAME_COUNT} AI vs AI games (${MCTS_ITERATIONS} iterations each)...\n`);

  for (let gameNum = 0; gameNum < GAME_COUNT; gameNum++) {
    const startTime = Date.now();
    const seed = `ai-vs-ai-${gameNum}`;

    const runner = new GameRunner({
      GameClass: HexGame as any,
      gameType: 'hex',
      gameOptions: {
        playerCount: 2,
        seed,
      },
    });

    let flowState = runner.start();
    let actionCount = 0;

    while (!flowState.complete && actionCount < MAX_ACTIONS) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        console.log(`  Game ${gameNum + 1}: Timeout after ${actionCount} moves`);
        break;
      }
      if (!flowState.awaitingInput) break;

      const currentPlayer = flowState.currentPlayer;
      if (currentPlayer === undefined) break;

      const availableActions = flowState.availableActions ?? [];
      if (availableActions.length === 0) break;

      // Both players use identical MCTS settings with objectives
      const bot = createBot(
        runner.game,
        HexGame as any,
        'hex',
        currentPlayer,
        runner.actionHistory,
        MCTS_ITERATIONS,
        { objectives: getHexObjectives }
      );

      const move = await bot.play();
      const result = runner.performAction(move.action, currentPlayer, move.args);
      if (!result.success) break;

      actionCount++;
      flowState = runner.getFlowState() ?? flowState;
    }

    const gameTime = Date.now() - startTime;
    totalMoves += actionCount;
    totalTime += gameTime;

    // Determine outcome
    const winners = (runner.game.settings.winners as number[]) ?? [];
    let outcome: string;

    if (!flowState.complete || winners.length === 0) {
      draws++;
      outcome = 'Draw';
    } else if (winners.includes(1) && !winners.includes(2)) {
      player1Wins++;
      outcome = 'P1 wins';
    } else if (winners.includes(2) && !winners.includes(1)) {
      player2Wins++;
      outcome = 'P2 wins';
    } else {
      draws++;
      outcome = 'Draw';
    }

    console.log(`  Game ${gameNum + 1}: ${outcome} (${actionCount} moves, ${(gameTime / 1000).toFixed(1)}s)`);
  }

  return {
    player1Wins,
    player2Wins,
    draws,
    totalGames: GAME_COUNT,
    avgMovesPerGame: totalMoves / GAME_COUNT,
    avgTimePerGame: totalTime / GAME_COUNT,
  };
}

async function main() {
  console.log('=== AI vs AI Benchmark ===');
  console.log('Testing MCTS strategy quality with identical settings');
  console.log('Player 1 connects top-bottom, Player 2 connects left-right');

  const result = await runAIvsAIBenchmark();

  console.log('\n=== Results ===');
  console.log(`Player 1 wins: ${result.player1Wins} (${((result.player1Wins / result.totalGames) * 100).toFixed(1)}%)`);
  console.log(`Player 2 wins: ${result.player2Wins} (${((result.player2Wins / result.totalGames) * 100).toFixed(1)}%)`);
  console.log(`Draws: ${result.draws} (${((result.draws / result.totalGames) * 100).toFixed(1)}%)`);
  console.log(`\nAvg moves/game: ${result.avgMovesPerGame.toFixed(1)}`);
  console.log(`Avg time/game: ${(result.avgTimePerGame / 1000).toFixed(2)}s`);

  // In Hex, Player 1 typically has a slight first-move advantage
  // We expect ~55-60% P1 wins in balanced play
  const p1WinRate = result.player1Wins / result.totalGames;
  if (p1WinRate > 0.45 && p1WinRate < 0.65) {
    console.log('\n✓ Results look balanced (expected P1 slight advantage)');
  } else if (p1WinRate < 0.3 || p1WinRate > 0.7) {
    console.log('\n⚠ Results seem unbalanced - may indicate AI issues');
  }
}

main().catch(console.error);
